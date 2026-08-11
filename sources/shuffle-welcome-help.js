'use strict';

const cheerio = require('cheerio');
const { CASINOS } = require('../lib/catalog');
const { fetchText } = require('../lib/network');
const { cleanText, createPromoEvent } = require('../lib/promo');

const name = 'shuffle-welcome-help';
const pageUrl = 'https://help.shuffle.com/en/articles/8407653-100-first-deposit-bonus-up-to-1-000-usd';

module.exports = {
  name,
  pageUrl,
  modes: ['summary'],
  async collect() {
    const { text: html } = await fetchText(pageUrl, { minimumBytes: 1000 });
    const $ = cheerio.load(html);
    const title = cleanText($('h1').first().text()) || '100% First Deposit Bonus up to $1,000 USD';
    const body = cleanText($('article').text() || $('main').text());
    if (!body || body.length < 100) throw new Error(`${name}: help article content is missing`);
    const event = createPromoEvent({
      source: name,
      casino: CASINOS.shuffle,
      providerId: '8407653',
      title,
      text: body,
      url: pageUrl,
      evergreen: true,
    });
    if (!event) throw new Error(`${name}: expected first-deposit phrase is missing`);
    return [event];
  },
};
