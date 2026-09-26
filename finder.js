(() => {
  const byId = (id) => document.getElementById(id);
  const isPopup = new URLSearchParams(location.search).has("popup");

  let allTabs = [];
  let filtered = []; // array of { tab, score, titleIndices }
  let selectedIndex = 0;

  // ── Fuzzy search ──────────────────────────────────────────────────────────

  function fuzzyMatch(query, text) {
    const q = query.toLowerCase();
    const t = text.toLowerCase();

    if (!q) return { matched: true, score: 0, indices: [] };

    let qi = 0;
    const indices = [];
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) { indices.push(ti); qi++; }
    }
    if (qi < q.length) return { matched: false, score: -Infinity, indices: [] };

    let score = 0;
    let run = 1;
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === indices[i - 1] + 1) { run++; score += run * 10; }
      else { run = 1; }
    }

    if (indices[0] === 0) score += 20;
    const boundary = /[\s\-_./\\:]/;
    for (const idx of indices) {
      if (idx === 0 || boundary.test(t[idx - 1])) score += 15;
    }

    if (t.includes(q)) score += 100;
    score -= indices[indices.length - 1];

    return { matched: true, score, indices };
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ── Highlighted title ─────────────────────────────────────────────────────

  function buildHighlight(text, indices) {
    const frag = document.createDocumentFragment();
    const matchSet = new Set(indices);
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

    byId("tf-count").textContent = `${filtered.length} tab${filtered.length !== 1 ? "s" : ""}`;

    if (filtered.length === 0) {
      list.replaceChildren(el("li", "tf-empty", "No tabs match"));
      return;
    }

    list.replaceChildren(...filtered.map(({ tab, titleIndices }, i) => {
      const isSelected = i === selectedIndex;
      const item = el("li", isSelected ? "tf-item tf-selected" : "tf-item");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(isSelected));
      item.dataset.index = i;
      item.addEventListener("click", () => switchToTab(tab));

      const title = el("span", "tf-title");
      title.append(buildHighlight(tab.title, titleIndices));
      const text = el("span", "tf-text");
      text.append(title, el("span", "tf-url", truncateUrl(tab.url)));

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

    newIndex = Math.max(0, Math.min(newIndex, filtered.length - 1));
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

  function filterTabs(query) {
    const q = query.trim();

    if (!q) {
      filtered = allTabs.map((tab) => ({
        tab, score: tab.active ? 1 : 0, titleIndices: [],
      }));
      filtered.sort((a, b) => b.score - a.score);
      selectedIndex = 0;
      return;
    }

    const results = [];
    for (const tab of allTabs) {
      const byTitle = fuzzyMatch(q, tab.title);
      const byUrl   = fuzzyMatch(q, truncateUrl(tab.url));
      if (!byTitle.matched && !byUrl.matched) continue;

      const score = Math.max(byTitle.score, byUrl.score);
      const titleIndices = byTitle.matched ? byTitle.indices : [];
      results.push({ tab, score, titleIndices });
    }

    results.sort((a, b) => b.score - a.score);
    filtered = results;
    selectedIndex = 0;
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
    allTabs = tabs;
    filterTabs(byId("tf-input").value);
    renderList();
  });
})();
