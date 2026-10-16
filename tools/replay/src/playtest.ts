// Speeltest-bot: plays about 15 in-game minutes against the AI through the REAL HUD only (mouse and keyboard at human
// speed: moves in steps, press and release with ~120 ms in between). No sendCommand, no sim access. `window.crawlout`
// is read only for assertions and logging (status, entities, camera target, pickAt to find where something is on screen).
//
// Scenario: gather with the scavengers (roster click + right click on a node), the builder builds a house, a
// workshop, a lab, a training facility and later a robot factory (B menu, placement on free ground found by trying),
// research Geweerrek, Raffinage and Robotica from the buildings bar and the cards, craft militia, produce robots, train
// one SPECIAL point, group-move the army (formation), attack-move toward a claim point, use the hero ability, pan and
// zoom the camera, deselect by a click on empty ground and with Escape, select buildings by clicking their roofs.
// Every step logs time, expectation, observation (status, queue, selection text) and takes a screenshot. The perf badge
// is sampled over time. At the end a findings list is printed.
//
// Needs a running client and Chrome (Playwright channel 'chrome'); not part of `pnpm test`.
//   PLAYTEST_URL=http://localhost:5190/ PLAYTEST_SHOTS=/some/dir PLAYTEST_SIZES=1600x900,1280x720 \
//     PLAYTEST_MINUTES=15 node --import tsx src/playtest.ts
// Sim time runs on Playwright's fake clock (runFor) so 15 game minutes take a few real minutes; every input is still
// real-time human speed. The perf badge is sampled in real-time stretches only (fast-forward frames say nothing).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';

const URL = process.env.PLAYTEST_URL ?? 'http://localhost:5190/';
const SHOTS = process.env.PLAYTEST_SHOTS;
const MINUTES = Number(process.env.PLAYTEST_MINUTES ?? 15);
const SIZES: readonly [number, number][] = (process.env.PLAYTEST_SIZES ?? '1600x900,1280x720')
  .split(',')
  .map((s) => s.split('x').map(Number) as [number, number]);

type Severity = 'hoog' | 'midden' | 'laag';
interface Finding {
  size: string;
  severity: Severity;
  text: string;
  step: string;
}
interface Pt {
  x: number;
  y: number;
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Ent {
  id: number;
  t: number;
  x: number;
  y: number;
  owner: number;
  anim: number;
  hp: number;
}
interface PerfSample {
  game: number;
  text: string;
  fps: number;
  worst: number;
  cpu: number;
  dc: number;
}

const ALL_FINDINGS: Finding[] = [];
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const BUILDING_MIN = 1024;
const BUILDING_MAX = 2048;
const SCRAP_NODE = 2048;
const CLAIM_POINT = 2049;
const ANIM_BUILD = 6;
const TICK_HZ = 20;
/** Display names of the build menu per data key (BUILDING_NAMES in the client). */
const DUTCH: Record<string, string> = { trainingsfaciliteit: 'Training' };

// Code that runs in the page, as strings: this package has no DOM types.
const ENTS = `(() => { const c = window.crawlout; return [...c.entities().values()].map((e) => ({ id: e.id, t: e.typeId, x: e.x, y: e.y, owner: e.owner, anim: e.anim, hp: e.hpPct })); })()`;
const rectOf = (sel: string): string =>
  `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`;
const textOf = (sel: string): string =>
  `(() => document.querySelector(${JSON.stringify(sel)})?.innerText ?? '')()`;

/** Facts about the HUD layout that should hold at every size: panels on screen, no panel on another, no text out of its panel. */
const LAYOUT_AUDIT = `(() => {
  const issues = [];
  const W = innerWidth, H = innerHeight;
  const panels = ['.co-counters', '.co-hero', '.co-minimap', '.co-selection', '.co-roster', '.co-cards', '.co-commands', '.co-top-right', '#perf', '.co-targeting', '.co-dominance']
    .map((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width === 0 ? null : { s, r }; }).filter(Boolean);
  for (const p of panels) {
    if (p.r.left < -1 || p.r.top < -1 || p.r.right > W + 1 || p.r.bottom > H + 1) issues.push('paneel buiten beeld: ' + p.s + ' ' + [p.r.left, p.r.top, p.r.right, p.r.bottom].map(Math.round).join(','));
  }
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    const a = panels[i].r, b = panels[j].r;
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) issues.push('panelen overlappen: ' + panels[i].s + ' en ' + panels[j].s);
  }
  for (const el of document.querySelectorAll('.co-panel, .co-building-btn, .co-btn, .co-card-main')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    const cs = getComputedStyle(el);
    const label = el.className.toString().split(' ').slice(0, 2).join('.') + '"' + (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 24) + '"';
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') issues.push('tekst loopt horizontaal over: ' + label);
    if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll' && cs.overflowY !== 'hidden') issues.push('tekst loopt verticaal over: ' + label);
    if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY === 'hidden') issues.push('tekst afgesneden: ' + label);
    for (const d of el.querySelectorAll('*')) {
      const q = d.getBoundingClientRect();
      if (q.width === 0 || q.height === 0 || !(d.textContent || '').trim()) continue;
      if (q.right > r.right + 1.5 || q.left < r.left - 1.5) { issues.push('kindtekst buiten ' + label + ': ' + (d.textContent || '').slice(0, 24)); break; }
    }
  }
  return [...new Set(issues)];
})()`;

class Bot {
  readonly size: string;
  readonly findings: Finding[] = [];
  readonly perf: PerfSample[] = [];
  readonly log: string[] = [];
  private stepNo = 0;
  private curStep = 'start';
  private readonly seenLayout = new Set<string>();
  private readonly t0 = Date.now();
  mapMeters = 0;
  /** Number of placement clicks that were refused, per building. */
  readonly refused: Record<string, number> = {};

  constructor(
    readonly page: Page,
    readonly width: number,
    readonly height: number,
  ) {
    this.size = `${width}x${height}`;
  }

