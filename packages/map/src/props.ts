import { UNITS_PER_METER } from '@crawlout/protocol';
import type { MapDef } from '@crawlout/data';
import type { MapAssets } from './types.js';

// Decoratieve props (bomen, rotsen, gras, kratten, wanden, torens). Puur visueel: de sim leest ze niet en ze zitten niet in de envHash.
// Opslag: data/maps/<id>.props.json, verwezen door het optionele veld MapDef.props. Posities in sim-eenheden (1 m = 256),
// yaw 0..65535 (zoals de sim), scalePct 80..130. Asset-ids zijn manifest-ids (zie propcatalog.ts). De generator staat in scatter.ts.
export const PROPS_FORMAT = 'crawlout-props/1';
export const PROP_SCALE_MIN = 80;
export const PROP_SCALE_MAX = 130;
/** Geen prop binnen deze afstand (meters) van spawns, scrap-nodes, claimpunten en creep-kampen. */
export const PROP_CLEARANCE_M = 3;

export interface PropRecord {
  asset: string;
  /** Sim-eenheden (1 m = 256). */
  x: number;
  y: number;
  /** 0..65535, 0 = sim +x. */
  yaw: number;
  scalePct: number;
}

export interface PropsFile {
  format: typeof PROPS_FORMAT;
  w: number;
  h: number;
  props: PropRecord[];
  _comment?: string;
}

/** Voor render: posities in meters, hoek in radialen. Hoogte (y omhoog) leest de renderer uit de heightmap. */
export interface PropInstance {
  asset: string;
  /** Meters, x en y als de map (y wordt z in de wereld). */
  x: number;
  y: number;
  yaw: number;
  yawRad: number;
  /** 1 = 100 %. */
  scale: number;
  scalePct: number;
}

const INV_UNITS = 0.00390625; // 1/256, macht van twee, dus exact (UNITS_PER_METER = 256)
const YAW_TO_RAD = 6.283185307179586 * 0.0000152587890625; // 2*pi/65536, de factor 1/65536 is exact

export function parseProps(text: string, w: number, h: number): PropsFile {
  const f = JSON.parse(text) as Partial<PropsFile> | null;
  if (!f || f.format !== PROPS_FORMAT)
    throw new Error(`props: onbekend formaat (verwacht ${PROPS_FORMAT})`);
  if (f.w !== w || f.h !== h)
    throw new Error(`props: ${String(f.w)}x${String(f.h)} past niet bij mapgrootte ${w}x${h}`);
  if (!Array.isArray(f.props)) throw new Error('props: props ontbreekt');
  const maxX = w * UNITS_PER_METER;
  const maxY = h * UNITS_PER_METER;
  f.props.forEach((p, i) => {
    const where = `props[${i}]`;
    if (typeof p.asset !== 'string' || p.asset.length === 0)
      throw new Error(`${where}: asset ontbreekt`);
    if (!Number.isInteger(p.x) || p.x < 0 || p.x >= maxX)
      throw new Error(`${where}: x buiten de map`);
    if (!Number.isInteger(p.y) || p.y < 0 || p.y >= maxY)
      throw new Error(`${where}: y buiten de map`);
    if (!Number.isInteger(p.yaw) || p.yaw < 0 || p.yaw > 65535)
      throw new Error(`${where}: yaw buiten 0..65535`);
    if (!Number.isInteger(p.scalePct) || p.scalePct < PROP_SCALE_MIN || p.scalePct > PROP_SCALE_MAX)
      throw new Error(`${where}: scalePct buiten ${PROP_SCALE_MIN}..${PROP_SCALE_MAX}`);
  });
  return f as PropsFile;
}

/** Leest de props van een map (def.props) voor de renderer. Geeft [] als de map geen props heeft. De sim roept dit nooit aan. */
export function loadProps(def: MapDef, assets: MapAssets): PropInstance[] {
  if (def.props === undefined) return [];
  const file = parseProps(assets.read(def.props), def.size.w, def.size.h);
  return file.props.map((p) => ({
    asset: p.asset,
    x: p.x * INV_UNITS,
    y: p.y * INV_UNITS,
    yaw: p.yaw,
    yawRad: p.yaw * YAW_TO_RAD,
    scale: p.scalePct * 0.01,
    scalePct: p.scalePct,
  }));
}

export function encodeProps(file: PropsFile): string {
  const head = JSON.stringify({
    format: file.format,
    w: file.w,
    h: file.h,
    ...(file._comment === undefined ? {} : { _comment: file._comment }),
  });
  const rows = file.props.map(
    (p) =>
      `    ${JSON.stringify({ asset: p.asset, x: p.x, y: p.y, yaw: p.yaw, scalePct: p.scalePct })}`,
  );
  return `${head.slice(0, -1)},"props":[\n${rows.join(',\n')}\n  ]}`;
}
