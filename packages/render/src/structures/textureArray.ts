// The diffuse textures of all building assets as one texture array, so one material (and so one instanced draw per
// asset per LOD) serves every building whatever its number of materials. The textures tile (uv outside 0..1), which an
// atlas cannot do without seams; an array layer wraps like a texture of its own. Every layer is resampled to one
// square size (the uv's are normalized, so a 256 x 512 source simply stretches), with mipmaps and repeat wrapping.
// Rows are stored top first, the glTF convention (flipY false), the same orientation GLTFLoader gives a building's map.
import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three/webgpu';
import type { TextureLayer } from './buildingGeometry.js';

/** Draws an image into size x size RGBA8 pixels, row 0 at the top; null when it cannot (no image, no canvas). */
export type Rasterize = (image: unknown, size: number) => Uint8Array | null;

/** Layer edge used when the layers' own images are bigger, and the cap for the texture array. */
export const DEFAULT_LAYER_SIZE = 512;

/** Rasterizes with an OffscreenCanvas (or a DOM canvas), the browser path. */
export const canvasRasterize: Rasterize = (image, size) => {
  if (!image) return null;
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  if (typeof OffscreenCanvas !== 'undefined')
    ctx = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
  else if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) return null;
  try {
    ctx.drawImage(image as CanvasImageSource, 0, 0, size, size);
    return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
  } catch {
    return null;
  }
};

/** Smallest power of two at or above n. */
function pow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Edge of the array layers: the largest source edge, rounded up to a power of two, at most `max`. */
export function layerSize(layers: readonly TextureLayer[], max = DEFAULT_LAYER_SIZE): number {
  let edge = 1;
  for (const l of layers) edge = Math.max(edge, l.width, l.height);
  let cap = 1;
  while (cap * 2 <= max) cap *= 2;
  return Math.min(pow2(edge), cap);
}

/**
 * The texture array for `layers` (one layer per entry, in order). A layer whose image cannot be rasterized is white,
 * so its material shows its flat base color.
 */
export function createLayerTexture(
  layers: readonly TextureLayer[],
  rasterize: Rasterize = canvasRasterize,
  maxSize = DEFAULT_LAYER_SIZE,
): { texture: DataArrayTexture; size: number; missing: string[] } {
  const size = layerSize(layers, maxSize);
  const depth = Math.max(1, layers.length);
  const bytes = size * size * 4;
  const data = new Uint8Array(bytes * depth).fill(255);
  const missing: string[] = [];
  layers.forEach((layer, i) => {
    const px = rasterize(layer.image, size);
    if (px && px.length === bytes) data.set(px, i * bytes);
    else missing.push(layer.key);
  });
  const texture = new DataArrayTexture(data, size, size, depth);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.flipY = false;
  texture.name = 'crawlout-building-layers';
  texture.needsUpdate = true;
  return { texture, size, missing };
}
