// Procedural TREES (26 §D): every TreeSpecies, top-down, light from the top-left, crown ≈ 85% of
// the sprite (radius 42.5 units around the centre). Broadleaves and conifers live here; desert,
// bare, wetland, crystal species and the ash fern are in treesExotic.ts.

import type { BiomeDef, TreeSpecies } from "../../content/biomes";
import { branches, C, CROWN, needles, puffCrown, puffLayout, snowDots, starLayers, tint, toneOf, type G, type Rnd } from "./spriteKit";
import { drawExoticTree } from "./treesExotic";

/** Draw one tree species into a 100-unit sprite context. `variant` only nudges proportions. */
export function drawTree(g: G, r: Rnd, sp: TreeSpecies, b: BiomeDef, variant: number): void {
  const fol = b.foliage, R = CROWN, snowy = b.weather === "snow";
  switch (sp) {
    case "oak": {
      const puffs = puffLayout(r, C, C, R, 9 + (variant % 2), 0.36);
      puffCrown(g, r, puffs, fol, R, C, C, 150);
      return;
    }
    case "bushy": {
      const puffs = puffLayout(r, C, C, R, 14, 0.27);
      puffCrown(g, r, puffs, tint(fol, [1.05, 1.12, 0.95]), R, C, C, 190);
      return;
    }
    case "beech": {
      const puffs = puffLayout(r, C, C, R, 7, 0.43);
      puffCrown(g, r, puffs, tint(fol, [0.9, 1.0, 1.08]), R, C, C, 130);
      return;
    }
    case "birch": {
      branches(g, r, C, C, R * 0.95, [226, 222, 212], 7, 2.6, 2);
      const puffs = puffLayout(r, C, C, R, 12, 0.24);
      puffCrown(g, r, puffs, tint(fol, [1.18, 1.22, 0.9]), R, C, C, 170, 0.82);
      return;
    }
    case "pine": {
      const tn = tint(fol, [0.92, 0.98, 1.0]);
      starLayers(g, r, C, C, R, tn, { layers: 4, points: 11, inner: 0.56, jag: 0.35, top: 0.32 });
      needles(g, r, C, C, R * 0.95, tn, 140);
      return;
    }
    case "fir":
      starLayers(g, r, C, C, R, tint(fol, [0.82, 0.92, 1.0]), { layers: 5, points: 8, inner: 0.5, jag: 0.12, top: 0.22 });
      return;
    case "snowSpruce":
      starLayers(g, r, C, C, R, tint(fol, [0.85, 0.95, 1.0]), { layers: 5, points: 9, inner: 0.5, jag: 0.22, top: 0.2, snow: 0.9 });
      snowDots(g, r, R, 26);
      return;
    case "larch": {
      // Late-autumn larch: muted bronze needles, snow-dusted in the north so it doesn't shout.
      const tn = toneOf([70, 58, 34], [122, 100, 58], [170, 150, 104]);
      starLayers(g, r, C, C, R, tn, { layers: 4, points: 14, inner: 0.62, jag: 0.3, top: 0.3, snow: snowy ? 0.5 : 0 });
      needles(g, r, C, C, R * 0.95, tn, 160);
      if (snowy) snowDots(g, r, R, 22);
      return;
    }
    case "dwarfPine": {
      const tn = tint(fol, [0.9, 1.0, 0.95]), n = 4 + (variant % 2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r() * 0.5, rr = R * (0.42 + 0.08 * r());
        const x = C + Math.cos(a) * (R - rr), y = C + Math.sin(a) * (R - rr);
        starLayers(g, r, x, y, rr, tn, { layers: 3, points: 9, inner: 0.55, jag: 0.3, top: 0.35, snow: snowy ? 0.75 : 0 });
      }
      starLayers(g, r, C - 2, C - 2, R * 0.5, tn, { layers: 3, points: 10, inner: 0.55, jag: 0.3, top: 0.35, snow: snowy ? 0.8 : 0 });
      return;
    }
    case "cypress": {
      g.save();
      g.translate(C, C); g.scale(0.62, 1); g.translate(-C, -C); // narrow column crown
      starLayers(g, r, C, C, R, tint(fol, [0.78, 0.88, 0.85]), { layers: 6, points: 12, inner: 0.72, jag: 0.15, top: 0.2 });
      g.restore();
      return;
    }
    default:
      drawExoticTree(g, r, sp, b, variant);
  }
}
