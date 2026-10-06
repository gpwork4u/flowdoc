// 把 `.flow` 的每一段情境轉成 Gherkin（cucumber／godog／behave 都讀得懂的 .feature）。
//
// 對應（見 skill/references/gherkin.md）：
// - part → 場景（Scenario），tag 是 @part-<id>；有 `from` 分支的段落，每條從 init 走到葉子的路徑各一個場景（分支加 @branch）
// - alias → 背景（Background）：示意 id 與種類，step definition 每次執行時建立真實資料並替換
// - init → 假設（Given）：每張卡的起始內容；路徑上各步的 fault 接在後面（先安排故障，再觸發）
// - step → 當（When）：步驟標題就是動作；點亮的連線寫成註解，說明會經過哪些元件
// - expect → 那麼 結果應該是「…」
// - 這一步有變動（含 note）的卡 → 那麼（Then）：這張卡在這一步之後的完整內容（data table，完全比對）；note 本身不進 .feature
//   卡片有 `in <元件>` 時寫成「<元件名稱> 的「卡」」
//   這一步點亮了非同步連線（async），或卡片列在這一步的 eventually 裡，寫成「最終…應該是」，step definition 要輪詢到逾時為止
//
// 給了 .flow 原文時，每一行原文也會以「#@ 」開頭的註解放進 .feature：檔頭在「功能」之前、part 在它的第一個場景之前、
// step 在它第一次出現的「當」之前、動畫下方的區塊在檔尾。依序接起來就是原本的 .flow，roundtrip.js 靠它轉回去。
//
// 這裡只產生 .feature 文字；step definition 由被驗證的專案自己實作。

import { isWide } from "./eaw.js";
import { Edge, Element, Inner } from "./model.js";
import { splitLines } from "./parse.js";
import { plain } from "./render.js";
import { partStates, paths } from "./state.js";

/** Gherkin data table 的跳脫：`\` → `\\`、`|` → `\|`、換行 → `\n`。 */
export const cell = (s) => s.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", "\\n");

function w(s) {
  let n = 0;
  for (const ch of s) n += isWide(ch.codePointAt(0)) ? 2 : 1;
  return n;
}

function table(rows, indent, header = ["key", "value"]) {
  const data = [header, ...rows.map((r) => [r[0], r[1]])].map((r) => r.map(cell));
  const widths = [0, 1].map((k) => Math.max(...data.map((r) => w(r[k]))));
  return data.map((r) => indent + "| " + r.map((c, k) => c + " ".repeat(widths[k] - w(c))).join(" | ") + " |");
}

/** 「卡」、「Postgres 的「卡」」。 */
export function subject(name, service) {
  return service ? `${service} 的「${name}」` : `「${name}」`;
}

/** 「最終」接在主詞前面：「最終「卡」」、「最終 Postgres 的「卡」」。 */
export const finally_ = (subj) => (subj.startsWith("「") ? "最終" : "最終 ") + subj;

function cardLines(subj, rows, kw, verb) {
  if (!rows.length) return [`    ${kw} ${subj}${verb}空的`];
  return [`    ${kw} ${subj}${verb}：`, ...table(rows, "      ")];
}

function isAsync(part, step) {
  const idx = part.canvas.index();
  return step.on.some((t) => idx.get(t.name) instanceof Edge && idx.get(t.name).dashed);
}

function displayName(idx, key) {
  const o = idx.get(key);
  if (o instanceof Inner) {
    const pod = idx.get(o.pod);
    return `${pod ? pod.name : o.pod}／${o.name}`;
  }
  if (o instanceof Element) return o.name;
  return null;
}

function pathComment(part, step) {
  const idx = part.canvas.index();
  const nm = (k) => displayName(idx, k) || k;
  const hops = [];
  for (const t of step.on) {
    const o = idx.get(t.name);
    if (o instanceof Edge) {
      let hop = `${nm(o.src)} → ${nm(o.dst)}`;
      if (o.label) hop += `（${o.label}）`;
      if (o.dashed) hop += "［非同步］";
      hops.push(hop);
    } else if (o !== undefined) {
      hops.push(nm(t.name));
    }
  }
  return hops.length ? hops.join("；") : null;
}

/** 場景名稱：`<段標題>（<actor>）`，分支再接 `／<分支步驟標題>`。 */
export function scenarioTitle(part, path) {
  let title = part.title + (part.actor ? `（${part.actor}）` : "");
  const branch = path.filter((n) => part.steps[n - 1].branchFrom !== null);
  if (branch.length) title += `／${part.steps[branch[branch.length - 1] - 1].title}`;
  return title;
}

