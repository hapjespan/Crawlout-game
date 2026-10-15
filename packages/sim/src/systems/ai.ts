import { MAX_ENTITIES, MAX_ENTITIES_PER_COMMAND, OWNER_NEUTRAL } from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import type { SimAiScript, SimBuildingType } from '../config.js';
import { AI_SITE_FRONT, AI_SITE_HQ, MAX_ABILITIES } from '../config.js';
import { HERO_DEAD, hasTechs, heroOf, researchCost } from '../effects.js';
import {
  BSTATE_DONE,
  BSTATE_SITE,
  C,
  JOB_PRODUCE,
  NO_ENTITY,
  ORDER_ATTACK_MOVE,
  ORDER_CRAFT,
  ORDER_GATHER,
  ORDER_NONE,
} from '../ecs/world.js';
import { PROVIDES_HQ, PROVIDES_WORKSHOP } from '../fromData.js';
import { clampI, idiv, imod } from '../math/int.js';
import { TERRAIN_UNREACHABLE } from '../pathdist.js';
import type { Census } from './census.js';
import { isRobot, takeCensus } from './census.js';
import { applyCommand, canPlaceType } from './commands.js';
import type { SimContext } from './common.js';
import {
  NO_WINNER,
  cellCenterOf,
  distToRect2,
  isEnemy,
  nodeAllowed,
  playerInTurn,
} from './common.js';
import { pointsOf } from './claims.js';
import { heroIndex } from './hero.js';
import { letterRunning, trainCost, trainedOn } from './training.js';
import { DEPOT_MASK, ROLE_MILITIA } from './orders.js';

// Systeem 2 (AI-deel): de scripted tegenstander, voor elke speler met ai = true, voor de unit-orders; de volgorde van
// de spelers draait per tick door (fair-ronde, zie aiSystem). Geen cheats: de AI geeft gewone commando's via
// applyCommand (dezelfde validatie als spelers) en ziet alleen wat elke speler kan zien: eigen units en gebouwen, de
// map, de spawns, wie een claimpunt bezit, en vijandelijke units die bij zijn eigen gebouwen staan. Alle getallen
// komen uit het script (ai/*.json, balans speltest 14 oktober). Afstanden naar verre doelen (nodes, claimpunten,
// raids, het front) meet hij over land, als padafstand over het terrein (pathdist.ts, xl-int): op een map met een
// rivier is hemelsbreed misleidend.
// Per tick, in deze volgorde (wie eerst komt, krijgt de vrije bouwer en de scrap):
//  1. de held: oplappen, perk kiezen, ability (heroThink); zolang de held dood is en er een hoofdgebouw is, spaart hij
//     voor het oplappen (geen bouwvolgorde, onderzoek, claims of omscholing);
//  2a. werkplaats kwijt (de bouwvolgorde had er een, er staat er geen, ook niet in aanbouw): een vrije bouwer zet een
//     nieuwe bij het hoofdgebouw; tot die betaald is, spaart hij (zonder werkplaats kan hij niet omscholen);
//  2b. huisvesting: zijn er housingFreeBeds of minder vrije bedden en is de pop-cap niet op popCapMax, dan bouwt een
//     vrije bouwer het huisvestingsgebouw (hoogstens één bouwplaats tegelijk);
//  3. bouwvolgorde uit het script (atTick, plaats hq, claim of front); een gebouw dat nooit kan slaat hij over. Mist
//     de order een prereqTech (besluit 8), dan onderzoekt hij eerst de keten en wacht hij met de order. Wacht de
//     order op scrap, dan geeft hij deze tick niets anders uit (onderzoek, claims). Een plek ligt altijd aan de kant van
//     het anker (lokale padafstand), een turret op de weg naar de vijand;
//  3b. na de bouwvolgorde, boven richScrap: de eerste richBuild waarvan er nog te weinig staan (een verloren gebouw
//     komt zo terug);
//  4. onderzoek: de eerste tech uit `research` die er nog niet is, vanaf researchFromTicks; 4b robots uit de fabriek
//     (robots.sequence, cyclisch); 4c SPECIAL-training (training.sequence). Data 0.17.0 (reserve): elk van de drie geeft
//     alleen uit wat boven de reserve zit, en vanaf reserve.fromTicks, met minstens reserve.minArmy leger (militie plus,
//     met robots.countAsArmy, de pop van de robots) en zonder dreiging, spaart hij voor het eerste doel dat alleen op
//     scrap wacht (onderzoek, robots, training; vanaf robotsFirstFromTicks robots vóór onderzoek). Omscholen tot militie
//     gaat dan alleen van wat boven die reserve zit. Training alleen onder die voorwaarde (luxe). Een bouworder die op
//     de prereqTech van zijn gebouw wacht, spaart voor dat onderzoek. Huisvesting houdt robots.reservePop vrij;
//  5. claimen: vanaf claimFromTicks neemt een vrije bouwer een neutraal claimpunt: eerst die aan de eigen kant (over land
//     duidelijk dichter bij het eigen hoofdgebouw dan bij de spawn van de vijand), dan de rest, elk het dichtst bij huis
//     over land; een onbereikbaar punt nooit. Verder dan claimSafeRadius gaat de militie zonder taak als escorte mee;
//     een punt dat niet aan de eigen kant ligt (het midden) pas vanaf claimFarFromTicks plus 0..waveJitterTicks (sim.rng,
//     één keer per potje: PlayerState.aiClaimAt);
//  6. bouwers zonder werk helpen bij een eigen bouwplaats;
//  7. plunderaars zonder werk gaan naar een node met minder dan scavengersPerNode plunderaars: nodes die door een
//     eigen claimpunt exclusief zijn eerst, daarna de kortste rit (padafstand van de node tot het dichtstbijzijnde eigen
//     depot);
//  8a. geen bouwer meer (ook niet in opleiding) en wel een werkplaats: meteen een bewoner tot bouwer omscholen, ook als
//     hij spaart (een plunderaar, zonder plunderaars een militie). Zonder werkplaats én bouwer levert de groei een
//     bouwer (economy.ts, vangnet) en komt 2a aan de beurt;
//  8. rolverdeling (met een werkplaats, één omscholing per tick): eerst `builders` bouwers, dan militie tot het
//     aandeel (militiaPermille plus militiaPermillePerMin per minuut tot militiaPermilleMax, bij dreiging minstens
//     threatMilitiaPermille); plunderaars boven scavengersPerNode maal het aantal bruikbare nodes worden ook militie.
//     Hij schoolt alleen om als hij die omscholing plus de lopende kan betalen (een omscholing betaalt pas bij de
//     werkplaats). Militie wordt het eerste loadout uit armyTypeIds waarvoor de techs er zijn; boven richScrap schoolt hij
//     bestaande militie om naar dat loadout;
//  9. golven: de eerste op attackTimersTicks, daarna elke waveIntervalTicks plus 0..waveJitterTicks (sim.rng). Een golf
//     vertrekt met minstens waveMinArmy + k maal waveArmyGrowth militie (golf k), of na waveMaxWaitTicks wachten met
//     waveMinArmy. Vanaf pushFromTicks met minstens pushMinArmy militie is het een push op het vijandelijke hoofdgebouw.
//     Anders is het een raid, maar alleen als de vijand genoeg claimpunten voor dominantie houdt: op zijn claimpunt het
//     dichtst bij huis over land (dat breekt de dominantie en zijn exclusieve node); daarna keren ze terug naar het
//     verzamelpunt. Een raid neemt een bouwer mee (een vrije als die er is) die naast het punt een claimgebouw zet; tot
//     de AI dat kan betalen, wacht de raid en spaart hij (geen huisvesting, bouwvolgorde, onderzoek, claims of
//     omscholing). Zonder push of raid vervalt de golf en spaart hij zijn leger. Alle militie en de held gaan mee.
//     Zonder bruikbare scrap-node (allInWithoutNodes: geen inkomen meer) gaat elke golf, hoe klein ook, naar het
//     hoofdgebouw en de plunderaars gaan mee. Een raid is voorbij zodra zijn claimpunt geen vijand meer heeft: die
//     militie telt dan als zonder taak (stap 10).
// 10. verdedigen: staat er een vijandelijke unit binnen defendRadius van een eigen gebouw, dan gaat militie zonder
//     taak (en de held) erop af; anders verzamelen ze bij het verzamelpunt zodra ze verder dan rallyRadius weg zijn:
//     rallySite hq is een begaanbare plek voor het hoofdgebouw op de weg naar de vijand, claim en front het eigen
//     claimpunt het dichtst bij huis of bij de vijand (over land).

const ROLE_SCAVENGER = ROLES.indexOf('scavenger');
const ROLE_BUILDER = ROLES.indexOf('builder');

function chunks(ids: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < ids.length; k += MAX_ENTITIES_PER_COMMAND)
    out.push(ids.slice(k, k + MAX_ENTITIES_PER_COMMAND));
  return out;
}

