// What the HUD shows for the Raiders (sim 0.18.0): slave binding to a Kooi, the Slaver's and the Chem-dealer's lines, the
// top-bar counters and the revolt check. The status does not expose the sim's census, so everything is derived from the
// own entities the snapshot shows (the player sees all of them): a slave is a unit of a slave loadout, a prisoner an own
// unit of ANOTHER faction's loadout (it keeps its old type until the Kooi transition has run), a fighter an own unit with
// role militia that is no hero, slave or prisoner. The binding of a slave to a Kooi is approximated by the nearest own
// finished Kooi; the sim binds the same way but also counts capacity, so the numbers can differ by a slave at a full Kooi.
import { ANIM, ENTITY_FLAG, UNITS_PER_METER } from '@crawlout/protocol';
import {
  PROVIDES,
  ROLES,
  heroIdOfTypeId,
  kindOfTypeId,
  type BuildingData,
  type ChemData,
  type GameData,
  type LoadoutData,
} from '@crawlout/data';
import type { RaiderCage, RaiderKind, RaiderStats } from '@crawlout/ui';
import { buildingName, humanize } from './cards.js';
import type { EntityRow } from './snapshot.js';

/** Dutch text for a stat of a chem effect, with the amount ("+35% schade", "+2 Kracht"). */
function chemEffectText(stat: string, delta: number, target: string): string {
  const pct = (label: string): string => `${delta > 0 ? '+' : ''}${delta / 10}% ${label}`;
  const who = target === 'held' ? 'voor de held' : 'voor eigen eenheden in de aura';
  switch (stat) {
    case 'damagePct':
      return `${pct('schade')} ${who}`;
    case 'speedPct':
      return `${pct('snelheid')} ${who}`;
    case 'S':
      return `${delta > 0 ? '+' : ''}${delta} Kracht ${who}`;
    case 'A':
      return `${delta > 0 ? '+' : ''}${delta} Behendigheid ${who}`;
    default:
      return `${stat} ${delta > 0 ? '+' : ''}${delta} ${who}`;
  }
}

/** Plain-Dutch lines of one chem: the dose, what it does, the crash after it and the cooldown (the card of its tech). */
export function chemLines(chem: ChemData, tickHz: number): string[] {
  const s = (ticks: number): number => Math.round(ticks / tickHz);
  const gain = chem.effects.map((e) => chemEffectText(e.stat, e.delta, e.target)).join(', ');
  const crash = chem.crash.map((e) => chemEffectText(e.stat, e.delta, e.target)).join(', ');
  return [
    `Dosis van ${chem.doseScrap} scrap, ${s(chem.activeTicks)} s: ${gain}`,
    `Daarna ${s(chem.crashTicks)} s crash: ${crash}`,
    `Cooldown ${s(chem.cooldownTicks)} s per eenheid`,
  ];
}

/** The kind of Raider unit a loadout is, or undefined for a unit of a faction without slaves (the Dwellers). */
export function raiderKindOf(data: GameData, l: LoadoutData | undefined): RaiderKind | undefined {
  if (!l || data.factions[l.factionId]?.slaves == null) return undefined;
  if (l.slave) return 'slave';
  if (l.capture) return 'slaver';
  if (l.aura) return 'chemDealer';
  return 'fighter';
}

const isCage = (b: BuildingData | undefined, kooi: number): b is BuildingData =>
  b !== undefined && b.cage !== null && b.provides.includes(kooi);

interface Census {
  slaves: EntityRow[];
  prisoners: EntityRow[];
  fighters: EntityRow[];
  cages: { e: EntityRow; b: BuildingData }[];
  tentReady: boolean;
}

function census(
  data: GameData,
  factionId: number,
  playerId: number,
  entities: Iterable<EntityRow>,
): Census {
  const kooi = PROVIDES.indexOf('kooi');
  const tent = PROVIDES.indexOf('tent');
  const militia = ROLES.indexOf('militia');
  const c: Census = { slaves: [], prisoners: [], fighters: [], cages: [], tentReady: false };
  for (const e of entities) {
    if (e.owner !== playerId) continue;
    const k = kindOfTypeId(e.typeId);
    if (k.kind === 'building') {
      const b = data.buildings[k.index];
      if (b && e.anim !== ANIM.build) {
        if (isCage(b, kooi)) c.cages.push({ e, b });
        if (b.provides.includes(tent)) c.tentReady = true;
      }
    } else if (k.kind === 'unit' && heroIdOfTypeId(e.typeId) < 0) {
      const l = data.loadouts[k.index];
      if (!l) continue;
      if (l.factionId !== factionId) c.prisoners.push(e);
      else if (l.slave) c.slaves.push(e);
      else if (l.role === militia) c.fighters.push(e);
    }
  }
  return c;
}

/** The own finished Kooi nearest to a unit (centre to centre), or undefined. */
function nearestCage(
  c: Census,
  e: Pick<EntityRow, 'x' | 'y'>,
): Census['cages'][number] | undefined {
  let best: Census['cages'][number] | undefined;
  let bestD = Infinity;
  for (const cage of c.cages) {
    const d = Math.hypot(cage.e.x - e.x, cage.e.y - e.y);
    if (d < bestD) {
      bestD = d;
      best = cage;
    }
  }
  return best;
}

const WORKING = new Set<number>([ANIM.gather, ANIM.build]);

