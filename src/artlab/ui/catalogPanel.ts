// Art Lab — left column: the asset catalog by group, with biome and faction selectors and per-asset
// status (procedural / real, plus the last QA verdict).

import { BIOME_IDS } from "../../config/biomes";
import { BIOMES, rgbHex } from "../../content/biomes";
import { FACTIONS } from "../../content/factions";
import type { BiomeId, FactionId } from "../../core/types";
import { ART_FACTIONS, ASSETS, isBiomeAsset, isFactionAsset } from "../catalog";
import type { Asset } from "../catalog";
import { el } from "./dom";
import { hasReal } from "./sources";
import { persisted } from "./state";

export interface CatalogHandlers { select: (a: Asset) => void; biome: (b: BiomeId) => void; faction: (f: FactionId) => void }

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

function statusChips(a: Asset): HTMLElement {
  const v = persisted.verdicts[a.id];
  return el("span.chips", {},
    hasReal(a) ? el("span.tag.real", { title: `A real file exists at ${a.path}` }, "REAL") : el("span.tag.proc", { title: "No file yet — the game uses the procedural version" }, "PROC"),
    v ? el(`span.tag.v-${v.verdict.toLowerCase()}`, { title: `Last processed result: ${v.verdict}${v.saved ? " (saved)" : ""} · ${new Date(v.at).toLocaleString()}` }, v.verdict) : null,
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
  const done = list.filter(hasReal).length;
  return el("section.group", {},
    el("h3", {}, el("span", {}, title), el("span.count", { title: "real files / total" }, `${done}/${list.length}`)),
    ...list.map((a) => entry(a, selected, h)),
  );
}

export function renderCatalog(root: HTMLElement, h: CatalogHandlers): void {
  const b = persisted.biome, f = persisted.faction, sel = persisted.selected;
  const of = (k: Asset["kind"]): Asset[] => ASSETS.filter((a) => a.kind === k
    && (isBiomeAsset(a) ? a.biome === b : isFactionAsset(a) ? a.faction === f : true));
  const total = ASSETS.filter(hasReal).length;
  root.replaceChildren(
    picker("Biome", BIOME_IDS, b, (id) => BIOMES[id].name, rgbHex(BIOMES[b].palette.ground.mid), h.biome),
    picker("Faction", ART_FACTIONS, f, (id) => FACTIONS[id].name, FACTIONS[f].color, h.faction),
    el("p.cat-sum", {}, `${total} of ${ASSETS.length} assets have real art. Numbers are the generation order (29 §B).`),
    group(`Terrain textures — ${BIOMES[b].name}`, of("texture"), sel, h),
    group(`Terrain sprites — ${BIOMES[b].name}`, of("sprite"), sel, h),
    group("Portraits", of("portrait"), sel, h),
    group(`Buildings — ${FACTIONS[f].short}`, of("building"), sel, h),
    group(`Units — ${FACTIONS[f].short}`, of("unit"), sel, h),
  );
  root.querySelector(".entry.active")?.scrollIntoView({ block: "nearest" });
}