/** Afgeleide kladruimte van de AI, elke beurt opnieuw gevuld (geen state). */
export class AiScratch {
  /** Plunderaars met een Gather-order per node-index. */
  readonly nodeLoad = new Int32Array(MAX_ENTITIES);
  /** Eigen gebouwen van de speler voor findThreat. */
  readonly own = new Int32Array(MAX_ENTITIES);
  /** Per node-index de padafstand tot het dichtstbijzijnde eigen depot (plunderaarsverdeling). */
  readonly nodeCost = new Int32Array(MAX_ENTITIES);
}

export function aiSystem(ctx: SimContext, census: Census, scratch: AiScratch): void {
  if (ctx.globals.winner !== NO_WINNER) return;
  let counted = false;
  // wie eerst denkt, krijgt bij een gelijke stand de plek of het punt: in de doordraaiende beurtvolgorde
  for (let k = 0; k < ctx.playerCount; k++) {
    const p = playerInTurn(ctx, k);
    const pl = ctx.players[p]!;
    if (!pl.ai || ctx.ps.defeated[p] !== 0) continue;
    const si = ctx.config.factions[pl.factionId]!.aiScript;
    if (si < 0) continue;
    if (!counted) {
      takeCensus(ctx, census);
      counted = true;
    }
    think(ctx, census, scratch, p, ctx.config.aiScripts[si]!);
  }
}

/**
 * Geometrie: de escorte van een claim loopt naar een punt zoveel eenheden naast het claimpunt (zie raidOver), aan de
 * kant van de eigen spawn vandaan. Dat is onder de 180-gradenspiegel gelijk: een vaste +1 werd bij het spiegelbeeld -1
 * en liet twee gespiegelde escortes een eenheid verschillend lopen (woning 3x3: spiegel brak in frame 3606).
 */
const ESCORT_OFFSET = 1;
/**
 * Geometrie: zover (Chebyshev, in cellen van het midden van het anker tot het midden van de footprint) zoekt de AI een
 * bouwplek. Echte-schaalronde (data 0.14.0): een woning is 13 x 19 m en het hoofdgebouw 21 x 21 m, dus negen woningen,
 * een werkplaats en een lab liggen tot ongeveer 50 m van het hoofdgebouw (was MAX_FREE_RING, 24 cellen).
 */
const AI_SITE_RING = 56;

/**
 * Geometrie: een claimpunt ligt aan de eigen kant als zijn afstand tot het eigen hoofdgebouw onder ongeveer 87 procent
 * (kwadraat 3/4) van die tot de spawn van de vijand ligt. Een punt in het midden van de map is zo van niemand, ook als
 * het een cel naast het symmetriepunt ligt.
 */
const OWN_SIDE_NUM = 3;
const OWN_SIDE_DEN = 4;

/** Geometrie: een gebouw met een wapen zoekt zijn plek vanaf zoveel cellen voorbij de rand van zijn anker, richting de vijand. */
const TURRET_FORWARD_CELLS = 3;

/** Geometrie: het verzamelpunt bij het hoofdgebouw ligt zoveel cellen voorbij zijn rand, op de weg naar de vijand. */
const RALLY_FORWARD_CELLS = 4;

/** Eigen claimpunt met de kleinste waarde in afstandsveld f (padafstand tot de bron van f), of -1. Tiebreak laagste index. */
function ownClaimNear(ctx: SimContext, p: number, f: Uint16Array): number {
  const w = ctx.world;
  let best = -1;
  let bestD = 0;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== p) continue;
    const d = ctx.terrainDist.at(f, w.x[pt]!, w.y[pt]!);
    if (best < 0 || d < bestD) {
      best = pt;
      bestD = d;
    }
  }
  return best;
}

/** Afstandsveld over het terrein vanaf de footprint van gebouw b. */
function fieldOf(ctx: SimContext, b: number): Uint16Array {
  const w = ctx.world;
  return ctx.terrainDist.field(w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!);
}

/** Afstanden die de AI deze beurt gebruikt: vanaf het eigen hoofdgebouw en vanaf de spawn van de vijand. */
interface Fields {
  readonly home: Uint16Array;
  readonly enemy: Uint16Array | null;
  /** Cel van de bron van enemy (de spawn van de vijand); alleen geldig als enemy er is. */
  readonly enemyCx: number;
  readonly enemyCy: number;
}

/**
 * Een stap van `steps` cellen vanaf (cx, cy) langs veld f naar zijn bron (tx, ty) (steeds de buur met de laagste
 * waarde, 8 richtingen, diagonaal alleen als beide rechte buren begaanbaar zijn; bij gelijke waarde de buur die
 * hemelsbreed het dichtst bij de bron ligt, zodat beide spelers op een puntsymmetrische map gespiegeld kiezen; dan de
 * buur rechts van de richting naar de bron; dan de vaste volgorde O, W, Z, N, ZO, ZW, NO, NW). Zo ligt "richting de
 * vijand" langs de weg erheen, niet over een rivier.
 */
function stepAlong(
  ctx: SimContext,
  f: Uint16Array,
  tx: number,
  ty: number,
  cx0: number,
  cy0: number,
  steps: number,
): { cx: number; cy: number } {
  const map = ctx.map;
  const W = map.w;
  const pass = map.passable;
  let cx = cx0;
  let cy = cy0;
  for (let n = 0; n < steps; n++) {
    const c = cy * W + cx;
    let best = c;
    let bestD = f[c]!;
    let bestE = 0;
    const pE = cx + 1 < W && pass[c + 1] === 1;
    const pW = cx > 0 && pass[c - 1] === 1;
    const pS = cy + 1 < map.h && pass[c + W] === 1;
    const pN = cy > 0 && pass[c - W] === 1;
    const cand = [
      pE ? c + 1 : -1,
      pW ? c - 1 : -1,
      pS ? c + W : -1,
      pN ? c - W : -1,
      pE && pS && pass[c + W + 1] === 1 ? c + W + 1 : -1,
      pW && pS && pass[c + W - 1] === 1 ? c + W - 1 : -1,
      pE && pN && pass[c - W + 1] === 1 ? c - W + 1 : -1,
      pW && pN && pass[c - W - 1] === 1 ? c - W - 1 : -1,
    ];
    let bestX = 0;
    for (const m of cand) {
      if (m < 0 || f[m]! > bestD || (f[m]! === bestD && best === c)) continue;
      const my = idiv(m, W);
      const mx = m - my * W;
      const e = (mx - tx) * (mx - tx) + (my - ty) * (my - ty);
      // dan rechts van de richting naar de bron (kruisproduct: gelijk onder de 180-gradenspiegel; de vaste volgorde
      // is dat niet)
      const x = (tx - cx) * (my - cy) - (ty - cy) * (mx - cx);
      if (f[m]! < bestD || e < bestE || (e === bestE && x > bestX)) {
        best = m;
        bestD = f[m]!;
        bestE = e;
        bestX = x;
      }
    }
    if (best === c) break;
    cy = idiv(best, W);
    cx = best - cy * W;
  }
  return { cx, cy };
}

/**
 * Het verzamelpunt voor het hoofdgebouw hq (cel), op de weg naar de vijand; null zonder vijand. Alleen terrein, geen
 * gebouwen: het ligt vast, ook als er later iets omheen wordt gebouwd. findSite houdt de cel vrij.
 */
function rallyCell(ctx: SimContext, hq: number, fields: Fields): { cx: number; cy: number } | null {
  if (fields.enemy === null) return null;
  const w = ctx.world;
  return stepAlong(
    ctx,
    fields.enemy,
    fields.enemyCx,
    fields.enemyCy,
    w.fx[hq]! + (w.fw[hq]! >> 1),
    w.fy[hq]! + (w.fh[hq]! >> 1),
    (w.fw[hq]! >> 1) + RALLY_FORWARD_CELLS,
  );
}

/**
 * Lokale padafstand (4-buren, actuele begaanbaarheid met gebouwen) vanaf de rechthoek [rx, rx+rw) x [ry, ry+rh) in
 * een venster van straal r cellen eromheen; -1 = niet bereikbaar binnen het venster. Voor de bouwplek: een plek aan de
 * overkant van een rivier ligt hemelsbreed dichtbij maar is ver lopen.
 */
function localDist(
  ctx: SimContext,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  r: number,
): { d: Int32Array; x0: number; y0: number; ww: number } {
  const map = ctx.map;
  const walk = ctx.terrain.walk;
  const x0 = rx - r < 0 ? 0 : rx - r;
  const y0 = ry - r < 0 ? 0 : ry - r;
  const x1 = rx + rw + r > map.w ? map.w : rx + rw + r;
  const y1 = ry + rh + r > map.h ? map.h : ry + rh + r;
  const ww = x1 - x0;
  const wh = y1 - y0;
  const d = new Int32Array(ww * wh).fill(-1);
  const q = new Int32Array(ww * wh);
  let qt = 0;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
      const l = (y - y0) * ww + (x - x0);
      d[l] = 0;
      q[qt++] = l;
    }
  }
  let qh = 0;
  while (qh < qt) {
    const l = q[qh++]!;
    const ly = idiv(l, ww);
    const lx = l - ly * ww;
    const c = (y0 + ly) * map.w + x0 + lx;
    const nd = d[l]! + 1;
    if (lx + 1 < ww && walk[c + 1] === 1 && d[l + 1] === -1) {
      d[l + 1] = nd;
      q[qt++] = l + 1;
    }
    if (lx > 0 && walk[c - 1] === 1 && d[l - 1] === -1) {
      d[l - 1] = nd;
      q[qt++] = l - 1;
    }
    if (ly + 1 < wh && walk[c + map.w] === 1 && d[l + ww] === -1) {
      d[l + ww] = nd;
      q[qt++] = l + ww;
    }
    if (ly > 0 && walk[c - map.w] === 1 && d[l - ww] === -1) {
      d[l - ww] = nd;
      q[qt++] = l - ww;
    }
  }
  return { d, x0, y0, ww };
}

