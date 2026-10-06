// flowdoc 播放器 runtime。資料由 renderer 以 <script type="application/json" id="flow-data"> 注入，
// 這支檔案本身不含任何文件內容，所有頁面共用同一份。
//
// 資料形狀（renderer 負責算好，runtime 不做推導）：
// {
//   cards: { <cardId>: { name, tag } },
//   parts: [{
//     id, title, actor, svg,          // svg = 這一段那張 <svg class="flow"> 的 id
//     cards: [<cardId>...],           // 這一段要顯示的狀態卡，順序即顯示順序
//     steps: [{
//       title, desc, key,             // desc 是 renderer 已 escape 的 HTML（含行內標記）；key=true 表示分歧點，標題後加 ★
//       on: [<data-k>...],            // 這一步要點亮的元素（renderer 已展開 edge 端點、pod 等）
//       cards: { <cardId>: [[k, v, cls], ...] },  // 這一步每張卡的完整內容（已套用 carry-over）
//       notes: { <cardId>: [[文字, cls], ...] },  // 可省略：只給讀者看的註記，接在卡片內容後面
//       from: N,                      // 可省略：這一步從第 N 步之後分出（0 = 起點）
//       changed: [<cardId>...]        // 這一步有 set／unset／clear／note 的卡
//     }]
//   }]
// }
(function(){
  var DATA = JSON.parse(document.getElementById("flow-data").textContent);
  var EMPTY = '<span class="empty">空</span>';

  function esc(s){
    return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; });
  }
  function kv(rows, notes){
    var html = (!rows || !rows.length) ? EMPTY : rows.map(function(r){
      return '<span class="k">' + esc(r[0]) + '</span> <span class="' + (r[2] || "v") + '">' + esc(r[1]) + '</span>';
    }).join("<br>");
    (notes || []).forEach(function(n){ html += '<br><span class="note ' + (n[1] || "hl") + '">' + esc(n[0]) + '</span>'; });
    return html;
  }
  function stepLabel(i, s){
    var t = "PART " + (part + 1) + " · STEP " + String(i + 1).padStart(2, "0");
    if (s.from === 0) return t + " · 從起點分出";
    if (s.from) return t + " · 接第 " + s.from + " 步之後";
    return t;
  }

  var stepN = document.getElementById("stepN"), stepT = document.getElementById("stepT"), stepD = document.getElementById("stepD");
  var dotsBox = document.getElementById("dots"), playBtn = document.getElementById("play");
  var partsBox = document.getElementById("parts"), storesBox = document.getElementById("stores");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var part = 0, cur = -1, timer = null, dots = [];

  // 狀態卡：每張卡只建一次，切段時用 hidden 控制
  var CARD = {}, BODY = {};
  Object.keys(DATA.cards).forEach(function(id){
    var c = DATA.cards[id];
    var el = document.createElement("div");
    el.className = "store"; el.id = "st-" + id; el.hidden = true;
    el.innerHTML = '<div class="store-h"><span class="store-n">' + esc(c.name) + '</span><span class="store-t">' + esc(c.tag || "") + '</span></div><div class="store-b"></div>';
    storesBox.appendChild(el);
    CARD[id] = el; BODY[id] = el.querySelector(".store-b");
  });

  var tabs = DATA.parts.map(function(p, i){
    var b = document.createElement("button");
    b.className = "part"; b.type = "button";
    b.setAttribute("role", "tab");
    b.innerHTML = '<span class="p-n">PART ' + (i + 1) + ' · ' + p.steps.length + ' 步</span><span class="p-t">' + esc(p.title) + '</span><span class="p-a">' + esc(p.actor || "") + '</span>';
    b.addEventListener("click", function(){ stop(); selectPart(i); });
    partsBox.appendChild(b);
    return b;
  });

  function steps(){ return DATA.parts[part].steps; }
  function svgOf(i){ return document.getElementById(DATA.parts[i].svg); }
  function title(s){ return s.title + (s.key ? "　★" : ""); }

  function selectPart(i){
    part = i;
    DATA.parts.forEach(function(p, k){ svgOf(k).toggleAttribute("hidden", k !== i); });
    Object.keys(CARD).forEach(function(id){ CARD[id].hidden = DATA.parts[i].cards.indexOf(id) < 0; });
    tabs.forEach(function(t, k){ t.setAttribute("aria-selected", k === i ? "true" : "false"); });
    dotsBox.innerHTML = "";
    dots = steps().map(function(s, j){
      var b = document.createElement("button");
      b.className = "dot"; b.type = "button"; b.textContent = String(j + 1);
      b.setAttribute("role", "tab");
      b.setAttribute("aria-label", "第 " + (j + 1) + " 步：" + s.title);
      b.addEventListener("click", function(){ stop(); show(j); });
      dotsBox.appendChild(b);
      return b;
    });
    show(0);
  }

  function show(i){
    cur = i;
    var s = steps()[i];
    Array.prototype.forEach.call(svgOf(part).querySelectorAll("[data-k]"), function(el){
      el.classList.toggle("on", s.on.indexOf(el.getAttribute("data-k")) >= 0);
    });
    DATA.parts[part].cards.forEach(function(id){ BODY[id].innerHTML = kv(s.cards[id], (s.notes || {})[id]); });
    Object.keys(CARD).forEach(function(id){ CARD[id].classList.toggle("changed", s.changed.indexOf(id) >= 0); });
    dots.forEach(function(d, k){ d.setAttribute("aria-current", k === i ? "true" : "false"); });
    stepN.textContent = stepLabel(i, s);
    stepT.textContent = title(s);
    stepD.innerHTML = s.desc;
    // 嵌在 editor 的預覽裡時，告訴外層目前在哪一步，重新產生後才能停在同一步
    if (window.parent !== window) {
      try { window.parent.postMessage({ flowdoc: "pos", part: part + 1, step: i + 1 }, "*"); } catch (e) {}
    }
  }

  function stop(){ if (timer){ clearInterval(timer); timer = null; } playBtn.textContent = "播放這一段"; }
  function play(){
    if (timer){ stop(); return; }
    if (cur >= steps().length - 1) show(0);
    playBtn.textContent = "暫停";
    timer = setInterval(function(){
      if (cur >= steps().length - 1){ stop(); return; }
      show(cur + 1);
    }, reduce ? 5600 : 3800);
  }
  playBtn.addEventListener("click", play);
  document.getElementById("next").addEventListener("click", function(){ stop(); show(Math.min(cur + 1, steps().length - 1)); });
  document.getElementById("prev").addEventListener("click", function(){ stop(); show(cur <= 0 ? 0 : cur - 1); });

  // #p2 直接開第 2 段、#p3s4 開第 3 段第 4 步（artifact 只允許單純的 #token，截圖驗證也靠它）；
  // 也可以用 window.name（editor 的預覽在 runtime 之前設定它，重新產生後停在原本那一步）
  var m = /^#p(\d+)(?:s(\d+))?$/.exec(location.hash || "") || /^p(\d+)(?:s(\d+))?$/.exec(window.name || "");
  var start = m ? Math.min(Math.max(parseInt(m[1], 10) - 1, 0), DATA.parts.length - 1) : 0;
  selectPart(start);
  if (m && m[2]) show(Math.min(Math.max(parseInt(m[2], 10) - 1, 0), steps().length - 1));
})();
