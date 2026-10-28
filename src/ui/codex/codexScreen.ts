// 25 — the Codex: the setting's archive. Left: categories, a search box and the entry list. Right:
// the reading pane (or the vertical Timeline). Entries / events with `unlock` stay classified until
// the campaign grants the key (28 §A.5); classified items still appear, redacted, and never match a
// search. Keys: ↑/↓ move through the list, "/" focuses search, Esc clears search, then goes back.

import { CODEX_CATEGORIES, codexEntries, TIMELINE, type CodexCategory, type CodexEntry, type TimelineEvent } from "../../content/lore";
import { portraitEl, emblemEl } from "../campaign/art";
import { loadProgress } from "../campaign/progress";
import { button, el } from "../components/ui";
import type { Screen } from "../screens/screenManager";
import { renderEntry, renderLocked } from "./codexReader";
import { isEventLocked, renderTimeline } from "./codexTimeline";
import type { FactionId } from "../../core/types";
import "../campaign/story-base.css";
import "./codex.css";
import "./codex-timeline.css";

type Item =
  | { kind: "entry"; key: string; cat: CodexCategory; entry: CodexEntry; locked: boolean }
  | { kind: "event"; key: string; cat: CodexCategory; index: number; ev: TimelineEvent; locked: boolean };

/** Where the reader was, so returning to the Codex keeps its place (session only). */
const memory: { cat: CodexCategory; key: string | null } = { cat: "world", key: null };

const CAT_LABEL = new Map(CODEX_CATEGORIES.map((c) => [c.id, c.label]));

function allItems(unlocked: ReadonlySet<string>): Item[] {
  const items: Item[] = codexEntries().map((e) => ({
    kind: "entry", key: e.id, cat: e.category, entry: e, locked: !!e.unlock && !unlocked.has(e.unlock),
  }));
  TIMELINE.forEach((ev, index) => items.push({ kind: "event", key: `tl_${index}`, cat: "timeline", index, ev, locked: isEventLocked(ev, unlocked) }));
  return items;
}

function matches(it: Item, q: string): boolean {
  if (it.locked) return false; // never leak a classified file through search
  const hay = it.kind === "entry" ? [it.entry.title, it.entry.subtitle ?? "", ...it.entry.body] : [it.ev.year, it.ev.title, it.ev.text];
  return hay.some((s) => s.toLowerCase().includes(q));
}

function itemArt(it: Item): HTMLElement {
  const art = el("span", "cx-li-art");
  if (it.locked) { art.classList.add("locked"); return art; }
  if (it.kind === "event") { art.append(el("span", "cx-li-year st-mono", it.ev.year.slice(0, 4))); art.classList.add("year"); return art; }
  const e = it.entry;
  if (e.portrait) art.append(portraitEl(e.portrait, 30));
  else if (e.faction) art.append(emblemEl(e.faction as FactionId, 28));
  else art.classList.add("plain");
  return art;
}

/**
 * `focus` (optional): open on a category, or "epilogue" — the Timeline at its last declassified
 * event (after the finale, the Reconvergence). Omitted → wherever the reader last was.
 */