/**
 * Somtabel ((w + 1) x (h + 1), integer) van de actuele begaanbaarheid (met gebouwen) over het venster
 * [x0, x0 + w) x [y0, y0 + h); cellen buiten de map tellen als 0. Afgeleid, geen state.
 */
function walkSums(ctx: SimContext, x0: number, y0: number, w: number, h: number): Int32Array {
  const map = ctx.map;
  const walk = ctx.terrain.walk;
  const W1 = w + 1;
  const sat = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    const my = y0 + y;
    let row = 0;
    for (let x = 0; x < w; x++) {
      const mx = x0 + x;
      if (mx >= 0 && my >= 0 && mx < map.w && my < map.h && walk[my * map.w + mx] === 1) row++;
      sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1]! + row;
    }
  }
  return sat;
}

/**
 * Vrije plek voor een gebouw: footprint plus een rand van één cel vrij, niet op nodes of claimpunten. Het anker is
 * het hoofdgebouw (AI_SITE_HQ), het eigen claimpunt het dichtst bij huis (AI_SITE_CLAIM) of het dichtst bij de vijand
 * (AI_SITE_FRONT), beide op padafstand; zonder eigen claimpunt het hoofdgebouw. Een gebouw met een wapen (turret) zoekt
 * vanaf een punt voor het anker, langs de weg naar de spawn van de vijand, zodat een aanval binnen zijn bereik komt.
 * Een plek moet vanaf het anker te belopen zijn zonder grote omweg (lokale padafstand hoogstens 2 maal de ring plus 2):
 * nooit aan de overkant van een rivier of bosrand.
 */
function findSite(
  ctx: SimContext,
  p: number,
  hq: number,
  bt: SimBuildingType,
  site: number,
  fields: Fields,
): { x: number; y: number } | null {
  const w = ctx.world;
  const map = ctx.map;
  let cx = w.fx[hq]! + (w.fw[hq]! >> 1);
  let cy = w.fy[hq]! + (w.fh[hq]! >> 1);
  let rx = w.fx[hq]!;
  let ry = w.fy[hq]!;
  let rw = w.fw[hq]!;
  let rh = w.fh[hq]!;
  let half = w.fw[hq]! >> 1;
  if (site !== AI_SITE_HQ) {
    const f = site === AI_SITE_FRONT && fields.enemy !== null ? fields.enemy : fields.home;
    const pt = ownClaimNear(ctx, p, f);
    if (pt >= 0) {
      cx = w.x[pt]! >> 8;
      cy = w.y[pt]! >> 8;
      rx = cx;
      ry = cy;
      rw = 1;
      rh = 1;
      half = 1;
    }
  }
  if (bt.damage > 0 && fields.enemy !== null) {
    const at = stepAlong(
      ctx,
      fields.enemy,
      fields.enemyCx,
      fields.enemyCy,
      cx,
      cy,
      half + TURRET_FORWARD_CELLS + (bt.footprintW >> 1),
    );
    cx = clampI(at.cx, 0, map.w - 1);
    cy = clampI(at.cy, 0, map.h - 1);
    rx = cx;
    ry = cy;
    rw = 1;
    rh = 1;
  }
  // Het verzamelpunt bij het hoofdgebouw blijft vrij: een groep die naar een punt in een gebouw loopt komt nooit aan en
  // blijft op AttackMove staan (een woning van 3x3 kwam er in een potje precies op te staan).
  const rally = rallyCell(ctx, hq, fields);
  const local = localDist(ctx, rx, ry, rw, rh, AI_SITE_RING + half + 2);
  // Op de eerste ring met een vrije plek: de plek het dichtst bij het midden van de map, dan het dichtst bij het anker,
  // dan rechts van de richting anker naar midden.
  // Op een puntsymmetrische map kiezen beide spelers zo elkaars spiegelbeeld (de scanvolgorde is dat niet). Gemeten
  // tussen de middens van de footprints in halve cellen: het midden van de map en van een footprint van even breedte
  // ligt op een celgrens, en een ring rond één cel zou voor de twee spelers andere footprints bevatten.
  const fw = bt.footprintW;
  const fh = bt.footprintH;
  const ax2 = 2 * rx + rw;
  const ay2 = 2 * ry + rh;
  // Kandidaten: elke footprint waarvan het midden binnen AI_SITE_RING cellen (Chebyshev) van het midden van het anker
  // ligt. Ring r2 is die afstand in halve cellen; de eerste ring met een vrije plek wint, daarbinnen m en a.
  const R2 = 2 * AI_SITE_RING;
  // Begaanbaarheid als somtabel over het zoekvenster (plus de rand van één cel): een footprint is vrij als zijn som
  // gelijk is aan zijn oppervlak. Buiten de map telt als onbegaanbaar, zoals in footprintFree.
  const sx0 = cx - AI_SITE_RING - fw - 1;
  const sy0 = cy - AI_SITE_RING - fh - 1;
  const sw = 2 * AI_SITE_RING + 2 * fw + 4;
  const sh = 2 * AI_SITE_RING + 2 * fh + 4;
  const sat = walkSums(ctx, sx0, sy0, sw, sh);
  const freeRect = (x: number, y: number, ww: number, hh: number): boolean => {
    const ax = x - sx0;
    const ay = y - sy0;
    if (ax < 0 || ay < 0 || ax + ww > sw || ay + hh > sh) return false;
    const W1 = sw + 1;
    const sum =
      sat[(ay + hh) * W1 + ax + ww]! -
      sat[ay * W1 + ax + ww]! -
      sat[(ay + hh) * W1 + ax]! +
      sat[ay * W1 + ax]!;
    return sum === ww * hh;
  };
  let found = -1;
  let bestR = 0;
  let bestM = 0;
  let bestA = 0;
  let bestX = 0;
  const idx = ctx.index;
  idx.refresh(w);
  for (let fy = cy - AI_SITE_RING - fh; fy <= cy + AI_SITE_RING; fy++) {
    for (let fx = cx - AI_SITE_RING - fw; fx <= cx + AI_SITE_RING; fx++) {
      const x2 = 2 * fx + fw;
      const y2 = 2 * fy + fh;
      const ex = x2 > ax2 ? x2 - ax2 : ax2 - x2;
      const ey = y2 > ay2 ? y2 - ay2 : ay2 - y2;
      const r2 = ex > ey ? ex : ey;
      if (r2 < 2 || r2 > R2) continue;
      const m = (x2 - map.w) * (x2 - map.w) + (y2 - map.h) * (y2 - map.h);
      const a = (x2 - ax2) * (x2 - ax2) + (y2 - ay2) * (y2 - ay2);
      // laatste tiebreak: rechts van de richting anker naar midden van de map (kruisproduct, gelijk onder de spiegel)
      const xr = (map.w - ax2) * (y2 - ay2) - (map.h - ay2) * (x2 - ax2);
      if (
        found >= 0 &&
        (r2 > bestR ||
          (r2 === bestR &&
            (m > bestM || (m === bestM && (a > bestA || (a === bestA && xr <= bestX))))))
      )
        continue;
      if (!freeRect(fx - 1, fy - 1, fw + 2, fh + 2)) continue;
      if (
        rally !== null &&
        rally.cx >= fx &&
        rally.cx < fx + fw &&
        rally.cy >= fy &&
        rally.cy < fy + fh
      )
        continue;
      // te belopen vanaf het anker zonder grote omweg (de dichtstbijzijnde cel van de footprint)
      let ld = -1;
      for (let y = fy; y < fy + fh; y++) {
        for (let x = fx; x < fx + fw; x++) {
          const lx = x - local.x0;
          const ly = y - local.y0;
          if (lx < 0 || ly < 0 || lx >= local.ww) continue;
          const v = local.d[ly * local.ww + lx];
          if (v !== undefined && v >= 0 && (ld < 0 || v < ld)) ld = v;
        }
      }
      if (ld < 0 || ld > r2 + 2) continue;
      let onFeature = false;
      for (let k = 0; k < idx.nodeCount && !onFeature; k++) {
        const j = idx.nodes[k]!;
        if (distToRect2(w.x[j]!, w.y[j]!, fx - 1, fy - 1, fw + 2, fh + 2) === 0) onFeature = true;
      }
      for (const j of ctx.claimPoints) {
        if (distToRect2(w.x[j]!, w.y[j]!, fx - 1, fy - 1, fw + 2, fh + 2) === 0) onFeature = true;
      }
      if (onFeature) continue;
      found = (fy + (fh >> 1)) * map.w + fx + (fw >> 1);
      bestR = r2;
      bestM = m;
      bestA = a;
      bestX = xr;
    }
  }
  if (found >= 0) return cellCenterOf(map, found);
  return null;
}

