// 27 §D — the commander picker (skirmish seats + MP lobby) and a read-only commander badge. The picker
// is a compact button (portrait + name, or "?" for Random) that opens a popover: four faction columns
// × two commanders, plus Random. Hover / focus shows the doctrine and ability text, templated from the
// config numbers. The popover lives on <body> (fixed) so scrolling panels never clip it. UI-only.

import { COMMANDERS, COMMANDERS_OF, FACTION_IDS } from "../../config/commanders";
import { abilityCooldownText, abilityText, COMMANDER_INFO, doctrineText, FACTIONS, fullName } from "../../content/factions";
import type { CommanderId } from "../../core/types";
import { emblemEl, portraitEl } from "../campaign/art";
import { el } from "./ui";
import "../campaign/story-base.css";
import "../campaign/commander-picker.css";

export type CommanderChoice = CommanderId | "random";

let openPopover: { close: () => void } | null = null;

/** A small portrait + emblem chip for read-only display (lobby rows, post-match, briefing seats). */
export function commanderBadge(id: CommanderId, size = 28): HTMLElement {
  const info = COMMANDER_INFO[id];
  const fac = FACTIONS[info.faction];
  const chip = el("span", "cp-badge");
  chip.style.setProperty("--fc", fac.color);
  chip.title = `${fullName(info)} · ${fac.name}\n${info.doctrineName}: ${doctrineText(id)}`;
  const pic = el("span", "cp-badge-pic");
  pic.append(portraitEl(id, size), emblemEl(info.faction, Math.max(12, Math.round(size * 0.5)), "st-emblem cp-badge-emb"));
  chip.append(pic, el("span", "cp-badge-name", info.short));
  return chip;
}

/** The face of the picker button for a choice. */
function renderFace(btn: HTMLButtonElement, v: CommanderChoice): void {
  btn.replaceChildren();
  if (v === "random") {
    btn.style.setProperty("--fc", "#94a3b8");
    btn.append(el("span", "cp-q", "?"), textStack("Random", "Any faction"));
  } else {
    const info = COMMANDER_INFO[v];
    btn.style.setProperty("--fc", FACTIONS[info.faction].color);
    btn.append(portraitEl(v, 30, "st-portrait cp-face"), textStack(info.short, FACTIONS[info.faction].short));
  }
  btn.append(el("span", "cp-caret", "▾"));
}

function textStack(name: string, sub: string): HTMLElement {
  const s = el("span", "cp-text");
  s.append(el("span", "cp-name", name), el("span", "cp-sub", sub));
  return s;
}

/** The detail pane: doctrine + ability for a commander, or the Random blurb. */
function renderDetail(pane: HTMLElement, v: CommanderChoice): void {
  pane.replaceChildren();
  if (v === "random") {
    pane.style.setProperty("--fc", "#94a3b8");
    pane.append(el("div", "cp-d-name", "Random commander"),
      el("div", "cp-d-text", "A commander from any faction is drawn from the match seed when the match starts."));
    return;
  }
  const info = COMMANDER_INFO[v];
  const fac = FACTIONS[info.faction];
  pane.style.setProperty("--fc", fac.color);
  const head = el("div", "cp-d-head");
  head.append(el("div", "cp-d-name", fullName(info)), el("div", "cp-d-fac", fac.name));
  const ability = COMMANDERS[v].ability;
  pane.append(
    head,
    el("div", "cp-d-play", info.playstyle),
    el("div", "st-label", `${info.doctrineName} · passive`),
    el("div", "cp-d-text", doctrineText(v)),
    el("div", "st-label", `${info.abilityName} · ability (F)`),
    el("div", "cp-d-text", abilityText(ability)),
    el("div", "cp-d-cd st-mono", abilityCooldownText(ability)),
  );
}

export function commanderPicker(opts: { value: CommanderChoice; onPick: (v: CommanderChoice) => void; disabled?: boolean }): HTMLElement {
  let value = opts.value;
  const wrap = el("span", "cp-wrap");
  const btn = el("button", "cp-btn");
  btn.type = "button";
  btn.disabled = !!opts.disabled;
  btn.setAttribute("aria-haspopup", "dialog");
  btn.title = opts.disabled ? "Commander locked" : "Choose a commander";
  renderFace(btn, value);
  wrap.append(btn);

  const pick = (v: CommanderChoice): void => {
    value = v;
    renderFace(btn, v);
    close();
    btn.focus();
    opts.onPick(v);
  };

  let pop: HTMLElement | null = null;
  let raf = 0;
  const onDown = (e: PointerEvent): void => {
    if (pop && !pop.contains(e.target as Node) && !btn.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !pop) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // don't let the ScreenManager pop the screen too
    close();
    btn.focus();
  };
  function close(): void {
    if (!pop) return;
    pop.remove();
    pop = null;
    cancelAnimationFrame(raf);
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
    btn.classList.remove("open");
    if (openPopover?.close === close) openPopover = null;
  }
  function place(): void {
    if (!pop) return;
    if (!btn.isConnected) { close(); return; }
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(vw - pw - 8, r.left));
    const below = r.bottom + 6;
    const top = below + ph <= vh - 8 ? below : Math.max(8, r.top - ph - 6);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    raf = requestAnimationFrame(place);
  }
  function open(): void {
    openPopover?.close();
    pop = buildPopover(value, pick);
    document.body.append(pop);
    btn.classList.add("open");
    openPopover = { close };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    place();
    (pop.querySelector(".cp-tile.on") as HTMLElement | null)?.focus();
  }
  btn.addEventListener("click", () => { if (pop) close(); else open(); });
  return wrap;
}

function buildPopover(value: CommanderChoice, pick: (v: CommanderChoice) => void): HTMLElement {
  const pop = el("div", "cp-pop");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Choose a commander");
  const head = el("div", "cp-pop-head");
  head.append(el("span", "st-label amber", "Choose commander"), el("span", "st-label", "Hover for doctrine"));
  const grid = el("div", "cp-grid");
  const detail = el("div", "cp-detail");
  const show = (v: CommanderChoice): void => renderDetail(detail, v);

  const tile = (v: CommanderChoice): HTMLButtonElement => {
    const t = el("button", `cp-tile${v === value ? " on" : ""}`);
    t.type = "button";
    if (v === "random") {
      t.classList.add("cp-random");
      t.append(el("span", "cp-q big", "?"), textStack("Random", "Drawn at match start"));
    } else {
      const info = COMMANDER_INFO[v];
      t.style.setProperty("--fc", FACTIONS[info.faction].color);
      const face = el("span", "cp-tile-face");
      face.append(portraitEl(v, 64));
      t.append(face, textStack(info.short, info.abilityName));
    }
    t.addEventListener("mouseenter", () => show(v));
    t.addEventListener("focus", () => show(v));
    t.addEventListener("click", () => pick(v));
    return t;
  };

  for (const f of FACTION_IDS) {
    const col = el("div", "cp-col");
    col.style.setProperty("--fc", FACTIONS[f].color);
    const ch = el("div", "cp-col-head");
    ch.append(emblemEl(f, 22), el("span", "cp-col-name", FACTIONS[f].short));
    col.append(ch, ...COMMANDERS_OF[f].map((id) => tile(id)));
    grid.append(col);
  }
  pop.append(head, grid, tile("random"), detail);
  show(value);
  return pop;
}
