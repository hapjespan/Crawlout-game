// Systeem 2 (AI-deel): de scripted tegenstander, voor elke speler met ai = true, voor de unit-orders; de volgorde van
// de spelers draait per tick door (fair-ronde, zie aiSystem). Geen cheats: de AI geeft gewone commando's via
// applyCommand (dezelfde validatie als spelers) en ziet alleen wat elke speler kan zien: eigen units en gebouwen, de
// map, de spawns, wie een claimpunt bezit, en vijandelijke units die bij zijn eigen gebouwen staan. Fog of war (sim
// 0.17.0): of those enemy units only the ones his own units and buildings see now (World.visTo); map knowledge (terrain,
// spawns, nodes, claim points and who holds them, as on the HUD) stays, so a push still walks to the enemy spawn. Alle getallen
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
//     claimpunt het dichtst bij huis of bij de vijand (over land). Data 0.24.0 (sim 0.19.0, alleen met de scriptvelden):
//     liberate stuurt vrije militie naar een zichtbare vijandelijke slaaf of gevangene bij de eigen gebouwen, en
//     defendHqFirst trekt bij een vijand aan het hoofdgebouw ook militie die al elders heen liep. Het script is dat voor
//     de factie van de tegenstander als er een is (ai/*.json versus), anders het standaardscript van de factie.

export {
  chunks,
  AiScratch,
  ESCORT_OFFSET,
  ownClaimNear,
  fieldOf,
  stepAlong,
  rallyCell,
} from './ai.geometry.js';
export type { Fields } from './ai.geometry.js';
export { aiSystem } from './ai.think.js';
export { findSite, isOwnSide, enemyOf, exclusiveFor, heroClaimNear } from './ai.sites.js';
export {
  claimNext,
  raidOver,
  findThreat,
  waveReady,
  enemyClaimFor,
  claimType,
  claimAt,
  RESEARCH_WAIT,
  RESEARCH_IMPOSSIBLE,
  researchFor,
  heroThink,
} from './ai.plans.js';