/**
 * Laat bouwer `builder` een neutraal claimpunt claimen. Eerst de punten aan de eigen kant (dichter bij het eigen
 * hoofdgebouw dan bij de spawn van de vijand), daarna de rest; binnen elke groep het dichtst bij het hoofdgebouw, alles op
 * padafstand (tiebreak laagste index). Een onbereikbaar punt slaat hij over. Een punt verder dan claimSafeRadius (te
 * lopen) krijgt de militie zonder taak als escorte mee; ligt het niet aan de eigen kant, dan pas vanaf claimFarFromTicks.
 */
function claimNext(
  ctx: SimContext,
  p: number,
  builder: number,
  script: SimAiScript,
  idleMilitia: number[],
  fields: Fields,
): boolean {
  const w = ctx.world;
  const bt = claimType(ctx, p);
  if (bt === undefined || !canPlaceType(ctx, p, bt.typeId) || ctx.ps.scrap[p]! < bt.scrapCost)
    return false;
  let best = -1;
  let bestD = 0;
  let bestOwn = false;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== OWNER_NEUTRAL) continue;
    const d = ctx.terrainDist.at(fields.home, w.x[pt]!, w.y[pt]!);
    if (d === TERRAIN_UNREACHABLE) continue;
    const own = isOwnSide(ctx, pt, fields);
    if (best < 0 || (own && !bestOwn) || (own === bestOwn && d < bestD)) {
      best = pt;
      bestD = d;
      bestOwn = own;
    }
  }
  if (best < 0) return false;
  const far = bestD > script.claimSafeRadius >> 8;
  const farAt = ctx.ps.aiClaimAt[p]!;
  if (far && !bestOwn && (farAt === 0 || ctx.frame < farAt - 1)) return false;
  if (
    !applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Claim',
      payload: { ids: [builder], pointId: w.idOf(best) },
    })
  )
    return false;
  if (far) {
    // de escorte loopt naar een punt net naast het claimpunt (ESCORT_OFFSET), zodat raidOver hem niet voor een
    // afgelopen raid houdt terwijl het punt nog neutraal is
    const x = w.x[best]! + (w.x[best]! >= ctx.map.spawns[p]!.x ? ESCORT_OFFSET : -ESCORT_OFFSET);
    for (const ids of chunks(idleMilitia))
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'AttackMove',
        payload: { ids, x, y: w.y[best]! },
      });
    idleMilitia.length = 0;
  }
  return true;
}

/**
 * Of claimpunt pt aan de eigen kant ligt: op padafstand duidelijk dichter bij het eigen hoofdgebouw dan bij de spawn van
 * de vijand (OWN_SIDE_NUM/DEN op de kwadraten). Zonder vijand ligt alles aan de eigen kant.
 */
function isOwnSide(ctx: SimContext, pt: number, fields: Fields): boolean {
  if (fields.enemy === null) return true;
  const w = ctx.world;
  const h = ctx.terrainDist.at(fields.home, w.x[pt]!, w.y[pt]!);
  const e = ctx.terrainDist.at(fields.enemy, w.x[pt]!, w.y[pt]!);
  return h * h * OWN_SIDE_DEN < e * e * OWN_SIDE_NUM;
}

/** Eerste tegenstander na p (cyclisch) die nog meedoet, of -1. */
function enemyOf(ctx: SimContext, p: number): number {
  for (let k = 1; k < ctx.playerCount; k++) {
    let q = p + k;
    if (q >= ctx.playerCount) q -= ctx.playerCount;
    if (ctx.ps.defeated[q] === 0) return q;
  }
  return -1;
}

/** Of node j binnen claimRadius ligt van een claimpunt van p (dan is hij exclusief van p). */
function exclusiveFor(ctx: SimContext, j: number, p: number): boolean {
  const w = ctx.world;
  const r = ctx.config.claimRadius;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== p) continue;
    const dx = w.x[j]! - w.x[pt]!;
    const dy = w.y[j]! - w.y[pt]!;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/** Het eerste unittype uit het script waarvoor speler p de techs heeft, of 0. */
function armyType(ctx: SimContext, p: number, script: SimAiScript): number {
  for (const t of script.armyTypeIds) {
    const u = ctx.unitType(t);
    if (
      u !== undefined &&
      u.factionId === ctx.players[p]!.factionId &&
      hasTechs(ctx, p, u.prereqTech)
    )
      return t;
  }
  return 0;
}