  // --- logging ---
  private stamp(): string {
    const s = Math.round((Date.now() - this.t0) / 1000);
    return `[real ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}]`;
  }
  say(line: string): void {
    const out = `${this.stamp()} ${line}`;
    this.log.push(out);
    console.log(out);
  }
  finding(severity: Severity, text: string): void {
    if (this.findings.some((f) => f.text === text)) return;
    const f: Finding = { size: this.size, severity, text, step: this.curStep };
    this.findings.push(f);
    ALL_FINDINGS.push(f);
    this.say(`  FINDING (${severity}): ${text}`);
  }
  /** Asserts what the step expected; a miss becomes a finding. */
  expect(ok: boolean, what: string, severity: Severity = 'midden', detail = ''): boolean {
    this.say(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
    if (!ok) this.finding(severity, `${what}${detail ? ` (${detail})` : ''}`);
    return ok;
  }

  // --- reading the game (assertions and logging only) ---
  ev<T>(code: string): Promise<T> {
    return this.page.evaluate(code) as Promise<T>;
  }
  ents(): Promise<Ent[]> {
    return this.ev<Ent[]>(ENTS);
  }
  async me(): Promise<number> {
    return this.ev<number>(`window.crawlout.session.playerId`);
  }
  async own(): Promise<Ent[]> {
    const me = await this.me();
    return (await this.ents()).filter((e) => e.owner === me);
  }
  async hq(): Promise<Ent> {
    const hq = (await this.buildings())[0];
    if (!hq) throw new Error('geen hoofdgebouw meer');
    return hq;
  }
  async buildings(): Promise<Ent[]> {
    return (await this.own()).filter((e) => e.t >= BUILDING_MIN && e.t < BUILDING_MAX);
  }
  status(): Promise<{
    scrap: number;
    settlers: number;
    pop: number;
    popCap: number;
    robotPop?: number;
    techs: number[];
    trained?: number[];
    queue: { kind: string; id: number; buildingId: number; progressPermille: number }[];
    hero?: { level: number; xp: number; state: string; abilityCooldownTicks?: number[] };
  }> {
    return this.ev(`window.crawlout.status()`);
  }
  gameSeconds(): Promise<number> {
    return this.ev<number>(`window.crawlout.session.frame / ${TICK_HZ}`);
  }
  text(sel: string): Promise<string> {
    return this.ev<string>(textOf(sel));
  }
  async selection(): Promise<string> {
    return (await this.text('.co-selection')).replace(/\s+/g, ' ').trim();
  }

  /** One line with everything a player can read off the screen. */
  async observe(): Promise<string> {
    const s = await this.status().catch(() => null);
    const sel = await this.selection();
    const notice = (await this.text('.co-card-notice')).trim();
    const mode = (await this.text('.co-targeting')).trim();
    const q = (s?.queue ?? []).map(
      (i) => `${i.kind}#${i.id}@${Math.round(i.progressPermille / 10)}%`,
    );
    const t = Math.round(await this.gameSeconds());
    return [
      `game ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`,
      s ? `scrap ${s.scrap}, pop ${s.pop}/${s.popCap}, robots ${s.robotPop ?? 0}` : 'geen status',
      `queue [${q.join(' ')}]`,
      `selectie "${sel.slice(0, 60)}"`,
      notice ? `melding "${notice}"` : '',
      mode ? `modus "${mode.slice(0, 50)}"` : '',
    ]
      .filter((x) => x !== '')
      .join(' | ');
  }

  async shot(name: string): Promise<void> {
    if (SHOTS) await this.page.screenshot({ path: `${SHOTS}/${this.size}-${name}.png` });
  }

  /** A step: what is expected, run it, what happened (observation), screenshot, layout audit, perf sample. */
  async step(name: string, expected: string, fn: () => Promise<void>): Promise<void> {
    this.stepNo++;
    const id = `${String(this.stepNo).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    this.curStep = id;
    this.say(`STEP ${id}`);
    this.say(`  verwacht: ${expected}`);
    try {
      await fn();
    } catch (e) {
      this.finding(
        'hoog',
        `stap ${id} mislukt: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
      );
    }
    this.say(
      `  gebeurd:  ${await this.observe().catch((e: Error) => `observatie mislukt: ${e.message}`)}`,
    );
    await this.shot(id);
    await this.layout();
  }

  async layout(): Promise<void> {
    const issues = await this.ev<string[]>(LAYOUT_AUDIT);
    for (const i of issues) {
      if (this.seenLayout.has(i)) continue;
      this.seenLayout.add(i);
      this.finding('midden', `layout ${this.size}: ${i}`);
    }
  }

  /** Reads the perf badge after a short real-time settle (never right after a fast-forward). */
  async samplePerf(): Promise<void> {
    await wait(1300);
    const text = (await this.text('#perf')).trim();
    const m = /(\d+) fps · ([\d.]+) ms · max (\d+) ms · (\d+) dc/.exec(text);
    if (!m) return;
    this.perf.push({
      game: Math.round(await this.gameSeconds()),
      text,
      fps: Number(m[1]),
      cpu: Number(m[2]),
      worst: Number(m[3]),
      dc: Number(m[4]),
    });
  }