export function codexScreen(focus?: CodexCategory | "epilogue"): Screen {
  return {
    bg: "codex", // SCREEN_BACKGROUNDS key — plain UI.BG until an image is configured
    build(root, nav) {
      root.classList.add("screen", "cx-screen");
      root.append(el("div", "st-atmos"));
      const unlocked = new Set(loadProgress().unlocked);
      const items = allItems(unlocked);
      let cat: CodexCategory = memory.cat;
      let selected: string | null = memory.key;
      let query = "";
      if (focus === "epilogue") {
        const events = items.filter((i) => i.kind === "event" && !i.locked);
        cat = "timeline";
        selected = events[events.length - 1]?.key ?? null;
      } else if (focus) {
        cat = focus;
        selected = null;
      }
      focus = undefined; // only on the first build; back() into the Codex keeps the reader's place

      // ── header ──
      const header = el("header", "cx-header");
      const titles = el("div", "cx-head-title");
      titles.append(el("div", "st-label amber", "Codex"), el("h2", "st-title cx-h", "Archive of the Spire Wars"));
      const known = items.filter((i) => !i.locked).length;
      const count = el("div", "cx-count");
      count.append(el("span", "st-label", "Files declassified"), el("span", "cx-count-n st-mono", `${known} / ${items.length}`));
      header.append(button({ label: "‹ Back", kind: "ghost", className: "st-btn st-back", onClick: () => nav.back() }), titles, count);

      // ── left: search, categories, list ──
      const left = el("aside", "cx-left st-panel");
      const search = el("input", "cx-search");
      search.type = "search";
      search.placeholder = "Search the archive…  ( / )";
      search.setAttribute("aria-label", "Search the Codex");
      const cats = el("nav", "cx-cats");
      const list = el("div", "cx-list st-scroll");
      list.setAttribute("role", "listbox");
      left.append(search, cats, list);
      const pane = el("article", "cx-pane st-panel st-scroll");
      const cols = el("div", "cx-cols");
      cols.append(left, pane);
      root.append(header, cols);

      const visible = (): Item[] => {
        const q = query.trim().toLowerCase();
        return q ? items.filter((it) => matches(it, q)) : items.filter((it) => it.cat === cat);
      };

      const renderCats = (): void => {
        cats.replaceChildren();
        const q = query.trim().toLowerCase();
        for (const c of CODEX_CATEGORIES) {
          const inCat = items.filter((it) => it.cat === c.id);
          const n = q ? inCat.filter((it) => matches(it, q)).length : inCat.filter((it) => !it.locked).length;
          const b = el("button", `cx-cat${!q && c.id === cat ? " on" : ""}${q && n === 0 ? " dim" : ""}`);
          b.type = "button";
          b.append(el("span", "cx-cat-name", c.label), el("span", "cx-cat-n st-mono", q ? String(n) : `${n}/${inCat.length}`));
          b.onclick = () => { query = ""; search.value = ""; cat = c.id; selected = null; render(); };
          cats.append(b);
        }
      };

      const renderList = (vis: Item[]): void => {
        list.replaceChildren();
        if (vis.length === 0) { list.append(el("div", "cx-empty", "No files match.")); return; }
        const q = query.trim();
        for (const it of vis) {
          const li = el("button", `cx-li${it.key === selected ? " on" : ""}${it.locked ? " locked" : ""}`);
          li.type = "button";
          li.setAttribute("role", "option");
          li.setAttribute("aria-selected", String(it.key === selected));
          li.dataset.key = it.key;
          const text = el("span", "cx-li-text");
          const title = it.locked ? "Classified" : it.kind === "entry" ? it.entry.title : it.ev.title;
          const sub = it.locked ? "Continue the campaign" : q ? CAT_LABEL.get(it.cat) ?? "" : it.kind === "entry" ? it.entry.subtitle ?? "" : it.ev.year;
          text.append(el("span", "cx-li-title", title), el("span", "cx-li-sub", sub));
          li.append(itemArt(it), text);
          li.onclick = () => select(it.key);
          list.append(li);
        }
      };

      const renderPane = (it: Item | undefined): void => {
        if (!it) { pane.replaceChildren(el("div", "cx-empty", "Select a file.")); return; }
        if (it.kind === "event") { renderTimeline(pane, unlocked, it.index); return; }
        if (it.locked) renderLocked(pane, CAT_LABEL.get(it.cat) ?? "");
        else renderEntry(pane, it.entry, CAT_LABEL.get(it.cat) ?? "");
      };

      function render(): void {
        const vis = visible();
        if (!query.trim() && cat === "timeline" && !vis.some((i) => i.key === selected)) {
          // The Timeline category opens on the whole rail.
          renderCats(); renderList(vis); renderTimeline(pane, unlocked); memory.cat = cat; memory.key = null;
          return;
        }
        if (!vis.some((i) => i.key === selected)) selected = vis[0]?.key ?? null;
        memory.cat = cat;
        memory.key = selected;
        renderCats();
        renderList(vis);
        renderPane(items.find((i) => i.key === selected));
      }

      function select(key: string): void {
        selected = key;
        const it = items.find((i) => i.key === key);
        if (it && !query.trim()) cat = it.cat;
        memory.cat = cat;
        memory.key = key;
        for (const li of list.querySelectorAll<HTMLElement>(".cx-li")) {
          const on = li.dataset.key === key;
          li.classList.toggle("on", on);
          li.setAttribute("aria-selected", String(on));
        }
        renderPane(it);
      }

      search.addEventListener("input", () => { query = search.value; selected = null; render(); });
      search.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          if (search.value) { search.value = ""; query = ""; render(); } else search.blur();
        } else if (e.key === "Enter" || e.key === "ArrowDown") {
          e.preventDefault();
          (list.querySelector<HTMLElement>(".cx-li.on") ?? list.querySelector<HTMLElement>(".cx-li"))?.focus();
        }
      });

      const onKey = (e: KeyboardEvent): void => {
        if (!root.isConnected || document.activeElement === search) return;
        if (e.key === "/") { e.preventDefault(); search.focus(); search.select(); return; }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        const vis = visible();
        if (vis.length === 0) return;
        e.preventDefault();
        const i = Math.max(0, vis.findIndex((it) => it.key === selected));
        const next = vis[Math.max(0, Math.min(vis.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
        select(next.key);
        const li = list.querySelector<HTMLElement>(`.cx-li[data-key="${next.key}"]`);
        li?.focus({ preventScroll: true });
        li?.scrollIntoView({ block: "nearest" });
      };
      window.addEventListener("keydown", onKey);
      render();
      return () => window.removeEventListener("keydown", onKey);
    },
    onEsc: (nav) => { nav.back(); return true; },
  };
}
