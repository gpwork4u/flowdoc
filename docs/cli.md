# 指令參考

```text
node bin/flowdoc.js <init|render|verify|shot|gherkin|flow|editor> …
```

需要 Node 20 以上，沒有任何相依套件，不用 `npm install`。在 repo 根目錄用 `node bin/flowdoc.js`；在其他目錄用 skill 的入口 `node <flowdoc repo>/skill/scripts/flowdoc.mjs`（透過 symlink 裝成 skill 時是 `~/.claude/skills/flowdoc/scripts/flowdoc.mjs`），兩者參數完全相同。不帶參數或加 `--help` 會印出用法。

## exit code

| code | 意義 |
|---|---|
| 0 | 成功；可能有 warn |
| 1 | 有 error、檔案已存在（`init`）、`.feature` 轉不回去（`flow`），或找不到輸入檔 |
| 2 | 參數寫錯；會印出用法 |

## 輸出格式

`verify`、`shot`、`flow`、`render`／`gherkin` 失敗時，每個問題一行：

```text
<檔案>:<行號>: <error|warn > <代號> <說明與修法>
```

最後一行是摘要 `<檔案>: N error · M warn`。工具不存在而跳過的檢查會印成 `<檔案>: 略過 …`，不會默默當作通過。代號的意義見 [驗證規格](../skill/references/verification.md)。

---

## init

```text
init <out> [--force]
```

從入門範例（[`examples/upload-avatar.flow`](../examples/upload-avatar.flow)）產生一份新的 `.flow` 當起點。開頭的註解會換成給新文件的提示，其餘照抄；產生出來的檔案直接就能通過 verify。

| 參數 | 說明 |
|---|---|
| `out` | 要產生的 `.flow` 路徑；目錄不存在會自動建立 |
| `--force` | 檔案已存在時覆蓋；沒加就拒絕並回 1 |

## render

```text
render <src.flow> -o <out.html> [--standalone]
```

把 `.flow` 產生成 HTML。會先跑第一、二層驗證：

- 有 error：只印出 error，不寫檔，回 1。
- 只有 warn：照常輸出，最後提示「N 個 warn，跑 verify 看細節」。

| 參數 | 說明 |
|---|---|
| `src` | `.flow` 檔 |
| `-o`, `--out` | 輸出的 HTML 路徑；目錄不存在會自動建立 |
| `--standalone` | 輸出完整的 HTML 文件（`<!DOCTYPE html>`、head、viewport），給靜態站用 |

預設輸出只有內文（`<title>`、樣式、頁面、資料與播放器），給 claude.ai artifact 用；artifact 會補上頁首。兩種輸出都內嵌 `page.css` 與 `runtime.js`，不依賴外部檔案（字型從 Google Fonts 載入，載不到時用系統字型）。

產生的頁面支援 `#p<N>`（開第 N 段）與 `#p<N>s<M>`（開第 N 段第 M 步）。

## verify

```text
verify <src.flow | src.html | src.feature>
```

依副檔名決定檢查哪幾層：

| 輸入 | 檢查 | 代號 |
|---|---|---|
| `.flow` | 第一層：語法與參照；第二層：版面（第一層有 error 時略過） | E1–E6、W1–W8 |
| `.html`／`.htm` | 第三層：標籤配對、內嵌 JS 語法、flow-data 與 SVG 對得上、主題色票與 hidden reset | E7–E10 |
| `.feature` | 轉回 `.flow` 會不會有問題（不寫檔），再對轉出的 `.flow` 跑第一、二層；行號是 `.feature` 的行號 | E12、W9，以及 E1–E6、W1–W8 |

E8 的 JS 語法檢查用 Node 內建的 `vm` 編譯一次（不執行），不需要另外的工具。

## shot

```text
shot <src.html> --out <dir>
```

用本機 headless Google Chrome 對每一段截圖，並確認播放器真的跑起來。

- 每段 4 張：1280／420 寬 × light／dark，檔名 `p<段>-<寬>-<主題>.png`。
- 每段用 `--dump-dom` 開 `#p<N>`，確認選到第 N 段、步驟點數量對、readout 有標題、那張 svg 有顯示；不對就是 E11。
- 找不到 Chrome 時印「略過截圖與 runtime 檢查（E11）」。macOS 預設找 `/Applications/Google Chrome.app`，其他系統找 PATH 裡的 `google-chrome`、`chromium`；用環境變數 `FLOWDOC_CHROME` 可以指定路徑。
- headless Chrome 的視窗最少 500 寬，所以 420 寬的圖是把頁面放進 420 寬的 iframe 截的，圖右邊會有一段灰底。

