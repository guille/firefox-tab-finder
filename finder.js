(() => {
  const byId = (id) => document.getElementById(id);
  const isPopup = new URLSearchParams(location.search).has("popup");

  const MAX_SHOWN = 100;

  let entries = [];  // one per tab: { tab, title, url }, each field from prepareField
  let filtered = []; // entries matching `tokens`, best first
  let tokens = [];
  let lastQuery = null;
  let selectedIndex = 0;

  // ── Fuzzy search ──────────────────────────────────────────────────────────
  // fzy's algorithm (github.com/jhawthorn/fzy/blob/master/ALGORITHM.md): a DP
  // over query × text finds the best-scoring alignment, not just the first.

  const SCORE_GAP_LEADING   = -0.005;
  const SCORE_GAP_TRAILING  = -0.005;
  const SCORE_GAP_INNER     = -0.01;
  const SCORE_CONSECUTIVE   = 1.0;
  const SCORE_MATCH_SLASH   = 0.9;
  const SCORE_MATCH_WORD    = 0.8;
  const SCORE_MATCH_CAPITAL = 0.7;
  const SCORE_MATCH_DOT     = 0.6;

  // Folds per UTF-16 unit so indices into the result are valid in `text`.
  function foldCase(text) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const lower = text[i].toLowerCase();
      out += lower.length === 1 ? lower : text[i];
    }
    return out;
  }

  function prepareField(text) {
    const bonus = new Float64Array(text.length);
    let prev = "/";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (prev === "/") bonus[i] = SCORE_MATCH_SLASH;
      else if (/[\s\-_:]/.test(prev)) bonus[i] = SCORE_MATCH_WORD;
      else if (prev === ".") bonus[i] = SCORE_MATCH_DOT;
      else if (prev !== prev.toUpperCase() && c !== c.toLowerCase()) bonus[i] = SCORE_MATCH_CAPITAL;
      prev = c;
    }
    return { text, folded: foldCase(text), bonus };
  }

  // Reused across calls: D[i*m+j] is the best score with query[i] matched at
  // text[j]; M[i*m+j] the best with query[..i] matched anywhere in text[..j].
  let D = new Float64Array(0);
  let M = new Float64Array(0);

  function align(query, field) {
    const n = query.length;
    const m = field.folded.length;
    const text = field.folded;

    let qi = 0;
    for (let j = 0; j < m && qi < n; j++) if (text[j] === query[qi]) qi++;
    if (qi < n) return -Infinity;

    if (D.length < n * m) {
      D = new Float64Array(n * m);
      M = new Float64Array(n * m);
    }

    for (let i = 0; i < n; i++) {
      const gap = i === n - 1 ? SCORE_GAP_TRAILING : SCORE_GAP_INNER;
      let prev = -Infinity;
      for (let j = 0; j < m; j++) {
        const k = i * m + j;
        if (query[i] === text[j]) {
          let score = -Infinity;
          if (i === 0) score = j * SCORE_GAP_LEADING + field.bonus[j];
          else if (j > 0) score = Math.max(M[k - m - 1] + field.bonus[j], D[k - m - 1] + SCORE_CONSECUTIVE);
          D[k] = score;
          M[k] = prev = Math.max(score, prev + gap);
        } else {
          D[k] = -Infinity;
          M[k] = prev = prev + gap;
        }
      }
    }
    return M[n * m - 1];
  }

  function positions(query, field) {
    if (align(query, field) === -Infinity) return [];
    const m = field.folded.length;
    const pos = [];
    let matchRequired = false;
    for (let i = query.length - 1, j = m - 1; i >= 0; i--) {
      for (; j >= 0; j--) {
        const k = i * m + j;
        if (D[k] !== -Infinity && (matchRequired || D[k] === M[k])) {
          matchRequired = i > 0 && j > 0 && M[k] === D[k - m - 1] + SCORE_CONSECUTIVE;
          pos.push(j--);
          break;
        }
      }
    }
    return pos;
  }

  // Each token is highlighted in whichever field it matches best.
  function highlights(entry) {
    const title = new Set();
    const url = new Set();
    for (const token of tokens) {
      const inTitle = align(token, entry.title) >= align(token, entry.url);
      const [field, set] = inTitle ? [entry.title, title] : [entry.url, url];
      for (const p of positions(token, field)) set.add(p);
    }
    return { title, url };
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ── Highlighted text ──────────────────────────────────────────────────────

  function buildHighlight(text, matchSet) {
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < text.length) {
      const marked = matchSet.has(i);
      let j = i + 1;
      while (j < text.length && matchSet.has(j) === marked) j++;
      const run = text.slice(i, j);
      frag.append(marked ? el("mark", null, run) : run);
      i = j;
    }
    return frag;
  }

  // ── Favicon / letter avatar ───────────────────────────────────────────────

  const AVATAR_COLORS = [
    "#3b82f6","#8b5cf6","#ec4899","#f59e0b",
    "#10b981","#ef4444","#06b6d4","#f97316",
  ];

  function avatarColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  function buildFavicon(tab) {
    const letter = (tab.title || tab.url || "?")[0].toUpperCase();
    let domain = "";
    try { domain = new URL(tab.url).hostname; } catch { domain = tab.title || ""; }

    const avatar = el("span", "tf-favicon tf-avatar", letter);
    avatar.style.background = avatarColor(domain || tab.title);

    if (!tab.favIconUrl || tab.favIconUrl.startsWith("chrome://") || tab.favIconUrl.startsWith("moz-extension://")) {
      return avatar;
    }

    const img = el("img", "tf-favicon");
    img.width = img.height = 16;
    img.addEventListener("error", () => img.replaceWith(avatar), { once: true });
    img.src = tab.favIconUrl;
    return img;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  // Full rebuild — only called when the filtered list itself changes (on input).
  function renderList() {
    const list = byId("tf-list");

    const total = filtered.length;
    byId("tf-count").textContent = total > MAX_SHOWN
      ? `${MAX_SHOWN} of ${total} tabs`
      : `${total} tab${total !== 1 ? "s" : ""}`;

    if (total === 0) {
      list.replaceChildren(el("li", "tf-empty", "No tabs match"));
      return;
    }

    list.replaceChildren(...filtered.slice(0, MAX_SHOWN).map((entry, i) => {
      const { tab } = entry;
      const marks = highlights(entry);
      const isSelected = i === selectedIndex;
      const item = el("li", isSelected ? "tf-item tf-selected" : "tf-item");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(isSelected));
      item.dataset.index = i;
      item.addEventListener("click", () => switchToTab(tab));

      const title = el("span", "tf-title");
      title.append(buildHighlight(entry.title.text, marks.title));
      const url = el("span", "tf-url");
      url.append(buildHighlight(entry.url.text, marks.url));
      const text = el("span", "tf-text");
      text.append(title, url);

      item.append(buildFavicon(tab), text);
      if (tab.active) item.append(el("span", "tf-badge", "current"));
      return item;
    }));

    list.querySelector(".tf-selected")?.scrollIntoView({ block: "nearest" });
  }

  // Cheap selection move — only swaps a CSS class and scrolls, never rebuilds the list.
  // Called on every arrow/page key press.
  function moveSelection(newIndex) {
    const list = byId("tf-list");
    if (!list || filtered.length === 0) return;

    newIndex = Math.max(0, Math.min(newIndex, Math.min(filtered.length, MAX_SHOWN) - 1));
    if (newIndex === selectedIndex) return;

    const prev = list.querySelector(".tf-selected");
    if (prev) {
      prev.classList.remove("tf-selected");
      prev.setAttribute("aria-selected", "false");
    }

    selectedIndex = newIndex;
    const next = list.querySelector(`[data-index="${selectedIndex}"]`);
    if (next) {
      next.classList.add("tf-selected");
      next.setAttribute("aria-selected", "true");
      next.scrollIntoView({ block: "nearest" });
    }
  }

  function pageSize() {
    const list = byId("tf-list");
    if (!list || filtered.length === 0) return 8;
    const firstItem = list.querySelector(".tf-item");
    if (!firstItem) return 8;
    return Math.max(1, Math.floor(list.clientHeight / firstItem.offsetHeight));
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  const byRecency = (a, b) => b.tab.lastAccessed - a.tab.lastAccessed;

  // Every whitespace-separated token must match the title or the URL.
  function filterTabs(query) {
    const q = foldCase(query.trim());
    tokens = q ? q.split(/\s+/) : [];
    selectedIndex = 0;

    if (!q) {
      filtered = [...entries].sort((a, b) => b.tab.active - a.tab.active || byRecency(a, b));
      lastQuery = q;
      return;
    }

    // Extending the query can only drop matches, never add them.
    const candidates = lastQuery !== null && q.startsWith(lastQuery) ? filtered : entries;
    lastQuery = q;

    const results = [];
    for (const entry of candidates) {
      let score = 0;
      for (const token of tokens) {
        score += Math.max(align(token, entry.title), align(token, entry.url));
        if (score === -Infinity) break;
      }
      if (score !== -Infinity) results.push({ entry, score });
    }

    results.sort((a, b) => b.score - a.score || byRecency(a.entry, b.entry));
    filtered = results.map((r) => r.entry);
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function onInput(e) {
    filterTabs(e.target.value);
    renderList();
  }

  function onKeyDown(e) {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeOverlay();
        break;
      case "ArrowDown":
        e.preventDefault();
        moveSelection(selectedIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveSelection(selectedIndex - 1);
        break;
      case "PageDown":
        e.preventDefault();
        moveSelection(selectedIndex + pageSize());
        break;
      case "PageUp":
        e.preventDefault();
        moveSelection(selectedIndex - pageSize());
        break;
      case "Home":
        e.preventDefault();
        moveSelection(0);
        break;
      case "End":
        e.preventDefault();
        moveSelection(filtered.length - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[selectedIndex]) switchToTab(filtered[selectedIndex].tab);
        break;
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function switchToTab(tab) {
    await browser.runtime.sendMessage({ type: "SWITCH_TO_TAB", tabId: tab.id, windowId: tab.windowId });
    if (isPopup) window.close();
  }

  function closeOverlay() {
    if (isPopup) {
      window.close();
      return;
    }
    const root = byId("tab-finder-root");
    root.classList.add("tf-closing");
    root.addEventListener("animationend", () => {
      browser.runtime.sendMessage({ type: "CLOSE_TAB_FINDER" });
    }, { once: true });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function truncateUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname + (u.pathname !== "/" ? u.pathname : "");
    } catch { return url; }
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  if (isPopup) document.documentElement.classList.add("tf-popup");

  byId("tf-backdrop").addEventListener("click", closeOverlay);
  byId("tf-input").addEventListener("input", onInput);
  document.addEventListener("keydown", onKeyDown);
  byId("tf-input").focus();

  browser.runtime.sendMessage({ type: "GET_TABS" }).then((tabs) => {
    entries = tabs.map((tab) => ({
      tab,
      title: prepareField(tab.title),
      url:   prepareField(truncateUrl(tab.url)),
    }));
    lastQuery = null;
    filterTabs(byId("tf-input").value);
    renderList();
  });
})();