function think(
  ctx: SimContext,
  census: Census,
  scratch: AiScratch,
  p: number,
  script: SimAiScript,
): void {
  const w = ctx.world;
  const ps = ctx.ps;
  const tick = ctx.frame;
  const hq = census.hq[p]!;
  const factionId = ctx.players[p]!.factionId;
  const roleTypes = ctx.config.factions[factionId]!.roleTypeIds;
  const enemy = enemyOf(ctx, p);
  const enemySpawn = enemy < 0 ? null : ctx.map.spawns[enemy]!;
  // padafstanden over het terrein: vanaf het eigen hoofdgebouw en vanaf de spawn van de vijand
  const fields: Fields | null =
    hq < 0
      ? null
      : {
          home: fieldOf(ctx, hq),
          enemy: enemySpawn === null ? null : ctx.terrainDist.fieldAt(enemySpawn.x, enemySpawn.y),
          enemyCx: enemySpawn === null ? 0 : enemySpawn.x >> 8,
          enemyCy: enemySpawn === null ? 0 : enemySpawn.y >> 8,
        };

  // Vanaf claimFarFromTicks: wanneer hij punten neemt die niet aan zijn kant liggen, met jitter (sim.rng, één keer per
  // potje), zodat niet altijd dezelfde speler als eerste bij het midden is.
  if (ps.aiClaimAt[p] === 0 && tick >= script.claimFarFromTicks)
    ps.aiClaimAt[p] =
      tick + (script.waveJitterTicks > 0 ? ctx.rng.nextInt(script.waveJitterTicks + 1) : 0) + 1;

  // Telling van de eigen units, gebouwen en de vijanden bij eigen gebouwen.
  const builders: number[] = [];
  const idleBuilders: number[] = [];
  const idleScavs: number[] = [];
  const scavs: number[] = [];
  const militia: number[] = [];
  const idleMilitia: number[] = [];
  const depots: number[] = [];
  // robots (data 0.16.0): geen militie (niet in golfgroottes, niet omgeschoold), wel mee met golven en verdediging
  const robots: number[] = [];
  const idleRobots: number[] = [];
  // data 0.17.0 (robots.countAsArmy): de pop van de robots telt mee voor de legergrootte van golven, push en reserve
  let robotArmy = 0;
  let producing = 0;
  let units = 0;
  let militiaPlanned = 0;
  let buildersPlanned = 0;
  let workshop = false;
  let workshopSite = false;
  let site = -1;
  let housingSite = false;
  const load = scratch.nodeLoad;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1) continue;
    if (w.has(i, C.resource)) {
      load[i] = 0;
      continue;
    }
    if (w.owner[i] !== p) continue;
    if (w.has(i, C.building)) {
      const bt = ctx.buildingType(w.typeId[i]!);
      const isWorkshop = bt !== undefined && (bt.provides & PROVIDES_WORKSHOP) !== 0;
      if (w.bstate[i] === BSTATE_DONE) {
        if (isWorkshop) workshop = true;
        if (bt !== undefined && (bt.provides & DEPOT_MASK) !== 0) depots.push(i);
      }
      if (w.jobKind[i] === JOB_PRODUCE && w.job[i] !== 0) producing++;
      if (w.bstate[i] === BSTATE_SITE) {
        if (site < 0) site = i;
        if (w.typeId[i] === script.housingTypeId) housingSite = true;
        if (isWorkshop) workshopSite = true;
      }
      continue;
    }
    if (!w.has(i, C.unit | C.orders) || w.has(i, C.hero)) continue;
    const ord = w.orderType(i);
    const id = w.idOf(i);
    if (isRobot(ctx, i)) {
      robots.push(id);
      robotArmy += ctx.unitType(w.typeId[i]!)?.popCost ?? 0;
      // een robot die repareert (zonder order, met een doel) is niet vrij
      const repairing = ord === ORDER_NONE && w.target[i] !== NO_ENTITY && w.damage[i]! <= 0;
      if (!repairing && (ord === ORDER_NONE || (ord === ORDER_ATTACK_MOVE && raidOver(ctx, p, i))))
        idleRobots.push(id);
      continue;
    }
    units++;
    if (ord === ORDER_CRAFT) {
      const to = ctx.unitType(w.ordX[w.currentOrder(i)]!);
      if (to?.role === ROLE_MILITIA) militiaPlanned++;
      if (to?.role === ROLE_BUILDER) buildersPlanned++;
      continue;
    }
    const role = w.role[i]!;
    if (role === ROLE_BUILDER) {
      builders.push(id);
      if (ord === ORDER_NONE) idleBuilders.push(id);
    } else if (role === ROLE_MILITIA) {
      militia.push(id);
      if (ord === ORDER_NONE || (ord === ORDER_ATTACK_MOVE && raidOver(ctx, p, i)))
        idleMilitia.push(id);
    } else if (role === ROLE_SCAVENGER) {
      scavs.push(id);
      if (ord === ORDER_NONE) idleScavs.push(id);
    }
  }
  // plunderaars per node (na de telling: een node kan een hogere index hebben dan zijn plunderaar)
  for (const id of scavs) {
    const i = w.resolve(id);
    if (w.orderType(i) !== ORDER_GATHER) continue;
    const n = w.resolve(w.ordT[w.currentOrder(i)]!);
    if (n >= 0 && w.has(n, C.resource)) load[n] = load[n]! + 1;
  }

  const takeBuilder = (): number | undefined => idleBuilders.shift();
  // legergrootte voor golven, push en reserve: militie plus (met robots.countAsArmy) de pop van de robots
  const robotWeight = script.robots !== null && script.robots.countAsArmy ? robotArmy : 0;

  // 1 de held: oplappen, perk kiezen, ability. Een gesneuvelde held gaat voor: tot hij opgelapt wordt, spaart de AI
  // (geen bouwvolgorde, onderzoek, claims of omscholing die de scrap opmaken).
  heroThink(ctx, p, hq);
  const hero = heroIndex(ctx, p);
  const heroId = hero < 0 ? -1 : w.idOf(hero);
  let nodes = 0;
  const idx = ctx.index;
  idx.refresh(w);
  for (let k = 0; k < idx.nodeCount; k++) {
    const j = idx.nodes[k]!;
    if (w.amount[j]! > 0 && nodeAllowed(ctx, j, p)) nodes++;
  }
  const h = heroOf(ctx, p);
  // zonder nodes komt er geen scrap meer bij: dan wachten op het oplappen heeft geen zin
  const heroWaits =
    hq >= 0 &&
    h !== undefined &&
    ps.heroState[p] === HERO_DEAD &&
    (nodes > 0 || ps.scrap[p]! >= h.reviveScrap);

  // 9a is er een golf klaar? Vooraf bepaald: een raid neemt een bouwer mee die een claimgebouw zet, en tot de AI dat
  // kan betalen, wacht de raid en spaart hij (geen huisvesting, bouwvolgorde, onderzoek, claims of omscholing).
  const wave =
    enemy >= 0 && enemySpawn !== null
      ? waveReady(ctx, p, script, enemy, militia.length + robotWeight, nodes, hq)
      : null;
  const claimBt = claimType(ctx, p);
  const raidWaits =
    wave !== null &&
    wave.raidPt >= 0 &&
    builders.length > 0 &&
    claimBt !== undefined &&
    ps.scrap[p]! < claimBt.scrapCost;
  const holdScrap = heroWaits || raidWaits;
  let saving = holdScrap;
  // waar hij voor spaart (bouwvolgorde of een nieuwe werkplaats): omscholen tot militie gaat alleen van wat erboven zit
  let reserve = 0;

  // 10a dreiging: de vijandelijke unit bij een eigen gebouw het dichtst bij het hoofdgebouw (data 0.17.0: vooraf, want
  // onder dreiging spaart hij niet voor onderzoek of training)
  const threat = hq >= 0 ? findThreat(ctx, scratch, p, hq, script.defendRadius) : -1;
  // Data 0.17.0 (reserve): vanaf reserve.fromTicks spaart hij voor zijn volgende onderzoek, robot of trainingsrun als
  // alleen de scrap ontbreekt, zolang zijn leger minstens reserve.minArmy is en er geen dreiging is.
  const reserveOn =
    script.reserve !== null &&
    tick >= script.reserve.fromTicks &&
    militia.length + robotWeight >= script.reserve.minArmy &&
    threat < 0;

  // 2a werkplaats kwijt (gesloopt): eerst een nieuwe, vóór alles behalve de held. Zonder werkplaats kan hij niet
  // omscholen (geen bouwers, geen leger). Alleen als de bouwvolgorde er al een had; tot hij betaald is, spaart hij.
  const order = script.buildOrder;
  let bi = ps.aiBuild[p]!;
  if (!saving && fields !== null && !workshop && !workshopSite) {
    let wsType: SimBuildingType | undefined;
    for (let k = 0; k < bi && k < order.length && wsType === undefined; k++) {
      const bt = ctx.buildingType(order[k]!.typeId);
      if (bt !== undefined && (bt.provides & PROVIDES_WORKSHOP) !== 0) wsType = bt;
    }
    if (wsType !== undefined && canPlaceType(ctx, p, wsType.typeId)) {
      if (ps.scrap[p]! < wsType.scrapCost) {
        saving = true;
        reserve = wsType.scrapCost;
      } else if (idleBuilders.length > 0) {
        const at = findSite(ctx, p, hq, wsType, AI_SITE_HQ, fields);
        if (
          at !== null &&
          applyCommand(ctx, {
            playerId: p,
            seq: 0,
            type: 'Build',
            payload: { ids: [idleBuilders[0]!], typeId: wsType.typeId, x: at.x, y: at.y },
          })
        )
          takeBuilder();
      } else if (builders.length > 0) saving = true; // de bouwer is bezig: wachten tot hij vrij is
    }
  }

  // 2b huisvesting zodra de pop-cap in zicht komt (zolang de bedden onder de ruimte voor bewoners blijven: popCapMax min
  // de pop van de robots, data 0.16.0)
  const popCap = census.popCap(ctx, p);
  // de pop voor robots: wat ze nu innemen (ook in productie), en data 0.17.0 minstens robots.reservePop
  let robotRoom = census.robotPop[p]! + census.reservedPop[p]!;
  if (script.robots !== null && robotRoom < script.robots.reservePop)
    robotRoom = script.robots.reservePop;
  const hbt = script.housingTypeId === 0 ? undefined : ctx.buildingType(script.housingTypeId);
  if (
    !saving &&
    fields !== null &&
    hbt !== undefined &&
    !housingSite &&
    census.beds[p]! < ctx.config.popCapMax - robotRoom &&
    popCap - census.pop[p]! <= script.housingFreeBeds
  ) {
    if (
      canPlaceType(ctx, p, hbt.typeId) &&
      ps.scrap[p]! >= hbt.scrapCost &&
      idleBuilders.length > 0
    ) {
      const at = findSite(ctx, p, hq, hbt, AI_SITE_HQ, fields);
      if (
        at !== null &&
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'Build',
          payload: { ids: [idleBuilders[0]!], typeId: hbt.typeId, x: at.x, y: at.y },
        })
      )
        takeBuilder();
    }
  }

  // 3 bouwvolgorde
  while (!saving && fields !== null && bi < order.length && tick >= order[bi]!.atTick) {
    const typeId = order[bi]!.typeId;
    const bt = ctx.buildingType(typeId);
    if (bt === undefined || bt.factionId !== factionId || (bt.provides & PROVIDES_HQ) !== 0) {
      bi++;
      continue;
    }
    if (!hasTechs(ctx, p, bt.prereqTech)) {
      const r = researchFor(ctx, p, bt.prereqTech);
      if (r.techId === RESEARCH_IMPOSSIBLE) {
        bi++;
        continue;
      }
      if (r.techId >= 0)
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'Research',
          payload: { techId: r.techId },
        });
      else {
        saving = true;
        // data 0.17.0: wacht de keten alleen op scrap, dan spaart hij ervoor (omscholen alleen van wat erboven zit)
        reserve = r.cost;
      }
      break;
    }
    if (ps.scrap[p]! < bt.scrapCost) {
      saving = true;
      reserve = bt.scrapCost;
      break;
    }
    // alleen een bouwer zonder werk: een bouwer van een vorige order weghalen laat die bouwplaats half staan
    const builder = idleBuilders[0];
    if (builder === undefined) break;
    const at = findSite(ctx, p, hq, bt, order[bi]!.site ?? AI_SITE_HQ, fields);
    if (at === null) {
      bi++;
      continue;
    }
    if (
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'Build',
        payload: { ids: [builder], typeId, x: at.x, y: at.y },
      })
    ) {
      bi++;
      takeBuilder();
    }
    break;
  }
  ps.aiBuild[p] = bi;

  // 3b extra gebouwen bij genoeg scrap
  if (
    !saving &&
    fields !== null &&
    bi >= order.length &&
    site < 0 &&
    ps.scrap[p]! >= script.richScrap &&
    idleBuilders.length > 0
  ) {
    const rb = richBuild(ctx, p, script);
    if (rb >= 0) {
      const o = script.richBuilds[rb]!;
      const bt = ctx.buildingType(o.typeId)!;
      const at = findSite(ctx, p, hq, bt, o.site, fields);
      if (
        at !== null &&
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'Build',
          payload: { ids: [idleBuilders[0]!], typeId: o.typeId, x: at.x, y: at.y },
        })
      )
        takeBuilder();
    }
  }

  // 4 onderzoek, 4b robots en 4c training (data 0.17.0): elk geeft alleen uit wat boven de reserve zit; met reserveOn
  // spaart hij voor het eerste doel in de volgorde dat alleen op scrap wacht. Volgorde: onderzoek, robots, training;
  // vanaf reserve.robotsFirstFromTicks robots vóór onderzoek.
  const researchStep = (): number => {
    if (tick < script.researchFromTicks) return 0;
    for (const techId of script.research) {
      if (hasTechs(ctx, p, [techId])) continue;
      const r = researchFor(ctx, p, [techId], reserve);
      if (r.techId === RESEARCH_IMPOSSIBLE) continue;
      if (r.techId >= 0)
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'Research',
          payload: { techId: r.techId },
        });
      return r.cost;
    }
    return 0;
  };
  // robots (data 0.16.0): vanaf fromTicks in de fabriek, cyclisch uit de volgorde, tot max levende robots
  const robotStep = (): number =>
    script.robots !== null && tick >= script.robots.fromTicks
      ? produceRobot(ctx, p, script.robots, robots.length + producing, reserve)
      : 0;
  // training is luxe: alleen met een leger van minstens reserve.minArmy en zonder dreiging (reserveOn)
  const trainingStep = (): number =>
    script.training !== null && tick >= script.training.fromTicks && reserveOn
      ? trainNext(ctx, p, script.training.programIds, reserve)
      : 0;
  if (!saving) {
    const robotsFirst = script.reserve !== null && tick >= script.reserve.robotsFirstFromTicks;
    for (const step of robotsFirst
      ? [robotStep, researchStep, trainingStep]
      : [researchStep, robotStep, trainingStep]) {
      const cost = step();
      if (reserveOn && reserve === 0) reserve = cost;
    }
  }

  // 5 claimen
  if (!saving && fields !== null && tick >= script.claimFromTicks && idleBuilders.length > 0) {
    if (claimNext(ctx, p, idleBuilders[0]!, script, idleMilitia, fields)) takeBuilder();
  }

  // 6 bouwers zonder werk helpen bij een bouwplaats
  if (site >= 0 && idleBuilders.length > 0) {
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Build',
      payload: { ids: idleBuilders, typeId: w.typeId[site]!, x: w.x[site]!, y: w.y[site]! },
    });
  }

  // 7 plunderaars zonder werk naar een node met plek: exclusieve nodes eerst, dan de kortste rit (padafstand van de
  // node tot het dichtstbijzijnde eigen depot: hoofdgebouw of werkplaats)
  if (idleScavs.length > 0) {
    const cost = scratch.nodeCost;
    for (let k = 0; k < idx.nodeCount; k++) {
      const j = idx.nodes[k]!;
      let c = TERRAIN_UNREACHABLE;
      for (const dep of depots) {
        const d = ctx.terrainDist.at(fieldOf(ctx, dep), w.x[j]!, w.y[j]!);
        if (d < c) c = d;
      }
      cost[j] = c;
    }
    for (const id of idleScavs) {
      let best = -1;
      let bestEx = false;
      let bestD = 0;
      let any = -1;
      let anyD = 0;
      for (let k = 0; k < idx.nodeCount; k++) {
        const j = idx.nodes[k]!;
        if (w.amount[j]! <= 0 || cost[j] === TERRAIN_UNREACHABLE || !nodeAllowed(ctx, j, p))
          continue;
        const d = cost[j]!;
        if (any < 0 || d < anyD) {
          any = j;
          anyD = d;
        }
        if (load[j]! >= script.scavengersPerNode) continue;
        const ex = exclusiveFor(ctx, j, p);
        if (best < 0 || (ex && !bestEx) || (ex === bestEx && d < bestD)) {
          best = j;
          bestEx = ex;
          bestD = d;
        }
      }
      // alle nodes vol: de dichtstbijzijnde (op padafstand) met voorraad
      if (best < 0) best = any;
      if (best < 0) break;
      load[best] = load[best]! + 1;
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'Gather',
        payload: { ids: [id], nodeId: w.idOf(best) },
      });
    }
  }

  // 8a geen enkele bouwer (ook niet in opleiding) en wel een werkplaats: meteen een bewoner omscholen tot bouwer, ook
  // als hij spaart (bouwen is de uitweg); een plunderaar, en zonder plunderaars een militie
  if (workshop && builders.length + buildersPlanned === 0 && script.builders > 0) {
    const pick =
      idleScavs.length > 0
        ? idleScavs[idleScavs.length - 1]
        : scavs.length > 0
          ? scavs[scavs.length - 1]
          : militia.length > 0
            ? militia[militia.length - 1]
            : undefined;
    if (pick !== undefined)
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'SetRole',
        payload: { ids: [pick], role: 'builder' },
      });
  }

  // 8 rolverdeling
  else if (workshop && scavs.length > 0 && !holdScrap) {
    const minutes = idiv(tick, ctx.config.ticksPerMinute);
    let share = script.militiaPermille + minutes * script.militiaPermillePerMin;
    if (share > script.militiaPermilleMax) share = script.militiaPermilleMax;
    if (threat >= 0 && share < script.threatMilitiaPermille) share = script.threatMilitiaPermille;
    const excess = scavs.length - nodes * script.scavengersPerNode;
    const pick = idleScavs.length > 0 ? idleScavs[idleScavs.length - 1]! : scavs[scavs.length - 1]!;
    const army = armyType(ctx, p, script);
    if (builders.length + buildersPlanned < script.builders) {
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'SetRole',
        payload: { ids: [pick], role: 'builder' },
      });
    } else if (
      army !== 0 &&
      affordable(ctx, p, army, militiaPlanned, reserve) &&
      (militia.length + militiaPlanned < idiv(units * share, 1000) || excess > 0)
    ) {
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'Craft',
        payload: { ids: [pick], loadoutId: ctx.unitType(army)!.loadoutId },
      });
    } else if (army !== 0 && ps.scrap[p]! >= script.richScrap && army !== roleTypes[ROLE_MILITIA]) {
      upgradeOne(ctx, militia, army);
    }
  }

  // 9 golven (de held loopt mee)
  if (wave !== null && !raidWaits) {
    const k = ps.aiAttack[p]!;
    let target: { x: number; y: number } | null = null;
    if (wave.push) target = enemySpawn;
    else if (wave.raidPt >= 0) target = { x: w.x[wave.raidPt]!, y: w.y[wave.raidPt]! };
    const jitter = script.waveJitterTicks > 0 ? ctx.rng.nextInt(script.waveJitterTicks + 1) : 0;
    if (target === null) {
      // geen push en geen dominantie te breken: deze golf overslaan, het leger blijft bij het verzamelpunt (ook dan
      // met jitter, zodat de volgende golf niet voorspelbaar is)
      ps.aiAttack[p] = k + 1;
      ps.aiWaveAt[p] = tick + script.waveIntervalTicks + jitter;
      return;
    }
    const send = wave.allIn ? [...militia, ...scavs, ...robots] : [...militia, ...robots];
    if (heroId >= 0) send.push(heroId);
    // een raid neemt een bouwer mee (een vrije als die er is) die naast het punt een claimgebouw zet: valt het
    // claimgebouw van de vijand, dan is het punt van hem in plaats van neutraal
    if (wave.raidPt >= 0 && builders.length > 0)
      claimAt(ctx, p, idleBuilders[0] ?? builders[0]!, wave.raidPt);
    for (const ids of chunks(send))
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'AttackMove',
        payload: { ids, x: target.x, y: target.y },
      });
    ps.aiAttack[p] = k + 1;
    ps.aiWaveAt[p] = tick + script.waveIntervalTicks + jitter;
    return;
  }

  // 10b verdedigen of verzamelen: militie (en de held) zonder taak
  const idle = [...idleMilitia, ...idleRobots];
  if (heroId >= 0 && w.orderType(hero) === ORDER_NONE) idle.push(heroId);
  if (idle.length === 0 || fields === null) return;
  let to: { x: number; y: number };
  let r = script.rallyRadius;
  if (threat >= 0) {
    to = { x: w.x[threat]!, y: w.y[threat]! };
    r = 0;
  } else {
    const f =
      script.rallySite === AI_SITE_FRONT && fields.enemy !== null ? fields.enemy : fields.home;
    const pt = script.rallySite === AI_SITE_HQ ? -1 : ownClaimNear(ctx, p, f);
    if (pt >= 0) to = { x: w.x[pt]!, y: w.y[pt]! };
    else if (fields.enemy !== null) {
      // voor het hoofdgebouw, op de weg naar de vijand: het midden van het gebouw zelf is niet te bereiken, dus een
      // groep die daarheen loopt komt nooit aan (en is dan nooit vrij voor verdediging of escorte)
      const c = rallyCell(ctx, hq, fields)!;
      to = { x: (c.cx << 8) + 128, y: (c.cy << 8) + 128 };
    } else to = { x: w.x[hq]!, y: w.y[hq]! };
  }
  const go: number[] = [];
  for (const id of idle) {
    const i = w.resolve(id);
    const dx = w.x[i]! - to.x;
    const dy = w.y[i]! - to.y;
    if (dx * dx + dy * dy > r * r) go.push(id);
  }
  for (const ids of chunks(go))
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'AttackMove',
      payload: { ids, x: to.x, y: to.y },
    });
}

