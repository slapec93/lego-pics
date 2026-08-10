'use strict';

const { BrowserWindow } = require('electron');

/**
 * Load a URL in an offscreen BrowserWindow and run an extractor function inside
 * the page. Because this is a real Chromium context it transparently passes the
 * Cloudflare / BrickLink browser checks that block plain HTTP clients (curl,
 * fetch, WebFetch all get 403 on rebrickable.com/colors and bricklink.com).
 *
 * @param {string} url
 * @param {Function} extractorFn a function serialised and run in the page; it is
 *   called with no args and must return a JSON-serialisable value (or null if
 *   the page is not ready yet).
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=45000] total time to wait for a non-null result
 * @param {number} [opts.pollMs=1000]
 * @param {(msg:string)=>void} [opts.log]
 * @returns {Promise<any>}
 */
async function scrapePage(url, extractorFn, opts = {}) {
  const { timeoutMs = 45000, pollMs = 1000, log = () => {}, show = true } = opts;
  const win = new BrowserWindow({
    show,
    width: 1280,
    height: 900,
    webPreferences: { javascript: true },
  });

  // Look like a normal desktop Chrome so challenges resolve cleanly.
  win.webContents.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  );

  const source = `(${extractorFn.toString()})()`;
  const deadline = Date.now() + timeoutMs;

  try {
    log(`loading ${url}`);
    await win.loadURL(url);

    while (Date.now() < deadline) {
      let result = null;
      try {
        result = await win.webContents.executeJavaScript(source, true);
      } catch (err) {
        log(`extractor error (retrying): ${err.message}`);
      }
      if (result != null) return result;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`timed out after ${timeoutMs}ms extracting from ${url}`);
  } finally {
    win.destroy();
  }
}

module.exports = { scrapePage };
