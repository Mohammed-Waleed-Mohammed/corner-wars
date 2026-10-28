// Art Lab — centre column, bottom half: step 4 (drop Gemini's result), the report (before/after,
// processing steps, QA table, verdict) and step 5 (save to game).

import type { Asset } from "../catalog";
import type { QAReport } from "../qa";
import { button, el, imgToCanvas, toCanvas } from "./dom";
import { runPipeline, saveToGame, sessionFromFile } from "./pipeline";
import { persisted, recordVerdict, save, session, setFlash, setSession } from "./state";
import type { Session } from "./state";

export interface ResultHandlers { changed: () => void }

function stepHead(n: string, title: string, hint: string): HTMLElement {
  return el("div.step-head", {}, el("span.num", {}, n), el("h3", {}, title), el("span.hint", {}, hint));
}

function slider(label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, onChange: (v: number) => void): HTMLElement {
  const input = el("input", { type: "range", min, max, step, value });
  const out = el("output", {}, fmt(value));
  input.addEventListener("input", () => { out.textContent = fmt(Number(input.value)); });
  input.addEventListener("change", () => onChange(Number(input.value)));
  return el("label.slider", {}, el("span", {}, label), input, out);
}

export function dropStep(a: Asset, h: ResultHandlers): HTMLElement {
  const input = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
  const zone = el("div.dropzone", { tabindex: 0 }, el("strong", {}, "Drop Gemini's image here"), el("span", {}, "or click to choose · PNG, JPEG or WebP"));
  const take = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    zone.classList.add("busy");
    zone.firstElementChild!.textContent = "Processing…";
    // Let the busy state paint — with a timer fallback, since rAF never fires in a hidden/background tab.
    await new Promise<void>((r) => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 60); });
    try {
      const s = await sessionFromFile(f);
      runPipeline(a, s);
      setSession(a, s);
      if (s.report) recordVerdict(a.id, s.report.verdict);
    } catch (e) {
      setSession(a, { file: f.name, source: { width: 0, height: 0, data: new Uint8ClampedArray(0) }, result: null, report: null, out: null, error: e instanceof Error ? e.message : String(e), saved: null });
    }
    h.changed();
  };
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") input.click(); });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); void take(e.dataTransfer?.files[0]); });
  input.addEventListener("change", () => void take(input.files?.[0]));

  const s = session(a);
  const reprocess = (): void => {
    if (!s || !s.source.width) { save(); return; }
    runPipeline(a, s);
    if (s.report) recordVerdict(a.id, s.report.verdict);
    h.changed();
  };
  const opts: HTMLElement[] = [];
  if (a.kind === "texture") opts.push(slider("Palette lock", persisted.lock, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => { persisted.lock = v; save(); reprocess(); }));
  // Terrain sprites keep their fixed pipeline; textures, portraits, units and buildings can trim a watermark.
  if (a.kind !== "sprite") opts.push(slider("Trim edges", persisted.trim, 0, 0.1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => { persisted.trim = v; save(); reprocess(); }));
  return el("section.card.step", {},
    stepHead("4", "Drop result", s ? `current: ${s.file}` : "Gemini's output, any size"),
    zone, input,
    opts.length ? el("div.opts", {}, ...opts, el("span.hint", {}, a.kind === "texture" ? "Lock: how far the mean colour is pulled to the palette mid (29 §C, default 60%). Trim: cut a watermark off the edges." : "Trim: cut a watermark off the edges.")) : null);
}

function qaTable(r: QAReport): HTMLElement {
  return el("table.qa", {},
    el("thead", {}, el("tr", {}, el("th", {}, "Metric"), el("th", {}, "Value"), el("th", {}, "Threshold"), el("th", {}, "Result"))),
    el("tbody", {}, ...r.metrics.flatMap((m) => [
      el(`tr.${m.verdict.toLowerCase()}`, {}, el("td", {}, m.label), el("td.num", {}, m.value), el("td.num", {}, m.threshold), el("td", {}, el(`span.tag.v-${m.verdict.toLowerCase()}`, {}, m.verdict))),
      m.note ? el(`tr.note.${m.verdict.toLowerCase()}`, {}, el("td", { colspan: 4 }, m.note)) : null,
    ].filter((x): x is HTMLTableRowElement => x !== null))));
}

