// Codex reading pane: a header plate (portrait, faction emblem or biome swatch), the title block and
// the body paragraphs. Quotes render as pull-quotes and "Label: text" lines get a small-caps label.
// Locked entries render as a redacted teaser so the player knows something is there.

import { BIOMES, biomeMapColor } from "../../content/biomes";
import { FACTIONS } from "../../content/factions";
import type { CodexEntry } from "../../content/lore";
import type { BiomeId, FactionId, TerrainType } from "../../core/types";
import { emblemEl, framedPortrait } from "../campaign/art";
import { el } from "../components/ui";

const SWATCH_TILES: TerrainType[] = ["ground", "forest", "hill", "shallows", "water", "mountain", "road"];

function biomePlate(id: BiomeId): HTMLElement {
  const b = BIOMES[id];
  const plate = el("div", "cx-biome-plate");
  for (const t of SWATCH_TILES) {
    const band = el("span", "cx-biome-band");
    band.style.background = biomeMapColor(id, t);
    band.title = b.tileNames[t];
    plate.append(band);
  }
  return plate;
}

function headerArt(e: CodexEntry): HTMLElement {
  const art = el("div", "cx-art");
  if (e.portrait) {
    art.append(framedPortrait(e.portrait, 112));
    if (e.faction) art.append(emblemEl(e.faction as FactionId, 34, "st-emblem cx-art-emb"));
  } else if (e.faction) {
    art.append(emblemEl(e.faction as FactionId, 104, "st-emblem cx-art-big"));
  } else if (e.biome) {
    art.append(biomePlate(e.biome as BiomeId));
  } else {
    art.append(el("span", "cx-art-glyph"));
  }
  return art;
}

/** Split "Bastion Doctrine (passive): text" into a label + text; null when it isn't that shape. */
function labelled(p: string): [string, string] | null {
  const m = /^([^:.“"]{2,48}): (.+)$/s.exec(p);
  return m ? [m[1], m[2]] : null;
}

function bodyPara(p: string, first: boolean): HTMLElement {
  if (p.startsWith("“") || p.startsWith("\"")) return el("blockquote", "cx-quote", p);
  const lab = first ? null : labelled(p);
  if (!lab) return el("p", first ? "cx-p cx-lede" : "cx-p", p);
  const para = el("p", "cx-p cx-labelled");
  para.append(el("span", "cx-p-label", lab[0]), document.createTextNode(lab[1]));
  return para;
}

export function renderEntry(pane: HTMLElement, e: CodexEntry, categoryLabel: string): void {
  pane.replaceChildren();
  const fc = e.faction ? FACTIONS[e.faction as FactionId]?.color : e.biome ? biomeMapColor(e.biome as BiomeId, "hill") : undefined;
  pane.style.setProperty("--fc", fc ?? "#f5c518");
  const head = el("header", "cx-head");
  const titles = el("div", "cx-titles");
  titles.append(el("div", "st-label amber", categoryLabel), el("h3", "st-title cx-title", e.title));
  if (e.subtitle) titles.append(el("div", "cx-subtitle", e.subtitle));
  head.append(headerArt(e), titles);
  const body = el("div", "cx-body");
  e.body.forEach((p, i) => body.append(bodyPara(p, i === 0)));
  pane.append(head, el("hr", "st-rule amber"), body);
  pane.scrollTop = 0;
}

/** The redacted teaser for a locked entry. */
export function renderLocked(pane: HTMLElement, categoryLabel: string): void {
  pane.replaceChildren();
  pane.style.setProperty("--fc", "#ef4444");
  const head = el("header", "cx-head");
  const titles = el("div", "cx-titles");
  titles.append(el("div", "st-label amber", categoryLabel), el("h3", "st-title cx-title cx-redacted-title", "Classified"));
  titles.append(el("div", "cx-subtitle", "Continue the campaign to declassify this file."));
  const art = el("div", "cx-art");
  art.append(el("span", "cx-art-glyph locked"));
  head.append(art, titles);
  const body = el("div", "cx-body");
  for (const w of [96, 88, 92, 54, 0, 90, 72]) {
    if (w === 0) { body.append(el("div", "cx-gap")); continue; }
    const bar = el("div", "cx-redact");
    bar.style.width = `${w}%`;
    body.append(bar);
  }
  body.append(el("div", "cx-stamp", "Classified — continue the campaign"));
  pane.append(head, el("hr", "st-rule"), body);
  pane.scrollTop = 0;
}
