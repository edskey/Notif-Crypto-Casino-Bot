'use strict';

const { CASINOS } = require('../lib/catalog');
const { renderPage } = require('../lib/browser');
const { eventsFromCandidates, extractCandidates } = require('./html-cards');

const name = 'winna-vip';
const pageUrl = 'https://winna.com/challenges';

module.exports = {
  name,
  pageUrl,
  async collect() {
    const { html } = await renderPage(pageUrl, {
      ready: 'body',
      minimumBytes: 4000,
      interact: async (page) => {
        const vip = page.getByText(/^VIP$/i).first();
        if (await vip.count()) {
          await vip.click();
          await page.locator('[data-testid="bonus-center-modal"]').waitFor({ state: 'visible' });
        }
      },
    });
    const candidates = extractCandidates(html, pageUrl, [
      '[data-testid="bonus-center-modal"] [data-testid]',
      '[data-testid="bonus-center-modal"] li',
      '[data-testid="bonus-center-modal"] article',
    ]);
    if (!candidates.length) throw new Error(`${name}: VIP modal opened but no reward cards were found`);
    return eventsFromCandidates(candidates, { source: name, casino: CASINOS.winna, pageUrl });
  },
};
