// What the pre-match menu shows, built from the loaded data and map: factions with their hero, and the map with a
// minimap preview (terrain, water, start positions, scrap and claim points). Menu texts are Dutch and live here, not in
// packages/ui, so the data stays the one source for names and numbers.
import { ARCHETYPES, type GameData } from '@crawlout/data';
import { heroCards } from './heroCards.js';
import type { MapGrid } from '@crawlout/map';
import type { MenuContent, MenuFaction, MenuMapInfo } from '@crawlout/ui';
import type { MinimapLayers } from './minimapLayers.js';

/** One or two sentences per faction (Spelfundament sectie 4). Unknown factions get an empty blurb. */
const BLURBS: Readonly<Record<string, string>> = {
  dwellers: 'Snel en wendbaar: turrets, robots en veel lichte units. Bewoners trekken vanzelf aan.',
  raiders: 'Zwermen, melee en chems. Rooft bewoners en maakt er slaven van.',
};

/** "Dwellers (De Kluis)" gives a name and a subtitle. */
export function splitFactionName(naam: string): { name: string; subtitle: string } {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(naam);
  return m ? { name: m[1]!, subtitle: m[2]! } : { name: naam, subtitle: '' };
}

export function menuFactions(data: GameData): MenuFaction[] {
  return data.factions.map((f) => {
    const { name, subtitle } = splitFactionName(f.naam);
    return {
      key: f.key,
      name,
      subtitle,
      blurb: BLURBS[f.key] ?? '',
      // the Krijger, the hero without a choice (hero choice, protocol 0.18.0)
      hero:
        data.heroes.find(
          (h) => h.factionId === f.id && h.archetype === ARCHETYPES.indexOf('krijger'),
        )?.naam ??
        data.heroes.find((h) => h.factionId === f.id)?.naam ??
        'onbekend',
      heroes: heroCards(data, f.id),
    };
  });
}

/** "Rustbelt" with the size mark of the XL map: ids are lower case keys, the menu shows them as names. */
const MAP_NAMES: Readonly<Record<string, string>> = { rustbelt: 'Rustbelt XL' };

export function menuMap(
  grid: MapGrid,
  dominance: { pointsRequired: number; minutes: number },
  layers: MinimapLayers,
): MenuMapInfo {
  return {
    id: grid.id,
    name: MAP_NAMES[grid.id] ?? grid.id,
    sizeLabel: `${grid.w} x ${grid.h} m`,
    maxPlayers: grid.spawns.length,
    dominance,
    minimap: {
      w: grid.w,
      h: grid.h,
      passable: grid.passable,
      ...layers,
      // Player 0 is "you" in the preview (green), the other start is the opponent (red).
      blips: [
        ...grid.scrapNodes.map((n) => ({ x: n.ux, y: n.uy, owner: -1, kind: 'node' as const })),
        ...grid.spawns.map((s, i) => ({ x: s.ux, y: s.uy, owner: i, kind: 'hero' as const })),
      ],
      claims: grid.claimPoints.map((c) => ({ x: c.ux, y: c.uy, owner: null })),
    },
  };
}

export function menuContent(
  data: GameData,
  grid: MapGrid,
  dominance: { pointsRequired: number; minutes: number },
  layers: MinimapLayers,
  versionLabel?: string,
): MenuContent {
  return {
    factions: menuFactions(data),
    map: menuMap(grid, dominance, layers),
    ...(versionLabel ? { versionLabel } : {}),
  };
}

/** What the menu holds while the data loads (the splash is up before the factions and the map are known). */
export const EMPTY_MENU_CONTENT: MenuContent = {
  factions: [],
  map: {
    id: '',
    name: '',
    sizeLabel: '',
    maxPlayers: 2,
    dominance: { pointsRequired: 0, minutes: 0 },
    minimap: { w: 1, h: 1, passable: new Uint8Array(1), blips: [], claims: [] },
  },
};
