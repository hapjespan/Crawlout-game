import { ENTITY_GEN_BITS, ENTITY_INDEX_BITS, ENTITY_NONE, MAX_ENTITIES, OWNER_NEUTRAL } from '@crawlout/protocol';

// ECS op typed arrays (SoA), vooraf gealloceerd op MAX_ENTITIES. Geen floats.
//
// Entity-id (contract 1, ENTITY_* in protocol): uint32 = index * 2^ENTITY_GEN_BITS + generatie. De index staat in
// de hoge bits, zodat oplopende id gelijk is aan oplopende index: iteratie op index is iteratie op oplopende id.
// Generatie 1..2^20-1, 0 komt nooit voor; id 0 (ENTITY_NONE) betekent dus altijd "geen entity".

export const GEN_MASK = (1 << ENTITY_GEN_BITS) - 1;
const GEN_SPAN = 1 << ENTITY_GEN_BITS;
export const NO_ENTITY = ENTITY_NONE;

export const ORDER_SLOTS = 4; // Orders: ringbuffer van 4 (contract 1)
export const ORDER_NONE = 0;
export const ORDER_MOVE = 1;
export const ORDER_ATTACK_MOVE = 2;
export const ORDER_ATTACK = 3;
export const ORDER_GATHER = 4;
export const ORDER_BUILD = 5;
// 6 was ORDER_CLAIM (sprint-2-interim); claimen is sinds sprint 3 een Build van het claimgebouw.
export const ORDER_CRAFT = 7;

/** Fasen binnen een order (veld `phase`). */
export const PHASE_GO = 0; // onderweg naar het doel
export const PHASE_WORK = 1; // aan het werk bij het doel (verzamelen, bouwen, wachten op scrap in de werkplaats)
export const PHASE_RETURN = 2; // verzamelen: onderweg naar een depot
export const PHASE_CRAFT = 3; // werkplaats: betaald, aan het omscholen

/** Bouwstatus (veld `bstate`). */
export const BSTATE_NONE = 0;
export const BSTATE_SITE = 1; // in aanbouw
export const BSTATE_DONE = 2;

export const NO_FIELD = 255;
/** goalX/goalY zonder doel. */
export const NO_GOAL = -1;

/** Componentbits in mask. */
export const C = {
  transform: 1 << 0,
  movement: 1 << 1,
  health: 1 << 2,
  owner: 1 << 3,
  unit: 1 << 4,
  orders: 1 << 5,
  combat: 1 << 6,
  building: 1 << 7,
  resource: 1 << 8,
  claim: 1 << 9,
  corpse: 1 << 10,
  /** De held van zijn speler (een unit met de stats uit SimHero; PlayerState houdt xp, level, perks en oplappen). */
  hero: 1 << 11,
} as const;

if (MAX_ENTITIES > 1 << ENTITY_INDEX_BITS) throw new Error('MAX_ENTITIES past niet in de index-bits van de entity-id');

export const makeId = (index: number, gen: number): number => index * GEN_SPAN + gen;
export const indexOf = (id: number): number => id >>> ENTITY_GEN_BITS;
export const genOf = (id: number): number => id & GEN_MASK;

type IntArray = Uint8Array | Uint16Array | Uint32Array | Int32Array;

export class World {
  readonly n = MAX_ENTITIES;

  // Entity-beheer
  readonly gen = new Uint32Array(MAX_ENTITIES);
  readonly alive = new Uint8Array(MAX_ENTITIES);
  readonly mask = new Uint32Array(MAX_ENTITIES);
  readonly freeStack = new Int32Array(MAX_ENTITIES);
  freeCount = 0;
  /** Aantal indices dat ooit is uitgegeven; alles daarboven is nul. */
  highWater = 0;

