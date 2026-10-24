// The diffuse textures of all building assets as one texture array, so one material (and so one instanced draw per
// asset per LOD) serves every building whatever its number of materials. The textures tile (uv outside 0..1), which an
// atlas cannot do without seams; an array layer wraps like a texture of its own. Every layer is resampled to one
// square size (the uv's are normalized, so a 256 x 512 source simply stretches), with mipmaps and repeat wrapping.
// Rows are stored top first, the glTF convention (flipY false), the same orientation GLTFLoader gives a building's map.
import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three/webgpu';
import { layerImage, type LayerMapKind, type TextureLayer } from './buildingGeometry.js';

/** Draws an image into size x size RGBA8 pixels, row 0 at the top; null when it cannot (no image, no canvas). */
export type Rasterize = (image: unknown, size: number) => Uint8Array | null;

/**
 * Cap on the layer edge. The layers take the largest source edge up to this (the asset-cli exports 512 now, so the
 * array stays at 512); 1024 lets sharper building textures through without a code change.
 */
export const DEFAULT_LAYER_SIZE = 1024;

/**
 * Rasterizes with an OffscreenCanvas (or a DOM canvas), the browser path.
 *
 * Careful: a 2D canvas stores its pixels premultiplied, so the rgb of a texel with a low alpha does not survive the
 * round trip and a texel with alpha 0 comes back black. That is fine for an opaque texture and for statistics, but
 * not for a diffuse map whose alpha carries the team mask (artist brief: 1 is team colour, so most of the map sits at
 * alpha 0 and would turn black). Use imageRasterize for anything that reaches the screen.
 */
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

/** The shared WebGL2 context of glRasterize; made on first use, null when the browser has none. */
let glScratch: WebGL2RenderingContext | null | undefined;

function scratchGl(): WebGL2RenderingContext | null {
  if (glScratch !== undefined) return glScratch;
  glScratch = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined')
      glScratch = new OffscreenCanvas(1, 1).getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null;
    else if (typeof document !== 'undefined')
      glScratch = document
        .createElement('canvas')
        .getContext('webgl2', { alpha: true, premultipliedAlpha: false });
  } catch {
    glScratch = null;
  }
  return glScratch;
}

function imageSizeOf(image: unknown): [number, number] {
  const i = image as { width?: unknown; height?: unknown } | null;
  const w = typeof i?.width === 'number' ? i.width : 0;
  const h = typeof i?.height === 'number' ? i.height : 0;
  return [w, h];
}

/**
 * Rasterizes through WebGL2: the image goes into a texture with UNPACK_PREMULTIPLY_ALPHA off, is blitted to a
 * size x size renderbuffer and read back. Unlike the 2D canvas this keeps the rgb under a transparent texel, which is
 * what a diffuse map with a team mask in its alpha needs. Null when there is no WebGL2 or the upload fails.
 */
export const glRasterize: Rasterize = (image, size) => {
  const gl = scratchGl();
  if (!gl || !image) return null;
  const [w, h] = imageSizeOf(image);
  if (w <= 0 || h <= 0) return null;
  const src = gl.createTexture();
  const read = gl.createFramebuffer();
  const draw = gl.createFramebuffer();
  const target = gl.createRenderbuffer();
  try {
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.bindTexture(gl.TEXTURE_2D, src);
    // Sized internal format: a framebuffer attachment must be colour-renderable, which unsized RGBA is not in WebGL2.
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      w,
      h,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image as TexImageSource,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src, 0);
    if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    gl.bindRenderbuffer(gl.RENDERBUFFER, target);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, size, size);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, target);
    if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    // Row 0 of the source is the top (glTF convention); the blit keeps that order.
    gl.blitFramebuffer(
      0,
      0,
      w,
      h,
      0,
      0,
      size,
      size,
      gl.COLOR_BUFFER_BIT,
      w === size && h === size ? gl.NEAREST : gl.LINEAR,
    );
    const out = new Uint8Array(size * size * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, draw);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  } catch {
    return null;
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.deleteFramebuffer(read);
    gl.deleteFramebuffer(draw);
    gl.deleteRenderbuffer(target);
    gl.deleteTexture(src);
  }
};

/** WebGL2 (alpha exact) with the 2D canvas as the fallback: the default for anything that ends up on screen. */
export const imageRasterize: Rasterize = (image, size) =>
  glRasterize(image, size) ?? canvasRasterize(image, size);

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

/** Hardest cap on a layer edge, whatever the budget allows: the asset-cli never exports more (BUDGETS.maxTextureSize). */
export const MAX_LAYER_SIZE = 2048;

/** Floor under the budgeted edge: below this a character's face falls apart at the closest zoom. */
export const MIN_LAYER_SIZE = 256;

/**
 * Bytes one map kind of one character asset may take on the GPU; see budgetedLayerSize. 32 MB lets one atlas layer
 * have the full 2048 (16.8 MB) and holds an un-atlased 23-material model at 512 (24.1 MB) instead of 1024 (96 MB).
 */
