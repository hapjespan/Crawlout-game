// Contract 1: snapshot sim naar render. Eén transferable ArrayBuffer per tick.
// Header, dan SoA-arrays per entity (gesorteerd op elementgrootte voor alignment), dan events.

// tick = het laatst uitgevoerde frame; hash = de state-hash na dat frame (besluit sprint 1, zie frames.ts).
export const SNAPSHOT_HEADER_BYTES = 12; // tick u32, hash u32, entityCount u16, eventCount u16

// Velden per entity (besluit sprint 2, zie fase-0 sectie 4):
// - typeId volgt de typeId-ruimte uit packages/data/src/typeIds.ts: unit 1 + loadoutId (1..999), held 1000 + heroId
//   (1000..1023, besluit sprint 3: de held is een unit zonder loadout; `heroIdOfTypeId` herkent hem), gebouw
//   1024 + buildingId (1024..2047), scrap-node 2048, claimpunt 2049; 0 is geen type.
// - owner: speler 0..MAX_PLAYERS-1, of OWNER_NEUTRAL (constants.ts) voor scrap-nodes en onbezette claimpunten.
// - hpPct: units en gebouwen hp in procenten; scrap-node resterende voorraad in procenten van de startvoorraad;
//   claimpunt 100.
// - anim/animT: unit volgens ANIM; gebouw in aanbouw ANIM.build met animT = bouwvoortgang, daarna ANIM.idle;
//   claimpunt animT = claimvoortgang (0..65535); lijk ANIM.death met animT = verstreken deel van corpseS.
export const ENTITY_FIELDS = {
  id: { bytes: 4, ctor: Uint32Array },
  x: { bytes: 4, ctor: Int32Array },
  y: { bytes: 4, ctor: Int32Array },
  typeId: { bytes: 2, ctor: Uint16Array },
  yaw: { bytes: 2, ctor: Uint16Array },
  animT: { bytes: 2, ctor: Uint16Array }, // 0..65535 = 0..100% van de clip
  owner: { bytes: 1, ctor: Uint8Array },
  anim: { bytes: 1, ctor: Uint8Array },
  hpPct: { bytes: 1, ctor: Uint8Array },
  flags: { bytes: 1, ctor: Uint8Array },
} as const;
export type EntityField = keyof typeof ENTITY_FIELDS;

// selected zet de client (selectie is geen sim-state; de client stempelt hem in de buffer voor de renderer die
// leest); dead, carrying en inCombat zet de sim. inCombat staat ook op een turret met doel (een voltooid gebouw
// met Combat, besluit 8 in fase-0 sectie 14); dead en carrying komen alleen op units voor.
export const ENTITY_FLAG = {
  selected: 1 << 0,
  dead: 1 << 1,
  carrying: 1 << 2,
  inCombat: 1 << 3,
} as const;

// Animatie-ids in het veld `anim` (besluit sprint 1). De volgorde is de clipvolgorde uit de artist-brief
// (Spelfundament sectie 9); de asset-cli bakt clips in deze volgorde en de renderer indexeert ermee.
export const ANIM = {
  idle: 0,
  walk: 1,
  run: 2,
  attack1: 3,
  attack2: 4,
  gather: 5,
  build: 6,
  death: 7,
} as const;
export type AnimName = keyof typeof ANIM;
/** Clipnamen op index, voor manifest-validatie en bakken. */
export const ANIM_NAMES: readonly AnimName[] = [
  'idle',
  'walk',
  'run',
  'attack1',
  'attack2',
  'gather',
  'build',
  'death',
];

// Events (besluit sprint 2): x, y is de positie van de entity in `a` op het moment van het event, in sim-eenheden.
// `a` is altijd de entity waar het om gaat; `b` staat per type hieronder. Een entity die dezelfde tick verdwijnt
// (gebouw gesloopt, lege node) staat niet meer in de snapshot: lees typeId dan uit `b`.
export const EVENT_TYPE = {
  spawn: 1, // a = entity, b = typeId
  death: 2, // a = entity, b = typeId
  shotFired: 3, // a = schutter, b = doel
  hit: 4, // a = doel, b = schutter
  buildingPlaced: 5, // a = gebouw, b = typeId
  buildingDone: 6, // a = gebouw, b = typeId
  claimTaken: 7, // a = claimpunt, b = nieuwe eigenaar (playerId)
  resourceDepleted: 8, // a = scrap-node, b = 0
  heroLevel: 9, // a = held, b = nieuw level
  // Besluit sprint 3: een ability-zone (Lockdown) begint. a = held, b = abilityId (index in heroes.abilities), x, y =
  // het midden van de zone (uitzondering op "x, y is de positie van a"). Straal en duur leest de renderer uit
  // packages/data op de held (heroIdOfTypeId van het typeId van a); er is geen event voor het einde van de zone.
  abilityZone: 10,
} as const;
export type EventType = keyof typeof EVENT_TYPE;

