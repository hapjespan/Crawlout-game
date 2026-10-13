import { MAX_ENTITIES } from '@crawlout/protocol';

// ECS op typed arrays (SoA), vooraf gealloceerd op MAX_ENTITIES. Geen floats.
//
// Entity-id (uint32) = index * 2^20 + generatie. De index staat in de hoge 12 bits, zodat oplopende id
// gelijk is aan oplopende index: iteratie op index is iteratie op oplopende entity-id.
// Generatie 1..2^20-1, 0 komt nooit voor; id 0 betekent dus altijd "geen entity".

export const INDEX_BITS = 12;
export const GEN_BITS = 20;
export const GEN_MASK = (1 << GEN_BITS) - 1;
const GEN_SPAN = 1 << GEN_BITS;
export const NO_ENTITY = 0;

export const ORDER_SLOTS = 4; // Orders: ringbuffer van 4
export const ORDER_NONE = 0;
export const ORDER_MOVE = 1;

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
} as const;

if (MAX_ENTITIES > 1 << INDEX_BITS) throw new Error('MAX_ENTITIES past niet in de index-bits van de entity-id');

export const makeId = (index: number, gen: number): number => index * GEN_SPAN + gen;
export const indexOf = (id: number): number => id >>> GEN_BITS;
export const genOf = (id: number): number => id & GEN_MASK;

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
  readonly goalX = new Int32Array(MAX_ENTITIES);
  readonly goalY = new Int32Array(MAX_ENTITIES);
  /** Afstand tot het doel waarbinnen contact met een gearriveerde groepsgenoot telt als aankomst. */
  readonly groupR = new Int32Array(MAX_ENTITIES);
  // Health
  readonly hp = new Int32Array(MAX_ENTITIES);
  readonly maxHp = new Int32Array(MAX_ENTITIES);
  readonly armorType = new Uint8Array(MAX_ENTITIES);
  // Owner
  readonly owner = new Uint8Array(MAX_ENTITIES);
  // Unit
  readonly typeId = new Uint16Array(MAX_ENTITIES);
  readonly bodyType = new Uint8Array(MAX_ENTITIES);
  readonly loadoutId = new Uint16Array(MAX_ENTITIES);
  readonly role = new Uint8Array(MAX_ENTITIES);
  // Orders: ringbuffer van ORDER_SLOTS per entity
  readonly ordType = new Uint8Array(MAX_ENTITIES * ORDER_SLOTS);
  readonly ordX = new Int32Array(MAX_ENTITIES * ORDER_SLOTS);
  readonly ordY = new Int32Array(MAX_ENTITIES * ORDER_SLOTS);
  readonly ordHead = new Uint8Array(MAX_ENTITIES);
  readonly ordCount = new Uint8Array(MAX_ENTITIES);
  // Presentatie (gaat de snapshot in, is ook state zodat de hash de hele snapshot dekt)
  readonly anim = new Uint8Array(MAX_ENTITIES);
  readonly animT = new Uint16Array(MAX_ENTITIES);
  readonly flags = new Uint8Array(MAX_ENTITIES);

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
    this.gen[i] = g >= GEN_MASK ? 1 : g + 1;
    this.alive[i] = 0;
    this.mask[i] = 0;
    this.x[i] = 0;
    this.y[i] = 0;
    this.yaw[i] = 0;
    this.speed[i] = 0;
    this.radius[i] = 0;
    this.flowField[i] = 0;
    this.goalX[i] = 0;
    this.goalY[i] = 0;
    this.groupR[i] = 0;
    this.hp[i] = 0;
    this.maxHp[i] = 0;
    this.armorType[i] = 0;
    this.owner[i] = 0;
    this.typeId[i] = 0;
    this.bodyType[i] = 0;
    this.loadoutId[i] = 0;
    this.role[i] = 0;
    const o = i * ORDER_SLOTS;
    for (let k = 0; k < ORDER_SLOTS; k++) {
      this.ordType[o + k] = 0;
      this.ordX[o + k] = 0;
      this.ordY[o + k] = 0;
    }
    this.ordHead[i] = 0;
    this.ordCount[i] = 0;
    this.anim[i] = 0;
    this.animT[i] = 0;
    this.flags[i] = 0;
    this.freeStack[this.freeCount++] = i;
  }

  /** Aantal levende entities. */
  liveCount(): number {
    let c = 0;
    for (let i = 0; i < this.highWater; i++) c += this.alive[i]!;
    return c;
  }

  // Orders-ringbuffer
  clearOrders(i: number): void {
    const o = i * ORDER_SLOTS;
    for (let k = 0; k < ORDER_SLOTS; k++) {
      this.ordType[o + k] = ORDER_NONE;
      this.ordX[o + k] = 0;
      this.ordY[o + k] = 0;
    }
    this.ordHead[i] = 0;
    this.ordCount[i] = 0;
  }

  /** Voegt een order achteraan toe; false als de ring vol is. */
  pushOrder(i: number, type: number, x: number, y: number): boolean {
    const c = this.ordCount[i]!;
    if (c >= ORDER_SLOTS) return false;
    const slot = i * ORDER_SLOTS + ((this.ordHead[i]! + c) & (ORDER_SLOTS - 1));
    this.ordType[slot] = type;
    this.ordX[slot] = x;
    this.ordY[slot] = y;
    this.ordCount[i] = c + 1;
    return true;
  }

  /** Slot-index (in ordType/ordX/ordY) van de huidige order, of -1. */
  currentOrder(i: number): number {
    return this.ordCount[i]! > 0 ? i * ORDER_SLOTS + this.ordHead[i]! : -1;
  }

  popOrder(i: number): void {
    const c = this.ordCount[i]!;
    if (c === 0) return;
    const slot = i * ORDER_SLOTS + this.ordHead[i]!;
    this.ordType[slot] = ORDER_NONE;
    this.ordX[slot] = 0;
    this.ordY[slot] = 0;
    this.ordHead[i] = (this.ordHead[i]! + 1) & (ORDER_SLOTS - 1);
    this.ordCount[i] = c - 1;
  }
}

