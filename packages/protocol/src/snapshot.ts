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
// Fog of war (protocol 0.11.0; bevestigd in fase-0 sectie 23 besluit 1): a snapshot is written for one player (the
// viewer, the local player of the client). It holds his own entities, the map features (scrap nodes and claim points:
// map knowledge, always), and the entities of others that he sees now. An enemy building he saw before but does not see
// now stays in as a ghost: its row as he last saw it (hp, build progress), with the flag `ghost` and no other sim flag;
// it goes when he sees the spot again and the building is gone. A ghost is presentation only: commands on it are
// refused by the sim (a target must be visible). The header hash stays the state hash of the whole shared state.
export const ENTITY_FLAG = {
  selected: 1 << 0,
  dead: 1 << 1,
  carrying: 1 << 2,
  inCombat: 1 << 3,
  ghost: 1 << 4,
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

/**
 * Fog of war (protocol 0.11.0; bevestigd in fase-0 sectie 23 besluit 1): the fog of one player on the vision grid,
 * on request of the HUD and the render (a `fog` query to the sim worker, like the player status; not in every snapshot).
 * The grid has cellsW x cellsH cells of cellUnits x cellUnits sim units (sim.json vision.cellM; 2 m = 512 units); cell
 * (cx, cy) covers x in [cx * cellUnits, (cx + 1) * cellUnits). Two bitsets of ceil(cellsW * cellsH / 8) bytes, cell
 * c = cy * cellsW + cx at bit c & 7 of byte c >> 3: explored (seen at some time) and visible (seen now; visible implies
 * explored). frame = the last executed frame.
 */
export interface FogMask {
  frame: number;
  playerId: number;
  cellsW: number;
  cellsH: number;
  cellUnits: number;
  explored: Uint8Array;
  visible: Uint8Array;
}

/** State of a fog cell (fogAt). */
export const FOG = { unexplored: 0, explored: 1, visible: 2 } as const;

/** FOG.unexplored, FOG.explored or FOG.visible for cell (cx, cy) of a fog mask; outside the grid unexplored. */
export function fogAt(mask: FogMask, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= mask.cellsW || cy >= mask.cellsH) return FOG.unexplored;
  const c = cy * mask.cellsW + cx;
  const bit = 1 << (c & 7);
  if ((mask.visible[c >> 3]! & bit) !== 0) return FOG.visible;
  return (mask.explored[c >> 3]! & bit) !== 0 ? FOG.explored : FOG.unexplored;
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
   * Winroute B, dominantie (protocol 0.6.0 als voorstel van sim-core naar fase-0 sectie 17; verplicht sinds protocol
   * 0.7.0, architect-review van de nachtronde, sectie 18): de eigen stand plus de tegenstander die het dichtst bij
   * dominantie is, zodat de HUD "nog 4:12" en "de vijand houdt 2 van 3" kan tonen. De sim levert hem altijd
   * (Sim.dominance in packages/sim/src/sim.ts), de client leest hem (apps/client/src/game/dominance.ts).
   */
  dominance: DominanceStatus;
  /**
   * Robots (protocol 0.8.0, data 0.16.0; besluit fase-0 sectie 20): de pop van de levende eigen robots. Robots
   * tellen voor pop maar niet voor bedden: `pop` is de pop van de bewoners (binnen de bedden), `robotPop` die van de
   * robots, en pop + robotPop (plus de robots in productie) blijft binnen popCapMax. `settlers` telt alleen bewoners.
   * popCap = min(beds, popCapMax - robotPop - pop van robots in productie): de ruimte voor bewoners. Verplicht sinds
   * protocol 0.9.0 (de HUD leest hem; bevestigd door de architect in fase-0 sectie 22); de sim levert hem altijd.
   */
  robotPop: number;
  /**
   * Getrainde SPECIAL-punten van de speler (protocol 0.8.0, data 0.16.0; besluit fase-0 sectie 20), per letter in de
   * volgorde S P E C I A L. Ze horen bij de speler, niet bij de held (ze blijven na zijn dood) en zitten al in
   * HeroStatus.special; de HUD heeft ze apart nodig voor de kosten en duur van de volgende run (training.json
   * scrapCost + scrapCostStep maal getraind). Verplicht sinds protocol 0.9.0 (de HUD leest hem; bevestigd in fase-0
   * sectie 22).
   */
  trained: [number, number, number, number, number, number, number];
  /**
   * Alle claimpunten met hun claimstand (protocol 0.10.0, data 0.20.0; voorstel van sim-core, bevestigd door de
   * architect in fase-0 sectie 22), zodat de HUD een ring met voortgang rond het claimpunt kan tonen: een paal in
   * aanbouw, de held die het punt claimt door erin te staan, of de overname van een punt zonder paal. pointId is het
   * entity-id van het claimpunt in de snapshot. Oplopend op pointId. De sim levert hem altijd (Sim.status,
   * claims.ts claimPointStatus) en de client leest hem (render: de ring; minimap). Verplicht sinds protocol 0.13.0
   * (voorstel, ter bevestiging door de architect; sectie 22 besluit 3): alle PlayerStatus-literals dragen hem.
   */
  claimPoints: ClaimPointStatus[];
  /**
   * Chem-dosis per eenheid (protocol 0.13.0; voorstel van hud, ter bevestiging door de architect, fase-0 sectie 23
   * besluit 8): elke eigen eenheid met een chem in een fase (active, crash of cooldown), zodat de HUD de dosis en de
   * cooldown van een Chem-dealer uit state leest en niet uit de snapshot benadert. Oplopend op unitId. De sim houdt
   * ze al bij (w.chem, w.chemPhase, w.chemTicks), dus geen state en geen hashwijziging; Sim.chems. Optioneel tot de
   * HUD hem leest (de sim levert hem altijd); leeg zonder doses.
   */
  chems?: ChemStatus[];
  /**
   * Creep-kampen (protocol 0.14.0; voorstel van sim-core, ter bevestiging door de architect): elk kamp van de map met
   * zijn stand, zodat de HUD een overgenomen kamp in de kleur van zijn eigenaar toont (minimap) en de Raiders bij een
   * bandiet "Overnemen" zien. Op kampindex (de volgorde van MapDef.creepCamps). Kaartkennis zoals claimPoints (een
   * kamp is een map-feature; wie het houdt is openbaar, of het nu vecht niet). De sim levert hem altijd (Sim.camps,
   * leest alleen state, geen hashwijziging); leeg op een map zonder kampen. Optioneel tot alle PlayerStatus-literals
   * hem dragen.
   */
  camps?: CreepCampStatus[];
  /**
   * De slavengroepen van de speler met hun bewakers (protocol 0.15.0, data 0.29.0; voorstel van sim-core, ter
   * bevestiging door de architect): per groep de slaven, de bewakers en wat de bewaakregel eist, zodat de HUD
   * "Bewakers 1/2 nodig" en de opstandwaarschuwing uit state toont in plaats van het uit de snapshot te benaderen (de
   * bewaakmodus staat niet in de snapshot). Oplopend op kind (kooi voor node), dan targetId. Eigen kennis; leeg voor een
   * factie zonder slaven. De sim levert hem altijd (Sim.status, slaves.ts guardStatus; leest alleen state, geen
   * hashwijziging). Optioneel tot alle PlayerStatus-literals hem dragen.
   */
  slaveGroups?: SlaveGroupStatus[];
}

