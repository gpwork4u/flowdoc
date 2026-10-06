import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/parse.js";
import { render as renderDoc } from "../src/render.js";
import { loadAssets, ROOT } from "../src/node/assets.js";

export { ROOT };
export const EXAMPLES = readdirSync(join(ROOT, "examples")).filter((f) => f.endsWith(".flow")).sort().map((f) => join(ROOT, "examples", f));
export const SYNC = join(ROOT, "examples", "catalog-search-sync.flow");
export const ACL = join(ROOT, "examples", "doc-search-acl.flow");
export const AVATAR = join(ROOT, "examples", "upload-avatar.flow");
export const read = (p) => readFileSync(p, "utf8");

export function load(path) {
  const { doc, issues } = parse(read(path));
  if (issues.length) throw new Error(`${path} 有 parse 問題：${issues.map((i) => i.format(path)).join("\n")}`);
  return doc;
}

const assets = loadAssets();
export const render = (doc, opts = {}) => renderDoc(doc, { assets, ...opts });
