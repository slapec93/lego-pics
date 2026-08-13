'use strict';

const { BrowserWindow } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A reusable offscreen(ish) scraping window. Because it is a real Chromium
 * context it transparently passes the browser checks that block plain HTTP
 * clients on bricklink.com. One window is reused across many loads (rapidly
 * creating/destroying windows, or firing loads back-to-back, intermittently
 * yields ERR_FAILED / ERR_ABORTED — reuse + retry avoids that).
 */
class Scraper {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.win = null;
  }

  ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { javascript: true },
    });
    this.win.webContents.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    );
    return this.win;
  }

  /**
   * Load a URL and poll an extractor until it returns non-null.
   * @param {string} url
   * @param {Function} extractorFn serialised + run in the page; returns JSON or null.
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs=45000]
   * @param {number} [opts.pollMs=1000]
   * @param {number} [opts.loadRetries=3]
   */
  async scrape(url, extractorFn, opts = {}) {
    const { timeoutMs = 45000, pollMs = 1000, loadRetries = 3 } = opts;
    const win = this.ensureWindow();
    const source = `(${extractorFn.toString()})()`;

    // Load with retry — transient ERR_FAILED/ERR_ABORTED are common back-to-back.
    let loaded = false;
    for (let attempt = 0; attempt <= loadRetries && !loaded; attempt++) {
      try {
        await win.webContents.loadURL(url);
        loaded = true;
      } catch (err) {
        const code = err && err.message ? err.message : String(err);
        if (attempt >= loadRetries) throw new Error(`load failed for ${url}: ${code}`);
        this.log(`load retry ${attempt + 1} for ${url} (${code})`);
        await sleep(600 * (attempt + 1));
      }
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let result = null;
      try {
        result = await win.webContents.executeJavaScript(source, true);
      } catch (err) {
        this.log(`extractor error (retrying): ${err.message}`);
      }
      if (result != null) return result;
      await sleep(pollMs);
    }
    throw new Error(`timed out after ${timeoutMs}ms extracting from ${url}`);
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

/**
 * One-shot convenience wrapper (creates + destroys its own window).
 * @param {string} url
 * @param {Function} extractorFn
 * @param {object} [opts]
 */
async function scrapePage(url, extractorFn, opts = {}) {
  const scraper = new Scraper({ log: opts.log });
  try {
    return await scraper.scrape(url, extractorFn, opts);
  } finally {
    scraper.destroy();
  }
}

module.exports = { Scraper, scrapePage };
