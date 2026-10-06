// 依 carry-over 規則算出每一步每張卡的完整內容，以及點亮集合的展開。
//
// - 同一段內，卡片內容帶到下一步；換段時從該段的 init 重新開始。
// - `step … from <N>` 的狀態從第 N 步之後接續（0 = init），不是上一步；之後沒寫 from 的步驟接著它。
// - !hl／!gone 與 note 只作用在寫下它的那一步。
// - 這一步有 set／unset／clear／note 的卡算 changed。

import { error } from "./issues.js";
import { Edge, Element, Inner } from "./model.js";

/** 每一步接續的是第幾步（1 起算，0 = init）。from 不合法時退回上一步（verify 回報 E2）。 */
export function parents(part) {
  return part.steps.map((st, k) => {
    const i = k + 1;
    const f = st.branchFrom;
    return f !== null && f >= 0 && f < i ? f : i - 1;
  });
}

/** 從 init 走到每個葉子（沒有被別的步驟接續的步驟）的路徑，依葉子出現的順序。 */
export function paths(part) {
  const par = parents(part);
  const out = [];
  for (let leaf = 1; leaf <= par.length; leaf++) {
    if (par.includes(leaf)) continue;
    const path = [leaf];
    while (par[path[path.length - 1] - 1]) path.push(par[path[path.length - 1] - 1]);
    out.push(path.reverse());
  }
  return out;
}

const styleKey = (card, key) => `${card}\u0000${key}`;
// 卡片 id 是使用者寫的；字典用沒有原型的物件，"constructor" 這類名字才不會撞到 Object.prototype
export const dict = (entries = []) => Object.assign(Object.create(null), Object.fromEntries(entries));

/** 套用一個 op。回傳 false 表示 unset 的 key 不存在。 */
function apply(rows, styles, op) {
  if (op.kind === "clear") {
    rows.length = 0;
    for (const k of [...styles.keys()]) if (k.startsWith(op.card + "\u0000")) styles.delete(k);
    return true;
  }
  for (const r of rows) {
    if (r[0] === op.key) {
      if (op.kind === "unset") {
        rows.splice(rows.indexOf(r), 1);
        styles.delete(styleKey(op.card, op.key));
      } else {
        r[1] = op.value;
        styles.set(styleKey(op.card, op.key), op.style);
      }
      return true;
    }
  }
  if (op.kind === "unset") return false;
  rows.push([op.key, op.value]);
  styles.set(styleKey(op.card, op.key), op.style);
  return true;
}

/**
 * 每一步的狀態：{ cards: {卡: [[k, v] 或 [k, v, style]]}, changed: [卡], notes: {卡: [[文字, style]]} }。
 * 傳入 issues 陣列時，unset 不存在的 key 會回報 E2。
 */
export function partStates(part, issues = null) {
  const cards = part.cards.map((t) => t.name);
  const init = dict(cards.map((c) => [c, []]));
  for (const op of part.init) if (op.card in init) apply(init[op.card], new Map(), op);
  const after = [init]; // after[i] = 第 i 步之後的內容（0 = init）
  const out = [];
  const par = parents(part);
  part.steps.forEach((step, k) => {
    const state = dict(Object.entries(after[par[k]]).map(([c, rows]) => [c, rows.map((r) => [...r])]));
    const styles = new Map();
    const changed = [];
    const notes = dict();
    for (const op of step.ops) {
      if (!(op.card in state)) continue; // verify 回報 E2
      if (op.kind === "note") {
        (notes[op.card] ||= []).push([op.value, op.style]);
      } else if (!apply(state[op.card], styles, op) && issues !== null) {
        const have = state[op.card].map((r) => r[0]).join("、") || "（空的）";
        issues.push(error("E2", op.line, `unset ${op.card} ${op.key}：這張卡此刻沒有「${op.key}」這一列（現在有：${have}）`));
      }
      if (!changed.includes(op.card)) changed.push(op.card);
    }
    const snap = dict();
    for (const c of cards) {
      snap[c] = state[c].map(([key, v]) => {
        const st = styles.get(styleKey(c, key)) || "";
        return st ? [key, v, st] : [key, v];
      });
    }
    after.push(state);
    out.push({ cards: snap, changed: cards.filter((c) => changed.includes(c)), notes });
  });
  return out;
}

/** 點亮連線 → 連線、標籤、兩端（inner 再加所屬 pod）；點亮 inner → 加所屬 pod。未知的 id 略過（verify 回報 E2）。 */
export function expandOn(canvas, names) {
  const idx = canvas.index();
  const out = [];
  const add = (k) => {
    if (!out.includes(k)) out.push(k);
  };
  const addEl = (k) => {
    const obj = idx.get(k);
    if (obj instanceof Inner) {
      add(obj.pod);
      add(k);
    } else if (obj instanceof Element && obj.kind !== "ghost") {
      add(k);
    }
  };
  for (const n of names) {
    const obj = idx.get(n);
    if (obj instanceof Edge) {
      add(n);
      if (obj.label) add(n + ":label");
      addEl(obj.src);
      addEl(obj.dst);
    } else {
      addEl(n);
    }
  }
  return out;
}
