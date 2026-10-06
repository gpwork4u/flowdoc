# 當成 Claude Code skill 使用

flowdoc 的 `skill/` 目錄就是一個 Claude Code skill。裝好之後，在任何專案裡請 Claude「把這份設計做成可播放的流程圖」，它會照同一套流程：蒐集現況、寫 `.flow`、驗證、截圖、發佈。

## 安裝

```bash
git clone git@github.com:gpwork4u/flowdoc.git ~/project/flowdoc
ln -s ~/project/flowdoc/skill ~/.claude/skills/flowdoc
```

確認裝好了（在任何目錄都能跑）：

```bash
node ~/.claude/skills/flowdoc/scripts/flowdoc.mjs verify ~/project/flowdoc/examples/upload-avatar.flow
# …/upload-avatar.flow: 0 error · 0 warn
```

**一定要用 symlink。** `scripts/flowdoc.mjs` 會跟著 symlink 找到 repo 裡的程式（`src/`）；把 `skill/` 單獨複製出去會找不到程式，執行時會直接告訴你要改用 symlink。好處是 `git pull` 更新 repo 之後，skill 跟著更新，不用重裝。

## 怎麼觸發

說到這些字眼時 Claude 會載入這個 skill：「架構動畫」、「流程圖動畫」、「可播放的流程圖」、「元件流程圖」、「設計說明做成頁面」、「flowdoc」、「.flow 檔」、「情境轉成 cucumber／gherkin」，或要把跨服務的設計決定畫給團隊看。也可以直接打 `/flowdoc`，後面接 spec 檔路徑、Jira ticket 或一段描述。

例如：

```text
/flowdoc docs/spec/search-sync.md
把商品同步到搜尋的設計做成可播放的流程圖，重點是下架時先刪搜尋文件
```

## Claude 會怎麼做

流程寫在 [`skill/SKILL.md`](../skill/SKILL.md)，摘要：

1. **先蒐集，再畫。** 從程式碼與 deployment 設定讀出元件與呼叫關係；能從真實執行取值的狀態就用真的，其餘用示意資料並以 `alias` 標出。
2. **依使用者行為切段**，每段 2–8 步；失敗路徑用 `from` 分支。
3. **用 `init` 產生起點，寫 `.flow`。**
4. **驗證到 `EXIT=0`**：`verify .flow` → `render` → `verify .html` → `shot`，並自己看一次截圖。node 或 Chrome 不存在時會照實回報「略過」。
5. **發佈**成 claude.ai artifact（或依你的要求用 `--standalone` 放到靜態站），並給你連結；可以附上 `#p<N>s<M>` 直接開到關鍵的那一步。
6. （選用）**產生驗收腳本** `.feature`；有人改了 `.feature`，用 `flow` 轉回 `.flow` 再重新產生頁面。

`.flow` 和產生的 HTML 會放在你指定的位置；之後要改版，請 Claude 改 `.flow` 再重新產生、發佈到同一個網址，不要直接改 HTML。

## 更新與移除

```bash
cd ~/project/flowdoc && git pull     # 更新：skill 跟著 repo 走
rm ~/.claude/skills/flowdoc          # 移除：只刪 symlink，repo 不受影響
```
