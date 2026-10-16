// Tiny raster helpers for tools/hud-art/crop.mjs: an RGBA image in memory with the few paint operations the HUD art
// needs (copy a rectangle, fill, hollow out, vertical gradient, mirror, grain). Coordinates and maths only, no art.
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// sharp lives with the asset CLI; resolve it from there so this tool needs no dependency of its own.
export const sharp = createRequire(join(here, '../asset-cli/package.json'))('sharp');

export class Img {
  constructor(w, h, data) {
    this.w = w;
    this.h = h;
    this.data = data ?? new Uint8ClampedArray(w * h * 4);
  }

  static async load(path) {
    const { data, info } = await sharp(path)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return new Img(info.width, info.height, new Uint8ClampedArray(data));
  }

  clone() {
    return new Img(this.w, this.h, new Uint8ClampedArray(this.data));
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x, y) {
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  set(x, y, c) {
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3] ?? 255;
  }

  /** Average colour of a rectangle (alpha ignored). */
  avg(x, y, w, h) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        if (!this.inside(xx, yy)) continue;
        const c = this.get(xx, yy);
        r += c[0];
        g += c[1];
        b += c[2];
        n++;
      }
    return n ? [r / n, g / n, b / n, 255] : [0, 0, 0, 255];
  }

  /** Copy a rectangle of `src` (default: this image as it is now) to (dx, dy). */
  copy(sx, sy, w, h, dx, dy, src = this.clone()) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) this.set(dx + x, dy + y, src.get(sx + x, sy + y));
  }

  /**
   * Fill [x, y, w, h] by tiling a source strip with mirroring, so a short clean stretch of material covers a longer
   * area without a visible seam. `horizontal` tiles along x, otherwise along y.
   */
  mirrorFill(srcX, srcY, srcW, srcH, x, y, w, h, src = this.clone()) {
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const fold = (v, n) => {
          const p = ((v % (2 * n)) + 2 * n) % (2 * n);
          return p < n ? p : 2 * n - 1 - p;
        };
        this.set(x + xx, y + yy, src.get(srcX + fold(xx, srcW), srcY + fold(yy, srcH)));
      }
  }

  /** Stretch a strip of `src` horizontally (linear blend) to fill [x, y, w, h]; rows map one to one. */
  stretchFill(srcX, srcY, srcW, x, y, w, h, src = this.clone()) {
    for (let xx = 0; xx < w; xx++) {
      const fx = srcX + (xx / Math.max(1, w - 1)) * (srcW - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(srcX + srcW - 1, x0 + 1);
      const t = fx - x0;
      for (let yy = 0; yy < h; yy++) {
        const a = src.get(x0, srcY + yy);
        const b = src.get(x1, srcY + yy);
        this.set(x + xx, y + yy, [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t).concat(255));
      }
    }
  }

  fill(x, y, w, h, c) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  /** Vertical gradient between two colours (top to bottom). */
  vgradient(x, y, w, h, top, bottom) {
    for (let yy = 0; yy < h; yy++) {
      const t = h <= 1 ? 0 : yy / (h - 1);
      const c = top.map((v, i) => v + (bottom[i] - v) * t);
      for (let xx = 0; xx < w; xx++) this.set(x + xx, y + yy, [c[0], c[1], c[2], 255]);
    }
  }

  /**
   * Remove lettering from a flat or smoothly shaded area: every column between `x` and `x + w` becomes a straight
   * blend between the pixel `margin` rows above the area and the pixel `margin` rows below it.
   */
  inpaintV(x, y, w, h, smooth = 0) {
    const avgAt = (xx, yy) =>
      smooth > 0 ? this.avg(xx - smooth, yy, smooth * 2 + 1, 1) : this.get(xx, yy);
    for (let xx = x; xx < x + w; xx++) {
      const top = avgAt(xx, y - 1);
      const bottom = avgAt(xx, y + h);
      for (let yy = 0; yy < h; yy++) {
        const t = (yy + 1) / (h + 1);
        this.set(xx, y + yy, [
          top[0] + (bottom[0] - top[0]) * t,
          top[1] + (bottom[1] - top[1]) * t,
          top[2] + (bottom[2] - top[2]) * t,
          255,
        ]);
      }
    }
  }

  /** Make a rectangle fully transparent. */
  hollow(x, y, w, h) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        if (!this.inside(xx, yy)) continue;
        this.data[(yy * this.w + xx) * 4 + 3] = 0;
      }
  }

  /** Make a rectangle with rounded corners transparent. */
  hollowRounded(x, y, w, h, r) {
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const cx = xx < r ? r - xx - 0.5 : xx >= w - r ? xx - (w - r) + 0.5 : 0;
        const cy = yy < r ? r - yy - 0.5 : yy >= h - r ? yy - (h - r) + 0.5 : 0;
        if (cx * cx + cy * cy > r * r) continue;
        if (this.inside(x + xx, y + yy)) this.data[((y + yy) * this.w + x + xx) * 4 + 3] = 0;
      }
  }

  /** Deterministic grain so flat repaints do not look like flat vector fills. */
  grain(x, y, w, h, amount) {
    let s = 1234567;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296 - 0.5;
    };
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        if (!this.inside(xx, yy)) continue;
        const i = (yy * this.w + xx) * 4;
        const d = rnd() * amount;
        this.data[i] += d;
        this.data[i + 1] += d;
        this.data[i + 2] += d;
      }
  }

  extract(x, y, w, h) {
    const out = new Img(w, h);
    out.copy(x, y, w, h, 0, 0, this);
    return out;
  }

  /** PNG buffer, scaled up by `scale` with lanczos and a light sharpen so the soft source holds up. */
  async png(scale = 2, sharpen = 0.6) {
    let p = sharp(Buffer.from(this.data.buffer), {
      raw: { width: this.w, height: this.h, channels: 4 },
    });
    if (scale !== 1)
      p = p.resize(Math.round(this.w * scale), Math.round(this.h * scale), { kernel: 'lanczos3' });
    if (sharpen > 0) p = p.sharpen({ sigma: sharpen });
    return p.png({ compressionLevel: 9 }).toBuffer();
  }
}
