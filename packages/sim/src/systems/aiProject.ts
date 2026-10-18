import { OWNER_NEUTRAL } from '@crawlout/protocol';
import type { SimAiScript } from '../config.js';
import { BSTATE_DONE, BSTATE_SITE } from '../ecs/world.js';
import { applyCommand } from './commands.js';
import type { SimContext } from './common.js';
import { kindsHeld, projectKindOf } from './project.js';

// The scripted AI and the Bouwproject (win route C, sim 0.25.0, data 0.30.0 ai/*.json `project`; voorstel, ter
// bevestiging door de architect). Three plain rules, all from the script, no numbers in code:
//  - restore (aiRestore): from restoreFromTicks, with an army of at least restoreMinArmy and no enemy at its buildings,
//    the AI sends `builders` idle builders to the nearest ruin (to its headquarters, as the crow flies; tiebreak the
//    lower part index) of a kind it holds no restored part of, one restore at a time; its other idle builders help at
//    that site like at any own site. A lost part is a missing kind again, so it rebuilds.
//  - sabotage (sabotageTarget): an opponent who holds a restored part of sabotageKinds kinds, or runs his countdown, is
//    a target: his restored or restoring part nearest to the own headquarters. The caller sends its idle army there
//    (AttackMove on the part: no formation, the units attack the building).
//  - rally (rallyPart): with rallyAtParts an idle army stands at the own part nearest to the enemy spawn while the AI
//    holds or restores one.
// The AI only reads map knowledge here: where the parts are and who holds them is public (PlayerStatus.project).

/** Squared distance between the centres of entities i and j. */
function d2(ctx: SimContext, i: number, j: number): number {
  const w = ctx.world;
  const dx = w.x[i]! - w.x[j]!;
  const dy = w.y[i]! - w.y[j]!;
  return dx * dx + dy * dy;
}

/** What the restore step did: the builders it gave an order, and the scrap it waits for (0 = none). */
export interface RestoreStep {
  readonly ids: readonly number[];
  /** The price of the restore it wants now but cannot pay yet: the caller saves for it (its reserve). */
  readonly wait: number;
}

const NOTHING: RestoreStep = { ids: [], wait: 0 };

/**
 * The restore step. `army` is the AI's army size as its script counts it; `saving` means the AI saves for something
 * else first (then it does nothing here).
 */
export function aiRestore(
  ctx: SimContext,
  p: number,
  script: SimAiScript,
  hq: number,
  army: number,
  threat: number,
  idleBuilders: readonly number[],
  saving: boolean,
): RestoreStep {
  const pr = script.project;
  const parts = ctx.projectParts;
  if (
    pr === undefined ||
    pr === null ||
    pr.restoreFromTicks < 0 ||
    ctx.frame < pr.restoreFromTicks ||
    parts.length === 0 ||
    hq < 0 ||
    saving ||
    threat >= 0 ||
    army < pr.restoreMinArmy
  )
    return NOTHING;
  const w = ctx.world;
  let covered = 0;
  for (const i of parts) {
    if (w.owner[i] !== p) continue;
    if (w.bstate[i] === BSTATE_SITE) return NOTHING; // one restore at a time; the builders help there
    if (w.bstate[i] === BSTATE_DONE) covered |= 1 << projectKindOf(ctx, w.typeId[i]!);
  }
  let best = -1;
  let bestD = 0;
  for (const i of parts) {
    if (w.owner[i] !== OWNER_NEUTRAL) continue;
    const kind = projectKindOf(ctx, w.typeId[i]!);
    if (kind < 0 || ((covered >>> kind) & 1) !== 0) continue;
    const d = d2(ctx, i, hq);
    if (best < 0 || d < bestD) {
      best = i;
      bestD = d;
    }
  }
  if (best < 0) return NOTHING;
  const kind = projectKindOf(ctx, w.typeId[best]!);
  const restored = ctx.config.project!.parts[kind]!.restoredTypeId;
  const cost = ctx.buildingType(restored)!.scrapCost;
  if (ctx.ps.scrap[p]! < cost) return { ids: [], wait: cost };
  if (idleBuilders.length === 0) return NOTHING;
  const ids = idleBuilders.slice(0, pr.builders);
  return applyCommand(ctx, {
    playerId: p,
    seq: 0,
    type: 'Build',
    payload: { ids, typeId: restored, x: w.x[best]!, y: w.y[best]! },
  })
    ? { ids, wait: 0 }
    : NOTHING;
}

/**
 * The part to sabotage: the restored or restoring part, nearest to the own headquarters, of an opponent who holds a
 * restored part of script.project.sabotageKinds kinds or runs his countdown; -1 without one.
 */
export function sabotageTarget(
  ctx: SimContext,
  p: number,
  script: SimAiScript,
  hq: number,
): number {
  const pr = script.project;
  const parts = ctx.projectParts;
  if (pr === undefined || pr === null || parts.length === 0 || hq < 0) return -1;
  let targets = 0;
  for (let q = 0; q < ctx.playerCount; q++) {
    if (q === p || ctx.ps.defeated[q] !== 0) continue;
    let n = 0;
    for (let m = kindsHeld(ctx, q); m !== 0; m &= m - 1) n++;
    if (n >= pr.sabotageKinds || ctx.ps.projTicks[q]! > 0) targets |= 1 << q;
  }
  if (targets === 0) return -1;
  const w = ctx.world;
  let best = -1;
  let bestD = 0;
  for (const i of parts) {
    const o = w.owner[i]!;
    if (o === OWNER_NEUTRAL || ((targets >>> o) & 1) === 0) continue;
    const d = d2(ctx, i, hq);
    if (best < 0 || d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** The own part (restored or restoring) nearest to (x, y) for the rally, with rallyAtParts; -1 without one. */
export function rallyPart(
  ctx: SimContext,
  p: number,
  script: SimAiScript,
  x: number,
  y: number,
): number {
  const pr = script.project;
  if (pr === undefined || pr === null || !pr.rallyAtParts) return -1;
  const w = ctx.world;
  let best = -1;
  let bestD = 0;
  for (const i of ctx.projectParts) {
    if (w.owner[i] !== p) continue;
    const dx = w.x[i]! - x;
    const dy = w.y[i]! - y;
    const d = dx * dx + dy * dy;
    if (best < 0 || d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/**
 * Whether an AttackMove to (x, y) is a sabotage run that is over: (x, y) is the centre of a part that no opponent of p
 * holds any more (a ruin, or p's own). Then the unit is idle again (ai.ts raidOver).
 */
export function sabotageOver(ctx: SimContext, p: number, x: number, y: number): boolean | null {
  const w = ctx.world;
  for (const i of ctx.projectParts) {
    if (w.x[i] !== x || w.y[i] !== y) continue;
    const o = w.owner[i]!;
    return o === OWNER_NEUTRAL || o === p;
  }
  return null;
}
