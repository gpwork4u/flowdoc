# 教學：從零寫一份 `.flow`

這份教學一步步寫出 [`examples/upload-avatar.flow`](../examples/upload-avatar.flow)：「上傳大頭貼」的兩種情境。寫完你會用到 flowdoc 大部分的功能。語法的完整定義在 [格式規格](../skill/references/format.md)，這裡只講怎麼用、為什麼這樣寫。

起點可以用 `init` 產生，再一段一段改成你的設計：

```bash
node bin/flowdoc.js init mydoc.flow
```

邊寫邊看最方便的是 [瀏覽器 editor](editor.md)：打開 `dist/flowdoc-editor.html`，從「載入範例」選入門範例，右邊會即時顯示動畫與檢查結果。下面每一節的片段都可以直接貼進去試。

## 1. 先想清楚要畫什麼

動手寫之前，先回答五個問題。答不出來的，通常代表這份設計還不需要動畫。

| 問題 | 上傳大頭貼的答案 |
|---|---|
| 有哪幾種使用者行為？每種是一段 | 正常上傳；排程清理半途放棄的上傳 |
| 每段用到哪些元件？ | 瀏覽器、API、物件儲存、佇列、縮圖 worker、Postgres |
| 讀者要看哪些狀態的變化？每個是一張狀態卡 | 物件儲存裡的檔案、佇列裡的工作、使用者那一列 |
| 刻意不走哪條路？ | 原圖經過 API 轉送 |
| 真正的設計決定在哪一步？整頁只有一個 ★ | 瀏覽器直傳物件儲存 |

元件和呼叫關係要從程式碼、deployment 設定讀，不要憑印象畫。狀態能從真實執行取值就用真的；還沒實作的設計用示意資料，並在頁面上標「示意」。

## 2. 頁首

```text
flowdoc v1

title 大頭貼不經過 API
eyebrow flowdoc demo · 上傳大頭貼
lede 瀏覽器拿到預簽網址後，直接把原圖傳到物件儲存；API 只發網址、記結果。縮圖交給背景 worker，失敗也不會讓使用者看到破圖。
chip key "原圖直傳物件儲存"
chip "示範用 · 不是真實系統"
chip old "API 轉送原圖"
stage "兩種情境" desc "先看正常上傳（含一條失敗分支），再看排程怎麼清掉半途放棄的上傳。"
```

- 第一行一定是 `flowdoc v1`。縮排一律兩個空白，`#` 開頭到行尾是註解。
- `title` 是唯一必填的頁首。用說出論點的名字（「大頭貼不經過 API」），不要「XX 設計說明」。
- `chip key` 是主色強調、`chip old` 是刪除線（被取代或不採用的做法）。
- `stage` 是動畫區的標題與說明；`caption` 是動畫下方的小字。兩者都可以省略。
- `lede`、`desc` 這類「到行尾的文字」不用加引號，支援 `` `code` `` 與 `**粗體**`。

## 3. 狀態卡

```text
alias upload up_1 up_9

store obj "物件儲存" tag "bucket: avatars" in s3
store job "縮圖工作" tag "queue: thumbnail" in q
store row "使用者資料" tag "users.avatar_*" in db
```

- 每張 `store` 是右側面板的一張卡，代表「某個地方此刻裝著什麼」。`tag` 是卡片右上角的小字。
- `in s3` 標出這張卡是哪個元件裡的狀態（元件 id 在下一節的圖裡定義）。產生驗收腳本時會寫成「物件儲存 的「物件儲存」應該是…」；某段列了這張卡、圖上卻沒有那個元件，verify 會給 W8。
- `alias upload up_1 up_9` 宣告 `up_1`、`up_9` 是示意的 id。動畫照樣顯示；轉成驗收腳本時，每次執行會換成真實建立的資料。

## 4. 第一段：畫圖

