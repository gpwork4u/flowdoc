// 依 skill/references/output.md 產生 HTML。
// page.css 與 runtime.js 由呼叫端傳入（Node 從檔案讀、瀏覽器版由打包時內嵌），這個模組不碰檔案系統。

import { LABEL_LEAD, layout } from "./layout.js";
import { CodeBlock, Decisions, Facts, Footer, QA, Table, Takeaway } from "./model.js";
import { pyRound } from "./pyfmt.js";
import { dict, expandOn, partStates } from "./state.js";

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700' +
  '&family=Noto+Serif+TC:wght@600;700&family=JetBrains+Mono:wght@400;500&display=swap">';
const STANDALONE_CSS = "body{margin:0}img{max-width:100%}";
const LEGEND = {
  changed: '<span><i class="lg-chg"></i>橘框：要新增或修改</span>',
  ghost: '<span><i class="lg-ghost"></i>打叉虛線框：刻意不走</span>',
  async: '<span><i class="lg-async"></i>虛線箭頭：非同步</span>',
};
const MARKERS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--line-2)"></path>
    </marker>
    <marker id="ahs" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--signal)"></path>
    </marker>
  </defs>
</svg>`;

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** 行內標記：`code` 與 **粗體**，其餘一律 escape。 */
export function inline(s) {
  return s
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 ? `<span class="mono">${esc(part.slice(1, -1))}</span>` : esc(part).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")))
    .join("");
}

/** 去掉行內標記，留下純文字（給 <title>、aria-label、字數計算）。 */
export const plain = (s) => s.replaceAll("`", "").replace(/\*\*(.+?)\*\*/g, "$1");

function n(v) {
  const r = pyRound(v, 1);
  return Number.isInteger(r) ? String(Math.trunc(r)) : String(r);
}

// ---------------------------------------------------------------- SVG
function svgText(t, anchor = "middle") {
  const style = t.style ? ` style="${t.style}"` : "";
  const a = anchor ? ` text-anchor="${anchor}"` : "";
  return `<text x="${n(t.x)}" y="${n(t.y)}"${a} class="${t.cls}"${style}>${esc(t.text)}</text>`;
}

