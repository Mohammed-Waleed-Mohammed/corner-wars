// Art Lab — centre column, top half: the spec card and steps 1–3 (guide, attachments, prompt).

import { SPRITE_FOOTPRINT, SPRITE_GAME_PX, assetSwatches, planAttachments } from "../catalog";
import type { Asset } from "../catalog";
import { canvasToImg, el, button, downloadCanvas, downloadUrl, swatch, toCanvas } from "./dom";
import { measureFootprint } from "../process";
import { attachmentFileName, attachmentLine, buildPrompt, stepText } from "../prompts";
import { guideCanvas, hasReal, proceduralSprite, realUrl } from "./sources";

const KIND_TEXT = { texture: "Seamless tileable texture", sprite: "Sprite, transparent background", portrait: "Character portrait" } as const;

function row(k: string, v: Node | string): HTMLElement { return el("div.kv", {}, el("span.k", {}, k), el("span.v", {}, v)); }

export function specCard(a: Asset): HTMLElement {
  const rows: HTMLElement[] = [
    row("File", el("code", {}, a.path)),
    row("Kind", KIND_TEXT[a.kind]),
    row("Output", `${a.outSize} × ${a.outSize} PNG${a.kind === "sprite" ? " with alpha" : ""}`),
    row("Order", `${stepText(a)} · #${a.order}`),
  ];
  if (a.kind === "texture") rows.push(row("Game scale", "one repeat = 256 world px = 8 tiles = 8 × 8 m (the 1024 guide: 128 px per metre)"));
  if (a.kind === "sprite") {
    const fp = SPRITE_FOOTPRINT[a.sprite], [g0, g1] = SPRITE_GAME_PX[a.sprite];
    const tuft = a.sprite === "tuft";
    const guideFp = measureFootprint(canvasToImg(proceduralSprite(a, 256)), tuft);
    const ok = Math.abs(guideFp - fp) <= 0.03;
    rows.push(row("Footprint", `${Math.round(fp * 100)}% of the ${tuft ? "width, base on the bottom edge" : "image (larger side), centred"}`));
    rows.push(row("Guide check", el(`span.${ok ? "ok" : "warn"}`, {}, `guide measures ${(guideFp * 100).toFixed(1)}% ${ok ? "✓" : `— differs from the ${Math.round(fp * 100)}% spec (terrainArt generator)`}`)));
    rows.push(row("In game", `drawn ${g0 === g1 ? g0 : `${g0}–${g1}`} px wide`));
  }
  if (a.kind === "portrait") rows.push(row("In game", "briefing / dialogue cards, 64–128 px"));
  return el("section.card.spec", {},
    el("div.spec-head", {},
      el("div", {}, el("h2", {}, a.title), el("div.sub", {}, el("code", {}, a.id))),
      el("div.chips", {}, el("span.tag.kind", {}, a.kind.toUpperCase()), hasReal(a) ? el("span.tag.real", {}, "REAL") : el("span.tag.proc", {}, "PROCEDURAL")),
    ),
    el("div.kvs", {}, ...rows),
    el("div.swatches", {}, ...assetSwatches(a).map((s) => swatch(s.hex, s.label))),
  );
}

function stepHead(n: string, title: string, hint: string): HTMLElement {
  return el("div.step-head", {}, el("span.num", {}, n), el("h3", {}, title), el("span.hint", {}, hint));
}

export function guideStep(a: Asset): HTMLElement {
  const g = guideCanvas(a);
  const thumb = toCanvas(g, 256, 256);
  thumb.className = "thumb";
  const name = attachmentFileName({ n: 1, role: "guide", asset: a });
  return el("section.card.step", {},
    stepHead("1", "Download guide", "1024 × 1024 PNG — always Image 1"),
    el("div.guide-row", {}, thumb,
      el("div", {},
        el("p", {}, a.kind === "sprite" ? "The game's procedural sprite on flat #FF00FF: it fixes the silhouette and footprint." : a.kind === "texture" ? "The game's procedural, seamless texture: it fixes the layout, colours and scale." : "The game's procedural bust: it fixes the framing, pose and colours."),
        button("Download guide", () => downloadCanvas(g, name), "btn primary"),
        el("div.fname", {}, name))));
}

export function attachStep(a: Asset, open: (x: Asset) => void): HTMLElement {
  const plan = planAttachments(a, hasReal);
  const items = plan.list.map((att) => {
    const fname = attachmentFileName(att);
    const url = att.role === "guide" ? null : realUrl(att.asset);
    const action = att.role === "guide"
      ? button("Download", () => downloadCanvas(guideCanvas(a), fname), "btn small")
      : url ? button("Download", () => downloadUrl(url, fname), "btn small") : button(`Make it first →`, () => open(att.asset), "btn small danger");
    return el("li", {}, el("span.att", {}, attachmentLine(att)), el("span.fname", {}, fname), action);
  });
  const notes = plan.missing.map((m) => m.required
    ? el("div.notice.bad", {}, `Missing required anchor: ${m.asset.id} (${m.asset.title}) has no real file yet. Make it first — 29 §B ${stepText(m.asset).toLowerCase()}.`)
    : el("div.notice.warn", {}, `${m.asset.id} (${m.asset.title}) doesn't exist yet, so it isn't attached and the prompt doesn't mention it. For the most consistent set, make it first.`, " ", button("Open it", () => open(m.asset), "btn small")));
  return el("section.card.step", {},
    stepHead("2", "Attach", `${plan.list.length} image${plan.list.length > 1 ? "s" : ""}, in this exact order`),
    el("ol.attach", {}, ...items),
    ...notes);
}

export function promptStep(a: Asset): HTMLElement {
  const plan = planAttachments(a, hasReal);
  const text = buildPrompt(a, plan);
  const pre = el("pre.prompt", {}, text);
  const status = el("span.copy-status", {});
  const copy = button("Copy prompt", () => {
    navigator.clipboard.writeText(text).then(
      () => { status.textContent = "Copied ✓"; setTimeout(() => (status.textContent = ""), 2000); },
      () => { status.textContent = "Clipboard blocked — select the text and copy"; },
    );
  }, "btn primary");
  return el("section.card.step", {},
    stepHead("3", "Copy prompt", `self-contained · ${text.length.toLocaleString()} characters`),
    el("div.prompt-bar", {}, copy, status, el("span.hint", {}, "Paste the whole block into Gemini together with the images above.")),
    pre);
}