/**
 * Robotproductie van de AI (data 0.16.0, ai/*.json robots): zolang er minder dan max robots zijn (levend plus in
 * productie), bestelt hij in een vrije eigen fabriek het volgende type uit de volgorde (cyclisch, PlayerState.aiRobot);
 * een type zonder de techs slaat hij over, een type dat hij nog niet kan betalen of dat niet in popCapMax past laat hij
 * wachten. Data 0.17.0: alleen van wat boven `reserve` zit; geeft de prijs als hij met een vrije fabriek alleen op scrap
 * wacht (om voor te sparen), anders 0.
 */
function produceRobot(
  ctx: SimContext,
  p: number,
  rs: NonNullable<SimAiScript['robots']>,
  have: number,
  reserve: number,
): number {
  if (have >= rs.max) return 0;
  const w = ctx.world;
  const n = rs.typeIds.length;
  for (let k = 0; k < n; k++) {
    const at = imod(ctx.ps.aiRobot[p]! + k, n);
    const t = ctx.unitType(rs.typeIds[at]!);
    if (t === undefined || t.producedAtTypeId === 0 || !hasTechs(ctx, p, t.prereqTech)) continue;
    let b = -1;
    for (let i = 0; i < w.highWater && b < 0; i++) {
      if (
        w.has(i, C.building) &&
        w.owner[i] === p &&
        w.typeId[i] === t.producedAtTypeId &&
        w.bstate[i] === BSTATE_DONE &&
        w.job[i] === 0 &&
        w.research[i] === 0
      )
        b = i;
    }
    if (b < 0) return 0;
    if (ctx.ps.scrap[p]! < t.scrapCost + reserve) return t.scrapCost;
    if (
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'Produce',
        payload: { buildingId: w.idOf(b), loadoutId: t.loadoutId },
      })
    )
      ctx.ps.aiRobot[p] = at + 1 < n ? at + 1 : 0;
    return 0;
  }
  return 0;
}

