// Terrain material (TSL): the albedo of terrain.json as the real color of the ground, toon-ramp light. No PBR.
// Built for readability at RTS distance: the photo color is lifted to a fixed mean brightness, a little desaturated
// and warmed towards the wasteland palette, so units (team color plus rim) and buildings (real shadow) still stand
// out against it.
//
//   albedo  = the albedo of terrain.json (Rock Terrain 4 seen from above, aligned with its heightfield), sampled with
//             its own uv per world point through the map's layout (albedoLayout.ts): the tile, its orientation, the
//             point-mirrored middle tile with its blended seam and the blended tile borders, exactly as packages/map
//             built the heights. So rock lies on the cliffs and gravel in the gullies the heights came from. Up to
//             four tiles near a corner and two samples on a mirror seam, only where their weight is not zero
//             (branches; explicit gradients from the unfolded tile coordinates, so the mip level stays right).
//   style   = times ALBEDO_TARGET_LUMA / the albedo's mean luminance (rockTint), its contrast to ALBEDO_CONTRAST,
//             ALBEDO_DESATURATE towards grey,
//             ALBEDO_WARMTH; the map's vertex colors a little (ruins), lowland slightly warmer, plateau cooler.
//   cliffs  = the top view smears down a steep wall: there a triplanar sample of the same albedo (world space, 13 m)
//             adds its brightness variation along the wall.
//   grain   = a fine rotated sample (7.7 m) adds texture near the camera (fades out from 25 to 90 m), where the
//             albedo (16 px per meter at 2048) is magnified.
//   detail  = a generated tiling texture (detailTexture.ts) sampled at two scales near the camera: grit, pebbles and cracks
//             as brightness and as a bent shading normal (smooth light delta, no extra banding), fading out with
//             distance; rock on steep slopes (stronger relief, cooler), dust on the flat (warmer, softer); at tens of
//             meters a macro variation of brightness and hue keeps large flat areas from being one colour. Off with
//             `detailLayer: false` (the cheaper ?detail=1 path).
//   beyond the map (the skirt, terrainSkirt.ts): the albedo mirrors there, which reads as a kaleidoscope. The sample
//             position is domain-warped by smooth value noise that grows from zero at the edge (no seam), the photo's
//             contrast fades towards a generic dust colour with the distance, and a macro brightness/hue noise
//             breaks up what mirroring and warping leave (outsideMeters, EDGE_*).
//   no texture: the tints of terrain.json on fixed brightness, rock from about 30 degrees slope (the former look).
//   light   = the shared light rig (unitMaterial.ts toonLight: hemisphere fill in the dark band, warm direct sun on
//             top, the toon ramp's soft band edges, as terrain normals vary smoothly and hard steps would shimmer),
//             the sun's shadow taking the direct part away, times the sky occlusion of the refined grid.

export {
  ROCK_LUMA,
  GROUND_LUMA,
  ALBEDO_TARGET_LUMA,
  ALBEDO_CONTRAST,
  ALBEDO_DESATURATE,
  GRASS_TINT,
  GRASS_TINT_STRENGTH,
  DETAIL_FINE_TILE,
  DETAIL_COARSE_TILE,
  DETAIL_FINE_FADE,
  DETAIL_COARSE_FADE,
  EDGE_WARP_RAMP,
  EDGE_WARP_AMPLITUDE,
  EDGE_WARP_WAVELENGTH,
  EDGE_DUST_FADE,
  EDGE_DUST_SHARE,
  DEFAULT_ALBEDO_TILE,
  DEFAULT_ROCK_TINT,
  DEFAULT_GROUND_TINT,
  normalizeTint,
} from './terrainMaterial.part1.js';
export type { TerrainMaterialOptions, TerrainMaterialBundle } from './terrainMaterial.part1.js';
export { createTerrainMaterial } from './terrainMaterial.part2.js';
