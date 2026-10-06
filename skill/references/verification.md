# 驗證

`flowdoc verify <file.flow>` 一律在發佈前跑，`EXIT=0` 才能發佈。輸出每一項都帶行號，格式：

```
examples/x.flow:42: error E2 step "記下 doc_id" 點亮了不存在的元件 cat.syncc
examples/x.flow:17: warn  W2 標籤「Create」與 node kb 重疊 6px
```

error 讓 exit code 非 0；warn 不擋，但要在回報裡交代為什麼保留。需要的工具不存在時（`node`、Google Chrome），對應的檢查會印出「略過 …」，不會默默當作通過。

`verify x.flow` 跑第一、二層；第一層有 error 時第二層會印「略過」，先修第一層。`verify x.feature`（改過的驗收腳本）先轉回 `.flow`，再跑第一、二層，行號是 `.feature` 的行號（見「改過的 .feature」）。

## 第一層：語法與參照（只讀 `.flow`）

| 代號 | 等級 | 檢查 |
|---|---|---|
| E1 | error | parse error：未知關鍵字、縮排錯、缺參數、多餘參數 |
| E2 | error | 參照不存在：`on`、`edge` 端點、`cross` 目標、`cards`、`set`／`note`／`eventually` 的卡（含沒列在該段 `cards` 的卡）、`unset` 的 key、`from` 指向的步驟（要在這一步之前）；`on` 點亮 ghost、edge 接到 ghost；`eventually` 列的卡這一步沒有變化 |
| E3 | error | 同一段 canvas 內 id 重複；store、part、決定編號、示意 id（`alias`）重複；`cards` 重複列同一張卡 |
| E4 | error | 一段裡有兩條 `key` 連線，或整頁有兩個以上 `key` 步驟（整頁只有一個 ★） |
| W1 | warn | 元件或連線從未被任何步驟點亮（畫了卻沒用到，通常該刪） |
| W4 | warn | 一段少於 2 步或多於 10 步 |
| W5 | warn | 一段列出的卡從未被 `init`／`set` 寫過 |
| W6 | warn | `desc` 超過 120 字 |
| W8 | warn | 卡片標了 `in <元件>`，但列出它的某一段圖上沒有那個元件 |

## 第二層：版面（renderer 算完座標後）

| 代號 | 等級 | 檢查 |
|---|---|---|
| E5 | error | 兩個框重疊（pod 與它自己的 inner 除外） |
| E6 | error | 元件或標籤超出 viewBox（座標是負的），或超出 `canvas cols`／`rows` 宣告的範圍 |
| W2 | warn | 標籤與任何框或其他標籤重疊 |
| W3 | warn | 連線穿過與它無關的框 |
| W7 | warn | 整張圖寬度超過 1000：1280 寬的螢幕上舞台左欄約 800px，SVG 的 min-width 是寬度的 0.8 倍，超過就要橫向捲動 |

文字寬度估算：CJK（East Asian Width 為 W／F）算 1em、其他字元 0.56em，mono 字型的非 CJK 字元 0.6em；字級依 class（`t-name` 11px、`t-sub`／`t-lab` 9px、`t-mono` 9px、`t-pod` 12px）。

## 第三層：輸出的 HTML

| 代號 | 等級 | 檢查 |
|---|---|---|
| E7 | error | `div`、`section`、`svg`、`g`、`table` 開關標籤數量不一致 |
| E8 | error | 內嵌 JS 語法錯誤（Node 內建的 `vm` 編譯一次，不執行；在沒有檢查器的環境印「略過」）；`flow-data` 不存在或不是合法 JSON |
| E9 | error | 每段的 `on` 裡有 SVG 找不到的 `data-k`，或 SVG 裡有從未被點亮的 `data-k`（第一層 W1 的最終確認） |
| E10 | error | 少了 `<title>`、`:root` 色票、dark 兩組區塊、`body` 背景色，或 `[hidden]{display:none!important}`（沒有它，svg 與 `display:flex` 的卡片藏不起來，直接開檔案時五段疊在一起） |

