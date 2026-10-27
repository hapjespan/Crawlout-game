// ?showcase of the render demo: every unit loadout (with the heroes, robots, rigid units and the Vertibird) and every
// building type once, side by side on flat ground without props, fog or movement, each with its id underneath.
// The units stand in one line facing the camera, grouped per faction; the buildings stand in a line 70 m behind them.
// The camera looks from the front at a low pitch (RtsCameraController.setPortraitView) and still pans and zooms;
// G jumps between the units line and the buildings line, ?showcase=buildings starts at the buildings.
import { BODY_TYPES, heroTypeId, unitTypeId, type GameData } from '@crawlout/data';
import { ANGLE_FULL, ANIM, TICK_MS, UNITS_PER_METER } from '@crawlout/protocol';
import { buildingTypeId, CLIPS, type CrawloutRenderer } from '@crawlout/render';
import { allocSnapshot, createGridTerrain } from '@crawlout/render/dev';
import { wastelandColor } from './demo.part1.js';

export interface ShowcaseItem {
  typeId: number;
  label: string;
  /** Faction key, or 'neutraal'; items of one group stand together. */
  group: string;
  /** Owner (team colour): the faction index. */
  owner: number;
  /** Center in meters, the width along the line, and the depth across it (buildings; 1 for a unit). */
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface ShowcaseLayout {
  units: ShowcaseItem[];
  buildings: ShowcaseItem[];
  /** Edge of the square terrain that holds both lines, meters. */
  size: number;
}

const MARGIN = 12;
/** Between two neighbours: units, and buildings (wider, so a 21 m compound reads as its own). */
const GAP = 1.5;
const BUILDING_GAP = 4;
const GROUP_GAP = 8;
/** Between the buildings line and the units line: from the buildings view the units stand behind the camera. */
const LINE_GAP = 70;
/** Room per unit along the line, by body type; a flying unit (the Vertibird: 12 m long, its rotors wider) gets more. */
const UNIT_WIDTH: Record<string, number> = { human: 2.6, robot: 4, beast: 4.5, vehicle: 7 };
const FLYING_WIDTH = 16;

type Unplaced = Omit<ShowcaseItem, 'x' | 'z'>;

/** Places `items` (sorted by group) left to right from MARGIN at depth `z`, with a wider gap between groups. */
function line(items: readonly Unplaced[], z: number, gap: number): ShowcaseItem[] {
  let x = MARGIN;
  let group: string | null = null;
  return items.map((it) => {
    if (group !== null && it.group !== group) x += GROUP_GAP;
    group = it.group;
    const placed = { ...it, x: x + it.w / 2, z };
    x += it.w + gap;
    return placed;
  });
}

/** Every loadout, hero and building of `data` once, grouped per faction (game data order, neutral last). */
export function showcaseLayout(
  data: Pick<GameData, 'factions' | 'loadouts' | 'buildings' | 'heroes'>,
): ShowcaseLayout {
  const group = (factionId: number) => data.factions[factionId]?.key ?? 'neutraal';
  const owner = (factionId: number) =>
    data.factions[factionId] ? factionId : data.factions.length;
  const order = (a: Unplaced, b: Unplaced) => a.owner - b.owner;
  const units: Unplaced[] = [
    ...data.heroes.map((h) => ({
      typeId: heroTypeId(h.id),
      label: `held ${h.key}`,
      group: group(h.factionId),
      owner: owner(h.factionId),
      w: UNIT_WIDTH.human!,
      d: 1,
    })),
    ...data.loadouts.map((l) => {
      const w = l.flying ? FLYING_WIDTH : (UNIT_WIDTH[BODY_TYPES[l.bodyType] ?? ''] ?? 3);
      const g = group(l.factionId);
      return {
        typeId: unitTypeId(l.id),
        label: l.key,
        group: g,
        owner: owner(l.factionId),
        w,
        d: 1,
      };
    }),
  ].sort(order);
  const buildings: Unplaced[] = data.buildings
    .map((b) => ({
      typeId: buildingTypeId(b.id),
      label: b.key,
      group: group(b.factionId),
      owner: owner(b.factionId),
      w: b.footprint.w,
      d: b.footprint.h,
    }))
    .sort(order);
  const deepest = Math.max(1, ...buildings.map((b) => b.d));
  const buildingsZ = MARGIN + deepest / 2;
  const unitsZ = buildingsZ + deepest / 2 + LINE_GAP;
  const placedUnits = line(units, unitsZ, GAP);
  const placedBuildings = line(buildings, buildingsZ, BUILDING_GAP);
  const end = Math.max(...[...placedUnits, ...placedBuildings].map((i) => i.x + i.w / 2));
  return {
    units: placedUnits,
    buildings: placedBuildings,
    size: Math.ceil(Math.max(end, unitsZ + FLYING_WIDTH / 2) + MARGIN),
  };
}

/** Snapshots of the layout: everything stands still, the units face the camera (+z) and loop `clip`. */
export class ShowcaseSource {
  private tick = 0;
  private t = 0;

  constructor(
    private readonly layout: ShowcaseLayout,
    private readonly clip: number,
  ) {}

