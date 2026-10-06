// Node 端：讀 skill/assets 的共用樣式與 runtime，以及入門範例。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadAssets() {
  return {
    css: readFileSync(join(ROOT, "skill", "assets", "page.css"), "utf8"),
    js: readFileSync(join(ROOT, "skill", "assets", "runtime.js"), "utf8"),
  };
}

export const STARTER = join(ROOT, "examples", "upload-avatar.flow");