  private lastPulse = -999;
  private pulses = 0;
  private readonly walkSeen = new Map<number, { x: number; y: number; n: number }>();
  /** A compact status line every 30 game seconds while waiting: scrap and what the settlers are doing. */
  async pulse(): Promise<void> {
    const t = await this.gameSeconds();
    if (t - this.lastPulse < 30) return;
    this.lastPulse = t;
    const s = await this.status();
    const mine = (await this.own()).filter((e) => e.t < BUILDING_MIN);
    const hist: Record<string, number> = {};
    for (const e of mine) hist[`${e.t}/a${e.anim}`] = (hist[`${e.t}/a${e.anim}`] ?? 0) + 1;
    const walkers = mine.filter((e) => e.anim === 1);
    for (const w of walkers) {
      const prev = this.walkSeen.get(w.id);
      if (prev && Math.hypot(prev.x - w.x, prev.y - w.y) < 256 * 0.5) {
        prev.n++;
        if (prev.n === 3)
          this.finding(
            'hoog',
            `eenheid ${w.id} (type ${w.t}) loopt-animatie maar staat >60 spelseconden stil op ${(w.x / 256).toFixed(0)},${(w.y / 256).toFixed(0)} (vast?)`,
          );
      } else this.walkSeen.set(w.id, { x: w.x, y: w.y, n: 0 });
    }
    for (const id of [...this.walkSeen.keys()])
      if (!walkers.some((w) => w.id === id)) this.walkSeen.delete(id);
    if (++this.pulses % 3 === 0) await this.samplePerf();
    this.say(
      `  . t=${Math.round(t)}s scrap ${s.scrap} pop ${s.pop}/${s.popCap} eenheden(type/anim) ${JSON.stringify(hist)}`,
    );
  }
  /** Idle scavengers (roster says "N vrij"): a player sends them to the next scrap node. */
  private lastTend = -999;
  private tending = false;
  async tendEconomy(): Promise<void> {
    if (this.tending) return;
    const now = await this.gameSeconds();
    if (now - this.lastTend < 40) return;
    const idleText = await this.ev<string>(
      `(() => { for (const b of document.querySelectorAll('.co-roster-group')) if (b.textContent.includes('Plunderaar')) return b.querySelector('.co-roster-idle')?.textContent ?? ''; return ''; })()`,
    );
    const idle = Number(/(\d+)/.exec(idleText)?.[1] ?? 0);
    if (idle === 0) return;
    this.tending = true;
    this.lastTend = now;
    try {
      const mode = await this.text('.co-targeting');
      if (mode.trim()) return;
      const ents = await this.ents();
      const hq = await this.hq();
      const nodes = ents
        .filter((e) => e.t === SCRAP_NODE)
        .sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y));
      const n = nodes[0];
      this.say(
        `  [bot] ${idle} plunderaars zonder taak; ${nodes.length} scrapbronnen over, dichtste op ${n ? (Math.hypot(n.x - hq.x, n.y - hq.y) / 256).toFixed(0) : '-'} m (hp ${n?.hp}%) - stuur ze opnieuw`,
      );
      this.finding(
        'midden',
        'nieuwe bewoners (en plunderaars zonder bron) staan zonder taak tot de speler ze handmatig naar een bron stuurt (roster toont "N vrij"); geen auto-verzamelen',
      );
      if (!n) return;
      await this.panTo((n.x + hq.x) / 2, (n.y + hq.y) / 2);
      if (!(await this.rosterGroup('Plunderaar'))) return;
      let cam = await this.cam();
      if (cam.d > 90) {
        await this.wheel(-240, 6);
        cam = await this.cam();
      }
      const p = await this.screenOf(n, [0, 1, 2, 0.5]);
      if (p) await this.click(p, { button: 'right' });
      else {
        this.say(
          `  [bot] bron ${n.id} niet te raken: camera ${JSON.stringify(cam)}, bron op ${(n.x / 256).toFixed(0)},${(n.y / 256).toFixed(0)}`,
        );
        this.finding('midden', 'scrapbron niet aanklikbaar bij herstart van het verzamelen');
      }
    } finally {
      this.tending = false;
    }
  }

  // --- time: sim minutes run on the fake clock, in slices so the worker keeps up ---
  async advance(seconds: number): Promise<void> {
    let left = seconds * 1000;
    while (left > 0) {
      const slice = Math.min(left, 4000);
      await this.page.clock.runFor(slice);
      await wait(120);
      left -= slice;
    }
  }
  /** Fast-forwards until `cond` holds; the game time cap yields a finding instead of waiting forever. */
  async until(
    what: string,
    cond: () => Promise<boolean>,
    maxGameSeconds: number,
    sliceS = 4,
  ): Promise<boolean> {
    const start = await this.gameSeconds();
    for (;;) {
      if (await cond()) return true;
      await this.tendEconomy();
      await this.pulse();
      if ((await this.gameSeconds()) - start > maxGameSeconds) {
        this.finding(
          'midden',
          `wachten op "${what}" duurde langer dan ${maxGameSeconds} spelseconden`,
        );
        return false;
      }
      await this.advance(sliceS);
    }
  }
  async gameOver(): Promise<boolean> {
    return (await this.gameSeconds()) >= MINUTES * 60;
  }

  // --- human input ---
  async move(p: Pt, steps = 8): Promise<void> {
    await this.page.mouse.move(p.x, p.y, { steps });
    await wait(60);
  }
  async click(
    p: Pt,
    opts: { button?: 'left' | 'right'; shift?: boolean; settle?: number } = {},
  ): Promise<void> {
    await this.move(p);
    if (opts.shift) await this.page.keyboard.down('Shift');
    await this.page.mouse.down({ button: opts.button ?? 'left' });
    await wait(120);
    await this.page.mouse.up({ button: opts.button ?? 'left' });
    if (opts.shift) await this.page.keyboard.up('Shift');
    await wait(opts.settle ?? 260);
  }
  async key(k: string, holdMs = 90): Promise<void> {
    await this.page.keyboard.down(k);
    await wait(holdMs);
    await this.page.keyboard.up(k);
    await wait(200);
  }
  async center(sel: string): Promise<Pt | null> {
    const r = await this.page
      .locator(sel)
      .first()
      .boundingBox({ timeout: 1500 })
      .catch(() => null);
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }
  /** Clicks a roster group by its name; false when there is no such button (or it is disabled). */
  async rosterGroup(naam: string, shift = false): Promise<boolean> {
    const sel = `.co-roster-groups button:has-text("${naam}")`;
    const p = await this.center(sel);
    if (!p) return false;
    if (await this.page.locator(sel).first().isDisabled()) return false;
    await this.click(p, { shift });
    return true;
  }
  async buildingButton(key: string): Promise<boolean> {
    const p = await this.center(`[data-building="${key}"]`);
    if (!p) return false;
    await this.click(p);
    return true;
  }
  /** Cards in the card window with their name, state, reason (tooltip) and screen box. */
  cards(): Promise<{ naam: string; state: string; kind: string; title: string; box: Box }[]> {
    return this.ev(`(() => [...document.querySelectorAll('.co-card')].map((li) => {
      const b = li.querySelector('button.co-card-main'); const r = b.getBoundingClientRect();
      return { naam: li.querySelector('.co-card-name')?.textContent ?? '', state: li.getAttribute('data-state') ?? '', kind: b.getAttribute('data-card-kind') ?? '', title: b.getAttribute('title') ?? '', box: { x: r.x, y: r.y, w: r.width, h: r.height } };
    }))()`);
  }
  /** Clicks the card with this name; returns its state before the click (null: no such card). */
  async clickCard(naam: string): Promise<string | null> {
    const c = (await this.cards()).find((k) => k.naam === naam);
    if (!c) return null;
    const inside =
      c.box.y >= 0 && c.box.y + c.box.h <= this.height && c.box.x + c.box.w <= this.width;
    if (!inside) this.finding('midden', `kaart "${naam}" valt buiten het scherm op ${this.size}`);
    await this.click({ x: c.box.x + c.box.w / 2, y: c.box.y + c.box.h / 2 }, { settle: 400 });
    return c.state;
  }

  // --- camera ---
  cam(): Promise<{ x: number; z: number; d: number }> {
    return this.ev(
      `(() => { const c = window.crawlout.renderer.cameraControls; return { x: c.target.x, z: c.target.z, d: c.distance }; })()`,
    );
  }
  async wheel(dy: number, times: number): Promise<void> {
    await this.page.mouse.move(this.width / 2, this.height / 2);
    for (let i = 0; i < times; i++) {
      await this.page.mouse.wheel(0, dy);
      await wait(70);
    }
    await wait(700);
  }
  /** Moves the camera to a sim position by clicking the minimap (a human does that); refines once. */
  async panTo(x: number, y: number): Promise<void> {
    const mm = await this.ev<Box | null>(rectOf('.co-minimap canvas'));
    if (!mm) {
      this.finding('midden', 'geen minimap om de camera mee te verplaatsen');
      return;
    }
    if (this.mapMeters === 0) {
      await this.click({ x: mm.x + mm.w / 2, y: mm.y + mm.h / 2 });
      await wait(900);
      this.mapMeters = (await this.cam()).x * 2;
    }
    const wantX = x / 256;
    const wantZ = y / 256;
    for (let i = 0; i < 2; i++) {
      const fx = Math.min(0.98, Math.max(0.02, wantX / this.mapMeters));
      const fy = Math.min(0.98, Math.max(0.02, wantZ / this.mapMeters));
      await this.click({ x: mm.x + fx * mm.w, y: mm.y + fy * mm.h });
      await wait(900);
      const c = await this.cam();
      if (Math.hypot(c.x - wantX, c.z - wantZ) < 6) break;
    }
  }
  /** Screen point of an entity: probe a projection grid around its position with pickAt until it is hit. */
  async screenOf(e: Ent, heights: number[] = [0, 1.5, 3]): Promise<Pt | null> {
    return this.ev<Pt | null>(`(() => {
      const c = window.crawlout, ctl = c.renderer.cameraControls, cam = ctl.camera; cam.updateMatrixWorld();
      const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
      const cv = document.getElementById('view');
      const proj = (x, y, z) => { const wy = ctl.target.y + y;
        const vx = v[0]*x+v[4]*wy+v[8]*z+v[12], vy = v[1]*x+v[5]*wy+v[9]*z+v[13], vz = v[2]*x+v[6]*wy+v[10]*z+v[14];
        const cx = p[0]*vx+p[4]*vy+p[8]*vz+p[12], cy = p[1]*vx+p[5]*vy+p[9]*vz+p[13], cw = p[3]*vx+p[7]*vy+p[11]*vz+p[15];
        return cw <= 0 ? null : { x: (cx / cw + 1) / 2 * cv.clientWidth, y: (1 - cy / cw) / 2 * cv.clientHeight }; };
      const ok = (pt) => pt && pt.x > 4 && pt.y > 4 && pt.x < innerWidth - 4 && pt.y < innerHeight - 4 && document.elementFromPoint(pt.x, pt.y)?.id === 'view';
      for (const h of ${JSON.stringify(heights)}) {
        const base = proj(${e.x} / 256, h, ${e.y} / 256);
        if (!base) continue;
        for (const [dx, dy] of [[0,0],[0,-8],[0,8],[-8,0],[8,0],[0,-16],[0,16],[-16,0],[16,0],[12,12],[-12,-12],[12,-12],[-12,12],[0,-30],[0,30]]) {
          const pt = { x: base.x + dx, y: base.y + dy };
          if (ok(pt) && c.renderer.pickAt(pt.x, pt.y).entityId === ${e.id}) return pt;
        }
      }
      for (const h of ${JSON.stringify(heights)}) {
        const base = proj(${e.x} / 256, h, ${e.y} / 256);
        if (!base) continue;
        for (let dy = -40; dy <= 40; dy += 5) for (let dx = -40; dx <= 40; dx += 5) {
          const pt = { x: base.x + dx, y: base.y + dy };
          if (ok(pt) && c.renderer.pickAt(pt.x, pt.y).entityId === ${e.id}) return pt;
        }
      }
      return null;
    })()`);
  }
  /** A scan of the visible canvas: ground points (sim units) with what is hit there. */
  groundGrid(
    step = 40,
  ): Promise<{ px: number; py: number; gx: number; gy: number; eid: number | null }[]> {
    return this.ev(`(() => {
      const out = []; const r = window.crawlout.renderer;
      for (let py = 60; py < innerHeight - 20; py += ${step}) for (let px = 20; px < innerWidth - 20; px += ${step}) {
        if (document.elementFromPoint(px, py)?.id !== 'view') continue;
        const h = r.pickAt(px, py); if (!h.ground) continue;
        out.push({ px, py, gx: h.ground.x, gy: h.ground.y, eid: h.entityId });
      }
      return out;
    })()`);
  }
  /** An empty ground spot on screen, as far as possible from every entity. */
  async emptySpot(): Promise<Pt> {
    const grid = (await this.groundGrid(50)).filter((g) => g.eid === null);
    const ents = await this.ents();
    let best: Pt | null = null;
    let bestD = -1;
    for (const g of grid) {
      let d = Infinity;
      for (const e of ents) d = Math.min(d, Math.hypot(e.x - g.gx, e.y - g.gy));
      if (d > bestD) {
        bestD = d;
        best = { x: g.px, y: g.py };
      }
    }
    if (!best) throw new Error('geen lege grond op het scherm');
    return best;
  }
}

