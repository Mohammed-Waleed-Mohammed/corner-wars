// 29 — the Art Lab: a dev-only page (npm run dev → /artlab.html) that turns Gemini output into game
// art exactly to spec: guide → attachments → prompt → drop → automatic fix + QA → save.
// Layout: catalog (left) · the selected asset's steps (centre) · game-context preview (right).

import "./styles.css";
import { BIOMES } from "../content/biomes";
import type { BiomeId } from "../core/types";
import { ASSETS, assetById } from "./catalog";
import type { Asset } from "./catalog";
import { exportAllPrompts } from "./prompts";
import { openBiomeSheet } from "./ui/biomeSheet";
import { renderCatalog } from "./ui/catalogPanel";
import { button, downloadText, el } from "./ui/dom";
import { renderPreview } from "./ui/preview";
import { dropStep, reportStep, saveStep } from "./ui/resultPanel";
import { hasReal } from "./ui/sources";
import { attachStep, guideStep, promptStep, specCard } from "./ui/specCard";
import { persisted, save, takeFlash } from "./ui/state";

const app = document.getElementById("artlab")!;
const left = el("aside.col.left", { "aria-label": "Asset catalog" });
const centre = el("main.col.centre", { "aria-label": "Selected asset" });
const right = el("aside.col.right", { "aria-label": "Game-context preview" });
const flash = el("div.flash", { hidden: true });

function current(): Asset { return assetById(persisted.selected) ?? ASSETS[0]; }

function select(a: Asset): void {
  persisted.selected = a.id;
  if (a.kind !== "portrait") persisted.biome = a.biome;
  save();
  history.replaceState(null, "", `#${a.id}`);
  renderAll();
  centre.scrollTo({ top: 0 });
}

function setBiome(b: BiomeId): void {
  persisted.biome = b;
  const a = current();
  if (a.kind !== "portrait" && a.biome !== b) { select(assetById(`${b}/${a.name}`) ?? assetById(`${b}/ground`)!); return; }
  save();
  renderAll();
}

let previewToken = 0;
function renderPreviewSafe(a: Asset): void {
  const token = ++previewToken;
  const box = el("div", {});
  void renderPreview(box, a, () => renderPreviewSafe(a)).then(() => { if (token === previewToken) right.replaceChildren(box); },
    (e: unknown) => { if (token === previewToken) right.replaceChildren(el("div.notice.bad", {}, `Preview failed: ${e instanceof Error ? e.message : String(e)}`)); });
}

function renderCentre(a: Asset): void {
  const changed = (): void => renderAll();
  const parts: (HTMLElement | null)[] = [];
  const safe = (f: () => HTMLElement | null): void => {
    try { parts.push(f()); } catch (e) { parts.push(el("div.notice.bad", {}, `Could not render this section: ${e instanceof Error ? e.message : String(e)}`)); }
  };
  safe(() => specCard(a));
  safe(() => guideStep(a));
  safe(() => attachStep(a, select));
  safe(() => promptStep(a));
  safe(() => dropStep(a, { changed }));
  safe(() => reportStep(a));
  safe(() => saveStep(a, { changed }));
  centre.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
}

function renderAll(): void {
  const a = current();
  renderCatalog(left, { select, biome: setBiome });
  renderCentre(a);
  renderPreviewSafe(a);
}

function header(): HTMLElement {
  const real = ASSETS.filter(hasReal).length;
  return el("header.top", {},
    el("div.brand", {}, el("span.logo", {}, "◆"), el("div", {}, el("h1", {}, "Art Lab"), el("div.sub", {}, "The Fall of the Citadel · Gemini art pipeline (description/29)"))),
    el("div.top-stats", {}, `${real} / ${ASSETS.length} real`),
    el("div.top-actions", {},
      button("Biome sheet", () => void openBiomeSheet(persisted.biome), "btn", { title: `Render a mini scene of ${BIOMES[persisted.biome].name} with its current art` }),
      button("Export all prompts", () => downloadText(exportAllPrompts(), "artlab_prompts.md"), "btn", { title: "Every prompt with its attachment list, in generation order (Markdown)" })),
  );
}

function boot(): void {
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash && assetById(fromHash)) persisted.selected = fromHash;
  const a = current();
  if (a.kind !== "portrait") persisted.biome = a.biome;
  app.replaceChildren(header(), flash, el("div.cols", {}, left, centre, right));
  const msg = takeFlash();
  if (msg) { flash.textContent = msg; flash.hidden = false; setTimeout(() => (flash.hidden = true), 9000); }
  renderAll();
}

boot();
// Deep links stay live: #verdant/mountain, #portraits/varga… switch the selected asset without a reload.
window.addEventListener("hashchange", () => {
  const id = decodeURIComponent(location.hash.slice(1));
  const a = id ? assetById(id) : undefined;
  if (a && id !== persisted.selected) select(a);
});
