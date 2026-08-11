'use strict';

const { chromium } = require('playwright');

let browserPromise;
let active = 0;
const waiters = [];
const MAX_PAGES = 2;

async function acquire() {
  if (active < MAX_PAGES) {
    active += 1;
    return;
  }
  await new Promise((resolve) => waiters.push(resolve));
  active += 1;
}

function release() {
  active -= 1;
  waiters.shift()?.();
}

async function getBrowser() {
  if (!browserPromise) {
    const executablePath = process.env.CHROME_EXECUTABLE_PATH || undefined;
    browserPromise = chromium.launch({
      headless: true,
      executablePath,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
  }
  return browserPromise;
}

async function renderPage(url, options = {}) {
  await acquire();
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage({ locale: options.locale || 'en-US' });
    page.setDefaultTimeout(options.timeoutMs || 30000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs || 45000 });
    if (options.ready) await page.locator(options.ready).first().waitFor({ state: 'attached' });
    if (typeof options.interact === 'function') await options.interact(page);
    await page.waitForTimeout(options.settleMs || 1500);
    const html = await page.content();
    if (html.length < (options.minimumBytes || 1000)) throw new Error(`Rendered page too short for ${url}`);
    return { html, finalUrl: page.url() };
  } finally {
    await page?.close().catch(() => {});
    release();
  }
}

async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = undefined;
  await browser?.close();
}

module.exports = { closeBrowser, renderPage };
