// Injected on demand into the top frame. Re-injection shares this content-script
// global, so a second run toggles instead of opening another overlay.
(() => {
  if (window.tabFinderToggle) {
    window.tabFinderToggle();
    return;
  }

  let host = null;

  function open() {
    host = document.createElement("tab-finder");
    host.style.setProperty("all", "initial", "important");

    // Closed so the page can't reach the iframe (and its moz-extension URL) through the DOM.
    const shadow = host.attachShadow({ mode: "closed" });
    const frame = document.createElement("iframe");
    const style = {
      position: "fixed", inset: "0", width: "100%", height: "100%",
      border: "0", margin: "0", padding: "0", display: "block",
      background: "transparent", "color-scheme": "normal",
      "z-index": "2147483647",
    };
    for (const [k, v] of Object.entries(style)) frame.style.setProperty(k, v, "important");
    frame.src = browser.runtime.getURL("finder.html");
    frame.addEventListener("load", () => frame.focus(), { once: true });

    shadow.append(frame);
    document.documentElement.append(host);
  }

  function close() {
    host?.remove();
    host = null;
  }

  window.tabFinderToggle = () => (host ? close() : open());

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === "CLOSE_TAB_FINDER") close();
  });

  open();
})();
