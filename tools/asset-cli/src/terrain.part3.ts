// Split from terrain.ts to stay under the 5,000-token file limit; terrain.ts re-exports the public surface.
// Holds: buildTerrain.
import {
  heightfieldSchema,
  type TerrainManifest,
  terrainManifestSchema,
  TERRAIN_MANIFEST_FORMAT,
} from './heightfield.js';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FLOATER_DEFAULTS,
  chooseCrop,
  formatHeightfield,
  readTerrainMesh,
  removeFloaters,
  rotateMeshY,
} from './terrain.part2.js';
import type { BuildTerrainOptions, BuildTerrainResult } from './terrain.part2.js';
import {
  bakeAlbedo,
  heightfieldFromSurface,
  hexOfLinear,
  rasterizeTopSurface,
  texturedOnly,
} from './terrain.part1.js';

export async function buildTerrain(options: BuildTerrainOptions): Promise<BuildTerrainResult> {
  const cells = options.cells ?? 128;
  const metersPerCell = options.metersPerCell ?? 1;
  const sub = options.sub ?? 8;
  const raw = await readTerrainMesh(options.source);
  const groundMaterial = raw.materials?.find((m) => !m.texture) ?? {
    factor: [0.05, 0.05, 0.05] as [number, number, number],
  };

  const surfaceMesh = texturedOnly(raw);
  const cleaned = removeFloaters(surfaceMesh, FLOATER_DEFAULTS);
  const crop = chooseCrop(
    cleaned.mesh,
    {
      sizeM: options.cropSizeM ?? 64,
      rotationsDeg: options.rotationsDeg ?? Array.from({ length: 90 }, (_, i) => i),
      minCoverage: 0.99,
    },
    surfaceMesh,
  );
  const mesh = rotateMeshY(cleaned.mesh, crop.rotationDeg);

  const surface = rasterizeTopSurface(mesh, {
    minX: crop.minX,
    minZ: crop.minZ,
    sizeM: crop.sizeM,
    resolution: cells * sub,
  });
  const { field, scale, heightOffsetM, filledCells } = heightfieldFromSurface(surface, {
    cells,
    metersPerCell,
  });
  heightfieldSchema.parse(field);

  // Het albedo op een eigen raster als de gevraagde maat afwijkt; het hoogteveld blijft op het grove raster.
  const albedoSize = options.albedoSize ?? surface.resolution;
  if (!Number.isInteger(albedoSize) || albedoSize < 16 || albedoSize > 8192)
    throw new Error(`albedoSize ${albedoSize}: verwacht een geheel getal van 16 tot 8192`);
  const albedoSurface =
    albedoSize === surface.resolution
      ? surface
      : rasterizeTopSurface(mesh, {
          minX: crop.minX,
          minZ: crop.minZ,
          sizeM: crop.sizeM,
          resolution: albedoSize,
        });
  const albedo = bakeAlbedo(mesh, albedoSurface);
  const albedoBytes = await sharp(albedo.rgb, {
    raw: { width: albedoSize, height: albedoSize, channels: 3 },
  })
    .jpeg({ quality: options.jpegQuality ?? 85, chromaSubsampling: '4:4:4', mozjpeg: false })
    .toBuffer();

  const heightPath = `${options.id}.height.json`;
  const albedoPath = `${options.id}.albedo.jpg`;
  const manifest: TerrainManifest = terrainManifestSchema.parse({
    format: TERRAIN_MANIFEST_FORMAT,
    id: options.id,
    attribution: options.attribution,
    heightfield: {
      path: heightPath,
      w: field.w,
      h: field.h,
      metersPerCell,
      minM: field.minM,
      maxM: field.maxM,
    },
    albedo: { path: albedoPath, width: albedoSize, height: albedoSize, mime: 'image/jpeg' },
    rockTint: hexOfLinear(albedo.meanLinear),
    groundTint: hexOfLinear(groundMaterial.factor),
    crop: {
      rotationDeg: crop.rotationDeg,
      minX: crop.minX,
      minZ: crop.minZ,
      sizeM: crop.sizeM,
      scale: Math.round(scale * 1e6) / 1e6,
      heightOffsetM: Math.round(heightOffsetM * 1e4) / 1e4,
    },
  });

  mkdirSync(options.outDir, { recursive: true });
  const outputs: [string, Uint8Array | string][] = [
    [heightPath, formatHeightfield(field)],
    [albedoPath, albedoBytes],
    ['terrain.json', JSON.stringify(manifest, null, 2) + '\n'],
  ];
  const files = outputs.map(([name, data]) => {
    writeFileSync(join(options.outDir, name), data);
    return {
      path: name,
      bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength,
    };
  });
  return {
    manifest,
    crop,
    field,
    filledCells,
    removedTriangles: cleaned.removedTriangles,
    coveredFraction: albedo.coveredFraction,
    files,
  };
}
