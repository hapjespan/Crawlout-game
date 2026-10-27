// Shared fixtures of the building tests (buildings.test.ts and buildings.config.test.ts).
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVariantsConfig } from '../src/buildings.js';
import type { VariantsConfig } from '../src/variants.js';
import { readDataList } from './dataLists.js';

export const srcDir = fileURLToPath(new URL('../../../assets/src/', import.meta.url));
export const variantsPath = join(srcDir, 'buildings', 'variants.json');
export const buildingsJson = readDataList('buildings') as {
  id: string;
  footprint: { w: number; h: number };
  visuals: { mesh: string };
}[];

export const config = loadVariantsConfig(variantsPath);
export const ids = Object.keys(config.variants).sort();

export function deepCopy(value: VariantsConfig): VariantsConfig {
  return JSON.parse(JSON.stringify(value)) as VariantsConfig;
}
