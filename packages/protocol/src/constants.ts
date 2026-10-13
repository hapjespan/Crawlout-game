// Contract 1: tijd en getallen. Eén plek. Zie docs/fase-0-contracten-en-agentbriefs.md sectie 4.
export const TICK_HZ = 20;
export const TICK_MS = 50;
export const UNITS_PER_METER = 256;
export const FRAC_BITS = 8;
export const ANGLE_FULL = 65536; // yaw: 0..65535 = 0..360 graden
export const MAX_ENTITIES = 4096;
export const MAX_PLAYERS = 8;
// Eigenaar (besluit sprint 2): owner is een uint8; 0..MAX_PLAYERS-1 zijn spelers, OWNER_NEUTRAL is de eigenaar
// van neutrale entities (scrap-nodes, onbezette claimpunten). Waarden daartussen zijn gereserveerd.
export const OWNER_NEUTRAL = 255;

// Yaw-conventie (besluit sprint 1): hoeken lopen van sim +x naar sim +y, dus yaw = atan2(dy, dx) geschaald
// naar 0..65535. De renderer zet sim (x, y) op wereld (x, z); een model dat bij hoek 0 naar wereld +z kijkt
// en met Ry draait, gebruikt radialen = PI/2 - yaw * 2 * PI / ANGLE_FULL.
export const YAW_PLUS_X = 0;
export const YAW_PLUS_Y = ANGLE_FULL >> 2; // 16384

// Entity-id (besluit sprint 1): uint32 = index * 2^ENTITY_GEN_BITS + generatie. Index in de hoge 12 bits,
// generatie 1..2^20-1 in de lage 20 bits. Oplopende id is oplopende index; id 0 is nooit een entity.
export const ENTITY_INDEX_BITS = 12;
export const ENTITY_GEN_BITS = 20;
export const ENTITY_NONE = 0;

// Seed: uint32, gekozen door de relay en zo in start en Replay.
export const SEED_MAX = 0xffffffff;

// Contract 2: lockstep.
export const DELAY_FRAMES_DEFAULT = 4; // 200 ms bij 20 Hz
export const DELAY_FRAMES_MIN = 2;
export const DELAY_FRAMES_MAX = 8;
export const HASH_INTERVAL_FRAMES = 20; // elke seconde een hash naar de relay
export const MAX_ENTITIES_PER_COMMAND = 64;
export const STALL_TIMEOUT_MS = 2000; // bundel ontbreekt langer dan dit: sim pauzeert
