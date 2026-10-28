// Art Lab — run a dropped Gemini output through processing (29 §C) and QA (29 §D) for an asset.

import { characterInfo } from "../../content/factions";
import { PORTRAIT_OUT, SPRITE_FOOTPRINT, SPRITE_OUT, assetTone } from "../catalog";
import type { Asset } from "../catalog";
import { hexToRgb, resample } from "../image";
import type { RGB } from "../image";
import { processPortrait, processSprite, processTexture } from "../process";
import { qaPortrait, qaSprite, qaTexture } from "../qa";
import { canvasToImg, fileToImg, imgToCanvas } from "./dom";
import { guideCanvas } from "./sources";
import { persisted } from "./state";
import type { Session } from "./state";

const ACCEPT = /^image\/(png|jpeg|webp)$/;

export async function sessionFromFile(file: File): Promise<Session> {
  if (!ACCEPT.test(file.type)) throw new Error(`${file.name}: not a PNG, JPEG or WebP image (${file.type || "unknown type"})`);
  const source = await fileToImg(file);
  return { file: file.name, source, result: null, report: null, out: null, error: null, saved: null };
}

export function textureTarget(a: Asset): RGB {
  return a.kind === "portrait" ? [0, 0, 0] : [...assetTone(a).mid] as RGB;
}

/** (Re)process the session's source with the current Palette lock / Trim settings. */
export function runPipeline(a: Asset, s: Session): void {
  s.error = null; s.saved = null;
  try {
    if (a.kind === "texture") {
      const target = textureTarget(a);
      const r = processTexture(s.source, { target, lock: persisted.lock, trim: persisted.trim });
      const g = canvasToImg(guideCanvas(a));
      const guide = resample(g, 0, 0, g.width, g.height, 512, 512);
      s.result = { kind: "texture", r };
      s.report = qaTexture(r, { target, lock: persisted.lock, bridge: a.tex === "bridge", guide });
      s.out = imgToCanvas(r.out);
    } else if (a.kind === "sprite") {
      const o = { footprint: SPRITE_FOOTPRINT[a.sprite], out: SPRITE_OUT[a.sprite], baseAtBottom: a.sprite === "tuft" };
      const r = processSprite(s.source, o);
      s.result = { kind: "sprite", r };
      s.report = qaSprite(r, o);
      s.out = r.out ? imgToCanvas(r.out) : null;
    } else {
      const backdrop = hexToRgb(characterInfo(a.charId)!.portrait.bg);
      const r = processPortrait(s.source, { out: PORTRAIT_OUT, trim: persisted.trim, backdrop });
      s.result = { kind: "portrait", r };
      s.report = qaPortrait(r, { backdrop });
      s.out = imgToCanvas(r.out);
    }
  } catch (e) {
    s.result = null; s.report = null; s.out = null;
    s.error = e instanceof Error ? e.message : String(e);
  }
}

export interface SaveResponse { ok: boolean; error?: string; path?: string; bytes?: number }

/** POST the processed PNG to the dev server (vite.config.ts → /__artlab/save). */
export async function saveToGame(a: Asset, out: HTMLCanvasElement): Promise<SaveResponse> {
  const dataUrl = out.toDataURL("image/png");
  try {
    const res = await fetch("/__artlab/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: a.path, dataUrl }) });
    const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as SaveResponse;
    return res.ok ? json : { ok: false, error: json.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: `${e instanceof Error ? e.message : String(e)} — is the Vite dev server running (npm run dev)?` };
  }
}
