// flowdoc editor：左邊編輯 .flow，右邊即時預覽。
// 打包時 build-editor.js 會把 src/ 的核心、page.css、runtime.js 與範例一起內嵌，所以整個 editor 是一個 HTML 檔。

import { compile, fromFeature } from "../src/index.js";

const ASSETS = globalThis.__FLOWDOC_ASSETS;
const EXAMPLES = globalThis.__FLOWDOC_EXAMPLES; // [{ id, title, text }]
const DRAFT_KEY = "flowdoc-editor:draft";
const DEBOUNCE = 200;

const $ = (s) => document.querySelector(s);
const ta = $("#src"), hl = $("#hl"), gutter = $("#gutter"), marks = $("#marks");
const issuesBox = $("#issues"), statusBox = $("#status"), staleBox = $("#stale"), featureBox = $("#feature");
const frames = [$("#pv-a"), $("#pv-b")];
let front = 0;
let pos = "p1s1"; // 預覽目前停在哪一步；重新產生後回到同一步
let lastHtml = null, lastFeature = "", lastIssues = [];
let featureDirty = false; // 驗收腳本分頁被手動改過、還沒套用
let name = "doc";
let timer = null;

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------------------------------------------------------------- 上色
const KEYWORDS = new Set(["flowdoc", "title", "eyebrow", "lede", "chip", "legend", "stage", "caption", "alias", "store", "part",
  "cards", "init", "canvas", "node", "pod", "inner", "field", "ghost", "edge", "step", "on", "desc", "set", "unset", "clear",
  "note", "expect", "fault", "eventually", "facts", "fact", "takeaway", "code", "table", "row", "qa", "q", "decisions", "d",
  "footer", "text", "link"]);
const MODIFIERS = new Set(["key", "old", "async", "changed", "future", "mono", "sub", "at", "span", "cross", "via", "as", "tag",
  "in", "actor", "from", "cols", "rows", "muted", "hv", "vh", "!hl", "!gone", "="]);

function paintLine(line) {
  const m = /^(\s*)(\|.*)$/.exec(line);
  if (m) return esc(m[1]) + `<span class="p">${esc(m[2])}</span>`;
  let out = "", i = 0, first = true;
  while (i < line.length) {
    const c = line[i];
    if (c === " " || c === "\t") {
      out += c;
      i++;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      out += `<span class="c">${esc(line.slice(i))}</span>`;
      break;
    } else if (c === '"' || c === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === "\\" && c === '"' ? 2 : 1;
      out += `<span class="s">${esc(line.slice(i, j + 1))}</span>`;
      i = j + 1;
      first = false;
    } else {
      let j = i;
      while (j < line.length && line[j] !== " " && line[j] !== "\t") j++;
      const w = line.slice(i, j);
      let cls = "";
      if (first && KEYWORDS.has(w)) cls = "k";
      else if (w === "->") cls = "a";
      else if (MODIFIERS.has(w)) cls = "m";
      else if (/^\d+,\d+$|^\d+x\d+$|^[xywh]=-?\d/.test(w)) cls = "n";
      out += cls ? `<span class="${cls}">${esc(w)}</span>` : esc(w).replace(/-&gt;/g, '<span class="a">-&gt;</span>');
      i = j;
      first = false;
    }
  }
  return out;
}

function paint(text, issues) {
  const lines = text.split("\n");
  hl.innerHTML = lines.map(paintLine).join("\n") + "\n ";
  const level = new Map();
  for (const it of issues) if (level.get(it.line) !== "error") level.set(it.line, it.level);
  gutter.innerHTML = lines.map((_, k) => `<div class="${level.get(k + 1) || ""}">${k + 1}</div>`).join("");
  marks.innerHTML = [...level].map(([ln, lv]) => `<div class="${lv}" style="top:calc(${ln - 1} * var(--lh))"></div>`).join("");
  syncScroll();
}

function syncScroll() {
  hl.scrollTop = ta.scrollTop;
  hl.scrollLeft = ta.scrollLeft;
  gutter.scrollTop = ta.scrollTop;
  marks.style.transform = `translateY(${-ta.scrollTop}px)`;
}