```text
part upload "正常上傳" actor "使用者換大頭貼"
  cards obj job row
  init
    set row avatar_url = old.jpg
    set row avatar_status = ready
  canvas
    node web "瀏覽器" sub "選了一張 8 MB 的照片" at 0,0
    node s3 "物件儲存" sub "S3 · 原圖與縮圖" at 1,0
    ghost relay "經 API 轉送原圖" sub "大檔佔住 API 的連線" at 2,0 cross s3 "不走"
    node api "API server" sub "只發網址、記結果" changed at 0,1
    node q "工作佇列" sub "thumbnail" at 1,1
    node worker "縮圖 worker（新）" sub "產生 256px 縮圖" changed at 2,1
    node db "Postgres" at 1,2
      field "users.avatar_url" mono
      field "+ avatar_status" mono changed
    edge web -> api "要上傳網址"
    edge web -> s3 "直傳原圖" key
    edge api -> db "記狀態"
    edge api -> q "排入縮圖" async
    edge q -> worker "取工作" async
    edge worker -> s3 "存縮圖"
    edge worker -> db "換上新網址"
```

**段落**

- `part <id> "<標題>" actor "<誰觸發>"`。標題和 actor 會出現在上方的分頁按鈕。
- `cards` 列出這一段要顯示的卡，順序就是顯示順序。只列用得到的。
- `init` 是這一段開始時各卡的內容，只能用 `set`。每一段都從自己的 `init` 重新開始。

**元件**

- `node <id> "<名稱>" sub "<第二行>" at <欄>,<列>`。格線從 0 起算；跨多格用 `span 1x2`（寬 x 高）。
- 欄寬依該欄最寬的元件決定；欄距依跨過那道空隙的連線標籤決定。只佔一列的元件在列內垂直置中，所以同一列的元件中心對齊，水平連線是直的。
- `changed` 畫橘框：**要新增或修改的地方**，不隨播放變暗。整頁只有它用橘色。
- `field "<文字>"` 是元件裡額外的一行（通常是表或欄位），可以單獨 `changed`。
- `mono` 修飾它前面最近的字串：放在 `field` 後面就是那一行用等寬字，放在 `sub "…"` 後面就是第二行用等寬字。
- `ghost` 畫**刻意不走的路**：褐色虛線框，`cross <目標> "<標籤>"` 畫一條打叉的線指向目標。它是負面決定唯一畫得出來的地方，只畫真正考慮過、刻意不採用的路。
- 同一個 process 裡的東西用 `pod` 包起來，裡面一行一個 `inner`；連線寫 `<pod>.<inner>`。見 [`catalog-search-sync.flow`](../examples/catalog-search-sync.flow)。

**連線**

- `edge <從> -> <到> "<標籤>"`。箭頭前後要有空白，標籤一定要加引號，最多兩行（寫兩個字串）。
- `async` 畫虛線（非同步）；`key` 是分歧點那條線，會有行進中的虛線動畫，一張圖最多一條。
- 連線 id 預設是 `<從>-><到>`（例如 `web->s3`），同一對元件有兩條同方向的線時用 `as <id>` 各自取名。
- 端點自動貼在兩個框面對面的邊上，同一條邊上有多條線時會錯開；標籤自動找不壓到框的位置。

## 5. 步驟

```text
  step "要一個上傳網址"
    on web->api api->db
    desc 預簽網址只對這個檔名有效、10 分鐘後過期。API 從頭到尾不碰 8 MB 的原圖。
    set row avatar_status = uploading !hl
  step "直傳物件儲存" key
    on web->s3
    desc 這一步決定了整個設計：原圖不經過 API，大檔不會佔住 API 的連線，上傳中斷也只影響這一個人。
    set obj up_1/original.jpg = 8 MB !hl
```

- `on` 列出要點亮的連線或元件。**點亮連線會自動點亮它的兩端與標籤**，點亮 inner 會自動點亮所屬的 pod。
- `desc` 講**為什麼在這一步、失敗會怎樣**，不要重述圖上已經畫的事。建議 120 字以內（超過會得到 W6）。
- `set <卡> <key> = <值>` 只寫這一步的變化，**卡片內容會自動帶到下一步**。已有的 key 原地更新，新的 key 加在最後。`unset <卡> <key>` 移除一列，`clear <卡>` 清空整張卡。
- 行尾加 `!hl` 用主色強調這一步的變化，`!gone` 用第二色表示已刪除或失效；兩者只作用在寫下它的那一步。
- `step … key` 標出**整頁唯一**的分歧點，標題後面會自動加 ★。

## 6. 分支、結果與故障

