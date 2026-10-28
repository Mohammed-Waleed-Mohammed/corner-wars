// 29 — tree species (26 §D), seen from straight above. `variant` is the occurrence of the species in
// its biome's six slots (Saltglass has two palms → variants 0 and 1), so repeats differ.

import type { TreeSpecies } from "../../content/biomes";
import type { SpriteDesc } from "./types";

const CROWN_ONLY = ["a trunk or branches sticking out of the crown", "roots"];
const pick = <T>(xs: readonly T[], v: number): T => xs[Math.min(v, xs.length - 1)];

export const TREE_DESC: Record<TreeSpecies, (variant: number) => SpriteDesc> = {
  // ── Verdant ──
  oak: () => ({ name: "Oak", subject: "the full, round crown of a mature oak tree", detail: [
    "built from 7 to 10 overlapping, billowing clusters of lobed leaves, each cluster lit on its top-left and shaded on its bottom-right",
    "rich mid-greens (#46703a), yellow-green highlights (#7aa04a), deep green shadowed gaps (#22381c) between clusters",
    "a slightly irregular, natural round outline",
  ], exclude: CROWN_ONLY }),
  bushy: () => ({ name: "Bushy broadleaf", subject: "the smaller, lopsided crown of a young broadleaf tree", detail: [
    "an irregular crown of fresh, light yellow-green leaves (#6a9a3a, highlights #a0c060)",
    "a few small gaps inside the crown filled with darker inner leaves (#2e4a22), never background",
  ], exclude: CROWN_ONLY }),
  beech: () => ({ name: "Beech", subject: "the dense, slightly oval crown of a beech tree", detail: [
    "small leaves packed tightly in smooth-edged masses, deep dark green (#2e5228) with modest top-left highlights (#5a8a3e)",
    "deep shadowed gaps (#162814) between the leaf masses; clearly darker and denser than the oak",
  ], exclude: CROWN_ONLY }),
  birch: () => ({ name: "Birch", subject: "the light, airy crown of a birch tree", detail: [
    "many small, fine leaves in pale silvery green (#9ab87a) and soft lime (#b8d070), with a feathery edge",
    "the inside of the crown shows darker green inner leaves (#4a6a3a); the background never shows through the crown",
  ], exclude: CROWN_ONLY }),
  pine: () => ({ name: "Pine", subject: "a pine tree seen from directly above its tip", detail: [
    "layered, needle-covered branches radiating from the centre in a roughly round, slightly jagged star",
    "dark blue-green needles (#2a4a3a), lighter green (#4a7a52) on the top-left of each branch layer, darker between layers",
    "the tip of the tree as a small bright point in the exact centre",
  ], exclude: ["a trunk", "cones larger than a needle tuft"] }),
  fir: () => ({ name: "Fir", subject: "a tall fir tree seen from directly above its tip", detail: [
    "dense, overlapping round layers of dark green needles (#24402c), fuller and rounder than a pine's star",
    "bright fresh lime-green new growth (#8ab84a) on the branch tips",
    "the top of the tree as a small point in the exact centre",
  ], exclude: ["a trunk", "cones"] }),
  // ── Saltglass ──
  palm: (v) => ({ name: v === 0 ? "Date palm" : "Young date palm", subject: v === 0 ? "a mature date palm seen from directly above its crown" : "a younger date palm seen from directly above its crown", detail: [
    pick(["14 to 16 long, arching feather-shaped fronds radiating evenly from a central point", "9 to 11 shorter fronds radiating from a central point, one of them dead and drooping"], v),
    "fronds in dusty olive green (#6c7a3a, highlights #9aa858), the older outer fronds yellowing (#b8a050) at the tips",
    pick(["a few clusters of orange-brown dates (#a8642a) close to the centre", "no fruit; one dead frond in dry brown (#8a6a3a)"], v),
  ], exclude: ["a trunk", "coconuts", "green grass under it"] }),
  acacia: (v) => ({ name: v === 0 ? "Acacia" : "Spreading acacia", subject: "the flat-topped umbrella crown of an acacia tree, seen from straight above", detail: [
    pick(["one wide, flat, irregular canopy", "a wider canopy split into two uneven lobes"], v),
    "made of masses of tiny leaflets in dusty olive (#7a8a4a, highlights #a8b070), slightly airy at the edge",
    "thin, dark thorny branch tips (#4a3a2a) visible at the very edge of the canopy",
  ], exclude: ["a trunk", "flowers"] }),
  cactus: () => ({ name: "Columnar cactus", subject: "a cluster of columnar cactus stems seen from straight above", detail: [
    "3 to 5 round, ribbed stem tops of different sizes grouped together, each a circle of radiating ribs",
    "grey-green (#5a7a4a) skin with pale tips (#9ab07a); tiny cream (#e8dcb0) spines along the ribs",
    "a few small cream-white flowers on the stem tops",
  ], exclude: ["pink, red or magenta flowers", "a pot", "sand"] }),
  thorn: () => ({ name: "Thorn tree", subject: "a sparse, twisted thorn tree seen from straight above", detail: [
    "twisted dark grey-brown branches (#4a3a2a) spreading from the centre",
    "small, scattered clumps of grey-green leaves (#7a8a5a) along the branches, and long pale thorns (#d8ccb0)",
    "the spaces between branches are open — flat background shows through them",
  ], exclude: ["a dense green crown", "flowers"] }),
  // ── Frostmarch ──
  snowSpruce: (v) => ({ name: pick(["Snowy spruce", "Young snowy spruce", "Old snowy spruce"], v), subject: "a snow-laden spruce seen from directly above its tip", detail: [
    "star-like tiers of dark green needles (#2e4a3c) radiating from the centre",
    pick(["about half of every branch covered in thick snow (#f0f4f8) with blue shadows (#b8c8dc)", "a narrower tree, two-thirds covered in snow", "a broad old tree with heavier branches, about a third covered in snow"], v),
    "the tip as a small snowy point in the exact centre",
  ], exclude: ["a trunk", "snow on the background"] }),
  bareBirch: () => ({ name: "Bare birch", subject: "a leafless winter birch seen from straight above", detail: [
    "a fine network of thin white-grey branches (#d8d4cc) radiating from a pale trunk top in the centre, dividing into ever thinner twigs",
    "thin lines of snow along the upper side of the bigger branches",
    "flat background shows between the branches",
  ], exclude: ["leaves", "a snowy ground disc"] }),
  larch: () => ({ name: "Autumn larch", subject: "a larch in autumn colour seen from directly above its tip", detail: [
    "soft tiers of fine needles in golden yellow (#c89a3a) and amber (#b8742a), lighter (#e0b85a) on the top-left of each tier",
    "a light frosting of white on the outer tips",
  ], exclude: ["a trunk", "green summer needles"] }),
  dwarfPine: () => ({ name: "Dwarf pine", subject: "a low, spreading mountain pine seen from straight above", detail: [
    "an irregular, wide mat of dark green needle clumps (#2a4434), wider than it is tall",
    "patches of snow (#eef2f6) lying in the hollows of the mat",
  ], exclude: ["a trunk", "a star shape"] }),
  // ── Cinder ──
  charred: (v) => ({ name: pick(["Charred tree", "Split charred tree", "Charred stump-tree"], v), subject: "a dead, burned tree seen from straight above", detail: [
    pick(["the charred top of the trunk in the centre with 5 or 6 broken, stubby limbs radiating out", "a trunk split in two, each half with a few broken limbs", "a short trunk with 3 long, bare, crooked limbs"], v),
    "charcoal-black wood (#1e1a18) with cracked, alligator-skin char; grey ash (#6a625a) on the upper surfaces",
    "a few faint orange ember glows (#c04a1a) deep in the cracks",
  ], exclude: ["leaves", "flames or smoke"] }),
  burntPine: (v) => ({ name: v === 0 ? "Burnt pine" : "Half-burnt pine", subject: "a scorched pine seen from directly above its tip", detail: [
    "a star of branches radiating from the centre",
    pick(["mostly dead rust-brown needles (#6a3a20) and black char (#1e1a18)", "half the needles dead rust-brown (#6a3a20), half surviving dull green (#3a4a32)"], v),
    "grey ash dust on the upper sides",
  ], exclude: ["a trunk", "flames"] }),
  ashFern: () => ({ name: "Ash tree-fern", subject: "a giant tree-fern seen from straight above", detail: [
    "a rosette of 8 to 10 long, finely divided fronds radiating from the centre",
    "dusty grey-green fronds (#5a5a4a) coated in pale ash (#8a847a), darker towards the centre",
  ], exclude: ["a trunk", "bright green"] }),
  // ── Mire ──
  mangrove: (v) => ({ name: v === 0 ? "Mangrove" : "Young mangrove", subject: "the crown of a mangrove tree seen from straight above", detail: [
    "a dense, lumpy, rounded crown of glossy oval leaves",
    pick(["dark glossy green (#3c5a2c) with paler leaf undersides showing at the edge (#7a9a5a)", "a smaller crown in lighter green (#4a6a32) with a few yellowing leaves (#a89a3a)"], v),
  ], exclude: CROWN_ONLY.concat(["water"]) }),
  willow: (v) => ({ name: v === 0 ? "Weeping willow" : "Young willow", subject: "a weeping willow seen from straight above", detail: [
    "a round, soft crown made of long hanging strands of thin leaves that spill outward from the centre",
    pick(["pale silvery green (#8aa060) with yellow-green tips (#b0c070)", "a smaller crown in fresher green (#7a9a4a)"], v),
    "a feathery, ragged outline",
  ], exclude: CROWN_ONLY }),
  cypress: () => ({ name: "Bald cypress", subject: "a bald cypress seen from directly above its tip", detail: [
    "a narrow, soft, rounded star of fine feathery needles",
    "rusty olive-green (#5a6a3a) with orange-brown tips (#9a6a3a)",
  ], exclude: ["a trunk", "knees or roots"] }),
  reeds: () => ({ name: "Reed bed", subject: "a dense clump of tall reeds seen from straight above", detail: [
    "many long, narrow reed leaves arching outward from the centre in every direction, roughly round overall",
    "olive green leaves (#7a8a4a) with feathery tan-brown seed plumes (#a08a5a) near the centre",
  ], exclude: ["purple or pink plumes", "water"] }),
  // ── Scar ──
  crystal: (v) => ({ name: pick(["Crystal cluster", "Crystal ring", "Twin crystal cluster"], v), subject: "a cluster of large violet crystals seen from straight above", detail: [
    pick(["tall hexagonal crystal prisms pointing up and outward from one centre", "a wide ring of prisms around a few short central points", "two crystal clusters grown into each other"], v),
    "translucent violet (#7a5ac8) with bright lavender facets (#c0a8ff) on the top-left and dark indigo facets (#3a2a6a) on the bottom-right",
    "a soft inner glow in the centre, contained inside the crystal",
  ], exclude: ["pink or magenta", "a glow spilling onto the background", "ground"] }),
  glassTree: (v) => ({ name: v === 0 ? "Glass tree" : "Young glass tree", subject: "a tree turned to glass, seen from straight above", detail: [
    "a branching crown of translucent glassy branches with leaf-shaped crystal plates",
    pick(["pale lilac-white glass (#d8d0f0) with cool lavender shadows (#9a8ac0)", "a smaller crown in clearer, bluer glass (#c8d0f0)"], v),
    "small refractive highlights on the top-left facets",
  ], exclude: ["pink or magenta", "green leaves", "glow on the background"] }),
  crystalDead: () => ({ name: "Crystal-grown dead tree", subject: "a dead tree overgrown by crystal, seen from straight above", detail: [
    "grey-black dead branches (#3a3438) radiating from the centre",
    "violet crystal growths (#7a5ac8, facets #c0a8ff) bursting from the branch joints and tips",
  ], exclude: ["leaves", "pink or magenta"] }),
};
