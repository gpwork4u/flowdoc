---
name: flowdoc
description: 用一份類似 mermaid 的 `.flow` 文字檔，產生「可播放的元件拓撲圖」架構文件：依使用者行為分段、每段一張只含用到元件的圖、逐步點亮連線、右側同步顯示各元件此刻裝著什麼、橘框標出要新增或修改的地方、打叉虛線框畫出刻意不走的路，並附四層驗證；同一份 `.flow` 也能轉成 Gherkin `.feature` 當驗收腳本，改過的 `.feature` 可以轉回 `.flow`（一對一）。當使用者提到「架構動畫」、「流程圖動畫」、「可播放的流程圖」、「元件流程圖」、「設計說明做成頁面／動畫頁」、「flowdoc」、「.flow 檔」、「情境轉成 cucumber／gherkin」，或要把跨服務的設計決定畫給團隊看時啟用。
argument-hint: "[要說明的設計：spec 檔路徑、Jira ticket，或直接描述]"
---

# flowdoc

把跨服務的設計說明寫成 `.flow`，交給工具產生一頁 HTML 動畫，驗證通過後發佈。SVG 座標、連線端點、標籤位置、每一步每張卡的完整內容都由工具算；撰寫者只描述「有哪些元件、誰連誰、每一步點亮什麼、卡片裡變了什麼」。

## 指令

一律透過 `scripts/flowdoc.mjs` 執行，下文寫成 `$FLOWDOC`：

```bash
FLOWDOC="node <這個 skill 的目錄>/scripts/flowdoc.mjs"
$FLOWDOC init doc.flow            # 從入門範例產生起點
$FLOWDOC verify doc.flow          # 語法、參照、版面
$FLOWDOC render doc.flow -o doc.html
$FLOWDOC verify doc.html          # 輸出的 HTML
$FLOWDOC shot doc.html --out shots/   # 每段截圖，並確認播放器真的跑起來
$FLOWDOC gherkin doc.flow -o doc.feature   # （選用）驗收腳本，帶著 .flow 原文
$FLOWDOC flow doc.feature -o doc.flow      # 改過的 .feature 轉回 .flow
```

它會跟著 symlink 找到 flowdoc repo，在任何目錄都能跑。skill 要用 `ln -s <flowdoc repo>/skill ~/.claude/skills/flowdoc` 安裝，不能單獨複製出去。需要 Node 20+，沒有相依套件；`shot` 用本機 Google Chrome，找不到時會印「略過」，回報時要照實說。

使用者想自己邊改邊看時，給他 flowdoc repo 的 `dist/flowdoc-editor.html`（瀏覽器打開就能用，左邊寫 `.flow`、右邊即時預覽），或用 `$FLOWDOC editor --fragment -o editor.html` 產生後發佈成 artifact。見 repo 的 `docs/editor.md`。

## 什麼時候用

適合：跨 3 個以上 service 的設計，正當性在於「資料流過哪裡」；有「刻意不用某條路」這類負面決定（不落地、不進佇列、不經過 API）；要給工程師、PM、QA 看同一份東西。

不適合：單一 service 內的小改動（幾句話加一張靜態圖就夠）；純 API 契約（那是 swagger／asyncapi 的工作）。

## 流程

1. **先蒐集，再畫。**
   - 拓撲：哪些 deployable、誰跟誰講話、哪些東西在同一個 process 裡（畫成 pod 與 inner）。從 cdk8s／deployment 設定與程式的 wiring 讀，不要憑印象。以現有做法為主，再標出要改的地方。
   - 每一步的狀態：能從真實的端到端執行取值就用真的（DB 內容、log、檔案大小、id 前綴）。還沒實作的設計用示意資料，示意的 id 用 `alias` 宣告，頁面標「示意」。
   - ghost：這個設計刻意不用什麼？它是負面決定唯一畫得出來的地方，投報率最高。
