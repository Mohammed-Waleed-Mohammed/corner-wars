# Portraits (drop-in)

Each character's portrait is a PNG named after its id: `src/assets/portraits/<id>.png`, 512 × 512, square, opaque. The game finds files here automatically (`render/portraits.ts`, Vite glob). If a file is missing, the game draws the procedural bust instead, so it never shows a 404. The spec is in `description/29-art-pipeline.md` §C and §E.

**Make them with the Art Lab.** Run `npm run dev` and open http://localhost:5173/artlab.html, then go to **Portraits**. For each character the Art Lab gives you:

- a 1024 guide (the procedural bust: framing, pose and colours);
- the attach list (the first finished portrait is the style anchor, 29 §B step 5);
- the full Gemini prompt.

When you drop Gemini's output into the Art Lab, it crops the image to a square at 512 and saves it here.

**Ids, in generation order.** The first one becomes the style anchor for the rest:

- **Commanders:** `varga`, `haddad`, `marchetti`, `achterberg`, `okafor`, `lindqvist`, `cantor`, `penitent`
- **Supporting cast:** `osei`, `ruiz`, `meridian`, `juniper`, `vex`, `kade`, `severance`
- **No portrait:** `narrator`

**Look**

- Head-and-shoulders, three-quarter view.
- Painterly realistic, in the style of 2000s RTS briefing portraits (original characters, not copies of any game).
- Key light from the top-left; a rim light in the faction colour.
- A plain, dark backdrop in the character's backdrop colour (`PortraitSpec.bg` in `src/content/factions.ts`).
- No text and no frame.
- **The Penitent** wears a smooth, featureless mask.
- **MERIDIAN** is an abstract gold AI glyph, not a face.
