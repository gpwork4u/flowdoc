# 交接：flowdoc

## 背景

這種「可播放的架構動畫頁」最初是手工做的：SVG 座標全手寫、每一步每張狀態卡都要寫完整內容、標籤常被框擋住、改一個元件要動好幾處。flowdoc 把它變成「寫 `.flow` → verify → render」。

之後加了兩個方向：同一份 `.flow` 轉成 Gherkin `.feature`，讓 cucumber 這類工具驗證每個情境裡各 service 的狀態；`.feature` 帶著 `.flow` 原文，改過的 `.feature` 可以轉回 `.flow`（一對一）。0.2 版改寫成純 JavaScript，同一份核心在瀏覽器 editor 與 Node CLI 裡跑。

## 已完成

- 規格：`skill/SKILL.md`、`skill/references/` 裡的 format／design-rules／verification／output／gherkin。
- `src/`（瀏覽器與 Node 共用）：parser（E1）、carry-over 狀態、layout（格線、連線端點錯開、標籤避讓）、renderer（含 `--standalone`）、verify 第一到三層（E2–E10、W1–W8）、`gherkin.js`（.flow → .feature，帶 `#@` 原文）、`roundtrip.js`（.feature → .flow，E12／W9）。
- `src/node/`：CLI（init／render／verify／shot／gherkin／flow／editor）、shot（截圖＋runtime 檢查 E11）、editor 打包、GitHub Pages 的內容（`site.js`）。
- 瀏覽器 editor：`editor/` 是原始碼，`dist/flowdoc-editor.html` 是打包好的單一檔案；即時預覽、停在同一步、錯誤標在行號上、分享連結、下載、驗收腳本分頁可以改再套用回 `.flow`。
- `test/`：每個錯誤代號都有 fixture（`test/fixtures/bad-*.flow`）、HTML 改壞測試、版面不變式、Gherkin 結構、`.flow ↔ .feature` 互轉、skill 經 symlink 執行、editor 打包與端對端測試、site。
- 三份範例（都是虛構的系統）：`upload-avatar.flow`（入門）、`catalog-search-sync.flow`（五段、pod、平行連線、故障分支、動畫下方的區塊）、`doc-search-acl.flow`（ghost、雙行標籤、`from 0`、`qa`、舊做法欄）。
- `.github/workflows/`：`ci.yml` 跑 `make check`；`pages.yml` 把 `make site`（editor 當首頁，加上範例頁面）部署到 GitHub Pages。

## 做過的決定（已寫回規格）

- **整頁只有一個 ★。** 每張圖仍可各有一條 `key` 連線。
- **`mono` 修飾它前面最近的字串**：`inner run "ProductService.Create" mono sub "…"` 是名稱用等寬字，`node s "search" sub "SearchDocumentV1" mono` 是第二行用等寬字。
- **`stage`、`caption`**：動畫區的標題與 figcaption。
- **欄寬依內容（至少 120）、欄距依跨過那道空隙的標籤（至少 44），圖寬超過 1000 是 W7。**
- **`[hidden]` reset 放進 `page.css`**：少了它，直接開檔案時每一段的 SVG 疊在一起、其他段的卡片藏不起來；E10 會檢查。
- **`.split` 單欄時要 `minmax(0,1fr)`**：否則 SVG 的 min-width 讓整頁在手機寬度橫向溢出。
- **runtime**：`desc` 用 innerHTML（renderer 已 escape，支援行內標記）；卡片 DOM id 加 `st-` 前綴；`#p<N>s<M>` 直接開到某一步；嵌在 iframe 裡時每換一步 `postMessage` 回報位置，起點也接受 `window.name`。
- **分支、註記、結果**（為了讓 Gherkin 正確）：`step … from <N>`、`note <卡> "<文字>"`、`expect "<結果>"`。
- **驗收腳本的四個綁定**：示意 id 用 `alias`；失敗分支的故障用 `fault`；卡片用 `store … in <元件 id>` 標出 service（W8）；「最終」除了 async 連線自動判斷，其餘用 `eventually <卡>` 明確標。
- **兩框重疊 ≥ 6px 就畫直線**；**pod 不填色**（接到 inner 的連線會穿過 pod 內距，填色會蓋掉箭頭）。
- **從 Python 改寫成 JavaScript（0.2）**：改寫期間保留 Python 版當對照，兩邊對範例、29 個錯誤 fixture、270 份隨機變形的 `.flow` 跑，HTML、驗證訊息、驗收腳本逐字相同後才刪掉 Python。為了逐字相同而保留的細節：數字依「四捨六入五成雙」（`src/pyfmt.js`）、全形字元表（`src/eaw.js`）、相似字建議移植 difflib 的演算法（`src/difflib.js`）。E6 訊息裡沒宣告的欄列數仍印成 `None`，之後可以改成更白話的說法。
- **`.flow ↔ .feature` 一對一**：`.flow` 每一行原文以 `#@` 註解放進 `.feature`（檔頭、每段第一個場景前、每一步第一次出現的「當」前、檔尾）；步驟順序和場景順序不同的段落，原文集中在段落開頭。轉回時 Gherkin 看得到的內容為準，表格只處理和原本不一樣的列，「當」的增刪會重新編號 `from`。理由與限制見 `gherkin.md`。

## 待辦

1. **在真實專案跑一次驗收腳本。** 用 godog／cucumber-js 實作 `gherkin.md`「step definition 要做什麼」那幾條，對著部署好的環境跑，看哪些約定（示意 id 替換、`…`／`*`、輪詢逾時）要修。
2. **匯入沒有 `#@` 的 `.feature`。** 現在是 E12；可以從場景、「當」與表格產生 `.flow` 骨架（canvas 要人補）。
3. **E6 訊息裡的 `None`** 改成白話（例如「沒有宣告」）。

## 驗收

- `make check` 通過，`EXIT=0`（含 `.feature` 轉回 `.flow` 逐字相同）。
- `out/shots/<範例>/p<N>-<寬>-<主題>.png` 看一次：各段的元件、連線、步驟、卡片內容正確；標籤沒有被框擋住。網址 `#p<N>s<M>` 可以直接開到某一步。
- 故意改壞範例（例如把某步的 `on cat.sync->pg` 改成 `on cat.sync->pgx`），verify 回 E2 並指出正確行號（`test/verify.test.js` 有這個測試）。

## 注意

- 格式若需調整，先改 `format.md`，再改 parser、範例、測試，同一個 commit；影響 `.feature` 的也要改 `gherkin.md` 與 `roundtrip.js`。
- headless Chrome 的視窗最少 500 寬、做完不會自己結束、字型 stylesheet 會擋 inline script；`src/node/shot.js` 都處理了，細節見 `verification.md` 第四層。
