# make check：全部範例 render（含 .feature）+ verify（含 .feature 轉回 .flow）+ editor 打包 + 測試 + 截圖。完成任何變更前都要跑，EXIT=0 才算完成。
# 只需要 Node 20+；找不到 Google Chrome（或 Node 沒有內建 WebSocket）時，截圖與 editor 的端對端測試會印出「略過」，不會默默當作通過。
NODE ?= node
FLOWDOC := $(NODE) bin/flowdoc.js
EXAMPLES := $(wildcard examples/*.flow)

.PHONY: check render verify editor test shot site clean

check: render verify editor test shot

render:
	@mkdir -p out
	@for f in $(EXAMPLES); do n=$$(basename $$f .flow); \
		$(FLOWDOC) render $$f -o out/$$n.html || exit 1; \
		$(FLOWDOC) gherkin $$f -o out/$$n.feature || exit 1; \
	done

verify:
	@for f in $(EXAMPLES); do $(FLOWDOC) verify $$f || exit 1; done
	@for f in $(EXAMPLES); do $(FLOWDOC) verify out/$$(basename $$f .flow).html || exit 1; done
	@for f in $(EXAMPLES); do n=$$(basename $$f .flow); \
		$(FLOWDOC) flow out/$$n.feature -o out/$$n.roundtrip.flow > /dev/null || exit 1; \
		cmp -s $$f out/$$n.roundtrip.flow || { echo "$${f}：.feature 轉回來和原本的 .flow 不同"; diff $$f out/$$n.roundtrip.flow; exit 1; }; \
		echo "$${f}：.feature 轉回來逐字相同"; \
	done

# 打包好的 editor 也進版控，沒有 Node 的人直接打開 dist/flowdoc-editor.html 就能用；測試會確認它是最新的
editor:
	@$(FLOWDOC) editor -o dist/flowdoc-editor.html

test:
	$(NODE) --test test/*.test.js

shot:
	@for f in $(EXAMPLES); do n=$$(basename $$f .flow); \
		$(FLOWDOC) shot out/$$n.html --out out/shots/$$n > out/shots-$$n.log || { cat out/shots-$$n.log; exit 1; }; \
		tail -n 3 out/shots-$$n.log | grep -v '\.png$$'; \
	done

# GitHub Pages 的內容（.github/workflows/pages.yml 也是跑這個）
site:
	@$(NODE) src/node/site.js _site

clean:
	rm -rf out _site
