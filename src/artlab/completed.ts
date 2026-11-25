// 29 §H — the completed list: assets that were checked (src/artlab/verify.ts) and tagged done, so
// the Art Lab hides them. The list lives in the repo as src/artlab/completed.json. It is written by
// `npm run art -- mark` and read by the Art Lab. Each entry pins the file's SHA-256, so a file that
// changes after it was verified counts as not done again. DOM-free (shared by the page and the CLI).

import { ASSETS } from "./catalog";

export const COMPLETED_FILE = "src/artlab/completed.json";

export interface CompletedEntry {
  file: string; // repo path of the verified file
  sha256: string; // hex digest of the file as verified
  width: number; height: number; bytes: number;
  verified: string; // ISO date (YYYY-MM-DD)
}
export interface CompletedList { assets: Record<string, CompletedEntry> }

const ABOUT = "Art Lab completed list (description/29 §H). Written by `npm run art -- mark <id>` after the file passes verification; remove an entry with `npm run art -- unmark <id>`.";

const isEntry = (e: unknown): e is CompletedEntry => {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  return typeof x.file === "string" && typeof x.sha256 === "string" && /^[0-9a-f]{64}$/.test(x.sha256)
    && typeof x.width === "number" && typeof x.height === "number" && typeof x.bytes === "number" && typeof x.verified === "string";
};

/** Parse the JSON file's contents. Malformed entries are dropped, never thrown on: the lab must still open. */
export function parseCompleted(raw: unknown): CompletedList {
  const out: CompletedList = { assets: {} };
  const assets = raw && typeof raw === "object" ? (raw as { assets?: unknown }).assets : undefined;
  if (!assets || typeof assets !== "object") return out;
  for (const [id, e] of Object.entries(assets as Record<string, unknown>)) if (isEntry(e)) out.assets[id] = e;
  return out;
}

const ORDER = new Map(ASSETS.map((a, i) => [a.id, i]));

/** Stable JSON: entries in generation order (29 §B), unknown ids last, one trailing newline. */
export function serializeCompleted(l: CompletedList): string {
  const ids = Object.keys(l.assets).sort((p, q) => (ORDER.get(p) ?? Infinity) - (ORDER.get(q) ?? Infinity) || p.localeCompare(q));
  const assets: Record<string, CompletedEntry> = {};
  for (const id of ids) {
    const e = l.assets[id];
    assets[id] = { file: e.file, sha256: e.sha256, width: e.width, height: e.height, bytes: e.bytes, verified: e.verified };
  }
  return `${JSON.stringify({ about: ABOUT, assets }, null, 2)}\n`;
}
