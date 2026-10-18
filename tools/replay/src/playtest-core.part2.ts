// Split from playtest-core.ts to stay under the 5,000-token file limit; playtest-core.ts re-exports the public surface.
// Holds: Bot.
import type { Page } from '@playwright/test';
import {
  ALL_FINDINGS,
  BUILDING_MAX,
  BUILDING_MIN,
  ENTS,
  LAYOUT_AUDIT,
  MINUTES,
  SCRAP_NODE,
  SHOTS,
  TICK_HZ,
  rectOf,
  textOf,
  wait,
} from './playtest-core.part1.js';
import type { Box, Ent, Finding, PerfSample, Pt, Severity } from './playtest-core.part1.js';

export class Bot {
  readonly size: string;
  readonly findings: Finding[] = [];
  readonly perf: PerfSample[] = [];
  readonly log: string[] = [];
  private stepNo = 0;
  private curStep = 'start';
  private readonly seenLayout = new Set<string>();
  private readonly t0 = Date.now();
  mapMeters = 0;
  /** Roster tile of the gatherers: the Dwellers' Plunderaar, the Raiders' Slaaf. */
  workerName = 'Plunderaar';
  /** Prefix of the screenshot file names (one per scenario run). */
  tag = '';
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
    if (
      !(await this.ev<boolean>(`!!(window.crawlout && window.crawlout.entities().size > 10)`).catch(
        () => false,
      ))
    )
      return `geen potje (menu of splash) | selectie "${(await this.selection()).slice(0, 40)}"`;
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
    if (SHOTS) await this.page.screenshot({ path: `${SHOTS}/${this.tag}${this.size}-${name}.png` });
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
      `(() => { const WORKER = ${JSON.stringify(this.workerName)}; for (const b of document.querySelectorAll('.co-roster-group')) if (b.textContent.includes(WORKER)) return b.querySelector('.co-roster-idle')?.textContent ?? ''; return ''; })()`,
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
      if (!(await this.rosterGroup(this.workerName))) return;
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
