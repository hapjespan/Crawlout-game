/// <reference types="vite/client" />
// Decorative props for the renderer: the map's props file (data/maps/<id>.props.json through @crawlout/map's
// loadProps) and the fallback for prop art the asset-cli has not delivered yet (the source GLBs in assets/src/props).
// The renderer takes the manifest first (assets/dist, see game/assets.ts), then these sources, then a placeholder.
import { MapDef } from '@crawlout/data';
import { loadProps, type PropInstance } from '@crawlout/map';
import type { PropSourceOptions } from '@crawlout/render';

const DATA_PREFIX = '../../../../data/';
const mapFiles = import.meta.glob('../../../../data/maps/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const SOURCE_DIR = '../../../../assets/src/props/';
const sourceFiles = import.meta.glob('../../../../assets/src/props/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** Source GLB URL per asset id (the file name in lower case, as the asset-cli names it). */
const sourceById = new Map(Object.entries(sourceFiles).map(([path, url]) => [path.slice(SOURCE_DIR.length, -'.glb'.length).toLowerCase(), url]));

/** The props of a map from data/maps, or [] when the map has none. */
export function loadMapProps(mapId: string): PropInstance[] {
  const read = (ref: string): string => {
    const text = mapFiles[`${DATA_PREFIX}${ref}`];
    if (typeof text !== 'string') throw new Error(`mapbestand data/${ref} ontbreekt in de bundel`);
    return text;
  };
  return loadProps(MapDef.parse(JSON.parse(read(`maps/${mapId}.json`))), { read });
}

/** Prop source for renderer.setProps: the renderer's manifest first, the source GLBs for ids it lacks. */
export function propSource(opts: { manifest?: boolean } = {}): PropSourceOptions {
  return { ...(opts.manifest === false ? { manifestUrl: null } : {}), sourceUrl: (id) => sourceById.get(id) };
}
