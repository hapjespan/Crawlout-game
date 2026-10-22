import { describe, expect, it } from 'vitest';
import {
  ANGLE_FULL,
  ANIM,
  ANIM_NAMES,
  CommandEnvelope,
  ENTITY_FLAG,
  ENTITY_GEN_BITS,
  ENTITY_INDEX_BITS,
  ENTITY_NONE,
  EVENT_TYPE,
  FOG,
  type FogMask,
  fogAt,
  LobbyPlayer,
  MAX_ENTITIES,
  MAX_PLAYERS,
  OWNER_NEUTRAL,
  Replay,
  SEED_MAX,
  SNAPSHOT_HEADER_BYTES,
  ServerMessage,
  TICK_MS,
  YAW_PLUS_X,
  YAW_PLUS_Y,
  readSnapshotHeader,
  snapshotLayout,
  writeSnapshotHeader,
  type HeroStatus,
  type PlayerStatus,
  type SurvivalStatus,
} from './index.js';

describe('besluiten sprint 1', () => {
  it('yaw: 0 is +x, een kwart slag is +y', () => {
    expect(YAW_PLUS_X).toBe(0);
    expect(YAW_PLUS_Y).toBe(ANGLE_FULL / 4);
  });
  it('anim-ids volgen de clipvolgorde van de artist-brief', () => {
    expect(ANIM_NAMES.map((n) => ANIM[n])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ANIM.idle).toBe(0);
    expect(ANIM.walk).toBe(1);
    expect(ANIM.death).toBe(7);
  });
  it('entity-id: index past in de hoge bits, generatie in de lage, samen uint32', () => {
    expect(ENTITY_INDEX_BITS + ENTITY_GEN_BITS).toBe(32);
    expect(MAX_ENTITIES).toBeLessThanOrEqual(1 << ENTITY_INDEX_BITS);
  });
  it('een LobbyPlayer draagt een ai-vlag en de seed is een uint32', () => {
    expect(
      LobbyPlayer.safeParse({
        playerId: 1,
        name: 'ai',
        faction: 'dwellers',
        ready: true,
        online: true,
      }).success,
    ).toBe(false);
    expect(
      LobbyPlayer.safeParse({
        playerId: 1,
        name: 'ai',
        faction: 'dwellers',
        ready: true,
        online: true,
        ai: true,
      }).success,
    ).toBe(true);
    const base = {
      dataVersion: '0.2.0',
      map: 'rustbelt',
      players: [],
      settings: { mode: 'skirmish', delayFrames: 4 },
      bundles: [],
      hashes: [],
    };
    expect(Replay.safeParse({ ...base, seed: SEED_MAX }).success).toBe(true);
    expect(Replay.safeParse({ ...base, seed: SEED_MAX + 1 }).success).toBe(false);
  });
  it('dominanceMinutes is optioneel: zonder override geldt de waarde uit de map', () => {
    const start = {
      kind: 'start',
      seed: 1,
      map: 'rustbelt',
      players: [],
      settings: { mode: 'skirmish', delayFrames: 4 },
      dataVersion: '0.2.0',
      you: 0,
    };
    expect(ServerMessage.safeParse(start).success).toBe(true);
  });
});

describe('lobby you (protocol 0.12.0, verplicht in 0.13.0, fase-0 sectie 23 besluit 7)', () => {
  const lobby = {
    kind: 'lobby',
    roomId: 'r',
    map: 'rustbelt',
    players: [
      { playerId: 0, name: 'Speler', faction: 'dwellers', ready: false, online: true, ai: false },
      { playerId: 1, name: 'Speler', faction: 'raiders', ready: true, online: false, ai: true },
    ],
  };
  it('het lobby-bericht draagt de eigen playerId, zoals start, en zonder you is het ongeldig', () => {
    expect(ServerMessage.safeParse(lobby).success).toBe(false);
    expect(ServerMessage.safeParse({ ...lobby, you: 0 }).success).toBe(true);
    const parsed = ServerMessage.parse({ ...lobby, you: 1 });
    expect(parsed.kind === 'lobby' && parsed.you).toBe(1);
  });
  it('you is een playerId binnen MAX_PLAYERS, geen naam', () => {
    expect(ServerMessage.safeParse({ ...lobby, you: MAX_PLAYERS }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...lobby, you: -1 }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...lobby, you: 'Speler' }).success).toBe(false);
  });
});

