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
| K | Craftmenu | bewoners geselecteerd en `getCraftOptions` levert opties |
| 1 tot 9 | Craft kiezen | craftmenu open |
| 1 tot 9 | Research of rekruteren (research eerst, dan rekruteren) | alleen gebouwen geselecteerd, met opties |
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

Volgorde bij cijfers: bouwmenu of craftmenu (als open), dan gebouwpaneel (als alleen gebouwen geselecteerd), anders de rolletoetsen.

### Conflicten met de camera

De camera gebruikt W, A, S, D (pan) en Q, E (draaien of zoomen). De HUD gebruikt daarom geen W, D, Q en E meer: perks staan op F1 tot F3 (F1 wordt met `preventDefault` afgevangen zodat de browser-hulp niet opent) en abilities op Z, X, C.

A (aanvallen-verplaatsen) en S (stop) blijven bewust in de HUD. **De client moet daarom de camera-pan op A en S uitschakelen** (de camera blijft panen met W en D en met de schermrand). Dat regelt de hoofdagent in `apps/client/src/main.ts`. Met een selectie handelt de HUD A en S af en roept `preventDefault` aan; zonder selectie laat de HUD de toets liggen, maar de camera hoort hem dan ook niet te gebruiken, zodat de toets nooit twee dingen doet.

## Deps voor held, gebouwen en craft (sprint 3)

- `heroName(heroId)`: naam uit data; zonder dep staat er "Held". Het held-paneel leest verder alles uit `PlayerStatus.hero` (`HeroStatus`); `HeroInfo` en `getHeroInfo` bestaan niet meer.
- `getHeroAbilities()`: `{ abilityId, naam, needsTarget, cooldownPct }[]`, 0 is klaar en 100 is net gebruikt.
- `isHeroDead()` en `reviveHero()`: er is geen dood-vlag in `HeroStatus` en geen Revive-commando in het protocol; de client levert beide tot de sim ze heeft.
- `getResearchOptions(buildingIds)`, `getRecruitOptions(buildingIds)`: opties voor de geselecteerde gebouwen (unieke buildingIds uit de typeId-ruimte), met `scrapCost` en `affordable`. Stuurt `Research { techId }` en `Recruit { buildingId }`.
- `getCraftOptions()`: opties voor de geselecteerde bewoners; leeg als ze niet bij een werkplaats staan. Stuurt `Craft { ids, loadoutId }` met alleen de units uit de selectie.
- `TargetingKind` heeft er `'heroAbility'` bij: de client roept bij de volgende wereldklik `completeTargeting({ x, y })` aan, ook zonder selectie.

## Demo

`apps/client/hud-demo.html` (via `pnpm dev`) draait de HUD met mock-deps.
