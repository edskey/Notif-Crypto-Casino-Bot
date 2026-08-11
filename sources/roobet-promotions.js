'use strict';

const { CASINOS } = require('../lib/catalog');
const { renderPage } = require('../lib/browser');
const { fetchText } = require('../lib/network');
const { eventsFromCandidates, extractCandidates } = require('./html-cards');

const name = 'roobet-promotions';
const pageUrl = 'https://roobet.com/promotions';
const selectors = ['a[href*="/promotions/"]', '[data-testid*="promotion"]', '[class*="promotion-card"]'];

module.exports = {
  name,
  pageUrl,
  async collect() {
    let html = '';
    try { ({ text: html } = await fetchText(pageUrl, { minimumBytes: 1000, attempts: 2 })); } catch { /* browser fallback */ }
    let candidates = html ? extractCandidates(html, pageUrl, selectors) : [];
    if (!candidates.length) {
      ({ html } = await renderPage(pageUrl, {
        ready: 'a[href*="/promotions/"]', minimumBytes: 3000, settleMs: 5000, timeoutMs: 60000,
      }));
      candidates = extractCandidates(html, pageUrl, selectors);
    }
    if (!candidates.length) throw new Error(`${name}: no promotion cards found`);
    return eventsFromCandidates(candidates, { source: name, casino: CASINOS.roobet, pageUrl });
  },
};
