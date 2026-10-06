# 輸出頁面的契約

renderer 產生的 HTML 必須符合這份契約，`runtime.js` 才能運作。頁面的資料放在 `flow-data` JSON，`runtime.js` 讀它來播放。

## 骨架

```html
<title>{title}</title>
<link rel="preconnect" …> <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC…&family=Noto+Serif+TC…&family=JetBrains+Mono…">
<style>{skill/assets/page.css 原文}</style>

<div class="page">
  <header class="hd">
    <div class="eyebrow">{eyebrow}</div>
    <h1>{title}</h1>
    <p class="lede prose">{lede}</p>
    <div class="meta"><span class="chip key|old">…</span>…</div>
  </header>

  <section>
    <div class="sechead"><h2>{stage}</h2><p>{stage desc}</p></div>      <!-- .flow 沒寫 stage 就省略 -->
    <figure><div class="stage"><div class="split">
      <div class="split-l">
        <div class="parts" id="parts" role="tablist" style="--parts:{min(段數,5)}"></div>   <!-- runtime 產生分頁按鈕 -->
        <div class="legend">…</div>                                 <!-- 圖例：橘框／打叉虛線框／虛線箭頭 -->
        <div class="flowwrap">
          <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>marker#ah、marker#ahs</defs></svg>
          <svg class="flow" id="fp1" viewBox="0 0 W H" style="max-width:Wpx;min-width:{0.8W}px" role="img" aria-label="…">…</svg>
          <svg class="flow" id="fp2" … hidden>…</svg>              <!-- 每段一張，第一張以外都 hidden -->
        </div>
        <div class="controls">
          <button class="primary" id="play">播放這一段</button><button id="prev">上一步</button><button id="next">下一步</button>
          <div class="dots" id="dots" role="tablist"></div>
        </div>
        <div class="readout" aria-live="polite"><div class="step-n" id="stepN"></div><h3 id="stepT"></h3><p id="stepD"></p></div>
      </div>
      <aside class="split-r">
        <div class="stores-head"><h3>此刻各元件裡裝著什麼</h3><span class="hint">示意資料 · 有變動的會亮起</span></div>
        <div class="stores" id="stores"></div>                      <!-- runtime 產生狀態卡 -->
      </aside>
    </div></div><figcaption>{caption}</figcaption></figure>              <!-- 沒寫 caption 就省略 -->
  </section>

  <section>facts → takeaway</section>
  <section>code</section> <section>table</section> <section>decisions</section>
  <footer>…</footer>
</div>

<script type="application/json" id="flow-data">{…}</script>
<script>{skill/assets/runtime.js 原文}</script>
```

`--standalone` 時外面再包 `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">…</head><body>…</body></html>`，並在 `<style>` 最後補 `body{margin:0}img{max-width:100%}`。

`[hidden]{display:none!important}` 放在 `page.css` 裡，兩種輸出都有：SVG 元素沒有 `[hidden]` 的預設樣式，`.store{display:flex}` 也會蓋過瀏覽器預設，少了它切段時其他段藏不起來（artifact 外殼雖然也補這條，直接開檔案或截圖時要靠 page.css）。

## SVG 內的元素

每段一張 `<svg class="flow">`，繪製順序固定（後畫的在上層）：

1. ghost：`<g class="ghost">`（rect＋文字＋打叉的線＋標籤）
2. 連線：`<g data-k="{edge id}" class="edge [dash]">`，內含 `<line>` 或 `<path>`；`key` 連線的 line 加 `class="keyflow"`
3. 元件：`<g data-k="{id}" class="node [future]">`、`<g data-k="{pod}.{inner}" class="inner">`，pod 本身是 `class="node pod"`（rect 不填色，接到 inner 的連線才看得到）且標題用 `t-pod`
4. 橘框：`<g class="chg-frame" aria-hidden="true">`，每個 `changed` 一個 rect，比元件外擴 4px（field 外擴 2px），不帶 `data-k`
5. 標籤：`<g data-k="{edge id}:label" class="lbl"><text class="t-lab">…</text></g>`；雙行標籤是兩個 `<text>`（行距 13），`mono` 那一行用 `t-mono`

文字 class：`t-name`（名稱）、`t-sub`（第二行）、`t-mono`（等寬）、`t-lab`（連線標籤）、`t-pod`（pod 標題）。

連線的 `data-k` 若含 `->`，直接放進屬性即可（記得 HTML escape `>`）。點亮連線時，renderer 要把 `"{edge id}:label"`、兩端元件、（若端點是 inner）所屬 pod 一起放進該步的 `on`。

## flow-data JSON

形狀定義在 `runtime.js` 開頭的註解。renderer 負責：

- 依 carry-over 規則算出**每一步每張卡的完整內容**（`cards`），runtime 不做推導。
- 算出每一步的 `changed`（有 set／unset／clear 的卡）。
- `on` 已展開（見上）。
- `key` 為 true 的步驟，runtime 會在標題後加 ★，`.flow` 的標題本身不要寫 ★。
- `desc` 是 renderer 已經 escape 過、套好行內標記（`` `code` `` → `<span class="mono">`、`**粗體**` → `<strong>`）的 HTML，runtime 用 `innerHTML` 放進 readout。卡片的 key／value、標題是純文字，runtime 自己 escape。
- 狀態卡的 DOM id 是 `st-<卡 id>`，避免和 `play`、`stores` 這些固定 id 撞名。
- `fault`、`expect` 由 renderer 依序接在 `desc` 的 HTML 後面：`<span class="fault">故障：…</span>`、`<span class="expect">預期：…</span>`。`alias`、`store … in`、`eventually` 只給驗收腳本用，不影響 HTML。
- `note` 放在步驟的 `notes`（`{卡: [[文字, "hl"|"gone"], …]}`），runtime 接在卡片內容後面，class 是 `note hl`／`note gone`；分支步驟帶 `from`，runtime 在步驟編號後面加「接第 N 步之後」。兩者沒有時省略。
- 網址 `#p<N>` 開第 N 段，`#p<N>s<M>` 開第 N 段第 M 步（給 review 時貼連結、截圖用）。沒有這個 hash 時，runtime 也接受同樣格式的 `window.name`（editor 的預覽在 runtime 之前設定它）。
- 頁面嵌在 iframe 裡時，runtime 每換一步就對外層 `postMessage({ flowdoc: "pos", part, step })`（1 起算），editor 靠它在重新產生後停在同一步。
- JSON 裡的 `</` 寫成 `<\/`，避免提早關掉 `<script>`。