| 參數 | 說明 |
|---|---|
| `src` | `render` 產生的 HTML |
| `--out` | 截圖輸出目錄；不存在會自動建立 |

## gherkin

```text
gherkin <src.flow> [-o <out.feature>]
```

把每一段情境轉成 Gherkin `.feature`（`# language: zh-TW`），並把 `.flow` 的每一行原文以 `#@` 註解放進去，之後可以用 `flow` 轉回來。會先跑第一、二層驗證，有 error 就不輸出、回 1。

| 參數 | 說明 |
|---|---|
| `src` | `.flow` 檔 |
| `-o`, `--out` | 輸出路徑；省略就印到 stdout |

對應規則（場景怎麼切、什麼時候寫「最終」、`alias`／`fault`／`in` 怎麼轉）見 [驗收腳本](../skill/references/gherkin.md)。

## flow

```text
flow <src.feature> [-o <out.flow>]
```

把 `gherkin`（或 editor）產生、之後改過的 `.feature` 轉回 `.flow`。`#@` 行是 `.flow` 原文；Gherkin 看得到的內容（標題、預期、故障、表格、「最終」、新增或刪除的「當」）以 Gherkin 為準，改寫對應的 `.flow` 行，其餘逐字保留。沒改過的 `.feature` 轉回來和原本的 `.flow` 逐字相同。

| 參數 | 說明 |
|---|---|
| `src` | `.feature` 檔 |
| `-o`, `--out` | 輸出的 `.flow` 路徑；省略就把 `.flow` 印到 stdout，訊息改印到 stderr |

每一處套用的修改印成一行 `<檔案>:<行號>: 修改  <說明>`，行號是 `.feature` 的行號；接著是問題（E12、W9，以及轉出的 `.flow` 跑第一、二層的結果）與摘要。有 error 時不輸出、回 1。

```text
$ node bin/flowdoc.js flow doc.feature -o doc.flow
doc.feature:72: 修改  第 1 段第 1 步的標題改成「跟 API 要上傳網址」
doc.feature:74: 修改  第 1 段第 1 步的「row」改成表格的內容（avatar_status）
doc.feature: 0 error · 0 warn
doc.feature → doc.flow（套用了 2 處修改）
```

哪些修改對應得到、哪些會得到 W9 或 E12，見 [驗收腳本](../skill/references/gherkin.md)「轉回 .flow」。

## editor

```text
editor [-o <out.html>] [--fragment]
```

產生瀏覽器 editor：一個 HTML 檔，核心、樣式、播放器與三份範例全部內嵌，直接打開就能用。用法見 [瀏覽器 editor](editor.md)。

| 參數 | 說明 |
|---|---|
| `-o`, `--out` | 輸出路徑；預設 `flowdoc-editor.html` |
| `--fragment` | 不含 `<!DOCTYPE>`、`<html>`、`<head>`、`<body>`，給 claude.ai artifact 發佈用（和 `render` 的預設輸出同一個規則） |

---

## make 目標

| 目標 | 做什麼 |
|---|---|
| `make check` | `render`（含 `.feature`）＋ `verify` ＋ `editor` ＋ `test` ＋ `shot`；完成任何變更前都要 `EXIT=0` |
| `make site` | 產生 GitHub Pages 的內容到 `_site/`：editor 當首頁，加上每個範例的頁面、`.flow` 與 `.feature` |
| `make render` | 每個 `examples/*.flow` 產生 `out/<名稱>.html` 與 `out/<名稱>.feature` |
| `make verify` | 驗證每個範例的 `.flow` 與 `out/` 裡的 HTML |
| `make editor` | 重新產生 `dist/flowdoc-editor.html`（進版控，測試會確認它是最新的） |
| `make test` | `node --test test/*.test.js`；editor 的端對端測試需要 Chrome 與 Node 22+，沒有就略過 |
| `make shot` | 每個範例截圖到 `out/shots/<名稱>/` |
| `make clean` | 刪掉 `out/` 與 `_site/` |

`NODE` 可以換 Node 執行檔：`make check NODE=/opt/node22/bin/node`。
