import { MAX_PLAYERS, UNITS_PER_METER } from '@crawlout/protocol';
import { isInt } from './math/int.js';
import { FNV_OFFSET, fnv1a, fnv1aInt, fnv1aString } from './math/fnv.js';

// De grens van de sim: alles in sim-eenheden (integers). De adapter vanuit de data-loader vult deze types bij de integratie;
// de sim leest nooit meters, seconden of JSON.

/** Passability-map: cellen van 1 m (256 eenheden), rij voor rij. 1 = begaanbaar, 0 = geblokkeerd. */
export interface SimMap {
  readonly w: number;
  readonly h: number;
  readonly passable: Uint8Array;
}

/** Eén unittype (body plus loadout) in sim-eenheden. */
export interface SimUnitType {
  readonly typeId: number; // uint16, gaat zo de snapshot in
  readonly maxHp: number;
  readonly speed: number; // eenheden per tick
  readonly radius: number; // eenheden, voor separatie
  readonly armorType: number; // uint8-index in de damage-matrix
  readonly bodyType: number; // uint8
  readonly loadoutId: number; // uint16
  readonly role: number; // uint8: 0 scavenger, 1 builder, 2 militia
}

export interface SimConfig {
  /** data/VERSION; gaat de hash-seed in, zodat een replay nooit stil op andere data draait. */
  readonly dataVersion: string;
  readonly unitTypes: readonly SimUnitType[];
  /** Afstand (eenheden) waarbinnen een Move-order klaar is. */
  readonly arriveRadius: number;
  /** Deel van de overlap dat separatie per tick oplost, in promille (0..1000). */
  readonly separationPermille: number;
  /** Maximaal aantal flow-field-cellen dat per tick wordt uitgebreid, alle velden samen. */
  readonly flowFieldBudget: number;
  /** animT-stap per tick (0..65535 wrapt). */
  readonly walkAnimStep: number;
}

export interface SimInit {
  readonly seed: number;
  readonly playerCount: number;
  readonly map: SimMap;
  readonly config: SimConfig;
}

/** Alles wat geen state is maar wel nodig is om een geserialiseerde state te laden. */
export type SimEnv = Omit<SimInit, 'seed'>;

export const MAX_MAP_CELLS_SIDE = 1024;
/** Bovengrens snelheid: kleiner dan een cel, zodat een unit nooit door een muur van 1 cel tunnelt. */
export const MAX_SPEED = UNITS_PER_METER >> 1;
/** Bovengrens straal: de separatie-grid gaat uit van buckets van 2 m. */
export const MAX_RADIUS = UNITS_PER_METER;
export const MAX_UNIT_TYPE_ID = 0xffff;

function req(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`SimInit ongeldig: ${msg}`);
}

const intIn = (v: unknown, lo: number, hi: number): boolean => isInt(v) && v >= lo && v <= hi;

/** Valideert de invoer eenmalig voor de eerste tick. Gooit bij ongeldige invoer. */
export function validateEnv(env: SimEnv): void {
  const { map, config, playerCount } = env;
  req(intIn(playerCount, 1, MAX_PLAYERS), `playerCount ${playerCount}`);
  req(intIn(map.w, 1, MAX_MAP_CELLS_SIDE) && intIn(map.h, 1, MAX_MAP_CELLS_SIDE), `mapmaat ${map.w}x${map.h}`);
  req(map.passable.length === map.w * map.h, 'passable heeft niet w*h cellen');
  for (let i = 0; i < map.passable.length; i++) req(map.passable[i]! <= 1, `passable[${i}] is geen 0 of 1`);
  req(typeof config.dataVersion === 'string' && config.dataVersion.length > 0, 'dataVersion ontbreekt');
  req(intIn(config.arriveRadius, 0, MAX_RADIUS * 4), 'arriveRadius');
  req(intIn(config.separationPermille, 0, 1000), 'separationPermille');
  req(intIn(config.flowFieldBudget, 1, 1 << 24), 'flowFieldBudget');
  req(intIn(config.walkAnimStep, 0, 0xffff), 'walkAnimStep');
  const seen = new Set<number>();
  for (const u of config.unitTypes) {
    req(intIn(u.typeId, 0, MAX_UNIT_TYPE_ID) && !seen.has(u.typeId), `typeId ${u.typeId} ongeldig of dubbel`);
    seen.add(u.typeId);
    req(intIn(u.maxHp, 1, 0x7fffffff), `maxHp van type ${u.typeId}`);
    req(intIn(u.speed, 0, MAX_SPEED), `speed van type ${u.typeId} (max ${MAX_SPEED})`);
    req(intIn(u.radius, 0, MAX_RADIUS), `radius van type ${u.typeId} (max ${MAX_RADIUS})`);
    req(intIn(u.armorType, 0, 0xff) && intIn(u.bodyType, 0, 0xff) && intIn(u.role, 0, 0xff), `uint8-velden van type ${u.typeId}`);
    req(intIn(u.loadoutId, 0, 0xffff), `loadoutId van type ${u.typeId}`);
  }
}

/**
 * Hash van de omgeving (dataVersion, config, map, spelers) in vaste veldvolgorde. Gaat de state-header in,
 * zodat twee clients met andere data of een andere map op tick 0 al verschillen.
 */
export function envHash(env: SimEnv): number {
  const { map, config } = env;
  let h = fnv1aString(FNV_OFFSET, config.dataVersion);
  h = fnv1aInt(h, env.playerCount);
  h = fnv1aInt(h, config.arriveRadius);
  h = fnv1aInt(h, config.separationPermille);
  h = fnv1aInt(h, config.flowFieldBudget);
  h = fnv1aInt(h, config.walkAnimStep);
  h = fnv1aInt(h, config.unitTypes.length);
  for (const u of config.unitTypes) {
    h = fnv1aInt(h, u.typeId);
    h = fnv1aInt(h, u.maxHp);
    h = fnv1aInt(h, u.speed);
    h = fnv1aInt(h, u.radius);
    h = fnv1aInt(h, u.armorType);
    h = fnv1aInt(h, u.bodyType);
    h = fnv1aInt(h, u.loadoutId);
    h = fnv1aInt(h, u.role);
  }
  h = fnv1aInt(h, map.w);
  h = fnv1aInt(h, map.h);
  return fnv1a(h, map.passable);
}
