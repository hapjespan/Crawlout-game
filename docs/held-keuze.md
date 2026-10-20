# Held-keuze (fase 3, data 0.39.0)

Voorstel voor de architect, startwaarden, geen balans. Bron: Spelfundament 01-1 punt 1 en 02-10 punt 7: kies 1 uit 3 archetypes, vast over alle facties: Bouwer (economie), Krijger (agressie), Tacticus (control); elke factie geeft ze een eigen kleur. De regels van de bestaande held blijven: oplappen bij het hoofdgebouw met 20 procent verlies van perks en hp (`revivePenaltyPct 20`, `maxRevives 4`), 6 levelstappen, 1 perk per level, alle 7 SPECIAL actief. Alle helden hebben SPECIAL-totaal 34.

## De negen helden

Krijger = bestaand (`opziener`, `warlord`, `zwaardridder`). Nieuw staat vet. Alle ids staan in `data/heroes.json` (idGroup 1), perks in `data/perks.json` (idGroup 1, 3 nieuwe per held, de rest hergebruikt).

| Factie | Bouwer | Tacticus |
|---|---|---|
| Dwellers | **Voorman** `voorman` | **Controleur** `controleur` |
| Raiders | **Marktmeester** `marktmeester` | **Ketenmeester** `ketenmeester` |
| Garde | **Kwartiermeester** `kwartiermeester` | **Archivaris** `archivaris` |

**Voorman** (SPECIAL S3 P4 E5 C7 I7 A4 L4). Passief: scavengers +8 procent opbrengst, bouwers 10 procent sneller. Ability Haastklus (op de held, 14 m, 10 s, cd 60): eigen units 25 procent sneller, 10 procent minder schade. Perks: papierwerk, opzichter_blik, zware_laarzen, voorraadkast, gereedschapsriem, zuinig_beheer. Basis: militie. Identiteit: de kluis draait op papier en schroeven.

**Controleur** (S3 P7 E5 C4 I6 A3 L6). Passief: turrets +1 m bereik; aura 8 m: vijanden 10 procent trager. Ability Noodslot (12 m, straal 7, 8 s, cd 50): vijanden 40 procent trager en 25 procent minder schade. Perks: stille_knop, geluksschot, zware_laarzen, scherpe_blik, kortsluiting, noodprotocol. Basis: patrol. Houdt een positie, rekt een gevecht uit.

**Marktmeester** (S3 P3 E5 C7 I6 A4 L6). Passief: slaven +10 procent scrap per rit, slaaf_bouwers 10 procent sneller. Ability Opbod (op de held, 14 m, 10 s, cd 55): eigen units, ook slaven, 30 procent sneller. Perks: schuldeiser, vakbond_verboden, dubbele_dosis, zwarte_markt, afdingen, gladde_prater. Xp-curve van de Warlord, basis warlord_basis.

**Ketenmeester** (S4 P5 E4 C5 I5 A6 L5). Passief: geen. Aura 8 m: vijanden 10 procent trager. Ability Prikkeldraad (12 m, straal 7, 8 s, cd 45): vijanden 45 procent trager en 15 procent minder schade. Perks: rammelende_ketting, goot_scherpschutter, grote_bek, lange_ketting, achtervolgingswaan, rookgordijn. Basis: warlord_basis.

**Kwartiermeester** (S3 P4 E5 C6 I7 A3 L6). Passief: initiate_zoekers +8 procent opbrengst, onderzoek 10 procent sneller. Ability Bevoorrading (op de held, 12 m, 10 s, cd 60): eigen units 20 procent sneller, 10 procent minder schade. Perks: papierwerk, zware_laarzen, geluksschot, voorraadlijst, bouwplan, rijke_archieven. Basis: initiate_wacht.

**Archivaris** (S3 P6 E5 C4 I7 A3 L6). Passief: geschutstorens +1 m bereik. Ability Dwangprotocol (12 m, straal 7, 7 s, cd 50): vijanden 35 procent trager en 30 procent minder schade. Perks: papierwerk, zware_laarzen, geluksschot, heldere_richtlijn, gelaagde_beveiliging, doelwitprotocol. Basis: initiate_wacht.

## Balansintentie

Elke factie heeft drie speelstijlen met gelijk SPECIAL-totaal en dezelfde oplap-regel. Krijger: de hero is de sterkste vechter (buff-ability op eigen units, zware basis zoals krachtpantser) en wint gevechten. Bouwer: economie en tech (circa 8 tot 10 procent), zwakke basis en een logistieke ability; hij wint op de klok en moet het gevecht ontlopen. Tacticus: vijand-effecten (trager, minder schade) plus turrets of aura; hij wint door een gevecht te kantelen, niet door schade. Doel: elke keuze 45 tot 55 procent tegen een andere keuze; meten is een apart werkpakket (niet gedaan).

## Datakeuzes en schemavoorstel

Alleen bestaande stats en mechanica (speedPct, damagePct, damageTakenPct, gatherRatePct, buildTimePct, research*, rangeM, hpPct). **Optioneel schemavoorstel (enige nieuwe mechanica)**: `idGroup` (geheel getal, afwezig 0) op Hero en Perk; `sortById` sorteert op (idGroup, id), zodat de oude ids niet verschuiven (de nieuwe heroes-ids sorteren anders voor `warlord`). Perks 31 van MAX_PERKS 32. Bouwer-abilities kennen geen eco-stat (alleen speedPct, damageTakenPct): een echte economie-ability (bv. gatherRatePct in een zone) vraagt een sim-uitbreiding van AURA_STATS en is niet voorgesteld.

## Wat de sim, het protocol en de client moeten bouwen

1. **Protocol**: `LobbyPlayer.heroId` (optioneel, de key van een held van de eigen factie) of `heroArchetype` ('bouwer' | 'krijger' | 'tacticus'). Aanbeveling: archetype, de factie kiest de held; de lobby valideert dat de held bij de factie hoort. Een lobby-commando `SetHero` voor de start; het zod-schema en het doc (contract 2) volgen. Het veld is deel van de seed-/replay-invoer.
2. **Standaard**: afwezig of ongeldig = de Krijger van de factie, zodat alle bestaande fixtures gelijk blijven (geen veld = zelfde hash).
3. **Sim**: `createGame` zoekt de held van de speler op (factie, archetype) in plaats van de eerste held van de factie; spawn met `baseLoadoutId` (afwezig: standaard militie), perk-pool, aura en passieven uit data. Heldenbeperkingen (een held per speler, oplappen, `maxRevives`) ongewijzigd. De `envHash` verandert met data 0.39.0 (9 helden, 31 perks): fixtures opnieuw opnemen (alleen versie en envHash; Krijger-potjes ongewijzigd qua uitkomst).
4. **AI**: de AI-scripts krijgen `heroArchetype` (afwezig = krijger); een basis-script kiest per seed of per `versus` (bijvoorbeeld Tacticus tegen een rush, Bouwer tegen een defensieve AI). Eerst alleen Krijger houden, dan variatie via data.
5. **Client**: een HUD-keuzescherm in de lobby (Preact): drie kaarten per factie met naam, passief, ability en SPECIAL-balken, standaard geselecteerd = Krijger, keuze vergrendeld bij de start. Teksten Nederlands. Alleen asset-ids voor portretten, geen assets in deze stap.
