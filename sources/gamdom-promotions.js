'use strict';

const cheerio = require('cheerio');
const { CASINOS } = require('../lib/catalog');
const { renderPage } = require('../lib/browser');
const { fetchText } = require('../lib/network');
const { cleanText } = require('../lib/promo');
const { eventsFromCandidates } = require('./html-cards');

const name = 'gamdom-promotions';
const pageUrl = 'https://gamdom.com/promotions';
function parseGamdomCards(html) {
  const $ = cheerio.load(html);
  const candidates = [];
  const seen = new Set();
  function add(titleNode, key, featured = false) {
    const titleElement = $(titleNode);
    const title = cleanText(titleElement.text());
    let container = titleElement.parent();
    for (let level = 0; level < 7 && container.length; level += 1) {
      const link = container.find('a[href*="/promotions/"]').first();
      const text = cleanText(container.text());
      if (link.length && text.length >= title.length && text.length < 2200) {
        const url = new URL(link.attr('href'), pageUrl).toString();
        const identity = `${url}|${title}`;
        if (!seen.has(identity)) {
          seen.add(identity);
          candidates.push({ title, text, url });
        }
        return;
      }
      container = container.parent();
    }
    const linkSelector = featured
      ? '[data-testid="promotion-top-read-more-btn"]'
      : `[data-testid="${key}-read-more-btn"]`;
    const href = $(linkSelector).attr('href');
    if (href && title) {
      const url = new URL(href, pageUrl).toString();
      const identity = `${url}|${title}`;
      if (!seen.has(identity)) candidates.push({ title, text: title, url });
    }
  }
  $('[data-testid="promotion-top-title"]').each((_, node) => add(node, 'promotion-top', true));
  $('[data-testid^="promotion-card-"][data-testid$="-title"]').each((_, node) => {
    const key = String($(node).attr('data-testid')).replace(/-title$/, '');
    add(node, key);
  });
  return candidates;
}

module.exports = {
  name,
  pageUrl,
  async collect() {
    let html = '';
    try { ({ text: html } = await fetchText(pageUrl, { minimumBytes: 2000, attempts: 2 })); } catch { /* browser fallback */ }
    let candidates = html ? parseGamdomCards(html) : [];
    if (!candidates.length) {
      ({ html } = await renderPage(pageUrl, { ready: '[data-testid="promotion-top-title"]', minimumBytes: 4000, settleMs: 5000 }));
      candidates = parseGamdomCards(html);
    }
    if (!candidates.length) throw new Error(`${name}: no promotion cards found`);
    return eventsFromCandidates(candidates, {
      source: name,
      casino: CASINOS.gamdom,
      pageUrl,
      evergreen: (candidate) => /\/promotions\/welcome-offer\/?$/iu.test(new URL(candidate.url).pathname),
    });
  },
};

module.exports.parseGamdomCards = parseGamdomCards;
