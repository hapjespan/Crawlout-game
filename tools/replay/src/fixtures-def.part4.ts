// Split from fixtures-def.ts to stay under the 5,000-token file limit; fixtures-def.ts re-exports the public surface.
// Holds: FIXTURES_UP_TO_S3, FIXTURES.
import { SitePlanner, settlementPoint, centrePoint, toward } from './bot.js';
import { createReplaySim } from './run.js';
import { PROJECT_FIXTURES } from './fixtures-project.js';
import {
  FIXTURES_S4,
  FIXTURES_S6,
  FIXTURES_S7,
  FIXTURES_S8,
  Script,
  base,
  building,
  cell,
  data,
  loadout,
  nearest,
  startOf,
  tech,
} from './fixtures-def.part1.js';
import type { FixtureDef } from './fixtures-def.part1.js';
import {
  FIXTURES_S14,
  FIXTURES_S15,
  FIXTURES_S5,
  radioIds,
  stateAt,
} from './fixtures-def.part3.js';
import {
  FIXTURES_S10,
  FIXTURES_S11,
  FIXTURES_S12,
  FIXTURES_S13,
  FIXTURES_S9,
} from './fixtures-def.part2.js';

const FIXTURES_UP_TO_S3: FixtureDef[] = [
  {
    // Beweging en commando-validatie op de kleine testmap: Move, Stop, seq-volgorde, ongeldige commando's.
    name: 's2-testmap-move-stop',
    build() {
      const r = base('testmap', 20261013, [false, false]);
      const st = startOf(r);
      const a = [...st.scav[0]!, ...st.builder[0]!, ...st.militia[0]!];
      const b = [...st.scav[1]!, ...st.builder[1]!, ...st.militia[1]!];
      const s = new Script()
        // testmap van 64 x 64 (echte-schaalronde): hoofdgebouwen van 21 x 21 op cellen 4..24 en 39..59
        .move(4, 0, a, 48, 20)
        .move(5, 1, b, 16, 44)
        .add(6, 1, 'Move', { ids: a, ...cell(3, 3) }) // ongeldig: niet van speler 1
        .add(60, 0, 'Stop', { ids: a.slice(0, 2) })
        .move(90, 0, a.slice(0, 2), 32, 30)
        .add(150, 0, 'Move', { ids: a, x: -10, y: 500 }) // ongeldig: buiten de map
        .move(200, 1, b, 48, 20) // zelfde doel als speler 0: veld hergebruiken
        // zelfde frame, seq bepaalt de volgorde: het tweede Move-commando wint
        .add(302, 0, 'Move', { ids: a.slice(2, 4), ...cell(24, 52) }, 101)
        .add(302, 0, 'Move', { ids: a.slice(2, 4), ...cell(36, 52) }, 100)
        .move(400, 1, b, 32, 30)
        .add(450, 1, 'Research', { techId: 0 }); // ongeldig: geen lab en prereqTech ontbreekt
      r.bundles = s.bundles();
      r.hashes = [{ frame: 599, hash: 0 }]; // lengte; record vult de echte hashes in
      return r;
    },
  },
  {
    // Een potje-fragment op Rustbelt met twee mensen: verzamelen, bouwen (woning, werkplaats), rol wisselen,
    // claimen met een claimpaal, en gevecht met AttackMove en Attack. Plus een Cancel met teruggave en een Surrender aan het eind.
    name: 's2-rustbelt-skirmish',
    build() {
      const r = base('rustbelt', 777, [false, false]);
      const st = startOf(r);
      const sim = st.sim;
      const s = new Script();
      const plan = new SitePlanner(sim);
      const spawns = sim.map.spawns;
      for (let p = 0; p < 2; p++) {
        const node = nearest(sim, st.nodes, spawns[p]!.x, spawns[p]!.y);
        s.add(4, p, 'Gather', { ids: st.scav[p]!, nodeId: node });
        s.add(6, p, 'Build', {
          ids: st.builder[p]!,
          typeId: building('woning'),
          ...plan.take(p, 'woning', 'hq'),
        });
      }
      // speler 0 bouwt meteen een werkplaats (hij heeft genoeg scrap na een paar ritten), speler 1 later
      s.add(700, 0, 'Build', {
        ids: st.builder[0]!,
        typeId: building('werkplaats'),
        ...plan.take(0, 'werkplaats', 'hq'),
      });
      s.add(1000, 1, 'Build', {
        ids: st.builder[1]!,
        typeId: building('werkplaats'),
        ...plan.take(1, 'werkplaats', 'hq'),
      });
      // cancel: speler 1 zet een radiobaken neer en trekt het terug
      s.add(1010, 1, 'Build', {
        ids: st.builder[1]!,
        typeId: building('radiobaken'),
        ...plan.take(1, 'radiobaken', 'hq'),
      });
      // omscholen: twee scavengers van speler 0 worden militie
      s.add(1800, 0, 'SetRole', { ids: st.scav[0]!.slice(0, 2), role: 'militia' });
      // claim: de bouwer van speler 1 zet een claimpaal bij het punt aan zijn kant (na de werkplaats); de militie mag niet
      const claim1 = settlementPoint(sim, 1).id;
      s.add(300, 1, 'Claim', { ids: st.militia[1]!, pointId: claim1 }); // ongeldig: geen bouwers
      s.add(2000, 1, 'Claim', { ids: st.builder[1]!, pointId: claim1 });
      // gevecht: militie van speler 0 op AttackMove naar dat claimpunt
      const c1 = sim.getUnit(claim1)!;
      s.add(1200, 0, 'AttackMove', { ids: st.militia[0]!, x: c1.x, y: c1.y });
      r.bundles = s.bundles();
      // de radiobaken-id volgt pas uit de run: Cancel op alle entities die er dan staan is ongeldig voor de rest
      r.bundles.push({
        frame: 1015,
        commands: [
          { frame: 1011, playerId: 1, seq: 500, type: 'Cancel', payload: { ids: radioIds(r) } },
        ],
      });
      r.bundles.push({
        frame: 2900,
        commands: [{ frame: 2896, playerId: 1, seq: 501, type: 'Surrender', payload: {} }],
      });
      r.bundles.sort((x, y) => x.frame - y.frame);
      r.hashes = [{ frame: 2999, hash: 0 }];
      return r;
    },
  },
  {
    // Sprint 3 op Rustbelt met twee mensen: claimen met de claimpaal (ook een ongeldige Claim zonder bouwers), de held
    // (escorte, gevecht, Lockdown, xp door kills en ontdekking, PickPerk, dood en oplappen met Recruit, Cancel van het
    // oplappen), onderzoek in de werkplaats (Research, Cancel met teruggave, opnieuw) en Craft van een patrol.
    name: 's3-rustbelt-hero-claims',
    build() {
      const r = base('rustbelt', 303, [false, false]);
      const st = startOf(r);
      const sim = st.sim;
      const s = new Script();
      const spawns = sim.map.spawns;
      const centre = centrePoint(sim).id;
      // het settlement-punt aan de eigen kant (sinds data 0.7.0 bij de 2500-node, besluit 9)
      const own = [0, 1].map((p) => settlementPoint(sim, p).id);
      const hero = data.heroes[0]!.id;
      for (let p = 0; p < 2; p++) {
        const node = nearest(sim, st.nodes, spawns[p]!.x, spawns[p]!.y);
        s.add(4, p, 'Gather', { ids: st.scav[p]!, nodeId: node });
        s.add(5, p, 'Claim', { ids: st.militia[p]!, pointId: own[p]! }); // ongeldig: geen bouwers
        s.add(6, p, 'Claim', { ids: st.builder[p]!, pointId: own[p]! });
      }
      // speler 0: de held escorteert de bouwer, daarna naar het midden; speler 1 claimt het midden
      const c = sim.getUnit(centre)!;
      const o0 = sim.getUnit(own[0]!)!;
      s.add(8, 0, 'Move', { ids: st.hero[0]!, x: o0.x, y: o0.y - 512 });
      s.add(900, 1, 'Claim', { ids: st.builder[1]!, pointId: centre });
      s.add(950, 1, 'AttackMove', { ids: st.hero[1]!, x: c.x, y: c.y });
      s.add(1000, 0, 'AttackMove', { ids: [...st.hero[0]!, ...st.militia[0]!], x: c.x, y: c.y });
      s.add(1300, 0, 'HeroAbility', { heroId: hero, abilityId: 0 });
      s.add(1310, 1, 'HeroAbility', { heroId: hero, abilityId: 0 });
      // beide spelers sturen scavengers naar het midden (xp voor de helden); speler 1 kiest perks zodra hij kan
      s.add(1100, 1, 'Move', { ids: st.scav[1]!.slice(0, 2), x: c.x, y: c.y });
      // (speler 0 stuurt ze naar waar de held van speler 1 op frame 1500 staat; dat volgt deterministisch uit de run)
      r.bundles = s.bundles();
      // creep camps (sim 0.20.0): the hero of player 1 may have fallen at the high camp on his way; then the centre
      const h1 = stateAt(r, 1500).getUnit(st.hero[1]![0]!) ?? c;
      s.add(1500, 0, 'Move', { ids: st.scav[0]!.slice(1), x: h1.x, y: h1.y });
      for (let k = 0; k < 6; k++)
        s.add(1500 + 1000 * k, 1, 'PickPerk', {
          heroId: hero,
          perkId: data.heroes[0]!.perkPool[k]!,
        });
      // oplappen: beide spelers proberen het op vaste frames (ongeldig zolang hun held leeft), speler 1 annuleert een keer
      for (let k = 0; k < 20; k++) {
        s.add(1600 + 300 * k, 0, 'Recruit', { buildingId: st.hq[0]! });
        s.add(1650 + 300 * k, 1, 'Recruit', { buildingId: st.hq[1]! });
      }
      s.add(1700, 1, 'Cancel', { ids: [st.hq[1]!] });
      // onderzoek: werkplaats, geweerrek (Cancel, opnieuw), patrol craften
      s.add(1200, 0, 'Build', {
        ids: st.builder[0]!,
        typeId: building('werkplaats'),
        ...new SitePlanner(sim).take(0, 'werkplaats', 'hq'),
      });
      s.add(2400, 0, 'Research', { techId: tech('geweerrek') });
      s.add(2410, 0, 'Cancel', { ids: [st.hq[0]!] }); // stopt het oplappen als dat loopt (teruggave)
      s.add(2600, 0, 'Research', { techId: tech('composiet_pantser') }); // ongeldig: prereqTech
      s.add(3200, 0, 'Craft', { ids: st.scav[0]!.slice(0, 1), loadoutId: loadout('patrol') });
      // later valt speler 1 met held en militie de basis van speler 0 aan; een opgelapte held heeft een nieuwe id
      r.bundles = s.bundles();
      const later = stateAt(r, 3400);
      const hero1 = later
        .entityIds()
        .filter((id) => later.getUnit(id)!.kind === 'hero' && later.getUnit(id)!.owner === 1);
      s.add(3400, 1, 'AttackMove', { ids: [...hero1, ...st.militia[1]!], ...spawns[0]! });
      // de militie van speler 0 laat de basis open: 20 m richting het midden
      s.add(3410, 0, 'Move', { ids: st.militia[0]!, ...toward(spawns[0]!, c, 20) });
      r.bundles = s.bundles();
      r.hashes = [{ frame: 7999, hash: 0 }];
      return r;
    },
  },
  {
    // Scripted AI tegen scripted AI op Rustbelt tot er een winnaar is. Geen bundels met commando's: de AI zit in de sim
    // (bouwvolgorde, claimpalen, omscholen, aanvalsgolven met de held, Lockdown, oplappen, perks).
    name: 's2-rustbelt-ai-vs-ai',
    build() {
      const r = base('rustbelt', 42, [true, true]);
      // tot net na de winst (dominantie of vernietiging), hoogstens 40 minuten speeltijd
      const sim = createReplaySim(r);
      let end = 47999;
      for (let f = 0; f < 48000; f++) {
        sim.applyBundle({ frame: f, commands: [] });
        sim.tick();
        const w = sim.winner();
        if (w !== null) {
          end = w.frame + 20;
          break;
        }
      }
      r.hashes = [{ frame: end, hash: 0 }];
      return r;
    },
  },
];

export const FIXTURES: readonly FixtureDef[] = [
  ...FIXTURES_UP_TO_S3,
  ...FIXTURES_S4,
  ...FIXTURES_S5,
  ...FIXTURES_S6,
  ...FIXTURES_S7,
  ...FIXTURES_S8,
  ...FIXTURES_S9,
  ...FIXTURES_S10,
  ...FIXTURES_S11,
  ...FIXTURES_S12,
  ...FIXTURES_S13,
  ...FIXTURES_S14,
  ...FIXTURES_S15,
  ...PROJECT_FIXTURES,
];