/** Places a building through the B menu on free ground: tries candidate spots near the base until one is accepted. */
async function placeBuilding(bot: Bot, naam: string, builderGroup = 'Bouwer'): Promise<Ent | null> {
  const before = await bot.buildings();
  const hq = before[0];
  if (!(await bot.rosterGroup(builderGroup))) {
    bot.finding('hoog', `geen ${builderGroup}-knop in de roster om ${naam} te bouwen`);
    return null;
  }
  const nameNow = await bot.selection();
  bot.expect(
    /Bouwer/.test(nameNow),
    'bouwer geselecteerd via de roster',
    'midden',
    nameNow.slice(0, 40),
  );
  await bot.key('b');
  const opt = bot.page
    .locator(
      `.co-build-option[aria-label^="${naam}," i], .co-build-option[aria-label^="${DUTCH[naam] ?? naam},"]`,
    )
    .first();
  if (!(await opt.count())) {
    bot.finding('hoog', `bouwmenu toont "${naam}" niet`);
    await bot.key('Escape');
    return null;
  }
  if (await opt.isDisabled()) {
    bot.finding(
      'laag',
      `bouwoptie "${naam}" is uitgeschakeld (te duur?) terwijl de bot hem wil kiezen`,
    );
    await bot.key('Escape');
    return null;
  }
  const optLabel = (await opt.getAttribute('aria-label')) ?? '';
  if (/^[a-z_]/.test(optLabel))
    bot.finding(
      'laag',
      `bouwmenu toont de ruwe datasleutel "${optLabel.split(',')[0]}" in plaats van de Nederlandse naam (getBuildOptions gebruikt b.key, niet buildingName)`,
    );
  const box = await opt.boundingBox();
  if (box) await bot.click({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  bot.expect(
    /Plaats/.test(await bot.text('.co-targeting')),
    `na de keuze staat de plaatsbalk er ("Plaats ${naam}")`,
    'hoog',
    optLabel,
  );
  // Candidate spots: visible ground free of entities, near the base, away from every building.
  const grid = (await bot.groundGrid(34))
    .filter((g) => g.eid === null)
    .map((g) => ({
      ...g,
      d: hq ? Math.hypot(g.gx - hq.x, g.gy - hq.y) / 256 : 0,
      near: Math.min(...before.map((b) => Math.hypot(g.gx - b.x, g.gy - b.y) / 256)),
    }))
    .filter((g) => g.near > 24)
    .sort((a, b) => a.d - b.d);
  const tried: string[] = [];
  const candidates = grid.filter((_, i) => i % 3 === 0).slice(0, 18);
  for (const c of candidates) {
    await bot.move({ x: c.px, y: c.py }, 10);
    await wait(150);
    await bot.click({ x: c.px, y: c.py }, { settle: 500 });
    const stillPlacing = /Plaats/.test(await bot.text('.co-targeting'));
    if (!stillPlacing) {
      // the click was accepted: a new site should appear
      await bot.advance(1);
      await wait(300);
      const after = await bot.buildings();
      const added = after.filter((a) => !before.some((b) => b.id === a.id));
      bot.expect(
        added.length > 0,
        `na plaatsen verschijnt een bouwplaats voor ${naam}`,
        'hoog',
        `${tried.length} geweigerde plekken`,
      );
      bot.refused[naam] = tried.length;
      if (tried.length >= 12)
        bot.finding(
          'midden',
          `plaatsing van ${naam}: ${tried.length} zichtbaar vrije plekken geweigerd voor er een werd geaccepteerd (de preview is rood, maar de speler zoekt zo lang)`,
        );
      return added[0] ?? null;
    }
    if (tried.length === 0) await bot.shot(`placement-refused-${naam}`);
    tried.push(`${Math.round(c.gx / 256)},${Math.round(c.gy / 256)}`);
  }
  bot.finding(
    'hoog',
    `plaatsing van ${naam}: alle ${tried.length} plekken geweigerd (altijd rood?) ${tried.join(' ')}`,
  );
  await bot.key('Escape');
  return null;
}

/** Waits until a new building of this site is finished (anim not build). */
async function untilBuilt(bot: Bot, site: Ent | null, naam: string, maxS = 240): Promise<boolean> {
  if (!site) return false;
  return bot.until(
    `${naam} klaar`,
    async () => {
      const e = (await bot.own()).find((x) => x.id === site.id);
      return !!e && e.anim !== ANIM_BUILD;
    },
    maxS,
  );
}

async function run(width: number, height: number): Promise<Bot> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });
  const page: Page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const bot = new Bot(page, width, height);
  console.log(`\n===== ${bot.size} =====`);
  page.on('pageerror', (e) => bot.finding('hoog', `pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404/.test(m.text()))
      bot.finding('laag', `console error: ${m.text().slice(0, 140)}`);
  });
  await page.clock.install();
  await page.goto(URL);
  await page.clock.resume();
  await page.waitForFunction(`window.crawlout && window.crawlout.entities().size > 10`, null, {
    timeout: 60000,
  });
  await wait(2500);

  await bot.step(
    'start',
    'spel gestart: 300 scrap, 6 bewoners, pop 6/6, held en 1 bouwer',
    async () => {
      const s = await bot.status();
      bot.expect(
        s.scrap === 300 && s.settlers === 6,
        'startstatus 300 scrap en 6 bewoners',
        'laag',
        `${s.scrap}/${s.settlers}`,
      );
      bot.expect(
        (await bot.text('.co-selection')).includes('Niets geselecteerd'),
        'niets geselecteerd bij de start',
      );
      await bot.samplePerf();
    },
  );

  // ---- camera: pan with keys, zoom, edge ----
  await bot.step(
    'camera-pan-zoom',
    'WASD/pijltjes verschuiven de camera, het wiel zoomt binnen de grenzen',
    async () => {
      const c0 = await bot.cam();
      await page.mouse.move(width / 2, height / 2);
      await bot.key('ArrowRight', 700);
      const c1 = await bot.cam();
      bot.expect(
        Math.hypot(c1.x - c0.x, c1.z - c0.z) > 1,
        'pijltje rechts verschuift de camera',
        'midden',
        JSON.stringify({ c0, c1 }),
      );
      await bot.key('d', 500);
      await bot.key('w', 500);
      const c2 = await bot.cam();
      bot.expect(
        Math.hypot(c2.x - c1.x, c2.z - c1.z) > 0.5,
        'D en W verschuiven de camera',
        'midden',
      );
      await bot.key('q', 400);
      await bot.key('e', 400);
      await bot.wheel(-240, 8);
      const near = await bot.cam();
      await bot.wheel(240, 25);
      const far = await bot.cam();
      bot.say(`  zoom: dichtbij ${near.d.toFixed(0)} m, ver ${far.d.toFixed(0)} m`);
      bot.expect(far.d > near.d * 2, 'wiel uitzoomen vergroot de afstand sterk', 'midden');
      await bot.shot('camera-far');
      await bot.wheel(-240, 14);
      await bot.samplePerf();
    },
  );
  await bot.step(
    'camera-edge',
    'de camera botst niet hard tegen de kaartrand en het beeld blijft bruikbaar',
    async () => {
      await page.mouse.move(width / 2, height / 2);
      await bot.page.keyboard.down('ArrowLeft');
      await bot.page.keyboard.down('ArrowUp');
      await wait(5000);
      await bot.page.keyboard.up('ArrowLeft');
      await bot.page.keyboard.up('ArrowUp');
      await wait(500);
      const c = await bot.cam();
      bot.say(
        `  camera na 5 s naar linksboven: x ${c.x.toFixed(0)} z ${c.z.toFixed(0)} afstand ${c.d.toFixed(0)}`,
      );
      await bot.shot('camera-corner');
      bot.expect(
        c.x >= -2 && c.z >= -2,
        'camera blijft binnen de kaart',
        'midden',
        `${c.x.toFixed(0)},${c.z.toFixed(0)}`,
      );
    },
  );
  // Back to the base: the Basis button (double click = camera).
  await bot.step(
    'camera-home',
    'dubbelklik op Basis in de gebouwenbalk zet de camera terug bij de basis',
    async () => {
      const p = await bot.center('[data-building="hoofdgebouw"]');
      if (!p) throw new Error('geen Basis-knop');
      await bot.move(p);
      await page.mouse.dblclick(p.x, p.y, { delay: 90 });
      await wait(1500);
      const hq = await bot.hq();
      const c = await bot.cam();
      bot.expect(
        Math.hypot(c.x - hq.x / 256, c.z - hq.y / 256) < 25,
        'camera staat bij de basis',
        'midden',
        `${c.x.toFixed(0)},${c.z.toFixed(0)} vs ${(hq.x / 256).toFixed(0)},${(hq.y / 256).toFixed(0)}`,
      );
      await bot.wheel(240, 6);
    },
  );

  // ---- gather ----
  await bot.step(
    'verzamelen',
    'plunderaars selecteren via de roster en rechts klikken op een bron: ze gaan verzamelen en scrap stijgt',
    async () => {
      const ents = await bot.ents();
      const hq = await bot.hq();
      const nearest = ents
        .filter((e) => e.t === SCRAP_NODE)
        .sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
      if (!nearest) throw new Error('geen scrapbron op de kaart');
      const node = nearest;
      const d = Math.hypot(node.x - hq.x, node.y - hq.y) / 256;
      bot.say(`  dichtste bron op ${d.toFixed(0)} m van de basis`);
      if (d > 60) bot.finding('laag', `dichtste scrapbron ligt ${d.toFixed(0)} m van de basis`);
      await bot.panTo((node.x + hq.x) / 2, (node.y + hq.y) / 2);
      bot.expect(await bot.rosterGroup('Plunderaar'), 'roster toont Plunderaar-knop');
      bot.expect(
        (await bot.selection()).toLowerCase().includes('selectie ('),
        'plunderaars zijn geselecteerd',
      );
      const p = await bot.screenOf(node, [0, 1, 2, 0.5]);
      if (!p) {
        bot.finding('hoog', 'scrapbron niet aanklikbaar op het scherm (pickAt raakt hem niet)');
        return;
      }
      await bot.click(p, { button: 'right' });
      await bot.advance(20);
      const acts = await bot.ev<string[]>(
        `[...document.querySelectorAll('.co-roster-unit')].map((b) => b.getAttribute('data-activity'))`,
      );
      const s0 = (await bot.status()).scrap;
      await bot.advance(45);
      const s1 = (await bot.status()).scrap;
      bot.say(`  activiteiten ${acts.join(',') || '(lijst dicht)'}; scrap ${s0} -> ${s1} in 45 s`);
      bot.expect(s1 > s0, 'scrap stijgt na verzamelen', 'hoog', `${s0} -> ${s1}`);
    },
  );

  // ---- builder: house, workshop ----
  let house: Ent | null = null;
  await bot.step(
    'woning-bouwen',
    'bouwer plaatst een woning via B-menu; pop-cap stijgt na afloop',
    async () => {
      await bot.panTo((await bot.hq()).x, (await bot.hq()).y);
      await bot.wheel(240, 5);
      house = await placeBuilding(bot, 'woning');
      if (await untilBuilt(bot, house, 'woning')) {
        await bot.advance(2);
        const s = await bot.status();
        bot.expect(s.popCap >= 11, 'popCap stijgt naar 11 met een woning', 'midden', `${s.popCap}`);
      }
    },
  );
  let werkplaats: Ent | null = null;
  await bot.step('werkplaats-bouwen', 'werkplaats geplaatst en gebouwd', async () => {
    werkplaats = await placeBuilding(bot, 'werkplaats');
    await untilBuilt(bot, werkplaats, 'werkplaats');
  });
  await bot.step(
    'scrap-sparen-lab',
    'scrap loopt op tot 150 voor het lab (inkomsten kloppen)',
    async () => {
      const s0 = (await bot.status()).scrap;
      const t0 = await bot.gameSeconds();
      await bot.until('150 scrap', async () => (await bot.status()).scrap >= 150, 300, 5);
      const dt = (await bot.gameSeconds()) - t0;
      const s1 = (await bot.status()).scrap;
      bot.say(
        `  inkomsten: ${s0} -> ${s1} in ${dt.toFixed(0)} s = ${(((s1 - s0) / Math.max(1, dt)) * 60).toFixed(0)} scrap/min`,
      );
    },
  );
  let lab: Ent | null = null;
  await bot.step('lab-bouwen', 'lab geplaatst en gebouwd', async () => {
    lab = await placeBuilding(bot, 'lab');
    await untilBuilt(bot, lab, 'lab');
  });

  // ---- research ----
  await bot.step(
    'gebouwenbalk',
    'de balk toont Basis, Werkplaats, Lab met een badge voor wat te starten is',
    async () => {
      const bar = (await bot.text('.co-building-buttons')).replace(/\s+/g, ' ');
      bot.expect(
        /Werkplaats/.test(bar) && /Lab/.test(bar),
        'balk toont Werkplaats en Lab',
        'hoog',
        bar,
      );
    },
  );
  await bot.step(
    'geweerrek',
    'Werkplaats via de balk selecteren, kaart Geweerrek starten (100 scrap)',
    async () => {
      await bot.until('100 scrap', async () => (await bot.status()).scrap >= 100, 120, 5);
      bot.expect(await bot.buildingButton('werkplaats'), 'klik op Werkplaats in de balk');
      bot.expect((await bot.selection()).includes('Werkplaats'), 'Werkplaats geselecteerd');
      const before = await bot.cards();
      bot.say(`  kaarten: ${before.map((c) => `${c.naam}[${c.state}]`).join(', ')}`);
      const st = await bot.clickCard('Geweerrek');
      bot.expect(st === 'available', 'kaart Geweerrek is beschikbaar', 'midden', String(st));
      await wait(800);
      const q = (await bot.status()).queue;
      bot.expect(
        q.some((i) => i.kind === 'research'),
        'onderzoek loopt in de wachtrij',
        'hoog',
        JSON.stringify(q),
      );
      // locked card says why
      const locked = (await bot.cards()).find((c) => c.state === 'locked');
      if (locked) {
        const q0 = (await bot.status()).queue.length;
        await bot.clickCard(locked.naam);
        const notice = (await bot.text('.co-card-notice')).trim();
        bot.expect(
          notice.length > 0,
          `klik op vergrendelde kaart "${locked.naam}" geeft een reden`,
          'midden',
          notice,
        );
        bot.expect((await bot.status()).queue.length === q0, 'vergrendelde kaart start niets');
      }
      // a card that does nothing without a reason: tooExpensive / busy must explain
      for (const c of await bot.cards())
        if (
          (c.state === 'tooExpensive' || c.state === 'busy' || c.state === 'locked') &&
          c.title === ''
        )
          bot.finding('midden', `kaart "${c.naam}" (${c.state}) heeft geen tooltip met de reden`);
    },
  );
  await bot.step(
    'raffinage',
    'Lab selecteren, Raffinage starten (ontgrendelt trainingsfaciliteit)',
    async () => {
      await bot.until('125 scrap', async () => (await bot.status()).scrap >= 125, 180, 5);
      bot.expect(await bot.buildingButton('lab'), 'klik op Lab in de balk');
      const st = await bot.clickCard('Raffinage');
      bot.expect(st === 'available', 'kaart Raffinage beschikbaar', 'midden', String(st));
      await wait(600);
    },
  );
  await bot.step('robotica', 'Robotica starten (180 scrap, zodra het lab vrij is)', async () => {
    await bot.until(
      'lab vrij',
      async () =>
        !(await bot.status()).queue.some(
          (q) => q.kind === 'research' && q.buildingId === (lab?.id ?? -1),
        ),
      120,
      4,
    );
    await bot.until('180 scrap', async () => (await bot.status()).scrap >= 180, 240, 5);
    await bot.buildingButton('lab');
    const st = await bot.clickCard('Robotica');
    bot.expect(st === 'available', 'kaart Robotica beschikbaar', 'midden', String(st));
    await wait(600);
    bot.expect(
      (await bot.status()).queue.some((q) => q.kind === 'research'),
      'Robotica loopt',
      'hoog',
    );
  });

  // ---- selecting by roofs, deselect ----
  await bot.step(
    'daken-klikken',
    'klikken op het dak van Basis, Werkplaats en Lab selecteert dat gebouw',
    async () => {
      await bot.wheel(240, 4);
      for (const [label, b] of [
        ['Werkplaats', werkplaats],
        ['Lab', lab],
      ] as const) {
        if (!b) continue;
        await bot.panTo(b.x, b.y);
        const fresh = (await bot.buildings()).find((e) => e.id === b.id);
        if (!fresh) continue;
        const p = await bot.screenOf(fresh, [8, 6, 4, 3, 2, 1]);
        if (!p) {
          bot.finding(
            'midden',
            `dak van ${label} niet aan te klikken (pickAt mist op alle hoogtes)`,
          );
          continue;
        }
        await bot.click({ x: width * 0.5, y: height * 0.1 });
        await bot.click(p);
        bot.expect(
          (await bot.selection()).includes(label),
          `klik op dak selecteert ${label}`,
          'hoog',
          await bot.selection(),
        );
      }
    },
  );
  await bot.step(
    'deselecteren',
    'klik op lege grond en Escape heffen de selectie op en sluiten het kaartvenster',
    async () => {
      await bot.buildingButton('lab');
      bot.expect(
        await bot.ev<boolean>(`!!document.querySelector('.co-cards')`),
        'kaartvenster open bij Lab',
      );
      await bot.click(await bot.emptySpot());
      bot.expect(
        (await bot.selection()).includes('Niets geselecteerd'),
        'klik op lege grond heft selectie op',
        'hoog',
      );
      bot.expect(
        !(await bot.ev<boolean>(`!!document.querySelector('.co-cards')`)),
        'kaartvenster sluit',
      );
      await bot.buildingButton('lab');
      await bot.key('Escape');
      bot.expect(
        (await bot.selection()).includes('Niets geselecteerd'),
        'Escape heft selectie op',
        'hoog',
      );
    },
  );

  // ---- training facility + SPECIAL ----
  let training: Ent | null = null;
  await bot.step(
    'training-bouwen',
    'na Raffinage staat Training in het bouwmenu; geplaatst en gebouwd',
    async () => {
      await bot.until(
        'Raffinage klaar',
        async () => (await bot.status()).techs.length >= 1,
        200,
        5,
      );
      await bot.until('180 scrap', async () => (await bot.status()).scrap >= 180, 240, 5);
      const hq = await bot.hq();
      await bot.panTo(hq.x, hq.y);
      await bot.wheel(240, 4);
      training = await placeBuilding(bot, 'trainingsfaciliteit');
      await untilBuilt(bot, training, 'training');
    },
  );
  await bot.step(
    'special-trainen',
    'Training selecteren en een SPECIAL-kaart starten; trained-teller stijgt',
    async () => {
      await bot.until('100 scrap', async () => (await bot.status()).scrap >= 100, 200, 5);
      bot.expect(
        await bot.buildingButton('trainingsfaciliteit'),
        'Training staat in de gebouwenbalk',
      );
      const cs = await bot.cards();
      bot.say(`  kaarten: ${cs.map((c) => `${c.naam}[${c.state}]`).join(', ')}`);
      const pick = cs.find((c) => c.kind === 'train' && c.state === 'available');
      bot.expect(!!pick, 'minstens één training-kaart is beschikbaar', 'midden');
      if (pick) {
        await bot.clickCard(pick.naam);
        const queued = await bot.until(
          'training in de wachtrij',
          async () => (await bot.status()).queue.some((q) => q.kind === 'train'),
          12,
          1,
        );
        bot.expect(queued, `training "${pick.naam}" start`, 'hoog');
        const before = ((await bot.status()).trained ?? []).reduce((a, b) => a + b, 0);
        await bot.until(
          'SPECIAL-punt erbij',
          async () => ((await bot.status()).trained ?? []).reduce((a, b) => a + b, 0) > before,
          120,
          5,
        );
      }
    },
  );

  // ---- craft / retrain militia ----
  await bot.step(
    'militie-craften',
    'plunderaars selecteren, kaart Militie in het kaartvenster: ze worden militie',
    async () => {
      await bot.until('120 scrap', async () => (await bot.status()).scrap >= 120, 200, 5);
      bot.expect(
        await bot.rosterGroup('Plunderaar'),
        'plunderaars selecteren (groep opent de lijst)',
      );
      // Only three of them: pick single units from the roster list (click, shift-click), so the income keeps running.
      const units = page.locator('.co-roster-unit');
      let n = await units.count();
      if (n < 3) {
        // the group was already selected: a second click toggles the list open
        await bot.rosterGroup('Plunderaar');
        n = await units.count();
      }
      if (n >= 3) {
        for (let i = 0; i < 3; i++) {
          const b = await units.nth(i).boundingBox();
          if (b) await bot.click({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, { shift: i > 0 });
        }
        bot.expect(
          /\(3\)/.test(await bot.selection()),
          'drie losse plunderaars geselecteerd via de rosterlijst',
          'midden',
          await bot.selection(),
        );
      } else bot.finding('midden', 'rosterlijst toont geen losse eenheden na klik op de groep');
      const cs = await bot.cards();
      bot.say(`  kaarten: ${cs.map((c) => `${c.naam}[${c.state}]`).join(', ')}`);
      if (cs.length === 0)
        bot.finding(
          'midden',
          'geen craft-kaarten met plunderaars geselecteerd en werkplaats klaar (hint "Druk K ..." ?)',
        );
      const st = await bot.clickCard('Militie');
      bot.expect(st === 'available', 'kaart Militie beschikbaar', 'midden', String(st));
      await wait(800);
      const q = (await bot.status()).queue;
      bot.expect(
        q.some((i) => i.kind === 'craft'),
        'craft staat in de wachtrij',
        'midden',
        JSON.stringify(q),
      );
      await bot.advance(25);
    },
  );
  await bot.step('hero-en-leger', 'roster toont Militie met meer dan 1 eenheid', async () => {
    const roster = (await bot.text('.co-roster-groups')).replace(/\s+/g, ' ');
    bot.say(`  roster: ${roster}`);
  });

  // ---- robot factory + robots ----
  let factory: Ent | null = null;
  await bot.step(
    'robotfabriek-bouwen',
    'na Robotica staat Robotfabriek in het bouwmenu; geplaatst en gebouwd',
    async () => {
      await bot.until('Robotica klaar', async () => (await bot.status()).techs.length >= 2, 240, 5);
      await bot.until('220 scrap', async () => (await bot.status()).scrap >= 220, 300, 5);
      const hq = await bot.hq();
      await bot.panTo(hq.x, hq.y);
      await bot.wheel(240, 4);
      factory = await placeBuilding(bot, 'robotfabriek');
      await untilBuilt(bot, factory, 'robotfabriek');
    },
  );
  await bot.step(
    'robots-produceren',
    'Robotfabriek selecteren en een robot produceren; Robots-teller stijgt',
    async () => {
      await bot.until('150 scrap', async () => (await bot.status()).scrap >= 150, 240, 5);
      bot.expect(await bot.buildingButton('robotfabriek'), 'Robotfabriek in de balk');
      const cs = await bot.cards();
      bot.say(`  kaarten: ${cs.map((c) => `${c.naam}[${c.state}]`).join(', ')}`);
      const pick = cs.find((c) => c.kind === 'produce' && c.state === 'available');
      bot.expect(!!pick, 'een robotkaart is beschikbaar', 'midden');
      if (pick) {
        await bot.clickCard(pick.naam);
        bot.expect(
          await bot.until(
            'productie in de wachtrij',
            async () => (await bot.status()).queue.some((q) => q.kind === 'produce'),
            10,
            1,
          ),
          `productie "${pick.naam}" start`,
          'hoog',
        );
        await bot.until(
          'robot klaar',
          async () => ((await bot.status()).robotPop ?? 0) > 0,
          120,
          5,
        );
        bot.expect(((await bot.status()).robotPop ?? 0) > 0, 'Robots-teller is gestegen', 'hoog');
        bot.expect(
          (await bot.text('.co-counters')).includes('ROBOTS'),
          'teller Robots staat in de bovenbalk',
          'laag',
        );
      }
    },
  );

  // ---- army: group move (formation), attack move, hero ability ----
  await bot.step(
    'leger-formatie',
    'militie en held samen rechts-klikken: ze lopen in formatie (niet op 1 punt) en komen aan',
    async () => {
      const hq = await bot.hq();
      await bot.panTo(hq.x, hq.y);
      await bot.wheel(240, 3);
      bot.expect(await bot.rosterGroup('Militie'), 'militie geselecteerd');
      await bot.rosterGroup('Opziener', true);
      const sel = await bot.selection();
      bot.say(`  selectie: ${sel}`);
      const spot = await bot.emptySpot();
      await bot.click(spot, { button: 'right' });
      await bot.advance(8);
      await bot.advance(20);
      const me = await bot.me();
      const mil = (await bot.ents()).filter((e) => e.owner === me && e.t < BUILDING_MIN);
      // spread of the army: minimum pairwise distance among the militia
      const army = mil.filter((e) => e.t !== 2 && e.t !== 7 && e.t !== 1000);
      let minD = Infinity;
      for (const a of army)
        for (const b of army)
          if (a.id < b.id) minD = Math.min(minD, Math.hypot(a.x - b.x, a.y - b.y) / 256);
      bot.say(
        `  leger: ${army.length} eenheden, kleinste onderlinge afstand ${minD === Infinity ? '-' : minD.toFixed(1)} m`,
      );
      if (army.length >= 2)
        bot.expect(minD > 0.4, 'groep staat niet op één punt', 'midden', `${minD.toFixed(2)} m`);
    },
  );
  await bot.step(
    'held-ability',
    'held selecteren (roster Opziener), Z, klik op de grond: Lockdown gaat in cooldown',
    async () => {
      bot.expect(await bot.rosterGroup('Opziener'), 'Opziener in de roster');
      const hasAbility = await bot.ev<boolean>(`!!document.querySelector('[data-ability]')`);
      bot.expect(hasAbility, 'abilityknop zichtbaar bij geselecteerde held', 'midden');
      await bot.wheel(-240, 6); // close enough that a click is within the 10 m range
      await bot.key('z');
      const mode = await bot.text('.co-targeting');
      bot.expect(
        /ability/i.test(mode) || mode.length > 0,
        'Z start richtmodus voor de ability',
        'midden',
        mode,
      );
      const me = await bot.me();
      const h = (await bot.ents()).find((e) => e.owner === me && e.t === 1000);
      const p = h ? await bot.screenOf(h) : null;
      let spot = p ? { x: p.x + 70, y: p.y + 40 } : await bot.emptySpot();
      const hit = await bot.ev<{ entityId: number | null }>(
        `window.crawlout.renderer.pickAt(${spot.x}, ${spot.y})`,
      );
      if (hit.entityId !== null) {
        bot.say(
          `  doelpunt van de ability raakt een eenheid/gebouw (${hit.entityId}): een klik daarop selecteert in plaats van te richten`,
        );
        bot.finding(
          'midden',
          'ability-doel (Z) of Val aan (A): een klik op een eenheid of gebouw annuleert het richten en selecteert dat object (clickRules.leftClickIs); een vijand direct aanklikken als doel kan dus niet',
        );
        // empty ground inside the ability range (10 m): nearest free grid point 4 to 8 m from the hero
        const near = h
          ? (await bot.groundGrid(14))
              .filter((g) => g.eid === null)
              .map((g) => ({ g, d: Math.hypot(g.gx - h.x, g.gy - h.y) / 256 }))
              .filter((c) => c.d >= 4 && c.d <= 8)
              .sort((a, b) => a.d - b.d)[0]
          : undefined;
        spot = near ? { x: near.g.px, y: near.g.py } : await bot.emptySpot();
      }
      await bot.click(spot);
      await wait(600);
      await bot.advance(2);
      await wait(900);
      const cd = (await bot.status()).hero?.abilityCooldownTicks?.[0] ?? 0;
      bot.expect(cd > 0, 'Lockdown staat in cooldown na gebruik', 'midden', `${cd}`);
    },
  );
  await bot.step(
    'realtime-meting',
    'ongeveer 16 seconden echte tijd met camerabeweging: fps en slechtste frame blijven bruikbaar',
    async () => {
      await page.mouse.move(width / 2, height / 2);
      for (let i = 0; i < 4; i++) {
        await bot.page.keyboard.down(i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
        await wait(1500);
        await bot.page.keyboard.up(i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
        await bot.samplePerf();
      }
      const worst = Math.max(...bot.perf.slice(-4).map((x) => x.worst));
      bot.expect(
        worst <= 40,
        'slechtste frame in de echte-tijdmeting onder 40 ms',
        'midden',
        `${worst} ms`,
      );
    },
  );
  await bot.step(
    'aanval-claimpunt',
    'Val aan (A) naar een claimpunt: militie loopt erheen en vecht onderweg',
    async () => {
      const me = await bot.me();
      const ents = await bot.ents();
      const hq = await bot.hq();
      const claim = ents
        .filter((e) => e.t === CLAIM_POINT && e.owner !== me)
        .sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
      if (!claim) {
        bot.finding('laag', 'geen claimpunt gevonden');
        return;
      }
      bot.say(
        `  claimpunt op ${(Math.hypot(claim.x - hq.x, claim.y - hq.y) / 256).toFixed(0)} m, eigenaar ${claim.owner}`,
      );
      await bot.panTo(claim.x, claim.y);
      await bot.wheel(240, 4);
      bot.expect(await bot.rosterGroup('Militie'), 'militie geselecteerd');
      await bot.key('a');
      bot.expect(
        /aanvalsdoel/.test(await bot.text('.co-targeting')),
        'A toont de aanvalsmodus',
        'midden',
      );
      const near = (await bot.groundGrid(40)).sort(
        (a, b) =>
          Math.hypot(a.gx - claim.x, a.gy - claim.y) - Math.hypot(b.gx - claim.x, b.gy - claim.y),
      )[0];
      if (!near) throw new Error('geen grond bij het claimpunt zichtbaar');
      await bot.click({ x: near.px, y: near.py });
      const start = (await bot.own()).filter(
        (e) => e.t === 4 || (e.t < BUILDING_MIN && e.t !== 2 && e.t !== 7 && e.t !== 1000),
      );
      await bot.advance(40);
      const after = await bot.own();
      const moved = start.filter((s) => {
        const a = after.find((x) => x.id === s.id);
        return a && Math.hypot(a.x - s.x, a.y - s.y) > 256 * 3;
      });
      bot.expect(
        moved.length > 0,
        'eenheden bewegen richting het doel',
        'midden',
        `${moved.length}/${start.length}`,
      );
      // units stuck: same position over two checks while the order should still run
      const a1 = await bot.own();
      await bot.advance(15);
      const a2 = await bot.own();
      const stuck = a1.filter(
        (e) => e.t < BUILDING_MIN && a2.find((x) => x.id === e.id && x.x === e.x && x.y === e.y),
      ).length;
      bot.say(`  na nog 15 s: ${stuck} eenheden onbewogen (kan klaar zijn)`);
    },
  );
  await bot.step(
    'claimen',
    'bouwer rechts-klikt een claimpunt: claimpaal wordt gebouwd, dominantie telt punt',
    async () => {
      const me = await bot.me();
      const ents = await bot.ents();
      const hq = await bot.hq();
      const claim = ents
        .filter((e) => e.t === CLAIM_POINT && e.owner !== me)
        .sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
      if (!claim) return;
      await bot.panTo(claim.x, claim.y);
      bot.expect(await bot.rosterGroup('Bouwer'), 'bouwer geselecteerd');
      const p = await bot.screenOf(claim, [0, 1, 2]);
      if (!p) {
        bot.finding('midden', 'claimpunt niet aan te klikken');
        return;
      }
      await bot.click(p, { button: 'right' });
      await bot.until(
        'claim genomen',
        async () => (await bot.ents()).find((e) => e.id === claim.id)?.owner === me,
        120,
        5,
      );
      const dom = (await bot.text('.co-dominance')).replace(/\s+/g, ' ');
      bot.say(`  dominantie: ${dom}`);
    },
  );

  // ---- play on until the time is up, answering alerts and keeping production going ----
  await bot.step(
    'doorspelen',
    `tot ${MINUTES} spelminuten doorspelen: scrap besteden, alarmen lezen`,
    async () => {
      while (!(await bot.gameOver())) {
        const s = await bot.status();
        const win = await bot.text('#end');
        if (/Gewonnen|Verloren/.test(win)) {
          bot.say(`  einde: ${win.trim()}`);
          break;
        }
        const toasts = await bot.text('.co-toasts');
        if (toasts.trim()) bot.say(`  alarmen: ${toasts.replace(/\s+/g, ' ').trim()}`);
        if (s.scrap >= 150 && factory) {
          await bot.buildingButton('robotfabriek');
          const pick = (await bot.cards()).find(
            (c) => c.kind === 'produce' && c.state === 'available',
          );
          if (pick) await bot.clickCard(pick.naam);
        }
        await bot.key('Escape');
        await bot.advance(20);
        await bot.samplePerf();
      }
      const me = await bot.me();
      const all = await bot.ents();
      bot.say(
        `  eind: eigen eenheden ${all.filter((e) => e.owner === me && e.t < BUILDING_MIN).length}, eigen gebouwen ${all.filter((e) => e.owner === me && e.t >= BUILDING_MIN && e.t < BUILDING_MAX).length}`,
      );
    },
  );

  await bot.step('eind', 'eindstand en perf', async () => {
    await bot.samplePerf();
    await bot.shot('final');
  });

  if (SHOTS) writeFileSync(`${SHOTS}/${bot.size}-log.txt`, bot.log.join('\n'));
  await browser.close();
  return bot;
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const bots: Bot[] = [];
for (const [w, h] of SIZES) {
  try {
    bots.push(await run(w, h));
  } catch (e) {
    console.log(`run ${w}x${h} afgebroken: ${e instanceof Error ? e.stack : String(e)}`);
    ALL_FINDINGS.push({
      size: `${w}x${h}`,
      severity: 'hoog',
      text: `bot afgebroken: ${e instanceof Error ? e.message : String(e)}`,
      step: 'crash',
    });
  }
}

console.log('\n===== PERF =====');
for (const b of bots) {
  if (b.perf.length === 0) continue;
  const fps = b.perf.map((p) => p.fps);
  const worst = Math.max(...b.perf.map((p) => p.worst));
  const dc = Math.max(...b.perf.map((p) => p.dc));
  console.log(
    `${b.size}: ${b.perf.length} metingen, fps min ${Math.min(...fps)} gem ${(fps.reduce((a, c) => a + c, 0) / fps.length).toFixed(0)}, slechtste frame ${worst} ms, max ${dc} draw calls`,
  );
  console.log(b.perf.map((p) => `  t=${p.game}s ${p.text}`).join('\n'));
}
console.log('\n===== BEVINDINGEN =====');
const order: Severity[] = ['hoog', 'midden', 'laag'];
for (const sev of order) {
  for (const f of ALL_FINDINGS.filter((x) => x.severity === sev))
    console.log(`[${sev}] (${f.size}, ${f.step}) ${f.text}`);
}
if (ALL_FINDINGS.length === 0) console.log('geen bevindingen');
if (SHOTS)
  writeFileSync(
    `${SHOTS}/findings.json`,
    JSON.stringify(
      { findings: ALL_FINDINGS, perf: bots.map((b) => ({ size: b.size, perf: b.perf })) },
      null,
      1,
    ),
  );
