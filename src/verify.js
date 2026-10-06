// 驗證。代號與意義見 skill/references/verification.md。
//
// - verifyFlow：第一層（語法與參照）＋第二層（版面）。
// - verifyHtml：第三層（輸出的 HTML）。

import { closeMatch } from "./difflib.js";
import { scanHtml } from "./htmlscan.js";
import { error, hasError, warn } from "./issues.js";
import { layout } from "./layout.js";
import { Edge, Element, Inner } from "./model.js";
import { parse } from "./parse.js";
import { cpLen } from "./pyfmt.js";
import { plain } from "./render.js";
import { expandOn, partStates } from "./state.js";

const DESC_MAX = 120;

function suggest(name, choices) {
  const m = closeMatch(name, choices);
  return m !== null ? `是不是 ${m}？` : "";
}

// ---------------------------------------------------------------- 第一層
function checkRefs(doc) {
  const out = [];
  const stores = new Map();
  for (const s of doc.stores) {
    if (stores.has(s.id)) out.push(error("E3", s.line, `store id ${s.id} 重複（第 ${stores.get(s.id)} 行已宣告）`));
    stores.set(s.id, s.line);
  }
  const partIds = new Map();
  const keySteps = [];
  for (const part of doc.parts) {
    if (partIds.has(part.id)) out.push(error("E3", part.line, `part id ${part.id} 重複（第 ${partIds.get(part.id)} 行已用過）`));
    partIds.set(part.id, part.line);
    const cards = new Map();
    for (const t of part.cards) {
      if (!stores.has(t.name)) out.push(error("E2", t.line, `cards 列了不存在的卡 ${t.name}：先在頁首用 store 宣告。${suggest(t.name, stores.keys())}`));
      else if (cards.has(t.name)) out.push(error("E3", t.line, `cards 重複列出 ${t.name}`));
      cards.set(t.name, t.line);
    }
    for (const op of [...part.init, ...part.steps.flatMap((st) => st.ops)]) {
      if (!cards.has(op.card)) {
        const where = !stores.has(op.card) ? "沒有用 store 宣告" : `沒有列在 part ${part.id} 的 cards 裡`;
        out.push(error("E2", op.line, `${op.kind} 的卡 ${op.card} ${where}。${suggest(op.card, cards.size ? cards.keys() : stores.keys())}`));
      }
    }
    if (part.canvas === null) continue;
    const cv = part.canvas;
    const ids = new Map();
    const claim = (key, line, what) => {
      if (ids.has(key)) {
        const hint = what === "edge" ? "；兩條同方向的連線要用 as <id> 各自取名" : "";
        out.push(error("E3", line, `${what} id ${key} 在這段 canvas 裡重複（第 ${ids.get(key)} 行已用過）${hint}`));
      }
      ids.set(key, line);
    };
    for (const e of cv.elements) {
      claim(e.id, e.line, e.kind);
      for (const i of e.inners) claim(i.key, i.line, "inner");
    }
    for (const ed of cv.edges) claim(ed.id, ed.line, "edge");
    const idx = cv.index();
    const nodes = new Set([...idx].filter(([, v]) => !(v instanceof Edge)).map(([k]) => k));
    for (const ed of cv.edges) {
      for (const end of [ed.src, ed.dst]) {
        const obj = idx.get(end);
        if (obj === undefined || obj instanceof Edge) {
          out.push(error("E2", ed.line, `edge ${ed.id} 的端點 ${end} 不存在。inner 要寫成 <pod>.<inner>。${suggest(end, nodes)}`));
        } else if (obj instanceof Element && obj.kind === "ghost") {
          out.push(error("E2", ed.line, `edge ${ed.id} 接到 ghost ${end}：ghost 是刻意不走的路，用 ghost 的 cross 畫打叉的線`));
        }
      }
    }
    for (const e of cv.elements) {
      if (e.cross && !nodes.has(e.cross.target)) {
        out.push(error("E2", e.cross.line, `ghost ${e.id} 的 cross 目標 ${e.cross.target} 不存在。${suggest(e.cross.target, nodes)}`));
      }
    }
    const keys = cv.edges.filter((ed) => ed.key);
    for (const ed of keys.slice(1)) {
      out.push(error("E4", ed.line, `part ${part.id} 有兩條以上的 key 連線（另一條在第 ${keys[0].line} 行）：一張圖最多一條分歧點的線`));
    }
    part.steps.forEach((st, k) => {
      const n = k + 1;
      if (st.branchFrom !== null && !(st.branchFrom >= 0 && st.branchFrom < n)) {
        out.push(error("E2", st.line, `step「${st.title}」是第 ${n} 步，from ${st.branchFrom} 要指向它前面的步驟（1–${n - 1}；0 表示從 init 分出）`));
      }
      for (const t of st.on) {
        const obj = idx.get(t.name);
        if (obj === undefined) {
          out.push(error("E2", t.line, `step「${st.title}」點亮了不存在的元件或連線 ${t.name}。連線 id 預設是 <從>-><到>，inner 是 <pod>.<inner>。${suggest(t.name, idx.keys())}`));
        } else if (obj instanceof Element && obj.kind === "ghost") {
          out.push(error("E2", t.line, `step「${st.title}」點亮了 ghost ${t.name}：ghost 不會被點亮，從 on 拿掉`));
        }
      }
      if (st.key) keySteps.push(st);
    });
  }
  for (const st of keySteps.slice(1)) {
    out.push(error("E4", st.line, `整頁有兩個以上的 key 步驟（另一個是第 ${keySteps[0].line} 行的「${keySteps[0].title}」）：一整頁只有一個 ★，標在真正的設計分歧點`));
  }
  return out;
}

