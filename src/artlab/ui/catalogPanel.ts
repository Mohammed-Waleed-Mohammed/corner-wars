// Art Lab — left column: the asset catalog by group, with biome and faction selectors and per-asset
// status (procedural / real, plus the last QA verdict or the completed tag). Completed assets
// (29 §H) are hidden unless "Show completed" is on.

import { BIOME_IDS } from "../../config/biomes";
import { BIOMES, rgbHex } from "../../content/biomes";
import { FACTIONS } from "../../content/factions";
import type { BiomeId, FactionId } from "../../core/types";
import { ART_FACTIONS, ASSETS, isBiomeAsset, isFactionAsset } from "../catalog";
import type { Asset } from "../catalog";
import { completedCounts, completedEntry, completedState, isDone, isHidden } from "./completed";
import { el } from "./dom";
import { hasReal } from "./sources";
import { persisted, save } from "./state";

export interface CatalogHandlers { select: (a: Asset) => void; biome: (b: BiomeId) => void; faction: (f: FactionId) => void; refresh: () => void }

/** A labelled <select> with a colour dot (biome / faction). */
function picker<T extends string>(label: string, ids: readonly T[], current: T, name: (id: T) => string, colour: string, onPick: (id: T) => void): HTMLElement {
  const select = el("select.biome-select", { "aria-label": label }, ...ids.map((id) => {
    const o = el("option", { value: id }, name(id));
    if (id === current) o.selected = true;
    return o;
  }));
  select.addEventListener("change", () => onPick(select.value as T));
  return el("div.cat-head", {}, el("label.lbl", {}, label), el("div.biome-row", {}, el("span.biome-dot", { style: `background:${colour}` }), select));
}

/** The completed-list chip (29 §H): DONE, or why an entry on the list no longer counts. */
function completedChip(a: Asset): HTMLElement | null {
  const s = completedState(a), e = completedEntry(a);
  if (!s || !e) return null;
  if (s === "done") return el("span.tag.done", { title: `Completed: verified ${e.verified}` }, "DONE");
  if (s === "changed") return el("span.tag.v-warn", { title: `Changed since it was verified on ${e.verified}: run npm run art -- mark ${a.id}` }, "CHANGED");
  return el("span.tag.v-fail", { title: `On the completed list, but ${e.file} is gone` }, "MISSING");
}

function statusChips(a: Asset): HTMLElement {
  const v = persisted.verdicts[a.id];
  const done = completedChip(a);
  return el("span.chips", {},
    hasReal(a) ? el("span.tag.real", { title: `A real file exists at ${a.path}` }, "REAL") : el("span.tag.proc", { title: "No file yet — the game uses the procedural version" }, "PROC"),
    done ?? (v ? el(`span.tag.v-${v.verdict.toLowerCase()}`, { title: `Last processed result: ${v.verdict}${v.saved ? " (saved)" : ""} · ${new Date(v.at).toLocaleString()}` }, v.verdict) : null),
  );
}

function entry(a: Asset, selected: string, h: CatalogHandlers): HTMLElement {
  const sub = `${a.name}.png`;
  const row = el(`button.entry${a.id === selected ? ".active" : ""}`, { type: "button", title: `${a.id} — step ${a.step}, #${a.order} in generation order` },
    el("span.ord", {}, String(a.order)),
    el("span.names", {}, el("span.t", {}, a.title), el("span.f", {}, sub)),
    statusChips(a),
  );
  row.addEventListener("click", () => h.select(a));
  return row;
}

function group(title: string, list: readonly Asset[], selected: string, h: CatalogHandlers): HTMLElement {
  const real = list.filter(hasReal).length, done = list.filter(isDone).length;
  const shown = list.filter((a) => !isHidden(a)), hidden = list.length - shown.length;
  return el("section.group", {},
    el("h3", {}, el("span", {}, title), el("span.count", { title: `real files / total · ${done} completed` }, `${real}/${list.length}${done ? ` · ${done} done` : ""}`)),
    ...shown.map((a) => entry(a, selected, h)),
    hidden ? el("p.group-hidden", {}, hidden === list.length ? `All ${hidden} completed.` : `${hidden} completed, hidden.`) : null,
  );
}

/** "Show completed" — off by default, so the catalog lists only the assets still to make (29 §H). */
function completedToggle(done: number, changed: number, onToggle: () => void): HTMLElement {
  const box = el("input", { type: "checkbox", id: "show-completed" });
  box.checked = persisted.showCompleted;
  box.addEventListener("change", () => { persisted.showCompleted = box.checked; save(); onToggle(); });
  return el("div.done-toggle", {},
    el("label", { for: "show-completed", title: "Completed assets passed npm run art -- check and are on src/artlab/completed.json" }, box, ` Show completed (${done})`),
    changed ? el("span.tag.v-warn", { title: "Completed entries whose file changed or is gone; they are listed again until re-verified" }, `${changed} to re-check`) : null);
}

export function renderCatalog(root: HTMLElement, h: CatalogHandlers): void {
  const b = persisted.biome, f = persisted.faction, sel = persisted.selected;
  const of = (k: Asset["kind"]): Asset[] => ASSETS.filter((a) => a.kind === k
    && (isBiomeAsset(a) ? a.biome === b : isFactionAsset(a) ? a.faction === f : true));
  const total = ASSETS.filter(hasReal).length;
  const { done, changed } = completedCounts(ASSETS);
  root.replaceChildren(
    picker("Biome", BIOME_IDS, b, (id) => BIOMES[id].name, rgbHex(BIOMES[b].palette.ground.mid), h.biome),
    picker("Faction", ART_FACTIONS, f, (id) => FACTIONS[id].name, FACTIONS[f].color, h.faction),
    el("p.cat-sum", {}, `${total} of ${ASSETS.length} assets have real art, ${done} completed. Numbers are the generation order (29 §B).`),
    completedToggle(done, changed, h.refresh),
    group(`Terrain textures — ${BIOMES[b].name}`, of("texture"), sel, h),
    group(`Terrain sprites — ${BIOMES[b].name}`, of("sprite"), sel, h),
    group("Portraits", of("portrait"), sel, h),
    group(`Buildings — ${FACTIONS[f].short}`, of("building"), sel, h),
    group(`Units — ${FACTIONS[f].short}`, of("unit"), sel, h),
  );
  root.querySelector(".entry.active")?.scrollIntoView({ block: "nearest" });
}
