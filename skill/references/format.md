# `.flow` 格式（flowdoc v1）

一份 `.flow` 描述一整頁架構動畫：頁首、數段「情境（part）」、每段自己的一張拓撲圖與逐步播放的步驟、右側狀態卡，以及動畫下方的說明區塊。寫法接近 mermaid：一行一個宣告，用縮排表示從屬。

## 通則

- 檔案第一行必須是 `flowdoc v1`。
- 縮排一律兩個空白；縮排決定從屬（`pod` 底下的 `inner`、`part` 底下的 `step`）。
- `#` 開頭到行尾是註解。`#` 要在行首或前面是空白才算；雙引號字串與 `` `code` `` 裡的 `#` 不算。`|` 開頭的 code 行整行照原樣保留，不處理註解。
- 字串用雙引號，內部的雙引號寫成 `\"`。沒有空白的單字可以不加引號。
- 識別字（id）符合 `[a-z][a-zA-Z0-9_]*`。同一段 canvas 內不可重複。
- 行內標記只支援兩種：`` `code` `` 與 `**粗體**`，適用於所有說明文字。
- 未知的關鍵字、多餘的參數一律是 parse error，不默默忽略。
- `desc`、`lede`、`fact` 這類「到行尾的文字」不用加引號；整段剛好是一個加引號的字串時，引號會去掉。

## 頁首

```
flowdoc v1
title 商品改了，搜尋跟著換版                     # <title> 與 <h1>；兩到四個詞的名字，不要「XX 說明」
eyebrow 範例 · 電商平台 · 第一階段
lede 沿用現有的 `search_sync`：商品上架時把商品資料組成一份搜尋文件。
chip key "只改 catalog"                          # key：主色強調
chip "設計提案 · 範例"                            # 一般
chip old "搜尋端自己掃 DB"                       # old：刪除線，表示被取代或不採用
legend changed ghost async                       # 圖例要出現哪幾項；省略則依實際用到的自動產生
stage "五種情境，各自一張圖" desc "每段只畫那個情境用到的 service。"   # 動畫區的標題與說明；可省略
caption index 與 purge 合成一格。                  # 動畫下方的小字（figcaption）；可省略
alias product sku_A sku_B sku_C                  # 示意 id 與種類；可寫多行（見下）
```

`title` 必填，其餘可省略；頁首的關鍵字各只能寫一次（`chip`、`alias` 除外），而且都要寫在第一個 `part` 之前。

`alias <種類> <示意 id…>` 宣告文件裡哪些值是示意的 id（商品、使用者…）。動畫照原樣顯示；轉成 Gherkin 時列在「背景」，驗收時每次建立真實資料來替換，`sku_A-r1` 這種以示意 id 開頭的值跟著換（見 `gherkin.md`）。同一個示意 id 宣告兩次是 E3。

## 狀態卡（store）

在頁首之後、任何 `part` 之前宣告。每張卡是一個「此刻裝著什麼」的容器。

```
store txt "組好的文件" tag "SearchText"
store doc "搜尋文件" tag "search_document" in search
store map "商品 → doc_id" tag "product.search_doc_id" in pg
store os "索引裡的文件" tag "index = products" in os
```

`in <元件 id>`（可省略）：這張卡是哪個元件裡的狀態。元件 id 用 canvas 裡的 id（inner 寫成 `<pod>.<inner>`），每一段列出這張卡時，那一段的圖上都要有這個元件，否則是 W8。轉成 Gherkin 時寫成「Postgres 的「商品 → doc_id」」，step definition 依它決定去哪裡查。程式裡的中間產物、每次當下算的值沒有地方存，就不加 `in`。

## 情境（part）

```
part create "上架商品" actor "賣家送出新商品"
  cards txt doc map os          # 這一段顯示哪些卡（順序即顯示順序）；只列用得到的
  init                          # 可省略：這一段開始時各卡的內容（只能用 set，不加 !hl／!gone）
    set map search_doc_id = sku_A-r1
  canvas ...                    # 見下節
  step ...                      # 見「步驟」
```

