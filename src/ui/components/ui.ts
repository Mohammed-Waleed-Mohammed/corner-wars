// Shared UI component kit (20 §A). Every screen builds from these so the whole front-end reads as one
// design language: three button tiers (primary/secondary/ghost), panels, and cards. Disabled buttons
// carry their reason as a tooltip (the file-16 tooltip standard = the native title attribute). Tokens
// live in constants (UI); the concrete CSS lives in style.css keyed off these class names.

export type ButtonKind = "primary" | "secondary" | "ghost";

export interface ButtonOpts {
  label: string;
  kind?: ButtonKind;
  onClick?: () => void;
  disabled?: boolean;
  reason?: string; // shown as a tooltip when disabled (20 §A: disabled-with-reason)
  hotkey?: string;
  className?: string;
  title?: string;
}

/** HTML-escape untrusted text before it touches innerHTML (map names, player names off the wire). */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(opts: ButtonOpts): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `ui-btn ${opts.kind ?? "secondary"}${opts.className ? " " + opts.className : ""}`;
  if (opts.hotkey) {
    const hk = el("span", "ui-btn-hk", opts.hotkey);
    b.append(hk);
  }
  b.append(el("span", "ui-btn-label", opts.label));
  setButtonState(b, opts.disabled ?? false, opts.disabled ? opts.reason : opts.title);
  if (opts.onClick) b.addEventListener("click", () => { if (!b.disabled) opts.onClick!(); });
  return b;
}

/** Update a button's enabled state + tooltip in place (disabled → 40% opacity via CSS + reason). */
export function setButtonState(b: HTMLButtonElement, disabled: boolean, tooltip?: string): void {
  b.disabled = disabled;
  b.classList.toggle("is-disabled", disabled);
  b.title = tooltip ?? "";
}

export interface PanelOpts {
  title?: string;
  className?: string;
}

export function panel(opts: PanelOpts = {}): HTMLElement {
  const p = el("div", `ui-panel${opts.className ? " " + opts.className : ""}`);
  if (opts.title) p.append(el("div", "ui-panel-title", opts.title));
  return p;
}

/** A clickable card (used by the PLAY expander, map browser, formation picker…). */
export function card(opts: { className?: string; onClick?: () => void }): HTMLElement {
  const c = el("div", `ui-card${opts.className ? " " + opts.className : ""}`);
  if (opts.onClick) { c.tabIndex = 0; c.addEventListener("click", opts.onClick); }
  return c;
}
