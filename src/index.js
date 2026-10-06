// 瀏覽器與 Node 共用的入口：不碰檔案系統、不呼叫外部程式。

export { parse } from "./parse.js";
export { verifyDoc, verifyFlow, verifyHtml } from "./verify.js";
export { render, flowData, usedLegend } from "./render.js";
export { featureModel, toFeature } from "./gherkin.js";
export { fromFeature, readFeature } from "./roundtrip.js";
export { layout } from "./layout.js";
export { partStates, paths, expandOn } from "./state.js";
export { hasError } from "./issues.js";

import { parse } from "./parse.js";
import { render } from "./render.js";
import { toFeature } from "./gherkin.js";
import { verifyDoc } from "./verify.js";
import { hasError } from "./issues.js";

/**
 * 一次做完 parse → verify →（沒有 error 時）render 與 Gherkin。editor 每次輸入都呼叫它。
 * 回傳 { doc, issues, notes, html, feature }；有 error 時 html 與 feature 是 null。feature 帶著 .flow 原文，可以用 fromFeature 轉回來。
 */
export function compile(text, { assets, standalone = false, src = "doc.flow" } = {}) {
  const { doc, issues: parseIssues } = parse(text);
  const { issues, notes } = verifyDoc(doc, parseIssues);
  if (hasError(issues)) return { doc, issues, notes, html: null, feature: null };
  return { doc, issues, notes, html: render(doc, { assets, standalone }), feature: toFeature(doc, src, text) };
}