規則：**一段一張圖，圖上只放這一段用到的元件。** 沒用到的 service 不畫。

## 拓撲（canvas）

### 版面：格線

```
  canvas cols 3 rows 3          # 欄列數；省略時依元件位置推算
```

元件以 `at <col>,<row>` 放在格線上（從 0 起算），`span <w>x<h>` 佔多格。renderer 依格線算出座標：

| 參數 | 預設 | 說明 |
|---|---|---|
| 欄寬 | 依該欄最寬的元件，至少 120 | 文字寬加左右內距；同一欄的框一樣寬 |
| 欄距 | 依跨過那道空隙的標籤，至少 44 | 相鄰兩欄之間的連線（含 ghost 的打叉線）有標籤時，空隙要放得下最寬的標籤（＋24）；沒有標籤就是 44 |
| 列高 | 依該列最高的元件 | pod 依 inner 數量撐高；只佔一列的元件在列內垂直置中 |
| 列距 | 56 | |

整張圖寬度超過 1000 會得到 W7：在 1280 寬的螢幕上要橫向捲動。常見的解法是把一串連線改成上下排（例如 search → indexer → OpenSearch 放同一欄）、兩個小元件疊在同一欄，或把 ghost 放進既有的欄。

`span` 跨多欄／多列的元件撐滿它佔的格子；內容放不下時，把差額平均加到它佔的欄列。`canvas cols`／`rows` 有寫時，元件超出範圍是 E6。

需要微調時可以用 `at x=<px> y=<px> w=<px> h=<px>` 絕對座標（逃生口，盡量少用）。

### 元件

```
    node search "search service" sub "SearchDocumentV1" mono at 1,1
    node pg "Postgres" at 0,2
      field "catalog_product_v1" mono
      field "+ search_doc_id · rev · digest" mono changed
    pod cat "catalog" sub "商品建立後" at 0,0 span 1x2
      inner api "ProductService.Create" mono sub "寫入商品（既有）"
      inner sync "search_sync（改）" sub "組文件 → 上傳 → Create → 記 doc_id" changed
    node shop "賣場前台" sub "第二階段" future at 0,3
    ghost scan "搜尋端自己掃 DB" sub "每次全表掃描" at 2,0 cross pg "不走"
```

| 關鍵字 | 意義 | 畫法 |
|---|---|---|
| `node` | 一個 deployable／外部服務 | 實線框；`sub` 是第二行小字 |
| `pod` | 同一個 process 的大框 | 標題用 display 字型；內含 `inner` |
| `inner` | pod 內的元件 | 小格子，自動由上往下排；id 寫成 `<pod>.<inner>`，例如 `cat.sync` |
| `field` | node 內額外的一行（通常是表或欄位） | 可加 `changed` 只框這一行 |
| `ghost` | **刻意不用**的東西 | 第二色（clay）虛線框；`cross <target> "<label>"` 畫一條打叉的線指向 target |

修飾字：

- `mono`：用等寬字（程式識別字、表名、RPC 名）。**修飾它前面最近的那個字串**：緊接在名稱後面就是名稱用等寬字（`inner api "ProductService.Create" mono sub "…"`），接在 `sub "…"` 後面就是第二行用等寬字（`node search "search service" sub "SearchDocumentV1" mono`）；`field` 的 `mono` 修飾那一行。
- `changed`：**要新增或修改的地方**，畫橘色實線框，不隨播放變暗。整個專案裡只有它用橘色。可用在 node、pod、inner、field；ghost 不行。
- `future`：之後的階段才做，虛線框、名稱變淡。只用在 node。

### 連線

```
    edge cat.sync -> pg "同步記 doc_id" key
    edge cat.sync -> search "Create"
    edge search -> idx "非同步 index" async
    edge cat.api -> cat.sync                   # 沒有標籤也可以
    edge gw -> cat.del "刪除" via hv as del    # 指定折線與 id
```