// ---------------------------------------------------------------- 檢查結果
function showIssues(issues, notes) {
  const sorted = [...issues].sort((a, b) => a.line - b.line || (a.code < b.code ? -1 : 1));
  const errs = issues.filter((i) => i.level === "error").length;
  const warns = issues.length - errs;
  statusBox.className = "status " + (errs ? "err" : warns ? "warn" : "ok");
  statusBox.textContent = errs ? `${errs} error · ${warns} warn` : warns ? `${warns} warn · 已更新` : "沒有問題 · 已更新";
  const items = sorted.map((i) =>
    `<li><button type="button" class="${i.level}" data-line="${i.line}"><span class="code">${i.code}</span><span class="ln">第 ${i.line} 行</span><span class="msg">${esc(i.msg)}</span></button></li>`);
  for (const n of notes) items.push(`<li class="note">${esc(n)}</li>`);
  if (!items.length) items.push('<li class="ok">沒有 error 也沒有 warn。</li>');
  issuesBox.innerHTML = items.join("");
}

issuesBox.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-line]");
  if (b) jumpTo(Number(b.dataset.line));
});

function jumpTo(line) {
  const lines = ta.value.split("\n");
  const k = Math.max(1, Math.min(line, lines.length));
  let start = 0;
  for (let i = 0; i < k - 1; i++) start += lines[i].length + 1;
  ta.focus();
  ta.setSelectionRange(start, start + lines[k - 1].length);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, (k - 1) * lh - ta.clientHeight / 3);
  syncScroll();
}

// ---------------------------------------------------------------- 預覽
window.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.flowdoc === "pos" && e.source === frames[front].contentWindow) pos = `p${d.part}s${d.step}`;
});

function loadPreview(html) {
  const back = frames[1 - front];
  let y = 0;
  try {
    y = frames[front].contentWindow.scrollY;
  } catch (e) {}
  back.onload = () => {
    try {
      back.contentWindow.scrollTo(0, y);
    } catch (e) {}
    back.classList.add("front");
    frames[front].classList.remove("front");
    front = 1 - front;
  };
  // runtime 讀 window.name 決定從哪一步開始；srcdoc 的 iframe 不會把 name 屬性帶進頁面，所以直接在 runtime 之前設定
  const start = `<script>window.name=${JSON.stringify(pos)}<\/script>\n`;
  back.srcdoc = html.replace('<script type="application/json" id="flow-data">', (m) => start + m);
}

function update() {
  const text = ta.value;
  try {
    localStorage.setItem(DRAFT_KEY, text);
  } catch (e) {}
  let res;
  try {
    res = compile(text, { assets: ASSETS, standalone: true, src: `${name}.flow` });
  } catch (e) {
    console.error(e);
    res = { issues: [{ level: "error", code: "E0", line: 1, msg: `flowdoc 內部錯誤：${e.message}` }], notes: [], html: null, feature: null };
  }
  lastIssues = res.issues;
  showIssues(res.issues, res.notes);
  paint(text, res.issues);
  staleBox.hidden = !!res.html || lastHtml === null;
  if (res.html) {
    if (res.html !== lastHtml) {
      lastHtml = res.html;
      loadPreview(res.html);
    }
    lastFeature = res.feature;
    if (!featureDirty) featureBox.value = res.feature;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(update, DEBOUNCE);
}

// ---------------------------------------------------------------- 編輯
function insert(text) {
  // execCommand 保留瀏覽器自己的復原紀錄；不支援時退回 setRangeText
  if (!document.execCommand("insertText", false, text)) ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
}

function replaceAll(text) {
  ta.focus();
  ta.select();
  insert(text);
  ta.setSelectionRange(0, 0);
  ta.scrollTop = 0;
}

ta.addEventListener("input", () => {
  paint(ta.value, lastIssues); // 先即時上色，檢查結果等停下來再更新
  schedule();
});
ta.addEventListener("scroll", syncScroll);
ta.addEventListener("keydown", (e) => {
  const v = ta.value, s = ta.selectionStart, end = ta.selectionEnd;
  if (e.key === "Tab") {
    e.preventDefault();
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    if (s === end && !e.shiftKey) {
      insert("  ");
      return;
    }
    const le = v.indexOf("\n", end - (end > s && v[end - 1] === "\n" ? 1 : 0));
    const block = v.slice(ls, le < 0 ? v.length : le);
    const next = block.split("\n").map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, "") : "  " + l)).join("\n");
    ta.setSelectionRange(ls, ls + block.length);
    insert(next);
    ta.setSelectionRange(ls, ls + next.length);
  } else if (e.key === "Enter" && !e.isComposing) {
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    const indent = /^ */.exec(v.slice(ls, s))[0];
    if (indent) {
      e.preventDefault();
      insert("\n" + indent);
    }
  } else if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    download(`${name}.flow`, ta.value, "text/plain");
  }
});

