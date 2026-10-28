// Vite config. The only addition is the Art Lab's dev-only save endpoint (file 29 §E). `vite build`
// is unaffected: the plugin has `apply: "serve"`, and with no `build.rollupOptions.input` Vite builds
// only index.html, so artlab.html and src/artlab/ never reach the production bundle.
//
// This file is NOT type-checked by `tsc` (tsconfig includes only src/, and @types/node isn't
// installed); Vite strips its types when it loads it.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

/** Where the Art Lab may write: terrain art per biome, and portraits. Lower-case snake_case PNGs only. */
export const ARTLAB_SAVE_PATH = /^src\/assets\/(terrain\/(verdant|saltglass|frostmarch|cinder|mire|scar)|portraits)\/[a-z0-9_]+\.png$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_BODY = 40 * 1024 * 1024; // a 1024² PNG as base64 is < 6 MB; this only stops runaway uploads

/** Validate a save request. Returns the absolute target and the PNG bytes, or an error message. */
export function validateSave(root: string, body: unknown): { file: string; png: Uint8Array } | { error: string } {
  if (!body || typeof body !== "object") return { error: "body must be a JSON object { path, dataUrl }" };
  const { path, dataUrl } = body as { path?: unknown; dataUrl?: unknown };
  if (typeof path !== "string" || typeof dataUrl !== "string") return { error: "path and dataUrl must be strings" };
  if (path.includes("\\") || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return { error: `path must be relative with forward slashes: ${path}` };
  if (posix.normalize(path) !== path || path.split("/").some((s) => s === ".." || s === "." || s === "")) return { error: `path is not normalized: ${path}` };
  if (!ARTLAB_SAVE_PATH.test(path)) return { error: `path not allowed: ${path} (must match ${ARTLAB_SAVE_PATH.source})` };
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return { error: "dataUrl must be a base64 PNG data URL (data:image/png;base64,…)" };
  const png = Uint8Array.from(Buffer.from(m[1], "base64"));
  if (png.length < 64 || PNG_SIGNATURE.some((b, i) => png[i] !== b)) return { error: "data is not a PNG (bad signature)" };
  const assets = resolve(root, "src", "assets") + sep;
  const file = resolve(root, ...path.split("/"));
  if (!file.startsWith(assets)) return { error: "path escapes src/assets" };
  return { file, png };
}

/** Dev-only: POST /__artlab/save { path, dataUrl } → writes the PNG → { ok: true, path, bytes } | { ok: false, error }. */
export function artLabSave(): Plugin {
  return {
    name: "artlab-save",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__artlab/save", (req, res) => {
        const reply = (status: number, json: object): void => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(json));
        };
        if (req.method !== "POST") { reply(405, { ok: false, error: "POST only" }); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        let aborted = false;
        req.on("data", (c: Buffer) => {
          if (aborted) return;
          size += c.length;
          if (size > MAX_BODY) { aborted = true; reply(413, { ok: false, error: "body too large" }); req.destroy(); return; }
          chunks.push(c);
        });
        req.on("end", () => {
          if (aborted) return;
          let body: unknown;
          try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { reply(400, { ok: false, error: "invalid JSON" }); return; }
          const v = validateSave(server.config.root, body);
          if ("error" in v) { reply(400, { ok: false, error: v.error }); return; }
          mkdir(dirname(v.file), { recursive: true })
            .then(() => writeFile(v.file, v.png))
            .then(() => {
              server.config.logger.info(`[artlab] saved ${(body as { path: string }).path} (${v.png.length} bytes)`, { timestamp: true });
              reply(200, { ok: true, path: (body as { path: string }).path, bytes: v.png.length });
            })
            .catch((e: unknown) => reply(500, { ok: false, error: `write failed: ${e instanceof Error ? e.message : String(e)}` }));
        });
        req.on("error", (e: Error) => { if (!aborted) reply(400, { ok: false, error: e.message }); });
      });
    },
  };
}

export default defineConfig({
  plugins: [artLabSave()],
});