  next(): ArrayBuffer {
    const { units, buildings } = this.layout;
    const def = CLIPS[this.clip]!;
    this.t = (this.t + TICK_MS / 1000 / def.duration) % 1;
    this.tick++;
    const snap = allocSnapshot(this.tick, this.tick, units.length + buildings.length, 0);
    const e = snap.entities;
    [...units, ...buildings].forEach((it, i) => {
      const unit = i < units.length;
      e.id[i] = i + 1;
      e.x[i] = Math.round(it.x * UNITS_PER_METER);
      e.y[i] = Math.round(it.z * UNITS_PER_METER);
      e.typeId[i] = it.typeId;
      e.owner[i] = it.owner;
      e.hpPct[i] = 100;
      if (!unit) return;
      e.yaw[i] = ANGLE_FULL / 4; // yaw grows from sim +x towards sim +y, which is world +z: the camera side
      e.anim[i] = this.clip;
      e.animT[i] = Math.floor(((this.t + i * 0.137) % 1) * (ANGLE_FULL - 1)); // desynced, not a drill
    });
    return snap.buffer;
  }
}

/** Camera per line: how far, how low and how high above the ground it looks. */
const VIEWS = {
  units: { distance: 9, pitchDeg: 9, lift: 1.1 },
  buildings: { distance: 46, pitchDeg: 14, lift: 4 },
} as const;

/** Runs the showcase on a renderer that already has its game data (demo.ts, after setGameData). */
export function runShowcase(
  renderer: CrawloutRenderer,
  data: GameData,
  params: URLSearchParams,
): void {
  const layout = showcaseLayout(data);
  const { size } = layout;
  const flat = (x: number, z: number) => wastelandColor(x, z, 0);
  renderer.setTerrain(createGridTerrain(size, size, 1, () => 0, flat));
  const hold = params.get('hold');
  const clip = hold && hold in ANIM ? ANIM[hold as keyof typeof ANIM] : ANIM.idle;
  const source = new ShowcaseSource(layout, clip);
  renderer.pushSnapshot(source.next());
  const pump = window.setInterval(() => renderer.pushSnapshot(source.next()), TICK_MS);

  const cam = renderer.cameraControls;
  cam.yaw = 0; // looks towards -z: the units face +z, so straight from the front
  let line: keyof typeof VIEWS = params.get('showcase') === 'buildings' ? 'buildings' : 'units';
  const show = (): void => {
    const v = VIEWS[line];
    const first = layout[line][0];
    cam.setPortraitView({ pitchDeg: v.pitchDeg, minDistance: 2, lift: v.lift });
    if (first) cam.focus(first.x + (line === 'units' ? 4 : 10), first.z);
    cam.zoomTo(v.distance, true);
  };
  show();
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyG') return;
    line = line === 'units' ? 'buildings' : 'units';
    show();
  });

  const labels = showcaseLabels(renderer, [...layout.units, ...layout.buildings]);
  const help = document.getElementById('help');
  if (help)
    help.innerHTML =
      '<b>Showcase</b>: alle loadouts, helden en gebouwen · WASD/pijlen: langs de rij · wiel: zoomen · ' +
      '<b>G</b>: eenheden of gebouwen · <code>?hold=walk</code> andere clip';
  window.addEventListener('beforeunload', () => {
    window.clearInterval(pump);
    labels();
    renderer.dispose();
  });
  Object.assign(window as object, { crawloutRender: renderer, crawloutShowcase: layout });
}

/**
 * The id under every item: one absolutely positioned div each, moved per frame from the projected ground point.
 * Only the line the camera stands at is labelled (the other is 70 m away and would clutter the horizon).
 */
function showcaseLabels(renderer: CrawloutRenderer, items: readonly ShowcaseItem[]): () => void {
  const stage = document.getElementById('stage') ?? document.body;
  const els = items.map((it) => {
    const el = document.createElement('div');
    el.textContent = it.label;
    el.style.cssText =
      'position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;font:12px system-ui;' +
      'color:#fff;background:rgba(10,10,12,.65);padding:1px 5px;border-radius:3px;will-change:transform';
    stage.appendChild(el);
    return el;
  });
  const cam = renderer.cameraControls;
  let raf = 0;
  const frame = (): void => {
    raf = requestAnimationFrame(frame);
    const c = cam.camera;
    const v = c.matrixWorldInverse.elements;
    const p = c.projectionMatrix.elements;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    items.forEach((it, i) => {
      const el = els[i]!;
      // Label at the front edge of the item, on the ground.
      const x = it.x;
      const z = it.z + it.d / 2;
      const vx = v[0]! * x + v[8]! * z + v[12]!;
      const vy = v[1]! * x + v[9]! * z + v[13]!;
      const vz = v[2]! * x + v[10]! * z + v[14]!;
      const near = Math.abs(it.z - cam.target.z) < 30;
      if (vz > -0.5 || !near) {
        el.style.display = 'none';
        return;
      }
      const sx = ((p[0]! * vx + p[8]! * vz) / -vz + 1) * 0.5 * w;
      const sy = (1 - (p[5]! * vy + p[9]! * vz) / -vz) * 0.5 * h;
      el.style.display = sx < -200 || sx > w + 200 ? 'none' : 'block';
      el.style.transform = `translate(${sx}px, ${sy + 4}px) translateX(-50%)`;
    });
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    for (const el of els) el.remove();
  };
}
