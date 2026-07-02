// Player color assignment (18 §H). Pure + DOM-free so it's headlessly testable. The host runs this
// on every roster change to give each seat a distinct palette color: human seats keep their requested
// color in playerId order (host seat 0 gets first pick), a clash falls back to the next free index,
// and AI/empty seats take the leftovers. With ≤4 seats and 4 colors a full permutation always exists.

export interface ColorSeat {
  kind: string; // "human" | "ai" | "open" | "closed"
  playerId: number; // 0..3
  colorPref?: number; // the occupant's requested color index (humans only)
}

/** Returns a palette index (0..3) per input seat, in the seats' original order. */
export function assignColorIndices(slots: ColorSeat[]): number[] {
  const taken = new Set<number>();
  const firstFree = (): number => {
    for (let i = 0; i < 4; i++) if (!taken.has(i)) return i;
    return 0;
  };
  const out = new Array<number>(slots.length).fill(0);
  // Humans first, honoring preference when free.
  slots.forEach((s, i) => {
    if (s.kind !== "human") return;
    let idx = typeof s.colorPref === "number" && s.colorPref >= 0 && s.colorPref <= 3 ? Math.floor(s.colorPref) : s.playerId;
    if (taken.has(idx)) idx = firstFree();
    out[i] = idx;
    taken.add(idx);
  });
  // Then everyone else takes the leftovers.
  slots.forEach((s, i) => {
    if (s.kind === "human") return;
    const idx = firstFree();
    out[i] = idx;
    taken.add(idx);
  });
  return out;
}
