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

/**
 * Cap on the layer edge. The layers take the largest source edge up to this (the asset-cli exports 512 now, so the
 * array stays at 512); 1024 lets sharper building textures through without a code change.
 */
export const DEFAULT_LAYER_SIZE = 1024;

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

/** An sRGB byte as linear 0..1. */
export function srgbByteToLinear(b: number): number {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear luminance (Rec. 709) of the sRGB RGBA8 texel at byte offset i. */
export function texelLuminance(px: Uint8Array, i: number): number {
  return (
    0.2126 * srgbByteToLinear(px[i]!) +
    0.7152 * srgbByteToLinear(px[i + 1]!) +
    0.0722 * srgbByteToLinear(px[i + 2]!)
  );
}

/** Mean linear luminance of sRGB RGBA8 pixels (every 7th texel is plenty for a mean). */
export function meanLuma(px: Uint8Array): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 28) {
    sum += texelLuminance(px, i);
    n++;
  }
  return n > 0 ? sum / n : 1;
}

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
): { texture: DataArrayTexture; size: number; missing: string[]; luma: number[] } {
  const size = layerSize(layers, maxSize);
  const depth = Math.max(1, layers.length);
  const bytes = size * size * 4;
  const data = new Uint8Array(bytes * depth).fill(255);
  const missing: string[] = [];
  const luma: number[] = [];
  layers.forEach((layer, i) => {
    const px = rasterize(layer.image, size);
    if (px && px.length === bytes) {
      data.set(px, i * bytes);
      luma.push(meanLuma(px));
    } else {
      missing.push(layer.key);
      luma.push(1); // white
    }
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
  return { texture, size, missing, luma };
}