describe('besluiten sprint 2', () => {
  it('de neutrale eigenaar past in het owner-byte en botst niet met een speler', () => {
    expect(OWNER_NEUTRAL).toBe(255);
    expect(OWNER_NEUTRAL).toBeGreaterThanOrEqual(MAX_PLAYERS);
  });
  it('Build draagt typeId en het midden van de footprint; Claim een pointId', () => {
    expect(
      CommandEnvelope.safeParse({
        frame: 0,
        playerId: 0,
        seq: 0,
        type: 'Build',
        payload: { ids: [1], typeId: 1025, x: 5248, y: 5248 },
      }).success,
    ).toBe(true);
    expect(
      CommandEnvelope.safeParse({
        frame: 0,
        playerId: 0,
        seq: 0,
        type: 'Claim',
        payload: { ids: [1], pointId: 7 },
      }).success,
    ).toBe(true);
  });
});

describe('besluiten sprint 3', () => {
  it('abilityZone is een event na heroLevel; de held zit in de unit-ruimte (1000 + heroId)', () => {
    expect(EVENT_TYPE.abilityZone).toBe(EVENT_TYPE.heroLevel + 1);
    expect(new Set(Object.values(EVENT_TYPE)).size).toBe(Object.keys(EVENT_TYPE).length);
  });
  it('HeroStatus: de velden van sprint 2 en de toestand van sprint 3 zijn verplicht (sim-core levert ze sinds sprint 4)', () => {
    const full: HeroStatus = {
      heroId: 0,
      level: 1,
      xp: 0,
      xpNext: 100,
      special: [6, 5, 6, 4, 4, 6, 3],
      perks: [],
      pendingPerks: 0,
      revivesLeft: 4,
      state: 'reviving',
      reviveTicksLeft: 800,
      entityId: ENTITY_NONE,
      abilityCooldownTicks: [0],
    };
    const status: PlayerStatus = {
      playerId: 0,
      scrap: 0,
      settlers: 0,
      pop: 0,
      popCap: 0,
      beds: 0,
      hero: full,
      techs: [1],
      queue: [],
      dominance: {
        pointsHeld: 0,
        pointsRequired: 2,
        ticksHeld: 0,
        ticksRequired: 9600,
        leader: null,
      },
      noBedPop: 0,
      trained: [0, 0, 0, 0, 0, 0, 0],
      claimPoints: [],
    };
    expect(status.hero?.state).toBe('reviving');
  });
  it('PlayerStatus.dominance (protocol 0.6.0, verplicht sinds 0.7.0): eigen stand plus de tegenstander die het dichtst bij dominantie is', () => {
    const status: PlayerStatus = {
      playerId: 0,
      scrap: 0,
      settlers: 0,
      pop: 0,
      popCap: 0,
      beds: 0,
      hero: null,
      queue: [],
      dominance: {
        pointsHeld: 1,
        pointsRequired: 2,
        ticksHeld: 0,
        ticksRequired: 9600,
        leader: { playerId: 1, pointsHeld: 2, ticksHeld: 4800 },
      },
      noBedPop: 0,
      trained: [0, 0, 0, 0, 0, 0, 0],
      claimPoints: [],
    };
    const d = status.dominance!;
    expect(d.leader!.ticksHeld * TICK_MS).toBe(240_000);
    expect({ ...status, dominance: { ...d, leader: null } }.dominance.leader).toBeNull();
  });
  it('Recruit draagt alleen het gebouw (het hoofdgebouw bij oplappen), HeroAbility mag zonder doel', () => {
    expect(
      CommandEnvelope.safeParse({
        frame: 0,
        playerId: 0,
        seq: 0,
        type: 'Recruit',
        payload: { buildingId: 1048577 },
      }).success,
    ).toBe(true);
    expect(
      CommandEnvelope.safeParse({
        frame: 0,
        playerId: 0,
        seq: 0,
        type: 'HeroAbility',
        payload: { heroId: 0, abilityId: 0 },
      }).success,
    ).toBe(true);
  });
});

describe('voorstel content-x (protocol 0.8.0, ter bevestiging door de architect)', () => {
  const env = (type: string, payload: unknown) =>
    CommandEnvelope.safeParse({ frame: 0, playerId: 0, seq: 0, type, payload }).success;

  it('Produce draagt het gebouw en het loadout, Train het gebouw en het programma', () => {
    expect(env('Produce', { buildingId: 1048577, loadoutId: 10 })).toBe(true);
    expect(env('Train', { buildingId: 1048577, programId: 3 })).toBe(true);
    expect(env('Produce', { buildingId: 1048577 })).toBe(false);
    expect(env('Train', { buildingId: 1048577, programId: -1 })).toBe(false);
    expect(env('Produce', { buildingId: 1, loadoutId: 2, ids: [1] })).toBe(false);
  });

  it('QueueItem kent produce en train; noBedPop en trained zijn verplicht (0.9.0/0.20.0)', () => {
    const status: PlayerStatus = {
      playerId: 0,
      scrap: 0,
      settlers: 3,
      pop: 3,
      popCap: 6,
      beds: 6,
      hero: null,
      queue: [
        {
          kind: 'produce',
          buildingId: 1048577,
          unitId: ENTITY_NONE,
          id: 10,
          progressPermille: 500,
        },
        { kind: 'train', buildingId: 2097153, unitId: ENTITY_NONE, id: 3, progressPermille: 0 },
      ],
      dominance: {
        pointsHeld: 0,
        pointsRequired: 3,
        ticksHeld: 0,
        ticksRequired: 9600,
        leader: null,
      },
      noBedPop: 2,
      trained: [1, 0, 0, 0, 0, 0, 0],
      claimPoints: [],
    };
    expect(status.queue.map((q) => q.kind)).toEqual(['produce', 'train']);
  });
});