| 參數 | 說明 |
|---|---|
| `"<label>"` | 線上的字，一定要加引號；renderer 自動找不壓到框的位置，畫在最上層並加底色描邊。最多兩行：寫兩個字串 `"讀內容" "算 digest"`。`mono` 緊接在某一行後面，那一行就用等寬字（`"Search" mono "+ doc_ids" mono`） |
| `async` | 虛線箭頭（非同步） |
| `key` | 分歧點那條線，行進中的虛線動畫；一張圖最多一條 |
| `via hv` / `via vh` | 折線。`hv`：從側邊水平出去，在兩框之間空隙的正中間轉成垂直，再水平接到目標的側邊；`vh` 上下對調。兩框在那個方向沒有空隙時退回直線。省略為直線 |
| `as <id>` | 自訂 id；預設 id 是 `<from>-><to>` |

箭頭前後要有空白（`a -> b`）；`on` 裡引用連線 id 時才寫成 `a->b`。同一對元件之間有兩條同方向的連線時，要用 `as` 各自取名。

連線端點的規則：

- 兩框面對面重疊至少 6px 時畫直線（左右並排畫水平線、上下排列畫垂直線）；不然從面對面的邊斜接過去。
- 同一條邊上有多條連線時，沿邊等距錯開（間距至少 14px），兩端互相對齊，平行的兩條線不會疊在一起。
- inner 的上下邊被兄弟 inner 或 pod 標題擋住，所以從 inner 往上、往下接到 pod 外的連線，改從 pod 的上下邊出去（點亮時仍然是那個 inner 亮）。

## 步驟（step）

```
  step "商品建立完成，交給同步"
    on cat.api cat.api->cat.sync
    desc 沿用 `search_sync` 的觸發點：商品寫進 DB、回應賣家之後才同步。
  step "記下 doc_id" key
    on cat.sync->pg
    desc 同步寫入：Create 回成功後，用一條條件式 UPDATE 寫回。
    set map search_doc_id = sku_A-r1 !hl
    set map search_doc_rev = 1 !hl
  step "背景寫入 OpenSearch"
    on search->idx idx->os
    set doc sku_A-r1 = indexed !hl
    set os doc_id = sku_A-r1 !hl
    unset txt "## 規格"
  step "分支：搜尋服務刪除失敗" from 1
    on cat.del->search
    expect "整個刪除回錯誤，商品原封不動"
    note map "— 不變 —"
```

| 行 | 說明 |
|---|---|
| `step "<標題>" [key] [from <N>]` | `key` 標出**整頁唯一**的分歧點，標題後加 ★；標題本身不要寫 ★。`from <N>` 表示這一步是**分支**：狀態從第 N 步之後接續（從 1 起算；`from 0` 表示從 `init` 分出），而不是上一步 |
| `on <targets...>` | 要點亮的元件或連線 id，可以分成多行 `on`。**點亮連線會自動點亮它的兩端與標籤；點亮 inner 會自動點亮所屬 pod**。ghost 不會被點亮 |
| `desc <文字>` | readout 的說明：講**為什麼在這一步、失敗會怎樣**，不要重述圖上已經畫的事。建議 ≤ 120 字；支援行內標記 |
| `expect "<結果>"` | 這一步預期的**結果**（回錯誤、回空清單…），不是某張卡的內容。顯示在 readout 的說明下面（「預期：…」），轉成 Gherkin 是 `那麼 結果應該是「…」`。一步最多一個 |
| `fault "<故障>"` | 走到這一步要先發生的故障（「search service 的 Delete 回錯誤」），通常寫在失敗分支上。readout 用第二色顯示「故障：…」；轉成 Gherkin 時放在那個場景的「假設」裡，觸發動作之前先安排好。可以寫多行 |
| `eventually <card…>` | 這幾張卡在這一步的斷言要**輪詢到逾時為止**，因為改變它們的是前面某一步排入的非同步工作。這一步點亮的連線有 `async` 時會自動輪詢，不用寫；列的卡這一步要有變化，否則是 E2 |
| `set <card> <key> = <value> [!hl\|!gone]` | 設定一列；`!hl` 主色強調這一步的變化，`!gone` 第二色表示已刪除或失效。key 是一個字（有空白就加引號）；`=` 前後要有空白；值是 `=` 之後到行尾（扣掉行尾的 `!hl`／`!gone`），整段加引號時去掉引號。已有的 key 原地更新，新的 key 加在最後 |
| `unset <card> <key>` | 移除一列；這張卡此刻沒有這個 key 是 E2 |
| `clear <card>` | 清空整張卡 |
| `note <card> "<文字>" [!hl\|!gone]` | **只給讀者看的註記**（比較、判斷、「不變」），接在卡片內容後面，用內文字型；預設 `!hl`。不改變卡片內容，也不進 Gherkin 的斷言 |

