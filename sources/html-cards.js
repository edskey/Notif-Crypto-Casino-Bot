'use strict';

const cheerio = require('cheerio');
const { cleanText, createPromoEvent } = require('../lib/promo');

function absoluteUrl(href, baseUrl) {
  try { return new URL(href, baseUrl).toString(); } catch { return ''; }
}

function extractCandidates(html, baseUrl, selectors) {
  const $ = cheerio.load(html);
  const candidates = [];
  const seen = new Set();

  for (const selector of selectors) {
    $(selector).each((_, node) => {
      let element = $(node);
      if (element.is('a')) {
        const parent = element.closest('article, li, [data-testid], [class*="card"], [class*="Card"]');
        if (parent.length && cleanText(parent.text()).length <= 2500) element = parent;
      }
      const text = cleanText(element.text());
      if (text.length < 8 || text.length > 3000) return;
      const anchor = element.is('a') ? element : element.find('a[href]').first();
      const href = anchor.attr('href') || '';
      const url = absoluteUrl(href || baseUrl, baseUrl);
      const heading = element.find('h1,h2,h3,h4,[role="heading"],[data-testid*="title"],strong').first();
      const title = cleanText(heading.text()) || cleanText(anchor.attr('aria-label')) || text.slice(0, 180);
      const key = `${url}|${title}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({ title, text, url });
      }
    });
  }
  return candidates;
}

function eventsFromCandidates(candidates, options) {
  return candidates.map((candidate) => createPromoEvent({
    source: options.source,
    casino: options.casino,
    title: candidate.title,
    text: candidate.text,
    url: candidate.url || options.pageUrl,
    providerId: options.providerId?.(candidate) || '',
    publishedAt: options.publishedAt?.(candidate) || '',
    expiry: options.expiry?.(candidate) || '',
    evergreen: options.evergreen?.(candidate) || false,
  })).filter(Boolean);
}

module.exports = { eventsFromCandidates, extractCandidates };
