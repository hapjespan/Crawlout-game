// Bestandsformaat voor bitmap- en heightmap-bestanden in data/maps/: JSON met run-length-encoding.
// { "format": "crawlout-grid/1", "w": 128, "h": 128, "type": "u8" | "i16", "rle": [waarde, aantal, waarde, aantal, ...] }
// Cellen staan rij voor rij (index = y * w + x). Geen afbeeldingsbibliotheek nodig, wel diffbaar in git.
export const GRID_FORMAT = 'crawlout-grid/1';

export type GridType = 'u8' | 'i16';

export interface GridFile {
  format: typeof GRID_FORMAT;
  w: number;
  h: number;
  type: GridType;
  rle: number[];
}

export function encodeGrid(w: number, h: number, type: GridType, cells: ArrayLike<number>): string {
  if (cells.length !== w * h) throw new Error(`grid: ${cells.length} cellen, verwacht ${w * h}`);
  const rle: number[] = [];
  let i = 0;
  while (i < cells.length) {
    const value = cells[i] as number;
    let n = 1;
    while (i + n < cells.length && cells[i + n] === value) n++;
    rle.push(value, n);
    i += n;
  }
  const file: GridFile = { format: GRID_FORMAT, w, h, type, rle };
  return JSON.stringify(file);
}

function parseGridFile(text: string): GridFile {
  const raw: unknown = JSON.parse(text);
  const f = raw as Partial<GridFile> | null;
  if (!f || f.format !== GRID_FORMAT) throw new Error(`grid: onbekend formaat (verwacht ${GRID_FORMAT})`);
  if (!Number.isInteger(f.w) || !Number.isInteger(f.h) || (f.w as number) <= 0 || (f.h as number) <= 0) throw new Error('grid: ongeldige afmetingen');
  if (f.type !== 'u8' && f.type !== 'i16') throw new Error('grid: ongeldig type');
  if (!Array.isArray(f.rle) || (f.rle.length & 1) !== 0) throw new Error('grid: ongeldige rle');
  return f as GridFile;
}

export function decodeGrid(text: string, expectW: number, expectH: number, expectType: GridType): Int16Array | Uint8Array {
  const f = parseGridFile(text);
  if (f.w !== expectW || f.h !== expectH) throw new Error(`grid: ${f.w}x${f.h} past niet bij mapgrootte ${expectW}x${expectH}`);
  if (f.type !== expectType) throw new Error(`grid: type ${f.type}, verwacht ${expectType}`);
  const total = f.w * f.h;
  const out = expectType === 'u8' ? new Uint8Array(total) : new Int16Array(total);
  const lo = expectType === 'u8' ? 0 : -32768;
  const hi = expectType === 'u8' ? 255 : 32767;
  let pos = 0;
  for (let k = 0; k < f.rle.length; k += 2) {
    const value = f.rle[k] as number;
    const n = f.rle[k + 1] as number;
    if (!Number.isInteger(value) || value < lo || value > hi) throw new Error('grid: waarde buiten bereik');
    if (!Number.isInteger(n) || n <= 0 || pos + n > total) throw new Error('grid: ongeldige runlengte');
    out.fill(value, pos, pos + n);
    pos += n;
  }
  if (pos !== total) throw new Error('grid: rle dekt niet alle cellen');
  return out;
}
