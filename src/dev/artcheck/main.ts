// 29 §H — the art checker: verify finished asset files against their Art Lab slot and keep the
// completed list (src/artlab/completed.json) that the Art Lab reads to hide finished assets.
// Node only, never in the game bundle. Run from the repo root:
//
//   npm run art -- check [filter…] [--all-checks]   verify every file that exists (exit 1 on a FAIL)
//   npm run art -- mark <filter…> | --all           verify, then tag the files that pass as completed
//   npm run art -- unmark <filter…>                 remove entries from the completed list
//   npm run art -- list                             the completed list, with each entry's state
//
// A filter is an asset id (verdant/ground), a prefix (verdant, units/concord) or a glob (verdant/tree_*).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { ASSETS, isBiomeAsset } from "../../artlab/catalog";
import type { Asset } from "../../artlab/catalog";
import { COMPLETED_FILE, parseCompleted, serializeCompleted } from "../../artlab/completed";
import type { CompletedEntry, CompletedList } from "../../artlab/completed";
import { verifyAsset } from "../../artlab/verify";
import type { Verification } from "../../artlab/verify";
import { decodePng } from "./png";

declare const process: { argv: string[]; exit(code: number): never; stdout: { write(s: string): void }; exitCode?: number };

const out = (s = ""): void => { process.stdout.write(`${s}\n`); };
const fail = (msg: string): never => { out(`error: ${msg}`); process.exit(2); };

if (!existsSync("package.json") || !existsSync("src/artlab/catalog.ts")) fail("run this from the repo root (npm run art -- …)");

// ── where the game loads each slot from (mirrors render/terrainArt.ts, unitArt.ts, portraits.ts) ──
/** Legacy files at the terrain root that count as verdant (29 §E): grass → ground, water_0 → water, grass_tuft_N → tuft_N, any name 1:1. */
function legacyPaths(a: Asset): string[] {
  if (!isBiomeAsset(a) || a.biome !== "verdant") return [];
  const alias = a.name === "ground" ? "grass" : a.name === "water" ? "water_0" : a.name.startsWith("tuft_") ? `grass_${a.name}` : null;
  return [...(alias ? [alias] : []), a.name].map((n) => `src/assets/terrain/${n}.png`);
}

/** The file the game uses for a slot: the canonical path wins over a legacy one. */
function fileFor(a: Asset): string | null {
  return [a.path, ...legacyPaths(a)].find((p) => existsSync(p)) ?? null;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${d.name}`;
    if (d.isDirectory()) files.push(...walk(p));
    else if (d.isFile()) files.push(p);
  }
  return files;
}

/** Image files under the art folders that no slot uses, with the reason (misnamed, wrong format, wrong folder…). */
function strayFiles(used: Set<string>): { file: string; why: string }[] {
  const res: { file: string; why: string }[] = [];
  const frames = /^src\/assets\/terrain\/(verdant\/|[a-z]+\/)?water_[1-3]\.png$/; // optional animation frames (26 §D)
  for (const f of ["src/assets/terrain", "src/assets/portraits", "src/assets/units", "src/assets/buildings"].flatMap(walk)) {
    if (used.has(f) || !/\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$/i.test(f)) continue;
    if (frames.test(f)) continue;
    const ext = f.slice(f.lastIndexOf(".") + 1);
    const stem = f.slice(0, f.lastIndexOf("."));
    if (ext !== "png") {
      const slot = ASSETS.find((a) => a.path === `${stem}.png` || a.path.toLowerCase() === `${stem}.png`.toLowerCase());
      res.push({ file: f, why: slot ? `wrong format (.${ext}): ${slot.id} needs a PNG at ${slot.path}` : `not a PNG, and no slot has this name` });
      continue;
    }
    const lower = ASSETS.find((a) => a.path.toLowerCase() === f.toLowerCase());
    if (lower) { res.push({ file: f, why: `wrong case: the game only loads ${lower.path}` }); continue; }
    res.push({ file: f, why: "no Art Lab slot has this path, so the game ignores it" });
  }
  return res;
}

// ── the completed list ────────────────────────────────────────────────────────────────────────
function loadList(): CompletedList {
  if (!existsSync(COMPLETED_FILE)) return { assets: {} };
  try { return parseCompleted(JSON.parse(readFileSync(COMPLETED_FILE, "utf8"))); }
  catch (e) { return fail(`${COMPLETED_FILE} is not valid JSON (${e instanceof Error ? e.message : String(e)}); fix or delete it`); }
}
function saveList(l: CompletedList): void {
  const tmp = `${COMPLETED_FILE}.tmp`;
  writeFileSync(tmp, serializeCompleted(l));
  renameSync(tmp, COMPLETED_FILE);
}

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Entry state: still matches its file, the file changed since, or the file is gone. */
function entryState(id: string, e: CompletedEntry): "ok" | "changed" | "missing" | "unknown slot" {
  const a = ASSETS.find((x) => x.id === id);
  if (!a) return "unknown slot";
  const f = fileFor(a);
  if (!f) return "missing";
  return f === e.file && sha256(readFileSync(f)) === e.sha256 ? "ok" : "changed";
}

// ── verifying ─────────────────────────────────────────────────────────────────────────────────
interface Result { a: Asset; file: string; bytes: Uint8Array; v: Verification; width: number; height: number }

function verifyFile(a: Asset, file: string): Result {
  const bytes = readFileSync(file);
  try {
    const p = decodePng(bytes);
    return { a, file, bytes, v: verifyAsset(a, p), width: p.width, height: p.height };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { a, file, bytes, width: 0, height: 0, v: { verdict: "FAIL", checks: [{ label: "Format", value: msg, expected: "a valid PNG", verdict: "FAIL", note: "Re-save the file as a PNG from the Art Lab." }] } };
  }
}

function matcher(filters: readonly string[]): (a: Asset) => boolean {
  if (!filters.length) return () => true;
  const tests = filters.map((f) => {
    if (f.includes("*")) {
      const re = new RegExp(`^${f.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
      return (id: string) => re.test(id);
    }
    const prefix = f.endsWith("/") ? f : `${f}/`;
    return (id: string) => id === f || id.startsWith(prefix);
  });
  return (a) => tests.some((t) => t(a.id));
}