// ---------------------------------------------------------------- 範例、分享、下載
const pick = $("#example");
for (const ex of EXAMPLES) {
  const o = document.createElement("option");
  o.value = ex.id;
  o.textContent = ex.title;
  pick.appendChild(o);
}
pick.addEventListener("change", () => {
  const ex = EXAMPLES.find((x) => x.id === pick.value);
  pick.value = "";
  if (!ex) return;
  name = ex.id;
  replaceAll(ex.text);
  update();
  toast(`已載入「${ex.title}」。原本的內容按 ⌘Z／Ctrl+Z 可以復原`);
});

// 發佈成 claude.ai artifact 時，頁面不能自己下載，要透過 downloads 能力（會先請使用者確認）
const inArtifact = typeof globalThis.claude?.use === "function";
let saver = null;
if (inArtifact) globalThis.claude.use("downloads").then((d) => (saver = d), () => {});
const SAVABLE = /\.(html|txt|json|md|csv|svg)$/; // artifact 允許的副檔名裡和這裡有關的幾個

async function download(filename, text, type) {
  if (inArtifact) {
    if (!saver) {
      toast("這裡不能下載檔案", { label: "改為複製", run: () => copy(text, filename) });
      return;
    }
    const fn = SAVABLE.test(filename) ? filename : `${filename}.txt`;
    try {
      await saver.save({ filename: fn, data: text });
      toast(fn === filename ? `已存成 ${fn}` : `已存成 ${fn}：這裡只能存 .txt，把結尾的 .txt 拿掉就是原本的檔案`);
    } catch (e) {
      if (e?.code === "declined") toast("已取消下載");
      else if (e?.code === "rate_limited") toast("上一個下載還在等你確認");
      else toast("這裡不能下載檔案", { label: "改為複製", run: () => copy(text, filename) });
    }
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`已下載 ${filename}`);
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`已複製 ${what} 的內容`);
  } catch (e) {
    toast("瀏覽器不讓這個頁面使用剪貼簿");
  }
}

$("#dl-flow").addEventListener("click", () => download(`${name}.flow`, ta.value, "text/plain"));
$("#dl-html").addEventListener("click", () => {
  if (lastHtml) download(`${name}.html`, lastHtml, "text/html");
  else toast("還沒有成功產生過頁面：先修正 error");
});
$("#dl-feature").addEventListener("click", () => download(`${name}.feature`, featureBox.value || lastFeature, "text/plain"));

// ---------------------------------------------------------------- 驗收腳本：改 .feature 再套用回 .flow
const featureState = $("#feature-state"), featureIssues = $("#feature-issues");
const applyBtn = $("#apply-feature"), discardBtn = $("#discard-feature");

function showFeatureState() {
  featureState.classList.toggle("dirty", featureDirty);
  featureState.textContent = featureDirty ? "有還沒套用的修改：.flow 改了也不會覆蓋這裡" : "跟著 .flow 即時更新；也可以直接改，再套用回 .flow";
  applyBtn.disabled = !featureDirty;
  discardBtn.hidden = !featureDirty;
}

featureBox.addEventListener("input", () => {
  featureDirty = featureBox.value !== lastFeature;
  showFeatureState();
});

discardBtn.addEventListener("click", () => {
  featureDirty = false;
  featureBox.value = lastFeature;
  featureIssues.hidden = true;
  showFeatureState();
});

