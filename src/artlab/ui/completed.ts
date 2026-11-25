// Art Lab — the completed list (29 §H) as the page sees it. src/artlab/completed.json is imported
// through an eager glob, so a missing file means "nothing completed" and `npm run art -- mark`
// rewriting it reloads the open page. Each entry is re-hashed against the file the game loads: a
// file replaced after it was verified shows up again as CHANGED instead of staying hidden.

import { parseCompleted } from "../completed";
import type { CompletedEntry } from "../completed";
import { assetById } from "../catalog";
import type { Asset } from "../catalog";
import { el } from "./dom";
import { persisted } from "./state";
import { realUrl } from "./sources";

const RAW = import.meta.glob("../completed.json", { eager: true, import: "default" }) as Record<string, unknown>;
const LIST = parseCompleted(Object.values(RAW)[0]);

/** done: verified and unchanged · changed: the file differs from the verified one · missing: no file any more. */
export type CompletedState = "done" | "changed" | "missing";

const hashState = new Map<string, "ok" | "changed">(); // filled by checkCompletedFiles(); absent = not hashed yet

export function completedEntry(a: Asset): CompletedEntry | undefined { return LIST.assets[a.id]; }

export function completedState(a: Asset): CompletedState | null {
  if (!LIST.assets[a.id]) return null;
  if (!realUrl(a)) return "missing";
  return hashState.get(a.id) === "changed" ? "changed" : "done";
}

export const isDone = (a: Asset): boolean => completedState(a) === "done";
/** Hidden from the catalog: done, and the "Show completed" toggle is off. */
export const isHidden = (a: Asset): boolean => !persisted.showCompleted && isDone(a);

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash every completed asset's current file and compare it with the verified digest. Calls
 * `changed` once at the end if any entry turned out to differ. A file that can't be fetched or
 * hashed (no crypto.subtle off localhost) keeps its entry as done: the CLI check is the authority.
 */
export async function checkCompletedFiles(changed: () => void): Promise<void> {
  if (!globalThis.crypto?.subtle) return;
  let any = false;
  await Promise.all(Object.entries(LIST.assets).map(async ([id, e]) => {
    const a = assetById(id), url = a ? realUrl(a) : null;
    if (!url) return;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const ok = (await sha256Hex(await res.arrayBuffer())) === e.sha256;
      hashState.set(id, ok ? "ok" : "changed");
      if (!ok) any = true;
    } catch { /* offline / blocked: leave it as done */ }
  }));
  if (any) changed();
}

/** Counts for the header and the catalog summary. */
export function completedCounts(all: readonly Asset[]): { done: number; changed: number } {
  let done = 0, changed = 0;
  for (const a of all) {
    const s = completedState(a);
    if (s === "done") done++; else if (s === "changed" || s === "missing") changed++;
  }
  return { done, changed };
}

/** The centre-column banner for a completed asset (null when it isn't on the list). */
export function completedNotice(a: Asset): HTMLElement | null {
  const e = LIST.assets[a.id], s = completedState(a);
  if (!e || !s) return null;
  if (s === "done") return el("div.notice.done", {}, el("strong", {}, "Completed. "),
    `Verified on ${e.verified}: ${e.width}×${e.height} PNG at ${e.file}. It's hidden from the catalog unless "Show completed" is on.`);
  if (s === "changed") return el("div.notice.warn", {}, el("strong", {}, "Changed since it was verified. "),
    `The file no longer matches the one verified on ${e.verified}, so it counts as not done. Run `, el("code", {}, `npm run art -- mark ${a.id}`), " to verify it again.");
  return el("div.notice.bad", {}, el("strong", {}, "Completed entry, but the file is gone. "),
    `${e.file} was verified on ${e.verified} and no longer exists. Make it again, or run `, el("code", {}, `npm run art -- unmark ${a.id}`), ".");
}