/**
 * .feature 的內容（還沒排成文字）。roundtrip.js 用同一個模型比對「.flow 算出來的」與「.feature 寫的」。
 * parts[k].scenarios[s].steps[i].home：這一步第一次出現在這個場景（之後的場景是重複的前置步驟）。
 */
export function featureModel(doc) {
  const stores = new Map(doc.stores.map((s) => [s.id, s]));
  const model = {
    title: plain(doc.title),
    lede: doc.lede ? plain(doc.lede) : null,
    aliases: doc.aliases.flatMap((al) => al.names.map((name) => [name, al.kind])),
    parts: [],
  };
  for (const part of doc.parts) {
    const states = partStates(part);
    const idx = part.canvas.index();
    const cards = part.cards.map((t) => t.name);
    const subj = (card) => {
      const st = stores.get(card);
      const svc = st && st.within ? displayName(idx, st.within) : null;
      return subject(st ? st.name : card, svc);
    };
    const init = new Map(cards.map((c) => [c, []]));
    for (const op of part.init) {
      const rows = init.get(op.card);
      if (!rows) continue;
      const r = rows.find((x) => x[0] === op.key);
      if (r) r[1] = op.value;
      else rows.push([op.key, op.value]);
    }
    const all = paths(part);
    const home = new Map();
    all.forEach((path, s) => path.forEach((n) => home.has(n) || home.set(n, s)));
    const scenarios = all.map((path, s) => ({
      path,
      tags: `@part-${part.id}` + (path.some((n) => part.steps[n - 1].branchFrom !== null) ? " @branch" : ""),
      title: scenarioTitle(part, path),
      given: cards.map((c) => ({ card: c, subject: subj(c), rows: init.get(c) })),
      faults: path.flatMap((n) => part.steps[n - 1].faults.map(([text], k) => ({ text: plain(text), step: n, k }))),
      steps: path.map((n) => {
        const st = part.steps[n - 1], ss = states[n - 1];
        const waits = new Set(st.eventually.map((t) => t.name));
        const async = isAsync(part, st);
        return {
          n,
          home: home.get(n) === s,
          title: st.title,
          key: st.key,
          branchFrom: st.branchFrom,
          route: pathComment(part, st),
          expect: st.expect === null ? null : plain(st.expect),
          async,
          blocks: ss.changed.map((c) => ({
            card: c,
            subject: subj(c),
            rows: ss.cards[c].map((r) => [r[0], r[1]]),
            eventually: async || waits.has(c),
          })),
        };
      }),
    }));
    model.parts.push({ part, cards, subjects: new Map(cards.map((c) => [c, subj(c)])), init, home, scenarios });
  }
  return model;
}

/**
 * 把 .flow 原文切成幾組，各自放在 .feature 裡對應的位置：
 * header（第一個 part 之前）、每個 part（到它的第一個 step 之前）、每個 step、trailer（動畫下方的區塊）。
 * 緊接在某組前面的空行與註解歸給那一組（例如「# ── Part 2」跟著 part 2）。
 */
export function flowGroups(doc, lines) {
  const starts = [];
  doc.parts.forEach((part, pi) => {
    starts.push({ at: part.line - 1, kind: "part", pi });
    part.steps.forEach((st, si) => starts.push({ at: st.line - 1, kind: "step", pi, si }));
  });
  if (doc.blocks.length) starts.push({ at: doc.blocks[0].line - 1, kind: "trailer" });
  starts.sort((a, b) => a.at - b.at);
  const loose = (s) => !s.trim() || s.trim().startsWith("#");
  starts.forEach((g, k) => {
    const floor = k ? starts[k - 1].at + 1 : 1;
    while (g.at > floor && loose(lines[g.at - 1])) g.at--;
  });
  const header = lines.slice(0, starts.length ? starts[0].at : lines.length);
  const parts = doc.parts.map(() => ({ lines: [], steps: [] }));
  let trailer = [];
  starts.forEach((g, k) => {
    const chunk = lines.slice(g.at, k + 1 < starts.length ? starts[k + 1].at : lines.length);
    if (g.kind === "part") parts[g.pi].lines = chunk;
    else if (g.kind === "step") parts[g.pi].steps[g.si] = chunk;
    else trailer = chunk;
  });
  return { header, parts, trailer };
}