function printResult(r: Result, all: boolean, done: string): void {
  out(`${r.v.verdict.padEnd(4)}  ${r.a.id.padEnd(34)} ${r.file}${done}`);
  for (const c of r.v.checks) {
    if (!all && c.verdict === "PASS") continue;
    out(`        ${c.verdict.padEnd(4)} ${c.label}: ${c.value} (expected ${c.expected})${c.note ? `\n             ${c.note}` : ""}`);
  }
}

/** Verify every slot that matches the filters and has a file. */
function run(filters: readonly string[]): Result[] {
  const picked = ASSETS.filter(matcher(filters));
  if (filters.length && !picked.length) fail(`no asset matches ${filters.join(" ")} (ids look like verdant/ground, portraits/varga, units/concord/rifleman)`);
  const results: Result[] = [];
  for (const a of picked) {
    const f = fileFor(a);
    if (f) results.push(verifyFile(a, f));
  }
  return results;
}

function summary(rs: readonly Result[]): string {
  const n = (v: string): number => rs.filter((r) => r.v.verdict === v).length;
  return `${rs.length} file${rs.length === 1 ? "" : "s"}: ${n("PASS")} pass, ${n("WARN")} warn, ${n("FAIL")} fail`;
}

// ── commands ──────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd = args[0] ?? "check";
const flags = new Set(args.filter((s) => s.startsWith("--")));
const rest = args.slice(1).filter((s) => !s.startsWith("--"));
const allChecks = flags.has("--all-checks");

if (cmd === "check") {
  const list = loadList();
  const rs = run(rest);
  for (const r of rs) {
    const e = list.assets[r.a.id];
    const st = e ? entryState(r.a.id, e) : null;
    printResult(r, allChecks, st === "ok" ? "  [completed]" : st ? `  [completed entry is ${st}]` : "");
  }
  out();
  out(summary(rs));
  if (!rest.length) {
    const used = new Set(ASSETS.map(fileFor).filter((f): f is string => f !== null));
    const stray = strayFiles(used);
    if (stray.length) { out(); out("Files no slot uses:"); for (const s of stray) out(`  ${s.file}: ${s.why}`); }
  }
  if (rs.some((r) => r.v.verdict === "FAIL")) process.exitCode = 1;
} else if (cmd === "mark") {
  if (!rest.length && !flags.has("--all")) fail("mark needs asset ids / filters, or --all");
  const list = loadList();
  const rs = run(flags.has("--all") ? [] : rest);
  if (!rs.length) fail("none of those assets has a file yet");
  const today = new Date().toISOString().slice(0, 10);
  let marked = 0, refused = 0;
  for (const r of rs) {
    if (r.v.verdict === "FAIL") { refused++; printResult(r, allChecks, "  → NOT marked"); continue; }
    const sha = sha256(r.bytes), prev = list.assets[r.a.id];
    const same = prev && prev.sha256 === sha && prev.file === r.file;
    list.assets[r.a.id] = same ? prev : { file: r.file, sha256: sha, width: r.width, height: r.height, bytes: r.bytes.length, verified: today };
    if (!same) marked++;
    printResult(r, allChecks, same ? "  → already completed" : "  → marked completed");
  }
  saveList(list);
  out();
  out(`${summary(rs)}. Marked ${marked}, refused ${refused}. ${Object.keys(list.assets).length} completed in ${COMPLETED_FILE}.`);
  if (refused) process.exitCode = 1;
} else if (cmd === "unmark") {
  if (!rest.length) fail("unmark needs asset ids / filters");
  const list = loadList(), match = matcher(rest);
  const gone = Object.keys(list.assets).filter((id) => match({ id } as Asset));
  for (const id of gone) delete list.assets[id];
  saveList(list);
  out(gone.length ? `Unmarked ${gone.join(", ")}.` : "Nothing to unmark.");
} else if (cmd === "list") {
  const list = loadList(), ids = Object.keys(list.assets);
  for (const id of ids) {
    const e = list.assets[id];
    out(`${entryState(id, e).padEnd(12)} ${id.padEnd(34)} ${e.width}×${e.height}  ${e.verified}  ${e.file}`);
  }
  out(`${ids.length} completed of ${ASSETS.length} assets.`);
} else {
  fail(`unknown command "${cmd}" (check · mark · unmark · list)`);
}
