// 29 §F — portrait prompts: head-and-shoulders, ¾ view, painterly realistic briefing portraits with a
// faction-colour rim light on a plain dark backdrop. Framing comes from the guide (render/portraits.ts).

import { FACTIONS, characterInfo, fullName } from "../../content/factions";
import { EMBLEM_DESC, GUIDE_SIZE, portraitDesc } from "../catalog";
import type { AttachPlan, PortraitAsset } from "../catalog";
import { DO_NOT_COMMON, assemble, bullets, numbered, referenceLines, section } from "./common";

const NEUTRAL_RIM = "#d0a060"; // factionless characters: a warm amber rim

export function portraitPrompt(a: PortraitAsset, plan: AttachPlan): string {
  const info = characterInfo(a.charId)!;
  const d = portraitDesc(a);
  const p = info.portrait;
  const fac = info.faction === "none" ? null : FACTIONS[info.faction];
  const rim = fac?.color ?? NEUTRAL_RIM;
  const who = `${fullName(info)}${info.title && !fullName(info).includes(info.title) ? `, ${info.title}` : ""}`;
  const side = fac ? `of ${fac.name}` : "(no faction)";
  const glyph = !d.human;

  const task = section("TASK", [
    `Repaint Image 1 as a finished character portrait of ${who} ${side}, for the mission briefing and radio-dialogue screens of "The Fall of the Citadel", a grounded military sci-fi real-time strategy game set in 2071.`,
    `Output exactly ONE square image, ${GUIDE_SIZE} × ${GUIDE_SIZE} pixels.`,
    `Image 1 is the game's own placeholder ${glyph ? "glyph" : "bust"} for this character: it fixes the framing, pose, size and colours. Paint it as a finished, painterly realistic portrait — do not recompose it.`,
  ]);

  const keep = section("KEEP EXACTLY", bullets(glyph ? [
    `Canvas: square, ${GUIDE_SIZE} × ${GUIDE_SIZE} px.`,
    "Framing: the glyph centred exactly where Image 1 has it (centre at about 48% of the height), the outer hexagon about 60% of the image width; the row of signal bars near the bottom, as in Image 1.",
    `Colours: the glyph in Halcyon gold ${p.trim}, its eye in pale gold ${p.eyes}, on a near-black backdrop ${p.bg}.`,
  ] : [
    `Canvas: square, ${GUIDE_SIZE} × ${GUIDE_SIZE} px.`,
    "Framing: a head-and-shoulders bust, centred, exactly as Image 1: the centre of the head at about 42% of the image height, the head about half the image width, the shoulders running off the bottom edge. Nothing else touches an edge.",
    "Pose: a three-quarter view — the head turned about 20° toward the viewer's left, the eyes looking at the viewer, the shoulders square to the camera.",
    p.headwear === "mask"
      ? `Colours from the character sheet: mask ${p.skin}, hood ${p.hair}, eye-slit glow ${p.eyes}, robes ${p.uniform}, trim and insignia ${p.trim}.`
      : `Colours from the character sheet: skin ${p.skin}, hair ${p.hair}, eyes ${p.eyes}, uniform ${p.uniform}, trim and insignia ${p.trim}.`,
    `Backdrop: dark and plain in ${p.bg}, with only a soft, slightly lighter glow behind the head. Ignore the faint emblem watermark in Image 1's backdrop — do not paint it.`,
  ]));

  const paint = section("PAINT", [
    ...bullets([
      glyph ? `What it is: ${d.age}.` : `Age: ${d.age}.`,
      `Face: ${d.face}.`,
      ...(glyph ? [] : [`Hair: ${d.hair}.`]),
      `${glyph ? "Below the glyph" : "Clothes"}: ${d.wear}.`,
      ...(fac && !glyph ? [`Insignia: a small badge on the collar — ${EMBLEM_DESC[fac.id]} — in ${p.trim}.`] : []),
      `Expression: ${d.expression}.`,
      ...d.extra.map((x) => `${x[0].toUpperCase()}${x.slice(1)}.`),
    ]),
    `Who they are: ${info.bio}`,
  ]);

  const style = section("STYLE", bullets([
    "Painterly realistic, like the commander briefing portraits of 2000s real-time strategy games (the C&C Generals / StarCraft II era) — an original character in an original style, not a copy of any game, film or real person.",
    "Confident, visible brushwork with a finished, polished face; realistic anatomy and proportions; grounded and serious, never glamorous.",
    "Readable small: in the game the portrait is shown at 64–128 px, so the head shape, the face and the rim light must read instantly.",
    "NOT a photograph, NOT a 3D render, NOT cartoon, anime or comic style.",
  ]));

  const light = section("LIGHT", bullets([
    "Key light: soft, from the top-left at 45°, lighting the left side of the face.",
    `Rim light: a thin, clear rim light in ${rim}${fac ? ` (${fac.short} colour)` : ""} along the right edge of the ${glyph ? "glyph" : "face, hair and shoulders"}.`,
    "Even exposure across the face: no lens flare, no harsh spotlight, no blown-out highlights.",
  ]));

  const rules = section("RULES", numbered([
    `The backdrop is plain and dark in ${p.bg}: no scenery, no room, no sky, no emblem, no pattern, no props.`,
    "No text of any kind: no names, letters, numbers, captions, logos or watermarks.",
    "No frame, border, vignette ring, rounded corners, nameplate or UI.",
    glyph ? "Exactly one glyph and nothing else: no human features at all." : "Exactly one person, alone in the frame.",
    "Keep Image 1's framing: the same crop, the same head position and the same head size.",
  ]));

  const refs = section("REFERENCES", bullets(referenceLines(plan.list, a)));

  const doNot = section("DO NOT", bullets([
    ...DO_NOT_COMMON,
    "a background scene, other people, hands in the frame or props",
    ...d.exclude,
    "a frame, nameplate or caption",
  ]));

  return assemble([task, keep, paint, style, light, rules, refs, doNot]);
}
