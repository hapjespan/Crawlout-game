import { describe, expect, it } from 'vitest';
import { Texture } from 'three/webgpu';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTerrainTextures, type TerrainTextureIO } from './terrainTextures.js';

const TERRAIN_JSON = readFileSync(
  fileURLToPath(new URL('../../../../assets/dist/terrain/terrain.json', import.meta.url)),
  'utf8',
);

function io(files: Record<string, string>): TerrainTextureIO & { loaded: string[] } {
  const loaded: string[] = [];
  return {
    loaded,
    fetchText: async (url) => {
      const f = files[url];
      if (f === undefined) throw new Error('HTTP 404');
      return f;
    },
    loadTexture: async (url) => {
      if (url.includes('missing')) throw new Error('HTTP 404');
      loaded.push(url);
      return new Texture();
    },
  };
}

describe('loadTerrainTextures', () => {
  it('reads tints and the albedo from terrain.json, resolved through resolveUrl', async () => {
    const files = io({ 'https://a.test/t/terrain.json': TERRAIN_JSON });
    const r = await loadTerrainTextures(
      { manifestUrl: 'https://a.test/t/terrain.json', resolveUrl: (p) => `https://cdn.test/${p}` },
      files,
    );
    expect(r.status).toMatchObject({
      state: 'ready',
      albedo: 'https://cdn.test/rock_terrain_4.albedo.jpg',
      rockTint: '#454340',
      groundTint: '#2b2b2b',
    });
    expect(r.status.attribution).toMatch(/CC-BY-4.0/);
    expect(r.texture).toBeInstanceOf(Texture);
  });

  it('resolves next to terrain.json by default, and explicit values win', async () => {
    const files = io({ 'https://a.test/t/terrain.json': TERRAIN_JSON });
    const r = await loadTerrainTextures(
      { manifestUrl: 'https://a.test/t/terrain.json', rockTint: '#112233' },
      files,
    );
    expect(files.loaded).toEqual(['https://a.test/t/rock_terrain_4.albedo.jpg']);
    expect(r.status.rockTint).toBe('#112233');
    const none = await loadTerrainTextures(
      { manifestUrl: 'https://a.test/t/terrain.json', albedoUrl: null },
      files,
    );
    expect(none.texture).toBeNull();
    expect(none.status.state).toBe('ready');
  });

  it('reports a broken manifest or albedo and keeps what it could read', async () => {
    const bad = await loadTerrainTextures(
      { manifestUrl: 'x.json', albedoUrl: 'missing.jpg' },
      io({ 'x.json': '{"format":"nope"}' }),
    );
    expect(bad.status.state).toBe('failed');
    expect(bad.status.reason).toMatch(/terrain.json/);
    expect(bad.status.reason).toMatch(/albedo missing.jpg/);
    expect(bad.texture).toBeNull();
    expect(bad.status.rockTint).toBe('#454340');
  });
});