  // Transform
  readonly x = new Int32Array(MAX_ENTITIES);
  readonly y = new Int32Array(MAX_ENTITIES);
  readonly yaw = new Uint16Array(MAX_ENTITIES);
  // Movement
  readonly speed = new Int32Array(MAX_ENTITIES);
  readonly radius = new Int32Array(MAX_ENTITIES);
  readonly flowField = new Uint8Array(MAX_ENTITIES);
  /** 1 zolang de unit naar (goalX, goalY) loopt. */
  readonly mvOn = new Uint8Array(MAX_ENTITIES);
  readonly goalX = new Int32Array(MAX_ENTITIES);
  readonly goalY = new Int32Array(MAX_ENTITIES);
  /** Aankomstafstand tot het doel (eenheden). */
  readonly goalR = new Int32Array(MAX_ENTITIES);
  /** Groeps-Move: afstand tot het doel waarbinnen contact met een gearriveerde groepsgenoot telt als aankomst. */
  readonly groupR = new Int32Array(MAX_ENTITIES);
  // Health
  readonly hp = new Int32Array(MAX_ENTITIES);
  readonly maxHp = new Int32Array(MAX_ENTITIES);
  readonly armorType = new Uint8Array(MAX_ENTITIES);
  // Owner
  readonly owner = new Uint8Array(MAX_ENTITIES);
  // Unit (en type van gebouwen, nodes en claimpunten)
  readonly typeId = new Uint16Array(MAX_ENTITIES);
  readonly bodyType = new Uint8Array(MAX_ENTITIES);
  readonly loadoutId = new Uint16Array(MAX_ENTITIES);
  readonly role = new Uint8Array(MAX_ENTITIES);
  // Orders: ringbuffer van ORDER_SLOTS per entity
  readonly ordType = new Uint8Array(MAX_ENTITIES * ORDER_SLOTS);
  readonly ordX = new Int32Array(MAX_ENTITIES * ORDER_SLOTS);
  readonly ordY = new Int32Array(MAX_ENTITIES * ORDER_SLOTS);
  readonly ordT = new Uint32Array(MAX_ENTITIES * ORDER_SLOTS);
  readonly ordHead = new Uint8Array(MAX_ENTITIES);
  readonly ordCount = new Uint8Array(MAX_ENTITIES);
  /** Fase binnen de huidige order (PHASE_*). */
  readonly phase = new Uint8Array(MAX_ENTITIES);
  /** Teller van de huidige fase in ticks (verzamelen, omscholen), de lijk-timer, of de onderzoeksvoortgang van een gebouw. */
  readonly work = new Int32Array(MAX_ENTITIES);
  // Target en Combat
  readonly target = new Uint32Array(MAX_ENTITIES);
  readonly cooldown = new Int32Array(MAX_ENTITIES);
  readonly cooldownMax = new Int32Array(MAX_ENTITIES);
  readonly damage = new Int32Array(MAX_ENTITIES);
  readonly damageType = new Uint8Array(MAX_ENTITIES);
  readonly range = new Int32Array(MAX_ENTITIES);
  // Economie
  readonly carry = new Int32Array(MAX_ENTITIES);
  /**
   * Bouwer: id van zijn laatste onafgemaakte bouwplaats (gezet bij elke bouworder, gewist door Stop). Zonder order
   * loopt hij daar vanzelf naar terug zolang de plaats bestaat en onaf is (systeem 2, orders.ts).
   */
  readonly resumeSite = new Uint32Array(MAX_ENTITIES);
  /** 1 na een Stop (of Cancel op de unit): geen automatisch helpen tot het volgende bevel. */
  readonly buildHold = new Uint8Array(MAX_ENTITIES);
  // Building: footprint in cellen (fx, fy linksboven), bouwstatus en voortgang in ticks
  readonly fx = new Int32Array(MAX_ENTITIES);
  readonly fy = new Int32Array(MAX_ENTITIES);
  readonly fw = new Uint8Array(MAX_ENTITIES);
  readonly fh = new Uint8Array(MAX_ENTITIES);
  readonly bstate = new Uint8Array(MAX_ENTITIES);
  readonly progress = new Int32Array(MAX_ENTITIES);
  /** Onderzoek in een voltooid gebouw: techId + 1, 0 = geen; de voortgang staat in `work` (duizendsten van een tick). */
  readonly research = new Uint16Array(MAX_ENTITIES);
  // ResourceNode
  readonly amount = new Int32Array(MAX_ENTITIES);
  // Claim: de eigenaar staat in `owner` (OWNER_NEUTRAL als onbezet). claimBy en claimProgress tonen de voortgang van
  // het verst gevorderde claimgebouw in aanbouw van een andere speler binnen de straal (claimProgress = 0..65535,
  // wordt animT); systeem 7 zet ze elke tick.
  readonly claimBy = new Uint8Array(MAX_ENTITIES);
  readonly claimProgress = new Int32Array(MAX_ENTITIES);
  /** Claimpunt: bitset van spelers die het ooit namen (ontdekking, xpPerDiscovery voor de held). */
  readonly seenBy = new Uint8Array(MAX_ENTITIES);
  // Presentatie (gaat de snapshot in, is ook state zodat de hash de hele snapshot dekt)
  readonly anim = new Uint8Array(MAX_ENTITIES);
  readonly animT = new Uint16Array(MAX_ENTITIES);
  readonly flags = new Uint8Array(MAX_ENTITIES);

