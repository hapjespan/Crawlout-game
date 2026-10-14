# @crawlout/ui

Preact-HUD als overlay op de 3D-scene. De HUD praat alleen via `HudDeps`: commando's uit `@crawlout/protocol` naar buiten, spelerstatus (`PlayerStatus`) naar binnen. Alle deps na de eerste vijf zijn optioneel; ontbreekt een dep, dan ontbreekt dat onderdeel.

## Sneltoetsen

Toetsen werken niet in een tekstveld en niet met Ctrl, Cmd of Alt.

| Toets | Actie | Voorwaarde |
|---|---|---|
| M | Verplaatsen (targeting) | selectie |
| A | Aanvallen-verplaatsen (targeting) | selectie |
| S | Stop | selectie |
| G | Verzamelen (targeting op een node) | selectie |
| 1, 2, 3 | Rol plunderaar, bouwer, militie | selectie |
| B | Bouwmenu | |
| 1 tot 9 | Gebouw kiezen | bouwmenu open |
| K | Cijfertoetsen van de craftkaarten aan of uit | bewoners geselecteerd en `getBuildingCards` levert craftkaarten |
| 1 tot 9 | Craftkaart starten | na K |
| 1 tot 9 | Kaart starten (de `hotkey` van de kaart) | alleen gebouwen geselecteerd, met kaarten |
| H | Held-paneel tonen of verbergen | held aanwezig |
| F1, F2, F3 | Perk 1, 2, 3 kiezen | level-up open (`pendingPerks` > 0) |
| Z, X, C | Held-ability 1, 2, 3 | held leeft, cooldown klaar; een ability met `needsTarget` vraagt daarna een wereldklik |
| V | Oplappen | held dood en `revivesLeft` niet 0 |
| N | Minimap tonen of verbergen | `getMinimap` |
| Spatie | Camera naar de laatste waarschuwing | waarschuwing aanwezig |
| . (punt) | Volgende unit zonder taak selecteren, camera erheen | eenhedenbalk aanwezig |
| L | Lobby-paneel | `getLobby` |
| R, O | Klaar, host-instellingen | lobby-paneel open |
| Esc | Annuleren: opgeven-dialoog, targeting, plaatsing, menu's | |

Volgorde bij cijfers: bouwmenu (als open), dan de kaarten (alleen gebouwen geselecteerd, of bewoners na K), anders de rolletoetsen. Een ontbrekende of niet-startbare kaart (vergrendeld, te duur, loopt, klaar) slikt het cijfer wel in, zodat het geen rol wisselt.

### Conflicten met de camera

De camera gebruikt W, A, S, D (pan) en Q, E (draaien of zoomen). De HUD gebruikt daarom geen W, D, Q en E meer: perks staan op F1 tot F3 (F1 wordt met `preventDefault` afgevangen zodat de browser-hulp niet opent) en abilities op Z, X, C.

A (aanvallen-verplaatsen) en S (stop) blijven bewust in de HUD. **De client moet daarom de camera-pan op A en S uitschakelen** (de camera blijft panen met W en D en met de schermrand). Dat regelt de hoofdagent in `apps/client/src/main.ts`. Met een selectie handelt de HUD A en S af en roept `preventDefault` aan; zonder selectie laat de HUD de toets liggen, maar de camera hoort hem dan ook niet te gebruiken, zodat de toets nooit twee dingen doet.

## Deps voor held, gebouwen en craft (sprint 3)

- `heroName(heroId)`: naam uit data; zonder dep staat er "Held". Het held-paneel leest verder alles uit `PlayerStatus.hero` (`HeroStatus`); `HeroInfo` en `getHeroInfo` bestaan niet meer.
- `getHeroAbilities()`: `{ abilityId, naam, needsTarget, cooldownPct }[]`, 0 is klaar en 100 is net gebruikt.
- `isHeroDead()` en `reviveHero()`: er is geen dood-vlag in `HeroStatus` en geen Revive-commando in het protocol; de client levert beide tot de sim ze heeft.
- `getBuildingCards(selection)`, `startCard(card)`, `cancelCard(card)`: zie "Gebouwpaneel met kaarten".
- Verouderd: `getResearchOptions(buildingIds)`, `getRecruitOptions(buildingIds)` en `getCraftOptions()`. Zonder `getBuildingCards` bouwt de HUD er zelf kaarten van (zonder icoon, effecten of duur; Recruit wordt een `revive`-kaart; annuleren kan niet). Ze vervallen zodra de client op `getBuildingCards` is overgestapt.
- `TargetingKind` heeft er `'heroAbility'` bij: de client roept bij de volgende wereldklik `completeTargeting({ x, y })` aan, ook zonder selectie.

## Gebouwpaneel met kaarten (sprint 4)

Vervangt het oude research/recruit-paneel en het craftmenu. Selecteer een gebouw (research, oplappen van de held) of bewoners bij een werkplaats (craft) en het paneel toont een kaart per mogelijkheid. De HUD kent geen spelregels: de client levert alles kant-en-klaar.

```ts
getBuildingCards?(selection: readonly SelectedEntity[]): readonly BuildingCard[]; // leeg: geen paneel
startCard?(card: BuildingCard): void;  // alleen aangeroepen voor state 'available'
cancelCard?(card: BuildingCard): void; // alleen voor state 'running'; zonder deze dep geen annuleerknop

interface BuildingCard {
  kind: 'research' | 'craft' | 'revive'; // revive = held oplappen (Recruit in het protocol)
  id: number;           // techId, loadoutId of buildingId (hoofdgebouw); met kind uniek in het paneel
  naam: string;
  icon: string;         // CardIconId: research craft revive shield blade gun tower patrol wrench heart crate bolt gear; onbekend = neutraal symbool
  scrapCost: number;
  seconds: number;      // 0 verbergt de duur
  effects: string[];    // gewone taal: "+20% schade voor militie"
  unlocks: string[];    // ["Patrouille", "Turret"]
  requires: string[];   // alleen bij locked: ["Geweerrek"]
  state: 'available' | 'tooExpensive' | 'locked' | 'running' | 'done';
  progressPct?: number; // 0..100, bij running
  hotkey: string;       // "1".."9"
}
```

Elke kaart toont een symbool, naam, kosten (rood bij te duur), duur, effect, wat ze ontgrendelt en de status. De status staat altijd ook als tekst en symbool (Beschikbaar, Te duur, Vergrendeld met "Vereist: ...", Bezig met voortgangsbalk en Annuleer, Klaar met vinkje), nooit alleen als kleur. Elke kaart is een knop met een volledige `aria-label`; een niet-startbare kaart is `aria-disabled` maar blijft focusbaar. Bij bewoners toont het paneel "Craft" en wijzen de cijfers pas na K naar de kaarten, omdat 1 tot 3 daarvoor rollen zijn. De HUD leest de kaarten bij elke refresh; geef stabiele objecten terug als niets verandert. Rendertijd van negen kaarten ligt ruim onder 2 ms (test).

Wat de client levert: de `state` uit GameData, scrap en `PlayerStatus.queue` (`QueueItem` met kind, buildingId, id en progressPermille: `running` en `progressPct = progressPermille / 10`), `startCard` stuurt `Research { techId }`, `Craft { ids, loadoutId }` of `Recruit { buildingId }`, `cancelCard` stuurt `Cancel { ids: [buildingId] }`.

## Demo

`apps/client/hud-demo.html` (via `pnpm dev`) draait de HUD met mock-deps, inclusief mock-kaarten in alle vijf de statussen (Y wisselt de selectie: gebouw geeft onderzoekskaarten, bewoners craftkaarten).
