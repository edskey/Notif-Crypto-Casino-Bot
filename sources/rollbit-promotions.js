'use strict';

const cheerio = require('cheerio');
const { CASINOS } = require('../lib/catalog');
const { fetchText } = require('../lib/network');
const { cleanText, createPromoEvent } = require('../lib/promo');

const name = 'rollbit-promotions';
const pageUrl = 'https://blog.rollbit.com/tag/promotions/';
const feedUrl = 'https://blog.rollbit.com/tag/promotions/rss/';

function parseFeed(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = $('item');
  if (!items.length) throw new Error(`${name}: RSS feed returned no posts`);
  const events = [];
  items.each((_, node) => {
    const item = $(node);
    const title = cleanText(item.find('title').first().text());
    const url = cleanText(item.find('link').first().text());
    const providerId = cleanText(item.find('guid').first().text() || url);
    const body = cleanText(item.find('content\\:encoded').text() || item.find('description').text());
    const event = createPromoEvent({
      source: name,
      casino: CASINOS.rollbit,
      providerId,
      title,
      text: `${title} ${body}`,
      url,
      publishedAt: cleanText(item.find('pubDate').text()),
    });
    if (event) events.push(event);
  });
  return events;
}

module.exports = {
  name,
  pageUrl,
  feedUrl,
  parseFeed,
  async collect() {
    const { text } = await fetchText(feedUrl, { minimumBytes: 500, accept: 'application/rss+xml,application/xml,text/xml' });
    return parseFeed(text);
  },
};
