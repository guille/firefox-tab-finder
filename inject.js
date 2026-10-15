// Injected on demand into the top frame. Re-injection shares this content-script
// global, so a second run toggles instead of opening another overlay.
// Evaluates to whether the overlay was handled; false asks for the popup instead.
(() => {
  if (window.tabFinderToggle) return window.tabFinderToggle();

  let host = null;

  function open() {
    // The page can't take focus from browser UI such as the URL bar.
    if (!document.hasFocus()) return false;

    host = document.createElement("tab-finder");
    host.style.setProperty("all", "initial", "important");

    // Closed so the page can't reach the iframe (and its moz-extension URL) through the DOM.
    const shadow = host.attachShadow({ mode: "closed" });
    const frame = document.createElement("iframe");
    const style = {
      position: "fixed", inset: "0", width: "100%", height: "100%",
      border: "0", margin: "0", padding: "0", display: "block",
      background: "transparent", "color-scheme": "dark",
      "z-index": "2147483647",
    };
    for (const [k, v] of Object.entries(style)) frame.style.setProperty(k, v, "important");
    frame.src = browser.runtime.getURL("finder.html");
    frame.addEventListener("load", () => frame.focus(), { once: true });

    shadow.append(frame);
    document.documentElement.append(host);
    return true;
  }

  function close() {
    host?.remove();
    host = null;
    return true;
  }

  window.tabFinderToggle = () => (host ? close() : open());

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === "CLOSE_TAB_FINDER") close();
  });

  return open();
})();