  /** Alle state-arrays in vaste volgorde (na de velden hierboven gedeclareerd). */
  readonly stateArrays: readonly StateArray[] = entityStateArrays(this);

  /** Geeft een vrije index uit (vrije lijst eerst, LIFO) of -1 als de wereld vol is. */
  alloc(): number {
    let i: number;
    if (this.freeCount > 0) i = this.freeStack[--this.freeCount]!;
    else if (this.highWater < this.n) i = this.highWater++;
    else return -1;
    if (this.gen[i] === 0) this.gen[i] = 1;
    this.alive[i] = 1;
    this.mask[i] = 0;
    this.flowField[i] = NO_FIELD;
    this.goalX[i] = NO_GOAL;
    this.goalY[i] = NO_GOAL;
    this.claimBy[i] = OWNER_NEUTRAL;
    return i;
  }

  idOf(i: number): number {
    return makeId(i, this.gen[i]!);
  }

  /** Index van een levende entity met deze id, anders -1. Veilig voor willekeurige invoer uit commando's. */
  resolve(id: number): number {
    if (!Number.isInteger(id) || id <= 0 || id > 0xffffffff) return -1;
    const i = indexOf(id);
    if (i >= this.highWater || this.alive[i] !== 1 || this.gen[i] !== genOf(id)) return -1;
    return i;
  }

  /** Geeft de index vrij: generatie omhoog (oude ids worden ongeldig), componenten op nul, index op de vrije lijst. */
  free(i: number): void {
    const g = this.gen[i]!;
    for (const s of this.stateArrays) {
      if (s.array === this.gen || s.array === this.alive) continue;
      const o = i * s.perEntity;
      for (let k = 0; k < s.perEntity; k++) s.array[o + k] = 0;
    }
    this.gen[i] = g >= GEN_MASK ? 1 : g + 1;
    this.alive[i] = 0;
    this.freeStack[this.freeCount++] = i;
  }

  /** Aantal levende entities. */
  liveCount(): number {
    let c = 0;
    for (let i = 0; i < this.highWater; i++) c += this.alive[i]!;
    return c;
  }

  has(i: number, bits: number): boolean {
    return this.alive[i] === 1 && (this.mask[i]! & bits) === bits;
  }

  // Orders-ringbuffer
  clearOrders(i: number): void {
    const o = i * ORDER_SLOTS;
    for (let k = 0; k < ORDER_SLOTS; k++) {
      this.ordType[o + k] = ORDER_NONE;
      this.ordX[o + k] = 0;
      this.ordY[o + k] = 0;
      this.ordT[o + k] = 0;
    }
    this.ordHead[i] = 0;
    this.ordCount[i] = 0;
    this.phase[i] = PHASE_GO;
    this.work[i] = 0;
  }

