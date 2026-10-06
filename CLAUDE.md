# flowdoc

- 一律用繁體中文溝通與撰寫文件；程式識別字保持英文。
- 實作只用 JavaScript，不加任何第三方套件（沒有 package 相依）。`src/` 的核心模組瀏覽器與 Node 共用，不能碰 `node:*`；只有 `src/node/` 可以用 Node 內建模組。CLI 與測試只需要 Node 20+（editor 的端對端測試要 22+，內建 WebSocket；不夠時略過）。
- 核心模組只用具名 import／export 與相對路徑，不用 default export：`src/node/build-editor.js` 靠這個規則把它們打包進 editor。
- 截圖與 editor 的端對端測試用本機 Google Chrome headless（`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，或 `FLOWDOC_CHROME`）；不存在時對應的檢查要明確回報「略過」，不能默默當作通過。
- `dist/flowdoc-editor.html` 是打包好的 editor，進版控給沒有 Node 的人直接打開；改了 `src/`、`editor/`、`skill/assets/` 或範例之後，`make check` 會重新產生它，要一起 commit。
- `skill/references/format.md` 是格式的唯一來源。改格式時同一個 commit 內更新規格、parser、範例與測試。
- `.feature` 的格式由 `src/gherkin.js` 產生、`src/roundtrip.js` 讀回；改其中一邊要同時改另一邊與 `skill/references/gherkin.md`。`make check` 會確認每個範例 `.flow → .feature → .flow` 逐字相同。
- `skill/assets/runtime.js` 與 `page.css` 是所有輸出頁面共用的，不在裡面放任何文件內容。
- 完成任何變更前跑 `make check`，確認 `EXIT=0`。
- 錯誤訊息要帶 `.flow` 的行號與代號（E1…、W1…，見 `skill/references/verification.md`），說清楚錯在哪、怎麼修。