function beforeAfter(s: Session): HTMLElement {
  const src = imgToCanvas(s.source);
  const before = toCanvas(src, Math.min(256, src.width), Math.round(Math.min(256, src.width) * (src.height / src.width)));
  before.className = "thumb";
  // Keep the output's proportions (a building is outW × outH): its larger side is 256.
  const k = s.out ? 256 / Math.max(s.out.width, s.out.height) : 1;
  const after = s.out ? toCanvas(s.out, Math.round(s.out.width * k), Math.round(s.out.height * k)) : el("div.thumb.empty", {}, "no output");
  const keyed = s.result?.kind === "sprite" || s.result?.kind === "unit" || s.result?.kind === "building";
  if (after instanceof HTMLCanvasElement) after.className = `thumb${keyed ? " checker" : ""}`;
  return el("div.ba", {},
    el("figure", {}, before, el("figcaption", {}, `Before · ${s.source.width}×${s.source.height}`)),
    el("figure", {}, after, el("figcaption", {}, `After · ${s.out ? `${s.out.width}×${s.out.height}` : "—"}`)));
}

export function reportStep(a: Asset): HTMLElement | null {
  const s = session(a);
  if (!s) return null;
  if (s.error || !s.result || !s.report) {
    return el("section.card.step", {}, stepHead("·", "Report", s.file), el("div.notice.bad", {}, `Could not process this file: ${s.error ?? "unknown error"}`));
  }
  const v = s.report.verdict;
  return el("section.card.step.report", {},
    stepHead("·", "Report", s.file),
    el(`div.verdict.v-${v.toLowerCase()}`, {}, el("strong", {}, v), el("span", {}, v === "PASS" ? "Every check passed — ready to save." : v === "WARN" ? "Saveable, but look at the warnings and the preview first." : "Rejected — fix the failures below before saving.")),
    beforeAfter(s),
    el("h4", {}, "Processing applied"),
    el("ol.steps", {}, ...s.result.r.steps.map((t) => el("li", {}, t))),
    el("h4", {}, "Quality checks (29 §D)"),
    qaTable(s.report));
}

export function saveStep(a: Asset, h: ResultHandlers): HTMLElement {
  const s = session(a);
  const status = el("div.save-status", {});
  const fails = s?.report?.metrics.filter((m) => m.verdict === "FAIL") ?? [];
  const blocked = !s || !s.out || !s.report || fails.length > 0;
  const b = button(`Save to ${a.path}`, async () => {
    if (!s?.out || blocked) return;
    b.disabled = true;
    status.className = "save-status";
    status.textContent = "Saving…";
    const res = await saveToGame(a, s.out);
    if (res.ok) {
      s.saved = res.path ?? a.path;
      recordVerdict(a.id, s.report!.verdict, true);
      setFlash(`Saved ${s.saved} (${(res.bytes ?? 0).toLocaleString()} bytes, ${s.report!.verdict}). The game now loads it instead of the procedural version.`);
      status.className = "save-status ok";
      status.textContent = `Saved ✓ ${s.saved} — Vite reloads the page to pick the file up (reload by hand if it doesn't).`;
    } else {
      status.className = "save-status bad";
      status.textContent = `Save failed: ${res.error}`;
      b.disabled = false;
    }
    h.changed();
  }, "btn primary big");
  b.disabled = blocked;
  if (s?.saved) { status.className = "save-status ok"; status.textContent = `Saved ✓ ${s.saved}`; }
  const why = !s ? el("p.hint", {}, "Drop a result first (step 4).")
    : !s.out ? el("div.notice.bad", {}, "Nothing to save: processing produced no output.")
    : fails.length ? el("div.notice.bad", {}, el("strong", {}, `Blocked by ${fails.length} failed check${fails.length > 1 ? "s" : ""}:`), el("ul", {}, ...fails.map((m) => el("li", {}, el("b", {}, `${m.label.split(" (")[0]}: `), m.note))))
    : null;
  return el("section.card.step", {}, stepHead("5", "Save to game", "writes the processed PNG via the dev server"), why, el("div.save-row", {}, b), status);
}