function svgShape(pts, cls = "") {
  const c = cls ? ` class="${cls}"` : "";
  if (pts.length === 2) {
    const [[x1, y1], [x2, y2]] = pts;
    return `<line${c} x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"></line>`;
  }
  let d = `M ${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i];
    d += Math.abs(py - y) < 0.05 ? ` H ${n(x)}` : Math.abs(px - x) < 0.05 ? ` V ${n(y)}` : ` L ${n(x)} ${n(y)}`;
  }
  return `<path${c} d="${d}"></path>`;
}

const rect = (b, rx) => `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="${rx}"></rect>`;

const labelSvg = (lb) =>
  lb.lines.map(([t, cls], k) => `<text x="${n(lb.x)}" y="${n(lb.y + k * LABEL_LEAD)}" text-anchor="middle" class="${cls}">${esc(t)}</text>`).join("");

function renderSvg(idx, part, lo, names) {
  const descs = part.canvas.edges.map((e) => {
    const d = `${names.get(e.src) ?? e.src} → ${names.get(e.dst) ?? e.dst}`;
    return d + (e.label ? `（${e.label}）` : "");
  });
  const aria = descs.length ? `${part.title}：` + descs.join("；") : part.title;
  const w = lo.width, h = lo.height;
  const hidden = idx ? " hidden" : "";
  const out = [
    `<svg class="flow" id="fp${idx + 1}" viewBox="0 0 ${w} ${h}" style="max-width:${w}px;min-width:${pyRound(w * 0.8)}px" role="img"${hidden}`,
    `     aria-label="${esc(aria)}">`,
  ];
  for (const g of lo.ghosts) {
    out.push('  <g class="ghost">');
    out.push("    " + rect(g.node.box, g.node.rx));
    for (const t of g.node.texts) out.push("    " + svgText(t));
    if (g.cross) {
      out.push("    " + svgShape(g.cross));
      for (const [a, b, c, d] of g.marks) out.push(`    <line x1="${n(a)}" y1="${n(b)}" x2="${n(c)}" y2="${n(d)}"></line>`);
    }
    if (g.label) out.push("    " + labelSvg(g.label));
    out.push("  </g>");
  }
  for (const e of lo.edges) {
    const cls = e.dashed ? "edge dash" : "edge";
    out.push(`  <g data-k="${esc(e.id)}" class="${cls}">${svgShape(e.points, e.key ? "keyflow" : "")}</g>`);
  }
  for (const nd of lo.nodes) {
    const cls = { inner: "inner", pod: "node pod" }[nd.kind] ?? (nd.future ? "node future" : "node");
    out.push(`  <g data-k="${esc(nd.key)}" class="${cls}">`);
    out.push("    " + rect(nd.box, nd.rx));
    for (const t of nd.texts) out.push("    " + svgText(t));
    out.push("  </g>");
  }
  if (lo.frames.length) out.push('  <g class="chg-frame" aria-hidden="true">' + lo.frames.map(([b, rx]) => rect(b, rx)).join("") + "</g>");
  for (const e of lo.edges) {
    if (e.label) out.push(`  <g data-k="${esc(e.label.key)}" class="lbl">${labelSvg(e.label)}</g>`);
  }
  out.push("</svg>");
  return out.join("\n");
}

// ---------------------------------------------------------------- flow-data
export function flowData(doc) {
  const data = { cards: dict(doc.stores.map((s) => [s.id, { name: s.name, tag: s.tag }])), parts: [] };
  doc.parts.forEach((part, i) => {
    const states = partStates(part);
    const steps = part.steps.map((st, k) => {
      const ss = states[k];
      let desc = inline(st.desc);
      for (const [fault] of st.faults) desc += `<span class="fault">故障：${inline(fault)}</span>`;
      if (st.expect) desc += `<span class="expect">預期：${inline(st.expect)}</span>`;
      const step = {
        title: st.title,
        desc,
        key: st.key,
        on: expandOn(part.canvas, st.on.map((t) => t.name)),
        cards: ss.cards,
        changed: ss.changed,
      };
      if (Object.keys(ss.notes).length) step.notes = ss.notes;
      if (st.branchFrom !== null) step.from = st.branchFrom;
      return step;
    });
    data.parts.push({ id: part.id, title: part.title, actor: part.actor, svg: `fp${i + 1}`, cards: part.cards.map((t) => t.name), steps });
  });
  return data;
}

const jsonScript = (data) => JSON.stringify(data).replaceAll("</", "<\\/").replaceAll("<!--", "<\\!--");

// ---------------------------------------------------------------- 區塊
function sechead(title, desc = null, small = false) {
  const cls = small ? ' class="small"' : "";
  const p = desc ? `<p${cls}>${inline(desc)}</p>` : "";
  return `<div class="sechead"><h2>${inline(title)}</h2>${p}</div>`;
}

const section = (ls) => "<section>\n" + ls.map((x) => "  " + x).join("\n") + "\n</section>";

function renderBlocks(doc) {
  const out = [];
  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b instanceof Facts) {
      const body = [sechead(b.title), '<div class="facts">'];
      for (const [t, x] of b.items) body.push(`  <div class="fact"><h3>${inline(t)}</h3><p>${inline(x)}</p></div>`);
      body.push("</div>");
      if (i + 1 < blocks.length && blocks[i + 1] instanceof Takeaway) {
        body.push(`<div class="takeaway prose">${inline(blocks[i + 1].text)}</div>`);
        i += 1;
      }
      out.push(section(body));
    } else if (b instanceof Takeaway) {
      out.push(section([`<div class="takeaway prose">${inline(b.text)}</div>`]));
    } else if (b instanceof CodeBlock) {
      out.push(section([sechead(b.title, b.desc), `<div class="schema"><pre>${esc(b.lines.join("\n"))}</pre></div>`]));
    } else if (b instanceof Table) {
      const rows = b.rows.map(([muted, cells]) => {
        const tds = cells.map((c, k) => {
          const cls = k === 0 ? ["key"] : [];
          if (muted || b.oldCols[k]) cls.push("was");
          const attr = cls.length ? ` class="${cls.join(" ")}"` : "";
          return `<td${attr}>${inline(c)}</td>`;
        });
        return "      <tr>" + tds.join("") + "</tr>";
      });
      const head = b.cols.map((c) => `<th>${inline(c)}</th>`).join("");
      out.push(section([sechead(b.title, b.desc), '<div class="tscroll">', '  <table class="dtable diff">',
        `    <thead><tr>${head}</tr></thead>`, "    <tbody>", ...rows, "    </tbody>", "  </table>", "</div>"]));
    } else if (b instanceof QA) {
      const items = b.items.map(([q, a]) => `  <div><h3>${inline(q)}</h3><p>${inline(a)}</p></div>`);
      out.push(section([sechead(b.title), '<div class="qa">', ...items, "</div>"]));
    } else if (b instanceof Decisions) {
      const rows = b.items.map(([d, t]) => `      <tr><td class="key">${esc(d)}</td><td>${inline(t)}</td></tr>`);
      out.push(section([sechead(b.title, b.desc, true), '<div class="tscroll">', '  <table class="dtable">',
        "    <thead><tr><th>#</th><th>決定</th></tr></thead>", "    <tbody>", ...rows, "    </tbody>", "  </table>", "</div>"]));
    }
    // Footer 一律放在最後，由 renderFooter 處理
  }
  return out;
}

function renderFooter(doc) {
  const ft = doc.blocks.find((b) => b instanceof Footer);
  if (!ft) return "";
  const out = ["<footer>"];
  let para = null;
  const flush = () => {
    if (para !== null) {
      out.push('  <p class="small">' + para.join("") + "</p>");
      para = null;
    }
  };
  for (const item of ft.items) {
    if (item[0] === "text") {
      flush();
      para = [inline(item[1])];
    } else if (item[0] === "link") {
      if (para === null) para = [];
      para.push(`<a href="${esc(item[2])}">${inline(item[1])}</a>`);
    } else {
      flush();
      out.push(`  <code>${esc(item[1])}</code>`);
    }
  }
  flush();
  out.push("</footer>");
  return out.join("\n");
}

// ---------------------------------------------------------------- 整頁
export function usedLegend(doc) {
  if (doc.legend !== null) return doc.legend;
  const items = [];
  const els = doc.parts.filter((p) => p.canvas).flatMap((p) => p.canvas.elements);
  if (els.some((e) => e.changed || e.fields.some((f) => f.changed) || e.inners.some((i) => i.changed))) items.push("changed");
  if (els.some((e) => e.kind === "ghost")) items.push("ghost");
  if (doc.parts.some((p) => p.canvas && p.canvas.edges.some((ed) => ed.dashed))) items.push("async");
  return items;
}

function displayNames(part) {
  const names = new Map();
  for (const e of part.canvas.elements) {
    names.set(e.id, e.name);
    for (const i of e.inners) names.set(i.key, `${e.name} 的 ${i.name}`);
  }
  return names;
}

/**
 * 產生整頁 HTML。assets = { css, js }：skill/assets/page.css 與 runtime.js 的內容。
 * standalone 為 true 時輸出完整的 HTML 文件（給靜態站用）。
 */
export function render(doc, { assets, standalone = false } = {}) {
  let css = assets.css.replace(/\n+$/, "");
  const js = assets.js.replace(/\n+$/, "");
  if (standalone) css += "\n" + STANDALONE_CSS;
  const svgs = doc.parts.map((part, i) => `<!-- Part ${i + 1} ${esc(part.title)} -->\n` + renderSvg(i, part, layout(part.canvas), displayNames(part)));
  const chips = doc.chips.map((c) => `    <span class="chip${c.kind ? " " + c.kind : ""}">${esc(c.text)}</span>`).join("\n");
  const legend = usedLegend(doc).map((k) => LEGEND[k]).join("");
  const stageHead = doc.stageTitle ? sechead(doc.stageTitle, doc.stageDesc) : "";
  const caption = doc.caption ? `<figcaption>${inline(doc.caption)}</figcaption>` : "";
  const nparts = Math.min(doc.parts.length, 5);
  const body = `<div class="page">

<header class="hd">
  ${doc.eyebrow ? `<div class="eyebrow">${esc(doc.eyebrow)}</div>` : ""}
  <h1 style="margin-top:12px">${esc(plain(doc.title))}</h1>
  ${doc.lede ? `<p class="lede prose">${inline(doc.lede)}</p>` : ""}
  <div class="meta">
${chips}
  </div>
</header>

<section>
  ${stageHead}
  <figure>
    <div class="stage"><div class="split">
      <div class="split-l">
        <div class="parts" id="parts" role="tablist" aria-label="使用情境" style="--parts:${nparts}"></div>
        <div class="legend">${legend}</div>
        <div class="flowwrap">
${MARKERS}
${svgs.join("\n")}
        </div>
        <div class="controls">
          <button class="primary" id="play" type="button">播放這一段</button>
          <button id="prev" type="button">上一步</button>
          <button id="next" type="button">下一步</button>
          <div class="dots" id="dots" role="tablist" aria-label="流程步驟"></div>
        </div>
        <div class="readout" aria-live="polite"><div class="step-n" id="stepN"></div><h3 id="stepT"></h3><p id="stepD"></p></div>
      </div>
      <aside class="split-r">
        <div class="stores-head"><h3>此刻各元件裡裝著什麼</h3><span class="hint">示意資料 · 有變動的會亮起</span></div>
        <div class="stores" id="stores"></div>
      </aside>
    </div></div>
    ${caption}
  </figure>
</section>

${renderBlocks(doc).join("\n")}

${renderFooter(doc)}

</div>

<script type="application/json" id="flow-data">${jsonScript(flowData(doc))}</script>
<script>
${js}
</script>
`;
  const head = `<title>${esc(plain(doc.title))}</title>\n${FONTS}\n<style>\n${css}\n</style>\n`;
  if (standalone) {
    return '<!DOCTYPE html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
      `${head}</head>\n<body>\n${body}</body>\n</html>\n`;
  }
  return head + body;
}