狀態語意：

- **同一段內，卡片內容會帶到下一步**（carry-over），每一步只寫變動。換段時從該段的 `init` 重新開始。
- `from <N>` 的步驟從第 N 步之後的內容接續；它後面沒寫 `from` 的步驟接著它。動畫仍照寫的順序播放，readout 標出「接第 N 步之後」。不要再用 `clear` 加 `set` 把卡片改回去來表示分支。
- `!hl`、`!gone` 與 `note` 只作用在寫下它的那一步；下一步沿用值，但樣式回到一般、註記消失。
- 這一步有 `set`／`unset`／`clear`／`note` 的卡，會亮起（changed）。
- `set`、`note` 的卡必須列在這一段的 `cards` 裡。
- **卡片只放 service 裡真的會有的狀態。** 「digest 7c1e… ≠ 9f3a…」「— 不變 —」「待補」這類說明用 `note`；用 `set` 寫成一列，它就會變成驗收腳本裡的斷言（見 `gherkin.md`）。

## 動畫下方的區塊

依出現順序輸出，全部可省略。

```
facts "圖上看不到的三件事"
  fact "為什麼不需要 reconciler" 切換時不等新版 index 完成……
  fact "寫回 doc_id 為什麼可靠" ……
  fact "為什麼不能更簡單" ……           # 慣例：第三張回答「拿掉某個東西不就好了」

takeaway 這一階段只保證一件事：**每份搜尋文件都找得到它屬於哪個商品。**

code "新的欄位" desc "不開新表，三個欄位記在商品列上。"
  | catalog_product_v1
  |   + search_doc_id   string  目前那一版的 doc id
  |   + search_doc_rev  int     目前版本號

table "要改的檔案" cols "位置" "改什麼"             # row 的格數要等於 cols 的欄數；可在 cols 前加 desc "<說明>"
  row "db/model" "`catalog_product_v1.go` 加三個欄位"
  row muted "不動" "search service · indexer · OpenSearch"

table "跟現有做法差在哪" cols "" old "現有全文搜尋" "文件語意搜尋"   # old 寫在欄名前面：那一欄是舊做法，整欄淡色
  row "權限粒度" "整個 space" "每份文件 → `doc_id`"

qa "常見問題"                                   # 兩欄的問答卡；回答開頭的 **粗體** 是一句話的結論
  q "是搜完再過濾嗎？" **不是。**filter 放進 prefetch，topK 直接在可見範圍裡取。

decisions "決定" desc "編號是跨文件的對照 key，發佈後不重排。"
  d P1-1 "search service 不改，也不加賣場 filter"
  d 風險 "後台管理員的全站搜尋看得到所有賣場的文件"

footer                                          # text 開新的一段；link 接在目前這段後面；code 自成一行
  text "整體設計："
  link "權限不進索引的文件搜尋" ../doc-search-acl/
  text "現況依據（catalog `1a2b3c4`）："
  code "catalog/pkg/search_sync/sync.go — 沿用並修改"
```

`code` 區塊底下每一行以 `|` 開頭，`| ` 之後的內容照原樣輸出（只拿掉 `|` 後面的一個空白）。

## 完整範例

`examples/` 有三份完整範例：`upload-avatar.flow`（入門）、`catalog-search-sync.flow`（五段、pod、平行連線、故障分支、動畫下方的區塊）、`doc-search-acl.flow`（ghost、雙行標籤、`from 0`、`qa`、舊做法欄）。