```text
  step "分支：縮圖失敗" from 3
    on q->worker
    desc 工作留在佇列裡重試；重試三次還不行就標成失敗，使用者看到的仍是舊頭像。
    fault "縮圖 worker 讀不到原圖"
    expect "頭像維持 old.jpg，工作重試"
    set job up_1 = "retry 1 / 3" !hl
    note row "avatar_url 不變"
```

- `from 3` 表示這一步是**分支**：狀態從第 3 步之後接續，不是上一步。動畫照寫的順序播放，步驟編號旁會標「接第 3 步之後」；轉成驗收腳本時會拆成獨立的場景。不要用 `clear` 再 `set` 把卡片手動改回去。
- `expect` 是這一步預期的**結果**（回錯誤、回空清單），顯示成「預期：…」。
- `fault` 是走到這一步要先發生的故障，顯示成褐色的「故障：…」；驗收腳本會在觸發動作之前先安排它。
- `note` 是**只給讀者看的註記**（比較、判斷、「不變」），接在卡片內容後面，不進驗收腳本的斷言。卡片只放 service 裡真的會有的狀態。

## 7. 第二段

```text
part cleanup "清理半途放棄的上傳" actor "每小時排程"
  cards obj row
  init
    set obj up_9/original.jpg = 6 MB
    set row avatar_url = old.jpg
    set row avatar_status = "uploading · 2 小時前"
  canvas
    node cron "清理排程（新）" sub "每小時一次" changed at 0,0
    node db "Postgres" at 1,0
      field "users.avatar_status" mono
    node s3 "物件儲存" sub "S3 · 原圖與縮圖" at 1,1
    edge cron -> db "找卡住的上傳"
    edge cron -> s3 "刪原圖"
  step "找出卡住的上傳"
    on cron->db
    desc 使用者拿了網址卻沒回報完成（關掉分頁、斷線），S3 裡就會留下沒人用的原圖。
    note row "超過 1 小時沒回報 → 清理"
  step "刪原圖、狀態改回"
    on cron->s3 cron->db
    desc 頭像本來就沒換，只要把狀態改回來；半途放棄的上傳不會一直佔著儲存空間。
    unset obj up_9/original.jpg
    note obj "up_9/original.jpg 已刪除" !gone
    set row avatar_status = ready !hl
```

**一段一張圖，圖上只放這一段用到的元件。** 這一段沒有瀏覽器和 worker，就不畫。元件 id 在不同段可以重複使用（`db`、`s3`），每段的 canvas 各自獨立。

## 8. 動畫下方的區塊

依出現順序輸出，全部可以省略：

```text
takeaway 原圖走**瀏覽器 → 物件儲存**，API 只處理小請求；任何一步失敗，使用者看到的都還是舊頭像。

footer
  text "這一頁由 `examples/upload-avatar.flow` 產生："
  code "node bin/flowdoc.js render examples/upload-avatar.flow -o upload-avatar.html"
```