/**
 * SPECIAL-training van de AI (data 0.17.0, ai/*.json training): de eerste entry k uit de volgorde die nog niet af is
 * (speler p heeft op die letter minder punten dan het programma in entries 0..k voorkomt, en minder dan maxPoints), niet
 * al loopt en waarvoor de techs er zijn, in een vrije eigen voltooide trainingsplek. Kan hij hem betalen naast de
 * reserve, dan start hij hem (0); ontbreekt alleen de scrap, dan de prijs (om voor te sparen); anders 0.
 */
function trainNext(
  ctx: SimContext,
  p: number,
  programIds: readonly number[],
  reserve: number,
): number {
  const w = ctx.world;
  for (let k = 0; k < programIds.length; k++) {
    const tr = ctx.config.training[programIds[k]!];
    if (tr === undefined || tr.factionId !== ctx.players[p]!.factionId) continue;
    let want = 0;
    for (let q = 0; q <= k; q++) if (programIds[q] === tr.programId) want++;
    const have = trainedOn(ctx, p, tr);
    if (have >= want || have >= tr.maxPoints || !hasTechs(ctx, p, tr.prereqTech)) continue;
    if (letterRunning(ctx, p, tr.special)) continue;
    let b = -1;
    for (let i = 0; i < w.highWater && b < 0; i++) {
      if (
        w.has(i, C.building) &&
        w.owner[i] === p &&
        w.typeId[i] === tr.buildingTypeId &&
        w.bstate[i] === BSTATE_DONE &&
        w.hp[i]! > 0 &&
        w.job[i] === 0 &&
        w.research[i] === 0
      )
        b = i;
    }
    if (b < 0) return 0;
    const cost = trainCost(ctx, p, tr);
    if (ctx.ps.scrap[p]! < cost + reserve) return cost;
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Train',
      payload: { buildingId: w.idOf(b), programId: tr.programId },
    });
    return 0;
  }
  return 0;
}

/**
 * Index van de eerste richBuild die nu kan en waarvan er te weinig staan: entry k is af zolang speler p minstens zoveel
 * gebouwen (af of in aanbouw) van dat type heeft als er entries 0..k van dat type zijn. -1 als alles staat of niets kan.
 */
function richBuild(ctx: SimContext, p: number, script: SimAiScript): number {
  const w = ctx.world;
  for (let k = 0; k < script.richBuilds.length; k++) {
    const t = script.richBuilds[k]!.typeId;
    let want = 0;
    for (let q = 0; q <= k; q++) if (script.richBuilds[q]!.typeId === t) want++;
    let have = 0;
    for (let i = 0; i < w.highWater; i++)
      if (w.alive[i] === 1 && w.owner[i] === p && w.has(i, C.building) && w.typeId[i] === t) have++;
    if (have >= want) continue;
    const bt = ctx.buildingType(t);
    if (bt === undefined || !canPlaceType(ctx, p, t) || ctx.ps.scrap[p]! < bt.scrapCost) return -1;
    return k;
  }
  return -1;
}

/**
 * Of militie i op een afgelopen raid is: zijn AttackMove gaat naar een claimpunt dat geen vijand meer heeft (het is
 * neutraal of van hemzelf). Dan telt hij als zonder taak en keert hij terug naar het verzamelpunt, in plaats van achter
 * gebouwen aan de vijandelijke basis in te lopen.
 */
function raidOver(ctx: SimContext, p: number, i: number): boolean {
  const w = ctx.world;
  const o = w.currentOrder(i);
  const x = w.ordX[o]!;
  const y = w.ordY[o]!;
  for (const pt of ctx.claimPoints) {
    if (w.x[pt] !== x || w.y[pt] !== y) continue;
    const owner = w.owner[pt]!;
    return owner === OWNER_NEUTRAL || owner === p;
  }
  return false;
}

/**
 * Of speler p nog een omscholing naar `typeId` kan betalen naast de `planned` die al onderweg zijn (die betalen pas bij
 * de werkplaats) en de `reserve` waarvoor hij spaart.
 */
function affordable(
  ctx: SimContext,
  p: number,
  typeId: number,
  planned: number,
  reserve: number,
): boolean {
  const t = ctx.unitType(typeId);
  return t !== undefined && ctx.ps.scrap[p]! >= t.scrapCost * (planned + 1) + reserve;
}

/** Eén militie-unit van een ander type dan `best` omscholen naar `best` (de laagste id). */
function upgradeOne(ctx: SimContext, militia: readonly number[], best: number): void {
  const w = ctx.world;
  for (const id of militia) {
    const i = w.resolve(id);
    if (w.typeId[i] === best) continue;
    applyCommand(ctx, {
      playerId: w.owner[i]!,
      seq: 0,
      type: 'Craft',
      payload: { ids: [id], loadoutId: ctx.unitType(best)!.loadoutId },
    });
    return;
  }
}

/**
 * Index van de vijandelijke unit binnen r van een eigen gebouw van p, het dichtst bij het hoofdgebouw; -1 als er geen is.
 * Eerst de eigen gebouwen en hun omhullende (plus r), dan per vijandelijke unit alleen binnen die omhullende de
 * gebouwen: zelfde uitkomst als alle paren, maar op een grote map met verre vijanden bijna gratis.
 */
function findThreat(ctx: SimContext, scratch: AiScratch, p: number, hq: number, r: number): number {
  const w = ctx.world;
  const r2 = r * r;
  const idx = ctx.index;
  idx.refresh(w);
  const own = scratch.own;
  let n = 0;
  let bx0 = 0;
  let by0 = 0;
  let bx1 = 0;
  let by1 = 0;
  for (let k = 0; k < idx.buildingCount; k++) {
    const b = idx.buildings[k]!;
    if (w.owner[b] !== p) continue;
    own[n++] = b;
    const x0 = (w.fx[b]! << 8) - r;
    const y0 = (w.fy[b]! << 8) - r;
    const x1 = ((w.fx[b]! + w.fw[b]!) << 8) + r;
    const y1 = ((w.fy[b]! + w.fh[b]!) << 8) + r;
    if (n === 1 || x0 < bx0) bx0 = x0;
    if (n === 1 || y0 < by0) by0 = y0;
    if (n === 1 || x1 > bx1) bx1 = x1;
    if (n === 1 || y1 > by1) by1 = y1;
  }
  if (n === 0) return -1;
  let best = -1;
  let bestD = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (!w.has(j, C.unit | C.health) || w.hp[j]! <= 0) continue;
    const o = w.owner[j]!;
    if (o === p || o >= ctx.playerCount) continue;
    const x = w.x[j]!;
    const y = w.y[j]!;
    if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
    let near = false;
    for (let k = 0; k < n && !near; k++) {
      const b = own[k]!;
      if (distToRect2(x, y, w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!) <= r2) near = true;
    }
    if (!near) continue;
    const d = distToRect2(x, y, w.fx[hq]!, w.fy[hq]!, w.fw[hq]!, w.fh[hq]!);
    if (best < 0 || d < bestD) {
      best = j;
      bestD = d;
    }
  }
  return best;
}