describe('CommandEnvelope', () => {
  it('accepteert een geldig Move-commando', () => {
    const r = CommandEnvelope.safeParse({
      frame: 10,
      playerId: 0,
      seq: 1,
      type: 'Move',
      payload: { ids: [1, 2], x: 2560, y: 512 },
    });
    expect(r.success).toBe(true);
  });
  it('weigert een payload die niet bij het type hoort', () => {
    const r = CommandEnvelope.safeParse({
      frame: 10,
      playerId: 0,
      seq: 1,
      type: 'Move',
      payload: { ids: [1], target: 5 },
    });
    expect(r.success).toBe(false);
  });
  it('weigert meer dan 64 entity-ids', () => {
    const ids = Array.from({ length: 65 }, (_, i) => i);
    const r = CommandEnvelope.safeParse({
      frame: 0,
      playerId: 0,
      seq: 0,
      type: 'Stop',
      payload: { ids },
    });
    expect(r.success).toBe(false);
  });
});

describe('snapshotLayout', () => {
  it('legt 4-byte arrays op 4-byte grenzen en groeit met de aantallen', () => {
    const a = snapshotLayout(10, 3);
    expect(a.entity.id % 4).toBe(0);
    expect(a.entity.x % 4).toBe(0);
    expect(a.event.a % 4).toBe(0);
    expect(a.totalBytes).toBeGreaterThan(SNAPSHOT_HEADER_BYTES);
    expect(snapshotLayout(20, 3).totalBytes).toBeGreaterThan(a.totalBytes);
  });
  it('schrijft en leest de header', () => {
    const buf = new ArrayBuffer(SNAPSHOT_HEADER_BYTES);
    writeSnapshotHeader(buf, { tick: 123, hash: 0xdeadbeef, entityCount: 7, eventCount: 2 });
    expect(readSnapshotHeader(buf)).toEqual({
      tick: 123,
      hash: 0xdeadbeef,
      entityCount: 7,
      eventCount: 2,
    });
  });
});

describe('fog of war (protocol 0.11.0, fase-0 sectie 23 besluit 1)', () => {
  it('ENTITY_FLAG.ghost is its own bit', () => {
    const bits = Object.values(ENTITY_FLAG);
    expect(ENTITY_FLAG.ghost).toBe(1 << 4);
    expect(new Set(bits).size).toBe(bits.length);
  });

  it('fogAt reads explored and visible from the two bitsets', () => {
    const mask: FogMask = {
      frame: 0,
      playerId: 0,
      cellsW: 3,
      cellsH: 3,
      cellUnits: 512,
      explored: new Uint8Array([0b0001_0011, 0]),
      visible: new Uint8Array([0b0001_0000, 0]),
    };
    expect(fogAt(mask, 0, 0)).toBe(FOG.explored);
    expect(fogAt(mask, 1, 0)).toBe(FOG.explored);
    expect(fogAt(mask, 2, 0)).toBe(FOG.unexplored);
    expect(fogAt(mask, 1, 1)).toBe(FOG.visible);
    expect(fogAt(mask, -1, 0)).toBe(FOG.unexplored);
    expect(fogAt(mask, 3, 0)).toBe(FOG.unexplored);
  });

  it('PlayerStatus.survival (protocol 0.17.0, sectie 24): de stand van een survival-run, null buiten Survival', () => {
    const survival: SurvivalStatus = {
      wavesStarted: 8,
      waves: 15,
      next: { wave: 9, atFrame: 20_800, rank: 'normal' },
      active: [{ target: 0, alive: 3 }],
      result: null,
    };
    const status: PlayerStatus = {
      playerId: 0,
      scrap: 0,
      settlers: 0,
      pop: 0,
      popCap: 0,
      beds: 0,
      hero: null,
      queue: [],
      dominance: { pointsHeld: 0, pointsRequired: 2, ticksHeld: 0, ticksRequired: 9600, leader: null },
      noBedPop: 0,
      trained: [0, 0, 0, 0, 0, 0, 0],
      claimPoints: [],
      survival,
    };
    expect(status.survival?.next?.rank).toBe('normal');
    const ended: SurvivalStatus = { ...survival, result: { outcome: 'overrun', frame: 21_000 } };
    expect(ended.result?.outcome).toBe('overrun');
  });
});
