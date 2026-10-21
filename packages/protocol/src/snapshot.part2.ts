// Split from snapshot.ts to stay under the 5,000-token file limit; snapshot.ts re-exports the public surface.
// Holds: PlayerStatus, QueueItem.
import type {
  ChemStatus,
  ClaimPointStatus,
  CreepCampStatus,
  DominanceStatus,
  HeroStatus,
  ProjectStatus,
  SlaveGroupStatus,
} from './snapshot.part1.js';
import type { SurvivalStatus } from './snapshot.part3.js';

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
   * Pop van elke eigen levende unit die geen bed gebruikt (protocol 0.8.0, data 0.16.0; besluit fase-0 sectie 20).
   * Sinds sim 0.34.0 (data 0.41.0, Slaapzaal en frames-zonder-bed, fase-0 sectie 25 besluit 2) telt dit ook de
   * Vertibird-vehicles, de Garde-frames en de beasts; de naam `robotPop` is historisch, het veld is in feite
   * `noBedPop` (sim: `census.robotPop + census.noBedPop`). `pop` is de pop van de bewoners (binnen de bedden) en
   * `settlers` telt alleen bewoners. popCap = min(beds, popCapMax - robotPop - pop van robots in productie): de
   * ruimte voor bewoners. Hernoemen naar `noBedPop` is besluit sectie 25 (protocol 0.20.0, volgende PR, want 30
   * literals te verzetten). Verplicht sinds protocol 0.9.0.
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
   * (bevestigd door de architect in fase-0 sectie 24 besluit 1): alle PlayerStatus-literals dragen hem.
   */
  claimPoints: ClaimPointStatus[];
  /**
   * Chem-dosis per eenheid (protocol 0.13.0; voorstel van hud, bevestigd door de architect in fase-0 sectie 24
   * besluit 1): elke eigen eenheid met een chem in een fase (active, crash of cooldown), zodat de HUD de dosis en de
   * cooldown van een Chem-dealer uit state leest en niet uit de snapshot benadert. Oplopend op unitId. De sim houdt
   * ze al bij (w.chem, w.chemPhase, w.chemTicks), dus geen state en geen hashwijziging; Sim.chems. Optioneel tot de
   * HUD hem leest (de sim levert hem altijd); leeg zonder doses.
   */
  chems?: ChemStatus[];
  /**
   * Creep-kampen (protocol 0.14.0; voorstel van sim-core, bevestigd in fase-0 sectie 24 besluit 1): elk kamp van de map met
   * zijn stand, zodat de HUD een overgenomen kamp in de kleur van zijn eigenaar toont (minimap) en de Raiders bij een
   * bandiet "Overnemen" zien. Op kampindex (de volgorde van MapDef.creepCamps). Kaartkennis zoals claimPoints (een
   * kamp is een map-feature; wie het houdt is openbaar, of het nu vecht niet). De sim levert hem altijd (Sim.camps,
   * leest alleen state, geen hashwijziging); leeg op een map zonder kampen. Optioneel tot alle PlayerStatus-literals
   * hem dragen.
   */
  camps?: CreepCampStatus[];
  /**
   * De slavengroepen van de speler met hun bewakers (protocol 0.15.0, data 0.29.0; voorstel van sim-core, bevestigd in
   * fase-0 sectie 24 besluit 1): per groep de slaven, de bewakers en wat de bewaakregel eist, zodat de HUD
   * "Bewakers 1/2 nodig" en de opstandwaarschuwing uit state toont in plaats van het uit de snapshot te benaderen (de
   * bewaakmodus staat niet in de snapshot). Oplopend op kind (kooi voor node), dan targetId. Eigen kennis; leeg voor een
   * factie zonder slaven. De sim levert hem altijd (Sim.status, slaves.ts guardStatus; leest alleen state, geen
   * hashwijziging). Optioneel tot alle PlayerStatus-literals hem dragen.
   */
  slaveGroups?: SlaveGroupStatus[];
  /**
   * Winroute C, Bouwproject (protocol 0.16.0, sim 0.25.0, data 0.31.0; bevestigd in fase-0 sectie 24 besluit 1):
   * de delen van het winkelcentrum met hun stand en de countdown van elke speler, zodat de HUD het projectpaneel, de
   * markers op de minimap en de meldingen (deel hersteld, deel verloren, countdown loopt, sabotage) uit state toont.
   * Kaartkennis zoals claimPoints: de ruines staan op de map en wie een deel houdt is openbaar. null zonder Bouwproject
   * (het speltype Skirmish). De sim levert hem altijd (Sim.status, project.ts projectStatus; leest alleen state, geen
   * hashwijziging). Optioneel tot alle PlayerStatus-literals hem dragen.
   */
  project?: ProjectStatus | null;
  /**
   * Survival co-op (protocol 0.17.0; besluit fase-0 sectie 24 besluit 3): de stand van de run voor het golfpaneel en
   * het eindscherm; vervangt de eigen worker-entry van de client (apps/client/src/game/simWorker.ts). null buiten het
   * speltype Survival. De sim levert hem altijd (Sim.status; leest alleen state, geen hashwijziging). Optioneel tot
   * alle PlayerStatus-literals hem dragen.
   */
  survival?: SurvivalStatus | null;
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
