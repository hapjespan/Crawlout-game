// Contract 1: tijd en getallen. Eén plek. Zie docs/fase-0-contracten-en-agentbriefs.md sectie 4.
export const TICK_HZ = 20;
export const TICK_MS = 50;
export const UNITS_PER_METER = 256;
export const FRAC_BITS = 8;
export const ANGLE_FULL = 65536; // yaw: 0..65535 = 0..360 graden
export const MAX_ENTITIES = 4096;
export const MAX_PLAYERS = 8;

// Contract 2: lockstep.
export const DELAY_FRAMES_DEFAULT = 4; // 200 ms bij 20 Hz
export const DELAY_FRAMES_MIN = 2;
export const DELAY_FRAMES_MAX = 8;
export const HASH_INTERVAL_FRAMES = 20; // elke seconde een hash naar de relay
export const MAX_ENTITIES_PER_COMMAND = 64;
export const STALL_TIMEOUT_MS = 2000; // bundel ontbreekt langer dan dit: sim pauzeert