其他可用的區塊：`facts`（圖上看不到的三件事）、`code`（schema 或程式片段）、`table`（可加 `desc` 與 `old` 欄）、`qa`（常見問題）、`decisions`（決定表，編號發佈後不重排）。寫法見 [格式規格「動畫下方的區塊」](../skill/references/format.md#動畫下方的區塊)，用法見另外兩份範例。

## 9. 驗證

```bash
node bin/flowdoc.js verify mydoc.flow
```

每個問題一行，帶行號、代號與修法。error 讓 exit code 非 0；warn 不擋，但要能說出為什麼保留。

```text
mydoc.flow:38: error E1 edge 不認得「排入縮圖」（標籤要加引號），寫法：edge <從> -> <到> ["<標籤>" [mono] ["<第二行>" [mono]]] [async] [key] [via hv|vh] [as <id>]
mydoc.flow: 略過參照與版面檢查：先修正上面的 E1
mydoc.flow: 1 error · 0 warn
```

```text
mydoc.flow:36: warn  W1 edge web->s3 從未被任何步驟點亮：不需要就刪掉，需要就加進某個 step 的 on
mydoc.flow:47: error E2 step「直傳物件儲存」點亮了不存在的元件或連線 web->s4。連線 id 預設是 <從>-><到>，inner 是 <pod>.<inner>。是不是 web->s3？
mydoc.flow: 1 error · 1 warn
```

語法錯誤（E1）會先擋下，修完才會檢查參照；參照有錯時也不會檢查版面。常見的情況：

| 代號 | 常見原因 | 怎麼修 |
|---|---|---|
| E1 | 標籤沒加引號、`set a=b` 等號沒空白、縮排不是兩個空白 | 照訊息裡的寫法改 |
| E2 | `on` 的連線 id 打錯、inner 沒寫成 `<pod>.<inner>`、`set` 的卡沒列在 `cards` | 訊息會建議最接近的 id |
| E4 | 整頁有兩個 `key` 步驟 | 只留真正的設計分歧點 |
| E5 | 兩個元件放在同一格 | 換一個 `at`，或用 `span` |
| W1 | 畫了卻從未點亮的元件或連線 | 不需要就刪掉 |
| W2 | 標籤壓到框 | 換格、縮短標籤 |
| W7 | 圖寬超過 1000，1280 寬的螢幕要捲動 | 把一串連線改成上下排 |

全部代號見 [驗證規格](../skill/references/verification.md)。

## 10. 產生與檢查畫面

```bash
node bin/flowdoc.js render mydoc.flow -o mydoc.html
node bin/flowdoc.js verify mydoc.html
node bin/flowdoc.js shot mydoc.html --out shots/
```

`shot` 用本機 Google Chrome 對每一段截 1280／420 寬、light／dark 四張圖（`p<段>-<寬>-<主題>.png`），並確認播放器真的跑起來。自己看一次：標籤有沒有被擋、連線有沒有交錯、窄螢幕會不會擠爛。看一次、修一輪就好。

瀏覽器開啟時，網址加 `#p1s2` 會直接開到第 1 段第 2 步。

## 11. 發佈

| 發佈到 | 怎麼做 |
|---|---|
| claude.ai artifact | 發佈 `render` 的預設輸出（只有內文，artifact 會補上頁首）。頁尾的相對連結要換成對方的 artifact 網址 |
| 靜態站（GitLab Pages 等） | `render --standalone`，輸出完整的 HTML 文件 |

**改版時改 `.flow`，不要改 HTML。** 重新 render、verify，再發佈到同一個位置。

## 12. 產生驗收腳本（選用）

```bash
node bin/flowdoc.js gherkin mydoc.flow -o mydoc.feature
```

`.feature` 裡 `#@` 開頭的行是 `.flow` 原文（下面的片段省略了），所以它也能轉回 `.flow`。

每條「從起點走到最後一步」的路徑變成一個場景，失敗分支自成一個場景。上面的分支會變成：

```gherkin
  @part-upload @branch
  場景: 正常上傳（使用者換大頭貼）／分支：縮圖失敗
    假設 物件儲存 的「物件儲存」是空的
    而且 工作佇列 的「縮圖工作」是空的
    而且 Postgres 的「使用者資料」是：
      | key           | value   |
      | avatar_url    | old.jpg |
      | avatar_status | ready   |
    而且 安排故障「縮圖 worker 讀不到原圖」

    當 要一個上傳網址
    …
```

### 改 `.feature`，再轉回 `.flow`

寫驗收腳本的人可以直接改 `.feature`：例如把「當 要一個上傳網址」改成「當 跟 API 要上傳網址」、把表格裡 `uploading` 改成 `uploading（等瀏覽器回報）`，再轉回去：

```bash
node bin/flowdoc.js flow mydoc.feature -o mydoc.flow
```

```text
mydoc.feature:72: 修改  第 1 段第 1 步的標題改成「跟 API 要上傳網址」
mydoc.feature:74: 修改  第 1 段第 1 步的「row」改成表格的內容（avatar_status）
mydoc.feature: 0 error · 0 warn
mydoc.feature → mydoc.flow（套用了 2 處修改）
```

`.flow` 只有那兩行變了：`step` 的標題，與那一步的 `set row avatar_status = …`。表格裡改的是「這一步之後的完整內容」，flowdoc 只處理和原本不一樣的列，前面步驟的修改會自然帶到後面的步驟。也可以在 editor 的「驗收腳本」分頁直接改，按「套用到 .flow」。

對應規則、step definition 要實作哪幾條、`eventually` 什麼時候要寫、哪些修改轉不回去，見 [驗收腳本](../skill/references/gherkin.md)。