function checkUsage(doc) {
  const out = [];
  for (const part of doc.parts) {
    const n = part.steps.length;
    if (n < 2 || n > 10) {
      const hint = n < 2 ? "少於 2 步就併到別段" : "多於 10 步讀者會失去位置感，拆段";
      out.push(warn("W4", part.line, `part ${part.id} 有 ${n} 步：${hint}`));
    }
    const written = new Set([...part.init.map((op) => op.card), ...part.steps.flatMap((st) => st.ops.filter((op) => op.kind === "set").map((op) => op.card))]);
    for (const t of part.cards) {
      if (!written.has(t.name)) out.push(warn("W5", t.line, `part ${part.id} 列出的卡 ${t.name} 從未被 init／set 寫過：用不到就從 cards 拿掉`));
    }
    for (const st of part.steps) {
      const length = cpLen(plain(st.desc));
      if (length > DESC_MAX) {
        out.push(warn("W6", st.descLine || st.line, `step「${st.title}」的 desc 有 ${length} 字，超過 ${DESC_MAX}：講為什麼就好，圖已經說了做什麼`));
      }
    }
    if (part.canvas === null) continue;
    const lit = new Set(part.steps.flatMap((st) => expandOn(part.canvas, st.on.map((t) => t.name))));
    for (const e of part.canvas.elements) {
      if (e.kind === "ghost") continue;
      if (!lit.has(e.id)) out.push(warn("W1", e.line, `${e.kind} ${e.id} 從未被任何步驟點亮：不需要就刪掉，需要就加進某個 step 的 on`));
      for (const i of e.inners) {
        if (!lit.has(i.key)) out.push(warn("W1", i.line, `inner ${i.key} 從未被任何步驟點亮：不需要就刪掉，需要就加進某個 step 的 on`));
      }
    }
    for (const ed of part.canvas.edges) {
      if (!lit.has(ed.id)) out.push(warn("W1", ed.line, `edge ${ed.id} 從未被任何步驟點亮：不需要就刪掉，需要就加進某個 step 的 on`));
    }
  }
  return out;
}

