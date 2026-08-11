'use strict';

const { CASINOS } = require('../lib/catalog');
const { renderPage } = require('../lib/browser');
const { eventsFromCandidates, extractCandidates } = require('./html-cards');

const name = 'bcgame-promotions';
const pageUrl = 'https://bc.game/ru/promotions/promotion';

module.exports = {
  name,
  pageUrl,
  async collect() {
    const { html } = await renderPage(pageUrl, { ready: 'body', minimumBytes: 5000, settleMs: 2500 });
    const candidates = extractCandidates(html, pageUrl, [
      'a[href*="/promotions/"]',
      '[data-testid*="promotion"]',
      '[class*="promotion-card"]',
      '[class*="PromotionCard"]',
    ]).filter((candidate) => !/New players can claim welcome bonuses/iu.test(candidate.text));
    if (!candidates.length) throw new Error(`${name}: no promotion cards found`);
    return eventsFromCandidates(candidates, { source: name, casino: CASINOS.bcgame, pageUrl });
  },
};