function showFeatureIssues(r, applied) {
  const items = [
    ...r.changes.map((c) => `<li><button type="button" class="chg" data-line="${c.line}"><span class="code">修改</span><span class="ln">第 ${c.line} 行</span><span class="msg">${esc(c.msg)}</span></button></li>`),
    ...r.issues.map((i) => `<li><button type="button" class="${i.level}" data-line="${i.line}"><span class="code">${i.code}</span><span class="ln">第 ${i.line} 行</span><span class="msg">${esc(i.msg)}</span></button></li>`),
  ];
  if (applied && items.length) items.unshift('<li class="note">已套用到 .flow；行號是套用前的 .feature（現在這裡換成從 .flow 重新產生的版本）</li>');
  featureIssues.innerHTML = items.join("");
  featureIssues.hidden = !items.length;
}

featureIssues.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-line]");
  if (!b) return;
  const lines = featureBox.value.split("\n");
  const k = Math.max(1, Math.min(Number(b.dataset.line), lines.length));
  let start = 0;
  for (let i = 0; i < k - 1; i++) start += lines[i].length + 1;
  featureBox.focus();
  featureBox.setSelectionRange(start, start + lines[k - 1].length);
  const lh = parseFloat(getComputedStyle(featureBox).lineHeight) || 20;
  featureBox.scrollTop = Math.max(0, (k - 1) * lh - featureBox.clientHeight / 3);
});

function applyFeature() {
  let r;
  try {
    r = fromFeature(featureBox.value);
  } catch (e) {
    console.error(e);
    r = { flow: null, changes: [], issues: [{ level: "error", code: "E0", line: 1, msg: `flowdoc 內部錯誤：${e.message}` }] };
  }
  const ok = r.flow !== null && !r.issues.some((i) => i.level === "error");
  showFeatureIssues(r, ok);
  if (!ok) {
    toast("驗收腳本有 error，沒有套用：看下面的清單");
    return;
  }
  featureDirty = false;
  showFeatureState();
  if (r.flow !== ta.value) replaceAll(r.flow);
  update();
  toast(r.changes.length ? `套用了 ${r.changes.length} 處修改；.flow 按 ⌘Z／Ctrl+Z 可以復原` : "沒有修改：.feature 和 .flow 一致");
}

applyBtn.addEventListener("click", applyFeature);

const featureFile = $("#feature-file");
$("#open-feature").addEventListener("click", () => featureFile.click());
featureFile.addEventListener("change", async () => {
  const f = featureFile.files[0];
  featureFile.value = "";
  if (!f) return;
  featureBox.value = await f.text();
  name = f.name.replace(/\.(feature|txt)$/g, "").replace(/\.feature$/, "") || name;
  featureDirty = true;
  showFeatureState();
  applyFeature();
});

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function packSource(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return b64url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function unpackSource(s) {
  const stream = new Blob([unb64url(s)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

$("#share").addEventListener("click", async () => {
  const hash = "#src=" + (await packSource(ta.value));
  const url = location.href.replace(/#.*$/, "") + hash;
  try {
    await navigator.clipboard.writeText(url);
    toast("分享連結已複製；對方打開就會看到這份內容");
  } catch (e) {
    try {
      history.replaceState(null, "", hash);
      toast("瀏覽器不讓複製；連結已經放在網址列，從那裡複製");
    } catch (e2) {
      toast("這個環境不能複製也不能改網址；請改用「下載 .flow」分享");
    }
  }
});

let toastTimer = null;
function toast(msg, action = null) {
  const t = $("#toast");
  t.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = action.label;
    b.addEventListener("click", action.run);
    t.append(" ", b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 8000 : 4000);
}

// ---------------------------------------------------------------- 分頁
const TABS = ["preview", "feature", "help"];
for (const id of TABS) {
  $(`#tab-${id}`).addEventListener("click", () => {
    for (const other of TABS) {
      $(`#tab-${other}`).setAttribute("aria-selected", String(other === id));
      $(`#view-${other}`).hidden = other !== id;
    }
  });
}

// ---------------------------------------------------------------- 開始
async function initialText() {
  const m = /^#src=([\w-]+)$/.exec(location.hash);
  if (m) {
    try {
      name = "shared";
      return await unpackSource(m[1]);
    } catch (e) {
      toast("分享連結壞了，改開入門範例");
    }
  }
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft && draft.trim()) return draft;
  } catch (e) {}
  name = EXAMPLES[0].id;
  return EXAMPLES[0].text;
}

ta.value = await initialText();
update();