export const UNIT_LAYER_BUDGET_BYTES = 32 * 1024 * 1024;

/**
 * Edge for an asset's own array given how many layers it has, under a byte budget per map kind.
 *
 * An array costs `count * edge^2 * 4` bytes of VRAM and an asset carries three of them (base, normal,
 * metallicRoughness), so a flat 1024 per layer is a blank cheque: the Klerk's 23 materials came to 96 MB per map kind
 * and ~276 MB for one unit type. The budget turns the layer count into the edge instead. One merged atlas layer
 * therefore gets the full 2048 and a model that never got an atlas lands on 512 rather than ruining the frame.
 */
export function budgetedLayerSize(
  count: number,
  budgetBytes = UNIT_LAYER_BUDGET_BYTES,
  max = MAX_LAYER_SIZE,
): number {
  let edge = max;
  while (edge > MIN_LAYER_SIZE && Math.max(1, count) * edge * edge * 4 > budgetBytes) edge /= 2;
  return edge;
}

/**
 * Fill of a layer whose map of this kind is missing. Base colour: white, so the material shows its flat base color.
 * Normal: (0.5, 0.5, 1) tangent space, i.e. no relief. MetallicRoughness: the material's own roughnessFactor in G and
 * metallicFactor in B (glTF channel order), so a material without the map still answers with its own response.
 */
function fallbackTexel(layer: TextureLayer, kind: LayerMapKind): [number, number, number, number] {
  if (kind === 'normal') return [128, 128, 255, 255];
  if (kind === 'mr') {
    // glTF's default metallicFactor is 1, and GLTFLoader cannot tell a declared 1 from the default. A material with
    // no metallicRoughness map that lands on exactly 1 is therefore read as "the exporter said nothing", not as
    // "bare metal": a fully metallic surface has no diffuse at all and a whole part would go black. Bare metal in
    // this pipeline comes with a map.
    const metal = (layer.metalness ?? 1) >= 1 ? 0 : layer.metalness!;
    return [
      255,
      Math.round(Math.min(1, Math.max(0, layer.roughness ?? 1)) * 255),
      Math.round(Math.min(1, Math.max(0, metal)) * 255),
      255,
    ];
  }
  return [255, 255, 255, 255];
}

/**
 * The texture array for `layers` (one layer per entry, in order). A layer whose image cannot be rasterized gets
 * fallbackTexel of its kind.
 *
 * `kind` picks which of the material's maps the array holds. All three arrays of one asset are indexed by the same
 * layer number (the asset-cli gives a primitive's normal and metallicRoughness map the same uv set and the same
 * dimensions as its base colour), so the geometry's uvl.z addresses all of them.
 *
 * Colour space: base colour is sRGB, normal and metallicRoughness are linear data. Marking a normal map sRGB bends
 * every vector towards the +z pole and looks worse than no normal map at all.
 */
export function createLayerTexture(
  layers: readonly TextureLayer[],
  rasterize: Rasterize = canvasRasterize,
  maxSize = DEFAULT_LAYER_SIZE,
  kind: LayerMapKind = 'base',
): { texture: DataArrayTexture; size: number; missing: string[]; luma: number[] } {
  const size = layerSize(layers, maxSize);
  const depth = Math.max(1, layers.length);
  const bytes = size * size * 4;
  const data = new Uint8Array(bytes * depth);
  const missing: string[] = [];
  const luma: number[] = [];
  layers.forEach((layer, i) => {
    const image = layerImage(layer, kind);
    const px = image ? rasterize(image, size) : null;
    if (px && px.length === bytes) {
      // glTF multiplies the metallicRoughness texture by roughnessFactor and metallicFactor; baking them in here
      // keeps the shader to one sample and no per-layer uniform. Without it the Klerk's coat reads as a conductor:
      // its map has B = 1 all over and only metallicFactor 0 says it is leather.
      if (kind === 'mr') {
        const r = Math.min(1, Math.max(0, layer.roughness ?? 1));
        const m = Math.min(1, Math.max(0, layer.metalness ?? 1));
        for (let p = 0; p < px.length; p += 4) {
          px[p + 1] = Math.round(px[p + 1]! * r);
          px[p + 2] = Math.round(px[p + 2]! * m);
        }
      }
      data.set(px, i * bytes);
      luma.push(meanLuma(px));
      return;
    }
    // A material that simply has no map of this kind is not "missing": only a base colour that failed to read is.
    if (kind === 'base' || image) missing.push(layer.key);
    luma.push(1);
    const [r, g, b, a] = fallbackTexel(layer, kind);
    for (let p = i * bytes; p < (i + 1) * bytes; p += 4) {
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = a;
    }
  });
  const texture = new DataArrayTexture(data, size, size, depth);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = kind === 'base' ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.flipY = false;
  texture.name = `crawlout-building-layers-${kind}`;
  texture.needsUpdate = true;
  return { texture, size, missing, luma };
}