/** Counters for the top bar, or null for a faction without slaves. */
export function raiderStats(
  data: GameData,
  factionId: number | undefined,
  playerId: number,
  entities: Iterable<EntityRow>,
): RaiderStats | null {
  const faction = factionId === undefined ? undefined : data.factions[factionId];
  const rules = faction?.slaves;
  if (!faction || !rules) return null;
  const c = census(data, faction.id, playerId, entities);
  const perCage = new Map<number, number>();
  for (const s of c.slaves) {
    const cage = nearestCage(c, s);
    if (cage) perCage.set(cage.e.id, (perCage.get(cage.e.id) ?? 0) + 1);
  }
  const reach = rules.revolt.garrisonRadiusU;
  const cages: RaiderCage[] = c.cages.map(({ e, b }) => {
    const slaves = perCage.get(e.id) ?? 0;
    // The sim measures from the footprint; add half of it so the centre distance is comparable.
    const half = (Math.max(b.footprint.w, b.footprint.h) * UNITS_PER_METER) / 2;
    const guards = c.fighters.filter(
      (f) => Math.hypot(f.x - e.x, f.y - e.y) <= reach + half,
    ).length;
    return {
      id: e.id,
      x: e.x,
      y: e.y,
      naam: buildingName(b.key),
      slaves,
      capacity: b.cage?.capacity ?? 0,
      guards,
      guardsNeeded: Math.max(
        rules.revolt.minGuards,
        Math.ceil(slaves / Math.max(1, rules.revolt.slavesPerGuard)),
      ),
    };
  });
  return {
    slaves: c.slaves.length,
    slavesWorking: c.slaves.filter(
      (s) => WORKING.has(s.anim) || (s.flags & ENTITY_FLAG.carrying) !== 0,
    ).length,
    prisoners: c.prisoners.length,
    fighters: c.fighters.length,
    safetyThreshold: faction.safetyNet.threshold,
    tentReady: c.tentReady,
    cages,
  };
}

/** Does the player see an enemy slave or prisoner (a unit of a slave loadout of someone else, or a captured unit)? */
export function seesEnemySlaves(
  data: GameData,
  playerId: number,
  neutralOwner: number,
  entities: Iterable<EntityRow>,
): boolean {
  for (const e of entities) {
    if (e.owner === playerId || e.owner === neutralOwner) continue;
    const k = kindOfTypeId(e.typeId);
    if (k.kind === 'unit' && data.loadouts[k.index]?.slave) return true;
  }
  return false;
}

/** Extra selection-panel lines for one own unit or building of the Raiders. */
export function raiderLines(
  data: GameData,
  factionId: number | undefined,
  playerId: number,
  entity: EntityRow,
  entities: Iterable<EntityRow>,
  tickHz: number,
  researched: readonly number[],
): string[] {
  const faction = factionId === undefined ? undefined : data.factions[factionId];
  if (!faction?.slaves) return [];
  const k = kindOfTypeId(entity.typeId);
  if (k.kind === 'building') {
    const b = data.buildings[k.index];
    if (!b?.cage || entity.anim === ANIM.build) return [];
    const stats = raiderStats(data, faction.id, playerId, entities);
    const cage = stats?.cages.find((x) => x.id === entity.id);
    return [
      `Kooi: ${cage?.slaves ?? 0} van ${b.cage.capacity} slaven, werkstraal ${Math.round(b.cage.workRadiusU / UNITS_PER_METER)} m`,
      `Gevangenen worden hier na ${Math.round(b.cage.transitionTicks / tickHz)} s slaaf`,
      ...(cage
        ? [
            `Bewakers: ${cage.guards} van ${cage.guardsNeeded}${cage.guards < cage.guardsNeeded ? ' (te weinig: slaven kunnen ontsnappen)' : ''}`,
          ]
        : []),
    ];
  }
  const l = data.loadouts[k.index];
  if (!l) return [];
  if (l.slave) {
    const c = census(data, faction.id, playerId, entities);
    const cage = nearestCage(c, entity);
    if (!cage?.b.cage) return ['Geen Kooi: bouw een Kooi om te kunnen werken'];
    return [
      `Kooi: ${buildingName(cage.b.key)}, werkstraal ${Math.round(cage.b.cage.workRadiusU / UNITS_PER_METER)} m`,
    ];
  }
  if (l.capture) {
    return [
      `Vangt een bewoner onder ${l.capture.maxHpPermille / 10}% leven, minstens ${Math.round(faction.slaves.minDistanceFromOwnerBaseU / UNITS_PER_METER)} m van zijn basis (${Math.round(l.capture.captureTicks / tickHz)} s aanraken)`,
    ];
  }
  if (l.aura) {
    const have = new Set(researched);
    return [
      `Doseert in gevecht binnen ${Math.round(l.aura.radiusU / UNITS_PER_METER)} m`,
      ...l.aura.chems.map((ci) => {
        const chem = faction.chems[ci];
        if (!chem) return '';
        const ready = have.has(chem.requiresTech);
        const tech = data.tech[chem.requiresTech];
        return `${chem.naam}: ${ready ? `klaar, ${chem.doseScrap} scrap per dosis, cooldown ${Math.round(chem.cooldownTicks / tickHz)} s` : `eerst ${humanize(tech?.key ?? 'onderzoek').toLowerCase()} onderzoeken`}`;
      }),
    ].filter((x) => x !== '');
  }
  return [];
}