/** 給驗收腳本用的宣告：alias、store … in、step 的 eventually。 */
function checkBindings(doc) {
  const out = [];
  const seen = new Map();
  for (const al of doc.aliases) {
    for (const name of al.names) {
      if (seen.has(name)) out.push(error("E3", al.line, `示意 id ${name} 重複宣告（第 ${seen.get(name)} 行已宣告）`));
      seen.set(name, al.line);
    }
  }
  const stores = new Map(doc.stores.map((s) => [s.id, s]));
  for (const part of doc.parts) {
    if (part.canvas === null) continue;
    const idx = part.canvas.index();
    for (const t of part.cards) {
      const st = stores.get(t.name);
      const obj = st && st.within ? idx.get(st.within) : undefined;
      if (st && st.within && !(obj instanceof Element || obj instanceof Inner)) {
        out.push(warn("W8", t.line, `卡 ${t.name} 標成在 ${st.within} 裡（第 ${st.line} 行），但 part ${part.id} 的圖上沒有 ${st.within}：把元件畫上去，或這一段不要列這張卡`));
      }
    }
    const cards = new Set(part.cards.map((t) => t.name));
    const states = partStates(part);
    part.steps.forEach((step, k) => {
      for (const t of step.eventually) {
        if (!cards.has(t.name)) {
          out.push(error("E2", t.line, `eventually 列的卡 ${t.name} 沒有列在 part ${part.id} 的 cards 裡`));
        } else if (!states[k].changed.includes(t.name)) {
          out.push(error("E2", t.line, `step「${step.title}」沒有改到卡 ${t.name}，不會產生斷言，eventually 沒有作用：拿掉它，或在這一步寫出 ${t.name} 的變化`));
        }
      }
    });
  }
  return out;
}

/** 回傳 { issues, notes }。notes 是「略過」之類要明確告知的訊息。 */
export function verifyDoc(doc, parseIssues) {
  let issues = [...parseIssues];
  const notes = [];
  if (hasError(issues)) {
    notes.push("略過參照與版面檢查：先修正上面的 E1");
    return { issues, notes };
  }
  issues.push(...checkRefs(doc), ...checkBindings(doc));
  const statesIssues = [];
  for (const part of doc.parts) partStates(part, statesIssues);
  issues.push(...statesIssues, ...checkUsage(doc));
  if (hasError(issues)) {
    notes.push("略過版面檢查（E5、E6、W2、W3）：先修正上面的 error");
    return { issues, notes };
  }
  for (const part of doc.parts) issues.push(...layout(part.canvas).issues);
  return { issues, notes };
}

export function verifyFlow(text) {
  const { doc, issues } = parse(text);
  return verifyDoc(doc, issues);
}

// ---------------------------------------------------------------- 第三層
const PAIRED = new Set(["div", "section", "svg", "g", "table"]);

/**
 * 檢查輸出的 HTML。checkJs(code) 回傳 null（沒問題）或 { line, msg }（line 是 code 裡的行號）；
 * 沒提供就略過 JS 語法檢查並記在 notes。
 */