interface Wave {
  /** Op het vijandelijke hoofdgebouw (vanaf pushFromTicks met pushMinArmy, of all-in zonder nodes). */
  readonly push: boolean;
  /** Zonder bruikbare node: alles gaat mee, ook de plunderaars. */
  readonly allIn: boolean;
  /** Raid: het claimpunt van de vijand (alleen als hij genoeg punten voor dominantie houdt), anders -1. */
  readonly raidPt: number;
}

/**
 * De golf die nu kan vertrekken, of null. De eerste op attackTimersTicks, daarna op aiWaveAt; met minstens waveMinArmy
 * + k maal waveArmyGrowth militie (golf k), of na waveMaxWaitTicks wachten met waveMinArmy; all-in zonder nodes.
 */
function waveReady(
  ctx: SimContext,
  p: number,
  script: SimAiScript,
  enemy: number,
  militia: number,
  nodes: number,
  hq: number,
): Wave | null {
  const k = ctx.ps.aiAttack[p]!;
  const timers = script.attackTimersTicks;
  const due = k < timers.length ? timers[k]! : ctx.ps.aiWaveAt[p]!;
  const allIn = script.allInWithoutNodes && nodes === 0;
  const tick = ctx.frame;
  if (tick < due) return null;
  const need = allIn ? 1 : script.waveMinArmy + k * script.waveArmyGrowth;
  const waited = tick >= due + script.waveMaxWaitTicks && militia >= script.waveMinArmy;
  if (!((militia > 0 || allIn) && (militia >= need || waited || allIn))) return null;
  const push = allIn || (tick >= script.pushFromTicks && militia >= script.pushMinArmy);
  // een raid alleen tegen dominantie: houdt de vijand genoeg punten, dan een van zijn claimpunten (enemyClaimFor)
  const raid = !push && pointsOf(ctx, enemy) >= ctx.map.dominance.pointsRequired;
  return {
    push,
    allIn,
    raidPt: raid ? enemyClaimFor(ctx, hq >= 0 ? fieldOf(ctx, hq) : null, enemy, k) : -1,
  };
}

/**
 * Het doel van raid k: de claimpunten van de vijand op volgorde van padafstand tot het eigen hoofdgebouw (tiebreak
 * laagste index), en daarvan nummer k modulo hun aantal; -1 zonder punten. Zo valt niet elke raid hetzelfde punt aan
 * (meestal het midden, waar de vijand zijn leger heeft staan) maar ook zijn settlements: één punt breken is genoeg om
 * zijn dominantie te stoppen.
 */
function enemyClaimFor(
  ctx: SimContext,
  home: Uint16Array | null,
  enemy: number,
  k: number,
): number {
  const w = ctx.world;
  const pts: number[] = [];
  const ds: number[] = [];
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== enemy) continue;
    const d = home === null ? 0 : ctx.terrainDist.at(home, w.x[pt]!, w.y[pt]!);
    let j = pts.length;
    pts.push(pt);
    ds.push(d);
    while (j > 0 && (ds[j - 1]! > d || (ds[j - 1] === d && pts[j - 1]! > pt))) {
      pts[j] = pts[j - 1]!;
      ds[j] = ds[j - 1]!;
      j--;
    }
    pts[j] = pt;
    ds[j] = d;
  }
  return pts.length === 0 ? -1 : pts[imod(k, pts.length)]!;
}

/** Het claimgebouw van de factie van speler p, of undefined. */
function claimType(ctx: SimContext, p: number): SimBuildingType | undefined {
  const typeId = ctx.config.factions[ctx.players[p]!.factionId]!.claimTypeId;
  return typeId === 0 ? undefined : ctx.buildingType(typeId);
}

/** Bouwer `builder` zet een claimgebouw bij punt pt (Claim), als speler p het kan betalen. */
function claimAt(ctx: SimContext, p: number, builder: number, pt: number): boolean {
  const bt = claimType(ctx, p);
  if (bt === undefined || !canPlaceType(ctx, p, bt.typeId) || ctx.ps.scrap[p]! < bt.scrapCost)
    return false;
  return applyCommand(ctx, {
    playerId: p,
    seq: 0,
    type: 'Claim',
    payload: { ids: [builder], pointId: ctx.world.idOf(pt) },
  });
}

/** researchFor: er loopt al onderzoek in de keten, of het gebouw is bezet of nog niet af, of de scrap ontbreekt. */
const RESEARCH_WAIT = -1;
/** researchFor: de keten kan niet (andere factie, of geen eigen gebouw van het type, af of in aanbouw). */
const RESEARCH_IMPOSSIBLE = -2;

/** Uitkomst van researchFor. */
interface ResearchStep {
  /** De tech om nu te onderzoeken, of RESEARCH_WAIT of RESEARCH_IMPOSSIBLE. */
  readonly techId: number;
  /** Bij RESEARCH_WAIT omdat alleen de scrap ontbreekt (vrij gebouw, keten klaar): de prijs; anders 0. */
  readonly cost: number;
}

const WAIT: ResearchStep = { techId: RESEARCH_WAIT, cost: 0 };
const IMPOSSIBLE: ResearchStep = { techId: RESEARCH_IMPOSSIBLE, cost: 0 };

/**
 * De tech die speler p nu moet onderzoeken voor `need` (diepte eerst in de prereqTech-keten, in lijstvolgorde): een
 * techId als Research nu kan, anders RESEARCH_WAIT (met de prijs als alleen de scrap ontbreekt) of RESEARCH_IMPOSSIBLE.
 */
function researchFor(
  ctx: SimContext,
  p: number,
  need: readonly number[],
  reserve = 0,
): ResearchStep {
  const w = ctx.world;
  const seen: number[] = [];
  const visit = (techId: number): ResearchStep => {
    if (seen.includes(techId)) return IMPOSSIBLE; // kring in de prereqTech-keten
    seen.push(techId);
    const t = ctx.config.techs[techId];
    if (t === undefined || t.factionId !== ctx.players[p]!.factionId) return IMPOSSIBLE;
    for (const q of t.prereqTech) {
      if (hasTechs(ctx, p, [q])) continue;
      return visit(q);
    }
    let exists = false;
    let free = false;
    for (let i = 0; i < w.highWater; i++) {
      if (!w.has(i, C.building) || w.owner[i] !== p) continue;
      if (w.research[i] === t.techId + 1) return WAIT; // loopt al
      if (w.typeId[i] !== t.buildingTypeId) continue;
      exists = true;
      if (w.bstate[i] === BSTATE_DONE && w.research[i] === 0 && w.job[i] === 0) free = true;
    }
    if (!exists) return IMPOSSIBLE;
    if (!free) return WAIT;
    const cost = researchCost(ctx, p, t);
    return ctx.ps.scrap[p]! >= cost + reserve
      ? { techId: t.techId, cost: 0 }
      : { techId: RESEARCH_WAIT, cost };
  };
  for (const techId of need) {
    if (hasTechs(ctx, p, [techId])) continue;
    return visit(techId);
  }
  return WAIT;
}

function heroThink(ctx: SimContext, p: number, hq: number): void {
  const ps = ctx.ps;
  const w = ctx.world;
  const h = heroOf(ctx, p);
  if (h === undefined) return;
  if (ps.heroState[p] === HERO_DEAD && hq >= 0 && ps.scrap[p]! >= h.reviveScrap) {
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Recruit',
      payload: { buildingId: w.idOf(hq) },
    });
  }
  if (ps.heroPending[p]! > 0) {
    for (const perkId of h.perkPool) {
      if (
        applyCommand(ctx, {
          playerId: p,
          seq: 0,
          type: 'PickPerk',
          payload: { heroId: h.heroId, perkId },
        })
      )
        break;
    }
  }
  const i = heroIndex(ctx, p);
  if (i < 0) return;
  for (let a = 0; a < h.abilities.length; a++) {
    if (ps.abCooldown[p * MAX_ABILITIES + a]! > 0) continue;
    const ab = h.abilities[a]!;
    // de dichtstbijzijnde vijandelijke unit binnen bereik (rangeU, of de straal als de zone op de held zelf ligt)
    const r = ab.rangeU > 0 ? ab.rangeU : ab.radiusU;
    let best = -1;
    let bestD = 0;
    for (let j = 0; j < w.highWater; j++) {
      if (!w.has(j, C.unit | C.health) || !isEnemy(w, i, j)) continue;
      const dx = w.x[j]! - w.x[i]!;
      const dy = w.y[j]! - w.y[i]!;
      const d = dx * dx + dy * dy;
      if (d <= r * r && (best < 0 || d < bestD)) {
        best = j;
        bestD = d;
      }
    }
    if (best < 0) continue;
    const at = ab.rangeU > 0 ? best : i;
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'HeroAbility',
      payload: { heroId: h.heroId, abilityId: a, x: w.x[at]!, y: w.y[at]! },
    });
  }
}
