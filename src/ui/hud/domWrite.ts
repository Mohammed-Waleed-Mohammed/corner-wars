// Per-frame HUD writes (31 §E perf): touch the DOM only when the value actually changed. Assigning
// textContent replaces the text node even when the string is identical, and every such mutation makes
// the browser recalculate style and layout — a dozen readouts rewritten at 60 fps was a measurable
// share of frame time in big battles. Reads (textContent, inline style, className, title) never force
// layout, so comparing first is cheap.

export function setText(el: HTMLElement, s: string): void {
  if (el.textContent !== s) el.textContent = s;
}

/** Inline style or custom property (`width`, `--cd`, …). The last value is remembered here (reading it
 *  back through CSSOM costs more than the comparison saves). */
const lastStyle = new WeakMap<HTMLElement, Map<string, string>>();
export function setStyle(el: HTMLElement, prop: string, v: string): void {
  let m = lastStyle.get(el);
  if (!m) { m = new Map(); lastStyle.set(el, m); }
  if (m.get(prop) === v) return;
  m.set(prop, v);
  el.style.setProperty(prop, v);
}

/** A percentage rounded to 0.1 so tiny float jitter doesn't count as a change. */
export function pct(frac: number): string {
  return `${Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 10}%`;
}

export function setClass(el: HTMLElement, cls: string): void {
  if (el.className !== cls) el.className = cls;
}

export function setTitle(el: HTMLElement, t: string): void {
  if (el.title !== t) el.title = t;
}

export function setHidden(el: HTMLElement, h: boolean): void {
  if (el.hidden !== h) el.hidden = h;
}

export function setDisabled(el: HTMLButtonElement, d: boolean): void {
  if (el.disabled !== d) el.disabled = d;
}
