'use strict';

const { CASINOS } = require('../lib/catalog');
const { renderPage } = require('../lib/browser');
const { eventsFromCandidates, extractCandidates } = require('./html-cards');

const name = 'thrill-casino';
const pageUrl = 'https://thrill.com/casino';

module.exports = {
  name,
  pageUrl,
  async collect() {
    const { html } = await renderPage(pageUrl, {
      ready: '[data-testid="casino-banner"]', minimumBytes: 4000, settleMs: 4000, timeoutMs: 60000,
    });
    const candidates = extractCandidates(html, pageUrl, [
      '[data-testid="casino-banner"]',
      'a[href*="/promo/"]',
    ]);
    if (!candidates.length) throw new Error(`${name}: no casino promo banners found`);
    return eventsFromCandidates(candidates, { source: name, casino: CASINOS.thrill, pageUrl });
  },
};