export function verifyHtml(text, { checkJs = null } = {}) {
  const notes = [];
  const issues = [];
  const stack = [];
  let title = null;
  const styles = [];
  const scripts = [];
  const svgs = new Map();
  let svg = null;
  let inTag = null, buf = [], inAttrs = {}, inLine = 0;
  scanHtml(text, {
    start(tag, a, line, selfClosing) {
      if (selfClosing) {
        if (svg && "data-k" in a) svgs.get(svg)[0].add(a["data-k"]);
        return;
      }
      if (PAIRED.has(tag)) stack.push([tag, line]);
      if (tag === "svg" && (a.class || "").split(/\s+/).includes("flow")) {
        svg = a.id || `(第 ${line} 行沒有 id 的 svg)`;
        svgs.set(svg, [new Set(), line]);
      }
      if (svg && "data-k" in a) svgs.get(svg)[0].add(a["data-k"]);
      if (tag === "title" || tag === "style" || tag === "script") {
        inTag = tag; buf = []; inAttrs = a; inLine = line;
      }
    },
    end(tag, line) {
      if (PAIRED.has(tag)) {
        if (stack.length && stack[stack.length - 1][0] === tag) {
          stack.pop();
        } else {
          const top = stack[stack.length - 1];
          const opened = top ? `，最近開著的是第 ${top[1]} 行的 <${top[0]}>` : "";
          issues.push(error("E7", line, `</${tag}> 找不到對應的開頭標籤${opened}`));
          for (let k = stack.length - 1; k >= 0; k--) {
            if (stack[k][0] === tag) {
              stack.splice(k);
              break;
            }
          }
        }
      }
      if (tag === "svg") svg = null;
      if (tag === inTag) {
        const body = buf.join("");
        if (tag === "title") title = body;
        else if (tag === "style") styles.push(body);
        else scripts.push([inAttrs, body, inLine]);
        inTag = null;
      }
    },
    data(t) {
      if (inTag) buf.push(t);
    },
  });
  for (const [tag, line] of stack) issues.push(error("E7", line, `<${tag}> 沒有關起來`));

  // E8：flow-data 是合法 JSON；內嵌 JS 語法正確
  let data = null;
  let dataLine = 1;
  const js = [];
  for (const [attrs, body, line] of scripts) {
    if (attrs.src) continue;
    if (attrs.type === "application/json") {
      if (attrs.id === "flow-data") {
        dataLine = line;
        try {
          data = JSON.parse(body);
        } catch (e) {
          issues.push(error("E8", line, `flow-data 不是合法 JSON：${e.message}`));
        }
      }
    } else {
      js.push([body, line]);
    }
  }
  if (data === null && !issues.some((i) => i.code === "E8")) {
    issues.push(error("E8", 1, '找不到 <script type="application/json" id="flow-data">：runtime 讀不到資料'));
  }
  if (!checkJs) {
    notes.push("略過 E8 的 JS 語法檢查：這個環境沒有提供檢查器");
  } else {
    for (const [body, line] of js) {
      const r = checkJs(body);
      if (r) issues.push(error("E8", r.line ? line + r.line - 1 : line, `內嵌 JS 語法錯誤：${r.msg}`));
    }
  }

  // E9：on 與 SVG 的 data-k 互相對得上
  if (data && typeof data === "object" && !Array.isArray(data)) {
    (data.parts || []).forEach((part, i) => {
      const id = part.svg;
      if (!svgs.has(id)) {
        issues.push(error("E9", dataLine, `第 ${i + 1} 段指向的 svg #${id} 不存在`));
        return;
      }
      const [keys, line] = svgs.get(id);
      const lit = new Set();
      (part.steps || []).forEach((st, j) => {
        for (const k of st.on || []) {
          lit.add(k);
          if (!keys.has(k)) issues.push(error("E9", dataLine, `第 ${i + 1} 段第 ${j + 1} 步點亮的 ${k} 在 svg #${id} 裡找不到 data-k`));
        }
      });
      for (const k of [...keys].filter((k) => !lit.has(k)).sort()) {
        issues.push(error("E9", line, `svg #${id} 裡的 ${k} 從未被點亮（.flow 的 W1）：刪掉它，或在某一步的 on 加上它`));
      }
    });
  }

  // E10：title、色票、dark 兩組、body 背景、hidden reset
  const css = styles.join("\n");
  if (!(title || "").trim()) issues.push(error("E10", 1, "少了 <title>"));
  const checks = [
    [/:root\s*\{[^}]*--[\w-]+\s*:/, "bare :root 的色票（light）"],
    [/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/, '@media (prefers-color-scheme: dark) 包 :root:not([data-theme="light"])'],
    [/:root\[data-theme="dark"\]\s*\{/, ':root[data-theme="dark"] 那一組'],
    [/(^|[}\s;])body\s*\{[^}]*background/, "body 的背景色"],
    [/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/, "[hidden]{display:none!important}（沒有它，切段時其他段的 svg 與卡片藏不起來）"],
  ];
  for (const [pat, what] of checks) if (!pat.test(css)) issues.push(error("E10", 1, `樣式少了 ${what}`));
  return { issues, notes };
}
