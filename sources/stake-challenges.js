'use strict';

const cheerio = require('cheerio');
const { CASINOS } = require('../lib/catalog');
const { renderPage } = require('../lib/browser');
const { cleanText, createPromoEvent } = require('../lib/promo');

const name = 'stake-challenges';
const pageUrl = 'https://stake.com/casino/challenges';

function parseStakeChallenges(html) {
  const $ = cheerio.load(html);
  const title = cleanText($('title').text());
  const bodyText = cleanText($('body').text());
  if (/just a moment|security verification|enable javascript and cookies/iu.test(`${title} ${bodyText}`)) {
    throw new Error(`${name}: blocked by Cloudflare security verification`);
  }

  let challenges;
  $('script[data-sveltekit-fetched]').each((_, node) => {
    if (challenges) return;
    try {
      const envelope = JSON.parse($(node).text());
      const result = JSON.parse(envelope.body || '{}');
      const list = result?.data?.challengeUnauthenticatedUserList;
      if (Array.isArray(list)) challenges = list;
    } catch { /* unrelated embedded response */ }
  });
  if (!Array.isArray(challenges)) throw new Error(`${name}: public challenge data is missing or changed schema`);

  return challenges.map((challenge) => {
    const game = cleanText(challenge?.game?.name || 'Casino challenge');
    const text = [
      game,
      `First to hit ${challenge.targetMultiplier || ''}x`,
      challenge.minBetUsd != null ? `with min $${challenge.minBetUsd} bet` : '',
      challenge.award != null ? `Prize ${challenge.award} ${challenge.currency || ''}` : '',
    ].filter(Boolean).join(' ');
    return createPromoEvent({
      source: name,
      casino: CASINOS.stake,
      providerId: challenge.id,
      title: game,
      text,
      url: pageUrl,
      publishedAt: challenge.createdAt || challenge.startAt || '',
      expiry: challenge.expireAt || '',
    });
  }).filter(Boolean);
}

module.exports = {
  name,
  pageUrl,
  modes: ['poll'],
  parseStakeChallenges,
  async collect() {
    const { html } = await renderPage(pageUrl, { ready: 'body', minimumBytes: 5000, settleMs: 5000, timeoutMs: 60000 });
    return parseStakeChallenges(html);
  },
};
