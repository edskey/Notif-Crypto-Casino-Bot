'use strict';

const cheerio = require('cheerio');
const { CASINOS } = require('../lib/catalog');
const { fetchText } = require('../lib/network');
const { cleanText, createPromoEvent } = require('../lib/promo');

const name = 'shuffle-promotions';
const pageUrl = 'https://shuffle.com/ru/promotions';

function translated(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.ru || value.en || Object.values(value).find((item) => typeof item === 'string') || '';
}

function findPromotions(root) {
  const found = [];
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if ((value.slug || value.id) && (value.title || value.name) &&
        ('description' in value || 'startsAt' in value || 'endsAt' in value || 'publishDate' in value)) {
      found.push(value);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(root);
  return found;
}

function parseShuffleHtml(html) {
  const $ = cheerio.load(html);
  const raw = $('#__NEXT_DATA__').text();
  if (!raw) throw new Error(`${name}: __NEXT_DATA__ is missing`);
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`${name}: malformed __NEXT_DATA__`); }
  const promotions = findPromotions(data);
  if (!promotions.length) throw new Error(`${name}: promotions array is empty or changed schema`);
  return promotions;
}

module.exports = {
  name,
  pageUrl,
  parseShuffleHtml,
  async collect() {
    const { text: html } = await fetchText(pageUrl, { minimumBytes: 2000 });
    return parseShuffleHtml(html).map((promo) => {
      const slug = cleanText(promo.slug || promo.id);
      const title = translated(promo.title || promo.name);
      const description = translated(promo.description || promo.shortDescription || '');
      const tags = Array.isArray(promo.tags) ? promo.tags.map(translated).join(' ') : '';
      return createPromoEvent({
        source: name,
        casino: CASINOS.shuffle,
        providerId: cleanText(promo.id || slug),
        title,
        text: `${title} ${description} ${tags}`,
        url: new URL(`/ru/promotions/${slug}`, pageUrl).toString(),
        publishedAt: promo.publishDate || promo.startsAt || '',
        expiry: promo.endsAt || '',
      });
    }).filter(Boolean);
  },
};