2. **依使用者行為切段。** 每段是一種行為（上架、發佈變更、下架、backfill…），各自 2–8 步。失敗路徑用 `step … from <N>` 分支，不要另開一段重畫。
3. **寫 `.flow`。** 從 `$FLOWDOC init doc.flow` 開始改。格式見 `references/format.md`；flowdoc repo 的 `examples/` 有三份範例：`upload-avatar.flow`（入門）、`catalog-search-sync.flow`（五段、pod、平行連線、故障分支）、`doc-search-acl.flow`（ghost、雙行標籤、`qa`）。
4. **驗證到 `EXIT=0`。** `verify doc.flow` → `render` → `verify doc.html` → `shot`。每個問題都帶行號與代號（見 `references/verification.md`）。warn 可以保留，但回報時要說為什麼。截圖自己看一次：標籤有沒有被擋、窄螢幕會不會擠爛；看一次、修一輪，不要無限迴圈。
5. **發佈。**
   - claude.ai artifact：用 Artifact 工具發佈 `render` 的預設輸出（只有內文，artifact 會補頁首）。頁尾若有指向其他頁的相對連結，先換成那一頁的 artifact 網址。網址加 `#p<N>s<M>` 可以直接開到第 N 段第 M 步，貼給 review 的人很方便。
   - 靜態站（例如 GitLab Pages）：`render --standalone`，輸出完整的 HTML 文件。
6. **改版時改 `.flow`，不要改 HTML。** 重新 render、重新 verify，再發佈到同一個位置（artifact 用同一個檔案路徑或網址）。
7. **（選用）產生驗收腳本。** `gherkin doc.flow -o doc.feature`：每條路徑一個場景，每步一個「當」，有變動的卡變成「那麼」；`.flow` 原文以 `#@` 註解跟著放進去。有人改了 `.feature`（場景、步驟、表格），用 `flow doc.feature -o doc.flow` 轉回來，看它列出的修改與 W9，再照常 verify、render。對應規則與 step definition 的約定見 `references/gherkin.md`。

## 撰寫重點

完整規則在 `references/design-rules.md`，最常犯的幾條：

- **一段一張圖，圖上只放這段用到的元件。** 一張圖寬度不超過 1000（W7）；太寬就把一串連線改成上下排。
- **三種顏色各有語意**：青色是「這一步正在發生」、褐色虛線是「刻意不走」、橘色實線是「要新增或修改」。
- **整頁只有一個 ★**（`step … key`），標在真正的設計分歧點；verify 會擋第二個（E4）。
- **desc 講為什麼，不講做什麼**，保持精簡（≤ 120 字）；圖已經說了做什麼。
- **卡片只放狀態**：比較、判斷、「不變」用 `note`，結果（回錯誤…）用 `expect`；分支用 `step … from <N>`，不要把卡片手動改回去。這三條決定了產生出來的驗收腳本對不對。
- **給驗收腳本的宣告**：示意 id 用 `alias`；卡片在哪個 service 用 `store … in <元件>`；失敗分支的故障用 `fault`；等前面非同步工作才成立的卡用 `eventually`。
- **標題說出論點**：「商品改了，搜尋跟著換版」，不要「XX 設計說明」。決定表的編號（D1…、P1-1…）是跨文件的對照 key，發佈後不重排。

## 與其他文件的分工

這一頁是說明用的，不是單一事實來源。權威版本在 living spec（例如 `docs/spec/*.md`）、asyncapi／swagger、施工圖、wiki。所以決定表要用和那些文件相同的編號，頁尾列出現況依據的檔案路徑（含 commit）。設計變更時這一頁也要跟著改：過期的視覺化說明比沒有更糟，因為它看起來很可信。

## 檔案

| 路徑 | 內容 |
|---|---|
| `references/format.md` | `.flow` 格式規格（唯一來源） |
| `references/design-rules.md` | 版面、顏色、文字、內容的規則 |
| `references/verification.md` | 驗證項目與代號 |
| `references/output.md` | 輸出 HTML 的契約 |
| `references/gherkin.md` | `.flow` ↔ `.feature` 的對應規則、轉回去時怎麼改、step definition 的約定 |
| `assets/page.css` | 頁面樣式（含三種主題狀態） |
| `assets/runtime.js` | 播放器，讀 `flow-data` JSON，所有頁面共用 |
| `scripts/flowdoc.mjs` | CLI 入口（init／render／verify／shot／gherkin／flow／editor） |

完整使用文件在 flowdoc repo 的 `README.md` 與 `docs/`。
