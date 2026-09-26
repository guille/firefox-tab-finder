browser.commands.onCommand.addListener(async (command) => {
  if (command !== "open-tab-search") return;

  try {
    await browser.tabs.executeScript({ file: "inject.js" });
  } catch (e) {
    console.warn("Tab Finder: cannot inject into this tab:", e.message);
  }
});

// The finder runs in a frame inside the page, where Firefox withholds the tabs
// API, so it does everything through here. sender.tab is the tab hosting it.
browser.runtime.onMessage.addListener(async (message, sender) => {
  switch (message.type) {
    case "GET_TABS": {
      const tabs = await browser.tabs.query({});
      return tabs.map((t) => ({
        id:         t.id,
        windowId:   t.windowId,
        title:      t.title      || "(no title)",
        url:        t.url        || "",
        favIconUrl: t.favIconUrl || "",
        active:     t.id === sender.tab?.id,
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
  return browser.tabs.sendMessage(sender.tab.id, { type: "CLOSE_TAB_FINDER" }, { frameId: 0 });
}
