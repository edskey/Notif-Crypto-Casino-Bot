'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseShuffleHtml } = require('../sources/shuffle-promotions');
const { parseFeed } = require('../sources/rollbit-promotions');
const { extractCandidates } = require('../sources/html-cards');
const { parseStakeChallenges } = require('../sources/stake-challenges');
const { parseGamdomCards } = require('../sources/gamdom-promotions');

test('parses Shuffle embedded promotion data and rejects malformed schema', () => {
  const data = {
    props: { pageProps: { promotions: [{
      id: 'promo-1', slug: 'welcome', title: 'Welcome Offer',
      description: 'Available to new players', publishDate: '2026-08-10', endsAt: null,
    }] } },
  };
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
  assert.equal(parseShuffleHtml(html).length, 1);
  assert.throws(() => parseShuffleHtml('<html></html>'), /__NEXT_DATA__/);
  assert.throws(() => parseShuffleHtml('<script id="__NEXT_DATA__">{}</script>'), /empty|schema/);
});

test('parses Rollbit RSS with guid and target phrase', () => {
  const rss = `<?xml version="1.0"?><rss><channel><item>
    <title>Welcome Offer</title><link>https://blog.rollbit.com/welcome/</link>
    <guid>rollbit-42</guid><pubDate>Tue, 11 Aug 2026 00:00:00 GMT</pubDate>
    <description><![CDATA[Bonus for new users]]></description>
  </item></channel></rss>`;
  const events = parseFeed(rss);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'rollbit-promotions:rollbit-42');
  assert.throws(() => parseFeed('<rss><channel></channel></rss>'), /no posts/);
});

test('extracts stable promo card links from minimal HTML fixtures', () => {
  const html = `<main><article data-testid="promotion-card"><h2>First deposit reward</h2>
    <p>100% bonus for first deposit</p><a href="/promotions/welcome">Details</a></article></main>`;
  const cards = extractCandidates(html, 'https://example.com/promotions', ['[data-testid="promotion-card"]']);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].url, 'https://example.com/promotions/welcome');
});

test('parses Stake embedded public GraphQL data and ignores first-to-hit false positives', () => {
  const challenge = {
    id: 'stake-1', targetMultiplier: 50000, minBetUsd: 0.01, award: 10, currency: 'usd',
    createdAt: 'Tue, 11 Aug 2026 00:00:00 GMT', game: { name: 'Ganja Snail' },
  };
  const body = JSON.stringify({ data: { challengeUnauthenticatedUserList: [challenge] } });
  const envelope = JSON.stringify({ status: 200, body });
  const html = `<html><head><title>Challenges</title></head><body><script data-sveltekit-fetched>${envelope}</script></body></html>`;
  assert.deepEqual(parseStakeChallenges(html), []);

  challenge.game.name = 'Welcome Offer for new players';
  const targetBody = JSON.stringify({ data: { challengeUnauthenticatedUserList: [challenge] } });
  const targetHtml = `<html><head><title>Challenges</title></head><body><script data-sveltekit-fetched>${JSON.stringify({ status: 200, body: targetBody })}</script></body></html>`;
  assert.equal(parseStakeChallenges(targetHtml)[0].id, 'stake-challenges:stake-1');
  assert.throws(() => parseStakeChallenges('<title>Just a moment...</title><body>Security verification</body>'), /Cloudflare/);
});

test('joins Gamdom featured title, conditions, and direct detail link', () => {
  const html = `<main><section><h2 data-testid="promotion-top-title">Welcome Offer</h2>
    <p data-testid="promotion-top-text">Available to new players</p>
    <a data-testid="promotion-top-read-more-btn" href="/promotions/welcome-offer">Read More</a>
  </section></main>`;
  const cards = parseGamdomCards(html);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].url, 'https://gamdom.com/promotions/welcome-offer');
  assert.match(cards[0].text, /new players/);
});
