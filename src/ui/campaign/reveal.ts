// Text reveal helpers for the story screens. The full text is laid out from the start (the
// unrevealed tail is visibility:hidden), so typing never shifts the layout. Timers only; no rAF
// work when idle. Every controller can be finished (show all) or cancelled (teardown).

export interface Reveal {
  /** Show everything now. */
  finish: () => void;
  /** Stop timers without changing what is shown (screen teardown). */
  cancel: () => void;
  readonly done: boolean;
}

/** Type `text` into `target` at `cps` characters per second. */
export function typewriter(target: HTMLElement, text: string, cps: number, onDone?: () => void, startDelayMs = 0): Reveal {
  const shown = document.createElement("span");
  const rest = document.createElement("span");
  rest.className = "st-type-rest";
  rest.style.visibility = "hidden";
  rest.textContent = text;
  const caret = document.createElement("span");
  caret.className = "st-caret";
  target.replaceChildren(shown, caret, rest);
  let i = 0;
  let done = false;
  let timer = 0;
  const step = 1000 / Math.max(1, cps);
  const finish = (): void => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    shown.textContent = text;
    rest.textContent = "";
    caret.remove();
    onDone?.();
  };
  const tick = (): void => {
    // Pause a beat on punctuation so sentences read like speech.
    i = Math.min(text.length, i + 1);
    shown.textContent = text.slice(0, i);
    rest.textContent = text.slice(i);
    if (i >= text.length) { finish(); return; }
    const ch = text[i - 1];
    timer = window.setTimeout(tick, ".!?".includes(ch) ? step * 7 : ",;:—".includes(ch) ? step * 3 : step);
  };
  timer = window.setTimeout(tick, startDelayMs);
  return { finish, cancel: () => window.clearTimeout(timer), get done() { return done; } };
}

/**
 * Reveal paragraphs one at a time into `container` (each typed, then a pause). All paragraphs are
 * laid out up front so the block never grows while it types.
 */
export function revealParagraphs(
  container: HTMLElement,
  paragraphs: string[],
  opts: { cps?: number; gapMs?: number; startDelayMs?: number; className?: string; onDone?: () => void } = {},
): Reveal {
  const cps = opts.cps ?? 70;
  const gap = opts.gapMs ?? 450;
  const els = paragraphs.map((t) => {
    const p = document.createElement("p");
    p.className = `${opts.className ?? "st-para"} pending`;
    p.textContent = t;
    container.append(p);
    return p;
  });
  let k = -1;
  let current: Reveal | null = null;
  let timer = 0;
  let done = false;
  const complete = (): void => { if (!done) { done = true; opts.onDone?.(); } };
  const next = (): void => {
    k++;
    if (k >= els.length) { complete(); return; }
    const p = els[k];
    p.classList.remove("pending");
    p.classList.add("live");
    current = typewriter(p, paragraphs[k], cps, () => {
      p.classList.remove("live");
      timer = window.setTimeout(next, gap);
    });
  };
  timer = window.setTimeout(next, opts.startDelayMs ?? 0);
  return {
    finish: () => {
      if (done) return;
      window.clearTimeout(timer);
      current?.cancel();
      els.forEach((p, j) => { p.classList.remove("pending", "live"); p.textContent = paragraphs[j]; });
      k = els.length;
      complete();
    },
    cancel: () => { window.clearTimeout(timer); current?.cancel(); },
    get done() { return done; },
  };
}