export const EVENT_FIELDS = {
  a: { bytes: 4, ctor: Uint32Array },
  b: { bytes: 4, ctor: Uint32Array },
  x: { bytes: 4, ctor: Int32Array },
  y: { bytes: 4, ctor: Int32Array },
  type: { bytes: 1, ctor: Uint8Array },
} as const;
export type EventField = keyof typeof EVENT_FIELDS;

const align4 = (n: number): number => (n + 3) & ~3;
const align2 = (n: number): number => (n + 1) & ~1;

export interface SnapshotLayout {
  totalBytes: number;
  entity: Record<EntityField, number>; // byte-offset van elk SoA-array
  event: Record<EventField, number>;
}

/** Byte-offsets voor een snapshot met entityCount entities en eventCount events. Sim en render gebruiken dezelfde functie. */
export function snapshotLayout(entityCount: number, eventCount: number): SnapshotLayout {
  let off = SNAPSHOT_HEADER_BYTES;
  const entity = {} as Record<EntityField, number>;
  for (const key of Object.keys(ENTITY_FIELDS) as EntityField[]) {
    const f = ENTITY_FIELDS[key];
    off = f.bytes === 4 ? align4(off) : f.bytes === 2 ? align2(off) : off;
    entity[key] = off;
    off += f.bytes * entityCount;
  }
  const event = {} as Record<EventField, number>;
  for (const key of Object.keys(EVENT_FIELDS) as EventField[]) {
    const f = EVENT_FIELDS[key];
    off = f.bytes === 4 ? align4(off) : off;
    event[key] = off;
    off += f.bytes * eventCount;
  }
  return { totalBytes: align4(off), entity, event };
}

export interface SnapshotHeader {
  tick: number;
  hash: number;
  entityCount: number;
  eventCount: number;
}

export function readSnapshotHeader(buf: ArrayBuffer): SnapshotHeader {
  const v = new DataView(buf);
  return {
    tick: v.getUint32(0, true),
    hash: v.getUint32(4, true),
    entityCount: v.getUint16(8, true),
    eventCount: v.getUint16(10, true),
  };
}

export function writeSnapshotHeader(buf: ArrayBuffer, h: SnapshotHeader): void {
  const v = new DataView(buf);
  v.setUint32(0, h.tick, true);
  v.setUint32(4, h.hash, true);
  v.setUint16(8, h.entityCount, true);
  v.setUint16(10, h.eventCount, true);
}

// Spelerstatus gaat apart, op verzoek van de UI (queryMessage), niet in elke snapshot.
/**
 * Toestand van de held (besluit sprint 3): alive = staat in de snapshot; dead = gesneuveld, oplappen kan (Recruit op
 * het hoofdgebouw); reviving = oplappen loopt, reviveTicksLeft telt af; empty = na maxRevives keer oplappen, komt
 * niet meer terug.
 */
export type HeroState = 'alive' | 'dead' | 'reviving' | 'empty';

/**
 * Held van de speler (besluit sprint 2). heroId is de hero-id uit packages/data; naam, abilities en perk-teksten
 * haalt de HUD daar zelf. xpNext is de absolute xp waarbij het volgende level begint (op maxlevel de laatste
 * drempel); pendingPerks het aantal level-ups zonder gekozen perk; revivesLeft het aantal keren oplappen dat nog kan
 * (heroes.maxRevives min gebruikt). heroId, xpNext, pendingPerks en revivesLeft zijn verplicht sinds de held in de
 * sim zit (sprint 3).
 * Besluit sprint 3, verplicht sinds sim-core ze levert (sprint 4): state, reviveTicksLeft (0 buiten reviving),
 * entityId (de entity van de levende held, ENTITY_NONE anders) en abilityCooldownTicks (per ability, in de volgorde
 * van heroes.abilities; 0 = klaar). De HUD leidt dood-zijn niet meer af uit de snapshot.
 */