/**
 * Een slavengroep (PlayerStatus.slaveGroups, protocol 0.15.0, voorstel). kind kooi: de slaven die bij een node met deze
 * Kooi dichtbij verzamelen plus de slaven van de Kooi die niet verzamelen (de dreiging van de Kooi: cageGuards
 * bewakers); kind node: de slaven bij een node zonder Kooi dichtbij (2 op 5, of 1 op 5 met een bewaker in bewaakmodus
 * op de node). Zie data/factions.json slaves.revolt.
 */
export interface SlaveGroupStatus {
  kind: 'kooi' | 'node';
  /** Entity-id van de Kooi of de node. */
  targetId: number;
  /** Midden van de Kooi of de node in sim-eenheden. */
  x: number;
  y: number;
  slaves: number;
  /** Eigen vechters die nu als bewaker tellen (bewaakmodus op het doel, of binnen de bewaakstraal). */
  guards: number;
  /** Wat de bewaakregel nu eist (0 zonder slaven). */
  guardsNeeded: number;
  /** Bewakers in bewaakmodus op dit doel of een node van de groep (een deel van guards). */
  guardMode: number;
  /** Entity-ids van de nodes waar slaven van de groep verzamelen (bij een Kooi-groep de nodes met de Kooi dichtbij). */
  nodeIds: number[];
  /** Ticks tot de volgende ontsnapping zolang guards < guardsNeeded, anders 0. */
  escapeInTicks: number;
}

