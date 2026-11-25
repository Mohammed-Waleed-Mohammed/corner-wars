// The few Node APIs the art checker uses (@types/node isn't installed; tsc still type-checks
// src/dev/). Never imported by the game: the checker is bundled for Node by `npm run art`.

declare module "node:fs" {
  export interface Dirent { name: string; isDirectory(): boolean; isFile(): boolean }
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function renameSync(from: string, to: string): void;
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
}

declare module "node:zlib" {
  export function inflateSync(data: Uint8Array): Uint8Array;
}

declare module "node:crypto" {
  export function createHash(algorithm: "sha256"): { update(data: Uint8Array): { digest(encoding: "hex"): string } };
}