export interface HeroStatus {
  heroId: number;
  level: number;
  xp: number;
  xpNext: number;
  special: [number, number, number, number, number, number, number];
  perks: number[];
  pendingPerks: number;
  revivesLeft: number;
  state: HeroState;
  reviveTicksLeft: number;
  entityId: number;
  abilityCooldownTicks: number[];
}

export interface PlayerStatus {
  playerId: number;
  scrap: number;
  settlers: number;
  pop: number;
  popCap: number;
  beds: number;
  /** null zolang de speler geen held heeft (een factie zonder held). */
  hero: HeroStatus | null;
  /**
   * Onderzochte tech-ids, oplopend (besluit sprint 3), zodat de HUD het bouwmenu en de craft-opties op prereqTech
   * filtert. Optioneel tot de HUD en de client hem lezen (sprint 4); de sim levert hem al.
   */
  techs?: number[];
  /**
   * Lopend werk (speltest 14 oktober, voor het gebouwpaneel met kaarten; architect-besluit sectie 16): onderzoek per
   * gebouw en craft per bewoner, met voortgang. Oplopend op buildingId, dan unitId. Verplicht sinds de sim het levert
   * (protocol 0.5.0, balans-ronde; Sim.queue in packages/sim/src/sim.ts); leeg zonder lopend werk.
   */
  queue: QueueItem[];
  /**
   * Winroute B, dominantie (protocol 0.6.0, voorstel architect fase-0 sectie 17, ter bevestiging): de eigen stand plus
   * de hoogste tegenstander, zodat de HUD "nog 4:12" en "de vijand houdt 2 van 3" kan tonen. Optioneel tot de HUD hem
   * leest; de sim levert hem altijd (Sim.dominance in packages/sim/src/sim.ts).
   */
  dominance?: DominanceStatus;
}

/**
 * Dominantie van een speler (winroute B: pointsRequired claimpunten gedurende ticksRequired ticks aaneengesloten).
 * pointsHeld = claimpunten van de speler nu; ticksHeld = ticks dat hij er aaneengesloten genoeg houdt (0 zolang hij
 * er minder dan pointsRequired heeft; de klok begint opnieuw zodra hij er een verliest). pointsRequired en
 * ticksRequired komen uit de map (dominance { pointsRequired, minutes }, of de lobby-override). De winst valt in de
 * tick waarin ticksHeld ticksRequired bereikt. Resterende tijd = (ticksRequired - ticksHeld) * TICK_MS.
 */
export interface DominanceStatus {
  pointsHeld: number;
  pointsRequired: number;
  ticksHeld: number;
  ticksRequired: number;
  /**
   * De tegenstander die het dichtst bij dominantie is: de meeste ticksHeld, dan de meeste pointsHeld, dan de laagste
   * playerId; alleen spelers die nog meedoen. null als er geen tegenstander meer meedoet.
   */
  leader: DominanceLeader | null;
}

export interface DominanceLeader {
  playerId: number;
  pointsHeld: number;
  ticksHeld: number;
}

/**
 * Eén lopend werk. Research loopt in een gebouw (economie: w.research en w.work op het gebouw): buildingId = het lab,
 * unitId = ENTITY_NONE; Cancel op het gebouw stopt het. Craft loopt op de bewoner die omgeschoold wordt (w.work op de
 * unit, bij de werkplaats): unitId = die bewoner, buildingId = de werkplaats waar hij staat, ENTITY_NONE zolang hij
 * onderweg is; Cancel op de unit stopt het (teruggave volgens cancelRefundPct). Twee bewoners die hetzelfde loadout
 * craften zijn twee items.
 */
export interface QueueItem {
  kind: 'research' | 'craft';
  /** Entity-id van het gebouw waarin het werk loopt (craft onderweg: ENTITY_NONE). */
  buildingId: number;
  /** Bij craft de bewoner die omgeschoold wordt; bij research ENTITY_NONE. Verplicht sinds protocol 0.5.0. */
  unitId: number;
  /** techId bij research, loadoutId bij craft. */
  id: number;
  /** 0..1000; bij craft 0 zolang de bewoner nog onderweg is naar de werkplaats. */
  progressPermille: number;
}
