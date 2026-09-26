browser.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "open-tab-search") return;

  // Non-web pages (about:, file:, …) never allow injection, and there Firefox
  // only opens the popup if it's called before any await.
  if (!/^https?:/.test(tab.url)) {
    browser.browserAction.openPopup();
    return;
  }

  // Web pages can still refuse injection (AMO, the PDF viewer, reader view).
  try {
    await browser.tabs.executeScript({ file: "inject.js" });
  } catch {
    await browser.browserAction.openPopup();
  }
});

// The finder runs in a frame inside the page, where Firefox withholds the tabs
// API, so it does everything through here. sender.tab is the tab hosting the
// overlay; the toolbar popup has none.
browser.runtime.onMessage.addListener(async (message, sender) => {
  switch (message.type) {
    case "GET_TABS": {
      const [tabs, [active]] = await Promise.all([
        browser.tabs.query({}),
        browser.tabs.query({ active: true, currentWindow: true }),
      ]);
      const currentId = (sender.tab ?? active)?.id;
      return tabs.map((t) => ({
        id:         t.id,
        windowId:   t.windowId,
        title:      t.title      || "(no title)",
        url:        t.url        || "",
        favIconUrl: t.favIconUrl || "",
        active:     t.id === currentId,
        lastAccessed: t.lastAccessed ?? 0,
      }));
    }
    case "SWITCH_TO_TAB":
      await browser.tabs.update(message.tabId, { active: true });
      await browser.windows.update(message.windowId, { focused: true });
      await closeFinder(sender);
      return;
    case "CLOSE_TAB_FINDER":
      await closeFinder(sender);
      return;
  }
});

function closeFinder(sender) {
  if (!sender.tab) return;
  return browser.tabs.sendMessage(sender.tab.id, { type: "CLOSE_TAB_FINDER" }, { frameId: 0 });
}
