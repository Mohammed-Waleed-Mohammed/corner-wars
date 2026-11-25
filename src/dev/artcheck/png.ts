// A strict, dependency-free PNG decoder for the art checker (Node only). It validates the
// signature, every chunk's CRC, the IHDR fields and the chunk order, inflates IDAT and undoes the
// filters (Adam7 too), and returns 8-bit RGBA pixels. Anything malformed throws with the reason.

import { inflateSync } from "node:zlib";
import type { DecodedPng } from "../../artlab/verify";

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
// Adam7 passes: x start, y start, x step, y step.
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Uint8Array): DecodedPng {
  if (file.length < 8 || SIG.some((v, i) => file[i] !== v)) throw new Error("not a PNG (bad signature)");
  let pos = 8, width = 0, height = 0, depth = 0, ctype = -1, interlace = 0, sawEnd = false;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  const seen: string[] = [];
  while (pos < file.length) {
    if (pos + 12 > file.length) throw new Error("truncated chunk header");
    const len = u32(file, pos), type = String.fromCharCode(file[pos + 4], file[pos + 5], file[pos + 6], file[pos + 7]);
    const start = pos + 8, end = start + len;
    if (end + 4 > file.length) throw new Error(`truncated ${type} chunk`);
    if (crc32(file, pos + 4, end) !== u32(file, end)) throw new Error(`bad CRC in the ${type} chunk (the file is corrupt)`);
    const data = file.subarray(start, end);
    if (seen.length === 0 && type !== "IHDR") throw new Error("first chunk is not IHDR");
    seen.push(type);
    if (type === "IHDR") {
      if (len !== 13) throw new Error("bad IHDR length");
      width = u32(data, 0); height = u32(data, 4); depth = data[8]; ctype = data[9]; interlace = data[12];
      if (!width || !height) throw new Error("zero width or height");
      if (!(ctype in CHANNELS) || !DEPTHS[ctype].includes(depth)) throw new Error(`invalid colour type ${ctype} / bit depth ${depth}`);
      if (data[10] !== 0 || data[11] !== 0 || interlace > 1) throw new Error("unknown compression, filter or interlace method");
    } else if (type === "PLTE") {
      if (len % 3 || len === 0 || len / 3 > 256) throw new Error("bad PLTE length");
      palette = data;
    } else if (type === "tRNS") {
      trns = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    } else if (!(file[pos + 4] & 0x20)) {
      throw new Error(`unknown critical chunk ${type}`);
    }
    pos = end + 4;
  }
  if (!sawEnd) throw new Error("no IEND chunk (the file is truncated)");
  if (!idat.length) throw new Error("no image data (IDAT)");
  if (ctype === 3 && !palette) throw new Error("palette image without a PLTE chunk");

  let raw: Uint8Array;
  try {
    const total = idat.reduce((n, c) => n + c.length, 0), z = new Uint8Array(total);
    let o = 0;
    for (const c of idat) { z.set(c, o); o += c.length; }
    raw = inflateSync(z);
  } catch (e) {
    throw new Error(`image data does not inflate: ${e instanceof Error ? e.message : String(e)}`);
  }

  const ch = CHANNELS[ctype], bitsPP = ch * depth, bpp = Math.max(1, bitsPP >> 3);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const maxV = (1 << depth) - 1;
  const sample = (row: Uint8Array, x: number, c: number): number => {
    if (depth === 8) return row[x * ch + c];
    if (depth === 16) { const i = (x * ch + c) * 2; return (row[i] << 8) | row[i + 1]; }
    const bit = (x * ch + c) * depth;
    return (row[bit >> 3] >> (8 - depth - (bit & 7))) & maxV;
  };
  const to8 = (v: number): number => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / maxV));
  const key = trns && (ctype === 0 || ctype === 2)
    ? (ctype === 0 ? [(trns[0] << 8) | trns[1]] : [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]])
    : null;

  let off = 0;
  const passes = interlace ? ADAM7 : [[0, 0, 1, 1]];
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const rowBytes = Math.ceil((pw * bitsPP) / 8);
    let prev = new Uint8Array(rowBytes), cur = new Uint8Array(rowBytes);
    for (let y = 0; y < ph; y++) {
      if (off + 1 + rowBytes > raw.length) throw new Error("image data is shorter than the image (truncated)");
      const f = raw[off++];
      for (let i = 0; i < rowBytes; i++) {
        const x = raw[off + i], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        switch (f) {
          case 0: cur[i] = x; break;
          case 1: cur[i] = (x + a) & 0xff; break;
          case 2: cur[i] = (x + b) & 0xff; break;
          case 3: cur[i] = (x + ((a + b) >> 1)) & 0xff; break;
          case 4: cur[i] = (x + paeth(a, b, c)) & 0xff; break;
          default: throw new Error(`bad row filter ${f}`);
        }
      }
      off += rowBytes;
      const py = y0 + y * dy;
      for (let x = 0; x < pw; x++) {
        const o = ((py * width) + x0 + x * dx) * 4;
        if (ctype === 3) {
          const idx = sample(cur, x, 0);
          if (idx * 3 + 2 >= palette!.length) throw new Error(`palette index ${idx} out of range`);
          rgba[o] = palette![idx * 3]; rgba[o + 1] = palette![idx * 3 + 1]; rgba[o + 2] = palette![idx * 3 + 2];
          rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
        } else if (ctype === 0 || ctype === 4) {
          const g = sample(cur, x, 0), v = to8(g);
          rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
          rgba[o + 3] = ctype === 4 ? to8(sample(cur, x, 1)) : key && g === key[0] ? 0 : 255;
        } else {
          const r = sample(cur, x, 0), g = sample(cur, x, 1), b = sample(cur, x, 2);
          rgba[o] = to8(r); rgba[o + 1] = to8(g); rgba[o + 2] = to8(b);
          rgba[o + 3] = ctype === 6 ? to8(sample(cur, x, 3)) : key && r === key[0] && g === key[1] && b === key[2] ? 0 : 255;
        }
      }
      [prev, cur] = [cur, prev];
    }
  }
  return {
    bytes: file.length, width, height, bitDepth: depth, colorType: ctype, interlaced: interlace === 1,
    alphaChannel: ctype === 4 || ctype === 6 || trns !== null,
    img: { width, height, data: rgba as Uint8ClampedArray<ArrayBuffer> },
  };
}