## 改過的 .feature（`flowdoc flow`／`verify x.feature`）

`.feature` 轉回 `.flow` 時（對應規則見 `gherkin.md`「轉回 .flow」），對應不到的修改不會默默丟掉：

| 代號 | 等級 | 檢查 |
|---|---|---|
| E12 | error | 轉不回去：沒有「#@」原文（不是 flowdoc 產生的 .feature）、場景前面沒有 `#@ part`、步驟原文集中在段落開頭的段落（步驟順序和場景順序不同）增刪了場景或「當」 |
| W9 | warn | 這個修改對應不到 `.flow`，略過：認不得的 Gherkin 行、改到推導出來的內容（分支場景開頭重複的前置步驟、分支場景的名稱、其他場景的起始狀態）、async 步驟拿掉「最終」、表格列數不是兩格、改了卡片名稱、故障數量變了、斷言一張這一步沒有變動的卡 |

`#@` 原文本身的語法錯誤照常是 E1，行號指到 `.feature` 裡那一行 `#@`。轉出來的 `.flow` 再跑第一、二層，問題的行號換算回 `.feature`（訊息後面附上轉出的 `.flow` 第幾行）。

## 第四層：看畫面（`flowdoc shot`）

`flowdoc shot <file.html> --out shots/` 用本機 headless Chrome 對每一段截圖（靠 `#p<N>` 直接開第 N 段），寬度 1280 與 420 各一張，light（`--blink-settings=preferredColorScheme=1`）與 dark（`--force-dark-mode`）各一張，檔名 `p<N>-<寬>-<主題>.png`。找不到 Chrome 時印「略過」；可用環境變數 `FLOWDOC_CHROME` 指定路徑。

| 代號 | 等級 | 檢查 |
|---|---|---|
| E11 | error | 用 `--dump-dom` 開 `#p<N>` 後，runtime 沒有正常執行：沒有選到第 N 段、步驟點數量不對、readout 標題是空的，或該段的 svg 沒顯示；或截圖失敗 |

實作上要注意的地方：

- headless Chrome 的視窗最少 500 寬，`--window-size=420` 實際排版是 500。420 的截圖是把頁面放進 420 寬的 iframe 再截，所以圖右邊會有一段灰底。
- macOS 上 headless Chrome 截完圖、倒完 DOM 常常不會自己結束；`shot` 讀到結果就把它關掉。
- 字型 stylesheet 會擋住後面 inline script 的執行；DOM 檢查時讓字型網域解析失敗，避免在 runtime 跑之前就倒出 DOM。

截圖給撰寫者（人或 agent）自己看一次：標籤有沒有被擋、連線有沒有交錯、窄螢幕會不會擠爛。看一次、修一輪，不要無限迴圈。

## 回歸

`test/`（`node --test test/*.test.js`）至少包含：

- 每個 `examples/*.flow` 都能 render 且 verify 通過。
- `.flow → .feature → .flow` 對每個範例與 fixture 逐字相同、沒有任何修改；每一種 Gherkin 上的修改（標題、預期、故障、表格、起始狀態、「最終」、示意 id、新增與刪除步驟）轉回後只改到對應的那幾行；對應不到的給 W9／E12（`test/roundtrip.test.js`）。
- 一組故意寫錯的 `.flow`（`test/fixtures/bad-*.flow`），各自觸發預期的錯誤代號；第 2 行寫 `# expect: E2@12`（代號@行號）。E7–E10 用改壞輸出 HTML 的方式測，E11 用假的 DOM 測判定邏輯，實際的 Chrome 檢查在 `make shot`。
- 瀏覽器 editor：打包後的核心和 Node 版產生一模一樣的頁面；`dist/flowdoc-editor.html` 是最新的；端對端測試用 headless Chrome（DevTools 協定，Node 22+ 內建的 WebSocket）實際操作 editor：改字後預覽更新並停在同一步、打錯 id 時保留上一次的預覽、點錯誤跳到那一行、修好、載入範例。沒有 Chrome 或 Node 版本不夠時明確略過。