/** Stand van een creep-kamp (CreepCampStatus.state): nog bandieten, geruimd, of overgenomen (een buitenpost). */
export type CampState = 'bandits' | 'cleared' | 'taken';

/** Eén creep-kamp (PlayerStatus.camps, protocol 0.14.0, voorstel). */
export interface CreepCampStatus {
  /** Index in MapDef.creepCamps. */
  camp: number;
  /** Midden van het kamp in sim-eenheden. */
  x: number;
  y: number;
  tier: number;
  state: CampState;
  /** Bij taken de playerId van de eigenaar van de buitenpost, anders OWNER_NEUTRAL. */
  owner: number;
  /**
   * Of de factie van de speler van deze status dit kamp overneemt in plaats van ruimt (data/creeps.json takeover voor
   * zijn tier); alleen zinvol zolang state bandits is.
   */
  takeover: boolean;
}

/** Fase van een chem op een eenheid (ChemStatus.phase). */
export type ChemPhase = 'active' | 'crash' | 'cooldown';

/** De chem van één eenheid (PlayerStatus.chems, protocol 0.13.0, voorstel). */
export interface ChemStatus {
  /** Entity-id van de gedoseerde eenheid. */
  unitId: number;
  /** Index in `factions[].chems` van de eigen factie (0-based). */
  chem: number;
  phase: ChemPhase;
  /** Ticks tot het einde van deze fase. */
  ticksLeft: number;
}

/** Wat een claimpunt nu verandert (ClaimPointStatus.activity). */
export type ClaimActivity = 'none' | 'post' | 'hero' | 'contest';

/**
 * Claimstand van één claimpunt (protocol 0.10.0, bevestigd in fase-0 sectie 22). owner: playerId of OWNER_NEUTRAL. beacon: het punt is van
 * owner zonder claimgebouw (zijn held claimde het, of het ging over na een aanval) en dus over te nemen: staan er units
 * van een ander in de cirkel en geen van owner, dan gaat het na sim.json contestFlipS over. activity en by: een paal van
 * by in aanbouw (post), de held van by die het vrije punt claimt (hero, heroClaimS), of units van by die een beacon
 * overnemen (contest); by is OWNER_NEUTRAL bij none. progressPermille: 0..1000 van die activiteit. frozen: units van
 * meer dan één speler in de cirkel (een heldclaim of overname staat dan stil).
 */
export interface ClaimPointStatus {
  pointId: number;
  owner: number;
  beacon: boolean;
  activity: ClaimActivity;
  by: number;
  progressPermille: number;
  frozen: boolean;
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
  /**
   * produce (protocol 0.8.0, besluit sectie 20): een robot in productie in een gebouw (buildingId = de fabriek, unitId =
   * ENTITY_NONE, id = loadoutId); train (protocol 0.8.0): een trainingsprogramma (buildingId = de trainingsfaciliteit,
   * unitId = ENTITY_NONE, id = programId). Beide stopt Cancel op het gebouw. Een gebouw heeft hoogstens één onderzoek
   * of één job (produce of train), nooit beide.
   */
  kind: 'research' | 'craft' | 'produce' | 'train';
  /** Entity-id van het gebouw waarin het werk loopt (craft onderweg: ENTITY_NONE). */
  buildingId: number;
  /** Bij craft de bewoner die omgeschoold wordt; bij research, produce en train ENTITY_NONE. Verplicht sinds protocol 0.5.0. */
  unitId: number;
  /** techId bij research, loadoutId bij craft en produce, programId bij train. */
  id: number;
  /** 0..1000; bij craft 0 zolang de bewoner nog onderweg is naar de werkplaats. */
  progressPermille: number;
}