/** Typed array met het aantal elementen per entity, voor serialisatie en hash in vaste volgorde. */
export interface StateArray {
  readonly name: string;
  readonly array: Uint8Array | Uint16Array | Uint32Array | Int32Array;
  readonly perEntity: number;
}

/** Alle per-entity state-arrays in vaste volgorde. Wijzigen = formatversie omhoog en nieuwe fixtures. */
export function entityStateArrays(w: World): readonly StateArray[] {
  return [
    { name: 'gen', array: w.gen, perEntity: 1 },
    { name: 'alive', array: w.alive, perEntity: 1 },
    { name: 'mask', array: w.mask, perEntity: 1 },
    { name: 'x', array: w.x, perEntity: 1 },
    { name: 'y', array: w.y, perEntity: 1 },
    { name: 'yaw', array: w.yaw, perEntity: 1 },
    { name: 'speed', array: w.speed, perEntity: 1 },
    { name: 'radius', array: w.radius, perEntity: 1 },
    { name: 'flowField', array: w.flowField, perEntity: 1 },
    { name: 'goalX', array: w.goalX, perEntity: 1 },
    { name: 'goalY', array: w.goalY, perEntity: 1 },
    { name: 'groupR', array: w.groupR, perEntity: 1 },
    { name: 'hp', array: w.hp, perEntity: 1 },
    { name: 'maxHp', array: w.maxHp, perEntity: 1 },
    { name: 'armorType', array: w.armorType, perEntity: 1 },
    { name: 'owner', array: w.owner, perEntity: 1 },
    { name: 'typeId', array: w.typeId, perEntity: 1 },
    { name: 'bodyType', array: w.bodyType, perEntity: 1 },
    { name: 'loadoutId', array: w.loadoutId, perEntity: 1 },
    { name: 'role', array: w.role, perEntity: 1 },
    { name: 'ordType', array: w.ordType, perEntity: ORDER_SLOTS },
    { name: 'ordX', array: w.ordX, perEntity: ORDER_SLOTS },
    { name: 'ordY', array: w.ordY, perEntity: ORDER_SLOTS },
    { name: 'ordHead', array: w.ordHead, perEntity: 1 },
    { name: 'ordCount', array: w.ordCount, perEntity: 1 },
    { name: 'anim', array: w.anim, perEntity: 1 },
    { name: 'animT', array: w.animT, perEntity: 1 },
    { name: 'flags', array: w.flags, perEntity: 1 },
  ];
}