  /** Voegt een order achteraan toe; false als de ring vol is. */
  pushOrder(i: number, type: number, x: number, y: number, t: number): boolean {
    const c = this.ordCount[i]!;
    if (c >= ORDER_SLOTS) return false;
    const slot = i * ORDER_SLOTS + ((this.ordHead[i]! + c) & (ORDER_SLOTS - 1));
    this.ordType[slot] = type;
    this.ordX[slot] = x;
    this.ordY[slot] = y;
    this.ordT[slot] = t;
    this.ordCount[i] = c + 1;
    return true;
  }

  /** Slot-index (in ordType/ordX/ordY/ordT) van de huidige order, of -1. */
  currentOrder(i: number): number {
    return this.ordCount[i]! > 0 ? i * ORDER_SLOTS + this.ordHead[i]! : -1;
  }

  /** Type van de huidige order, of ORDER_NONE. */
  orderType(i: number): number {
    return this.ordCount[i]! > 0 ? this.ordType[i * ORDER_SLOTS + this.ordHead[i]!]! : ORDER_NONE;
  }

  popOrder(i: number): void {
    const c = this.ordCount[i]!;
    if (c === 0) return;
    const slot = i * ORDER_SLOTS + this.ordHead[i]!;
    this.ordType[slot] = ORDER_NONE;
    this.ordX[slot] = 0;
    this.ordY[slot] = 0;
    this.ordT[slot] = 0;
    this.ordHead[i] = (this.ordHead[i]! + 1) & (ORDER_SLOTS - 1);
    this.ordCount[i] = c - 1;
    this.phase[i] = PHASE_GO;
    this.work[i] = 0;
  }
}

/** Typed array met het aantal elementen per entity, voor serialisatie en hash in vaste volgorde. */
export interface StateArray {
  readonly name: string;
  readonly array: IntArray;
  readonly perEntity: number;
}

/** Alle per-entity state-arrays in vaste volgorde. Wijzigen = formatversie omhoog en nieuwe fixtures. */
export function entityStateArrays(w: World): readonly StateArray[] {
  const one = (name: string, array: IntArray): StateArray => ({ name, array, perEntity: 1 });
  const ord = (name: string, array: IntArray): StateArray => ({ name, array, perEntity: ORDER_SLOTS });
  return [
    one('gen', w.gen),
    one('alive', w.alive),
    one('mask', w.mask),
    one('x', w.x),
    one('y', w.y),
    one('yaw', w.yaw),
    one('speed', w.speed),
    one('radius', w.radius),
    one('flowField', w.flowField),
    one('mvOn', w.mvOn),
    one('goalX', w.goalX),
    one('goalY', w.goalY),
    one('goalR', w.goalR),
    one('groupR', w.groupR),
    one('hp', w.hp),
    one('maxHp', w.maxHp),
    one('armorType', w.armorType),
    one('owner', w.owner),
    one('typeId', w.typeId),
    one('bodyType', w.bodyType),
    one('loadoutId', w.loadoutId),
    one('role', w.role),
    ord('ordType', w.ordType),
    ord('ordX', w.ordX),
    ord('ordY', w.ordY),
    ord('ordT', w.ordT),
    one('ordHead', w.ordHead),
    one('ordCount', w.ordCount),
    one('phase', w.phase),
    one('work', w.work),
    one('target', w.target),
    one('cooldown', w.cooldown),
    one('cooldownMax', w.cooldownMax),
    one('damage', w.damage),
    one('damageType', w.damageType),
    one('range', w.range),
    one('carry', w.carry),
    one('resumeSite', w.resumeSite),
    one('buildHold', w.buildHold),
    one('fx', w.fx),
    one('fy', w.fy),
    one('fw', w.fw),
    one('fh', w.fh),
    one('bstate', w.bstate),
    one('progress', w.progress),
    one('research', w.research),
    one('amount', w.amount),
    one('claimBy', w.claimBy),
    one('claimProgress', w.claimProgress),
    one('seenBy', w.seenBy),
    one('anim', w.anim),
    one('animT', w.animT),
    one('flags', w.flags),
  ];
}