const ann = (indent, line) => indent + (line ? "#@ " + line : "#@");

/** 步驟在場景裡出現的順序是不是和 .flow 的順序一樣（一樣時每一步的原文就放在它的「當」前面）。 */
function inOrder(mp) {
  let next = 1;
  for (const sc of mp.scenarios) for (const st of sc.steps) if (st.home && st.n !== next++) return false;
  return true;
}

export const HEADER = [
  "# E2E：每個場景只有第一個「當」從外部觸發；之後的「當」是內部步驟，step definition 實作成「等到這件事發生」。",
  "# 「背景」的示意 id 每次執行時換成真實資料；表格裡的值做同樣的替換（sku_A-r1 → <真實 id>-r1）。",
  "# 「那麼」的表格是這張卡在這一步之後的完整內容；值含「…」的只檢查有值，「*」是萬用字元。",
  "# 「最終…應該是」要輪詢到逾時為止；「安排故障」在觸發動作之前先讓那個故障發生。",
];

export const COLLECTED = "  # 這一段的步驟在場景裡出現的順序和 .flow 不同，所以每一步的原文集中放在這裡（照 .flow 的順序）。";

/**
 * 產生 .feature。給了 text（.flow 原文）就把原文以「#@」行放進去，之後可以用 fromFeature 轉回 .flow。
 */
export function toFeature(doc, src, text = null) {
  const model = featureModel(doc);
  const groups = text === null ? null : flowGroups(doc, splitLines(text));
  const out = ["# language: zh-TW"];
  if (groups) {
    out.push(
      `# 由 ${src} 產生（flowdoc gherkin）。可以直接改這份 .feature，再用 flowdoc flow 轉回 .flow。`,
      "# 「#@」開頭的行是 .flow 原文（元件、連線、說明）；標題、預期、故障、表格與「最終」以 Gherkin 為準，改 Gherkin 那一行就好。",
    );
  } else {
    out.push(`# 由 ${src} 產生（flowdoc gherkin）。不要手改：改 .flow 再重新產生。`);
  }
  out.push(...HEADER);
  if (groups) out.push(...groups.header.map((l) => ann("", l)));
  out.push(`功能: ${model.title}`);
  if (model.lede) out.push(`  ${model.lede}`);
  if (model.aliases.length) {
    out.push("", "  背景:", "    假設 示意 id 對應到這次執行建立的資料：", ...table(model.aliases, "      ", ["示意", "種類"]));
  }
  model.parts.forEach((mp, pi) => {
    const g = groups && groups.parts[pi];
    const together = g && !inOrder(mp);
    if (g) {
      out.push("", ...g.lines.map((l) => ann("  ", l)));
      if (together) out.push(COLLECTED, ...g.steps.flatMap((chunk) => chunk.map((l) => ann("  ", l))));
    }
    for (const sc of mp.scenarios) {
      out.push("", `  ${sc.tags}`, `  場景: ${sc.title}`);
      let given = "假設";
      for (const gv of sc.given) {
        out.push(...cardLines(gv.subject, gv.rows, given, "是"));
        given = "而且";
      }
      for (const f of sc.faults) {
        out.push(`    ${given} 安排故障「${f.text}」`);
        given = "而且";
      }
      for (const st of sc.steps) {
        out.push("");
        if (g && !together && st.home) out.push(...g.steps[st.n - 1].map((l) => ann("    ", l)));
        if (st.key) out.push("    # ★ 分歧點"); // Gherkin 的步驟行不能接行尾註解
        if (st.branchFrom !== null) out.push(st.branchFrom ? `    # 分支：接第 ${st.branchFrom} 步之後` : "    # 分支：從起點分出");
        out.push(`    當 ${st.title}`);
        if (st.route) out.push(`      # 經過：${st.route}`);
        let then = "那麼";
        if (st.expect !== null) {
          out.push(`    那麼 結果應該是「${st.expect}」`);
          then = "而且";
        }
        if (!st.blocks.length && st.expect === null) out.push("      # 這一步沒有改變任何卡");
        for (const b of st.blocks) {
          out.push(...cardLines(b.eventually ? finally_(b.subject) : b.subject, b.rows, then, "應該是"));
          then = "而且";
        }
      }
    }
  });
  if (groups && groups.trailer.length) out.push("", ...groups.trailer.map((l) => ann("", l)));
  return out.join("\n") + "\n";
}
