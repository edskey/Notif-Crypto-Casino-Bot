'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const handler = require('../api/check');

function responseCapture() {
  let status;
  let body;
  return {
    res: {
      status(value) { status = value; return this; },
      setHeader() {},
      end(value) { body = JSON.parse(value); },
    },
    result: () => ({ status, body }),
  };
}

function promo(source, id, options = {}) {
  return {
    source,
    id,
    title: options.title || `Offer ${id}`,
    url: options.url || `https://example.com/${source}/${id}`,
    casino: options.casino || 'Stake',
    emoji: options.emoji || '🎯',
    evergreen: Boolean(options.evergreen),
    publishedAt: '2026-08-11T00:00:00Z',
    fields: [
      ['Казино', options.casino || 'Stake'],
      ['Категория', 'Первый депозит'],
      ['Бонус / условия', options.conditions || 'First deposit bonus'],
      ['Срок действия', options.expiry || '31 December 2026'],
      ['Совпавшая фраза', 'First deposit'],
    ],
    matchKeys: options.matchKeys || [`url:https://example.com/${id}`],
  };
}

function harness(context) {
  Object.assign(process.env, {
    CASINO_NOTIF_CHECK_SECRET: 'secret',
    CASINO_NOTIF_UPSTASH_REDIS_REST_URL: 'https://redis.test',
    CASINO_NOTIF_UPSTASH_REDIS_REST_TOKEN: 'redis-token',
    CASINO_NOTIF_TELEGRAM_BOT_TOKEN: 'bot-token',
    CASINO_NOTIF_TELEGRAM_CHAT_ID: '@channel',
  });
  let state = null;
  let telegramAttempt = 0;
  let failAt = 0;
  const telegram = [];
  context.mock.method(global, 'fetch', async (url, options = {}) => {
    if (String(url) === 'https://redis.test') {
      const command = JSON.parse(options.body);
      if (command[0] === 'SET' && command.includes('NX')) return new Response(JSON.stringify({ result: 'OK' }));
      if (command[0] === 'GET') return new Response(JSON.stringify({ result: state && JSON.stringify(state) }));
      if (command[0] === 'SET') state = JSON.parse(command[2]);
      return new Response(JSON.stringify({ result: null }));
    }
    if (String(url).includes('/sendMessage')) {
      telegramAttempt += 1;
      const message = JSON.parse(options.body);
      telegram.push(message);
      if (failAt && telegramAttempt === failAt) {
        return new Response(JSON.stringify({ ok: false, description: 'synthetic failure' }), { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true }));
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  return {
    telegram,
    state: () => state,
    failTelegramAt: (attempt) => { failAt = attempt; },
    clearFailure: () => { failAt = 0; },
    async invoke(body, secret = 'secret') {
      const capture = responseCapture();
      await handler({ method: 'POST', headers: { authorization: `Bearer ${secret}` }, body }, capture.res);
      return capture.result();
    },
  };
}

function poll(sources, events) {
  return { mode: 'poll', sources, events };
}

test('rejects an invalid secret before external calls', async (context) => {
  process.env.CASINO_NOTIF_CHECK_SECRET = 'correct';
  context.mock.method(global, 'fetch', async () => { throw new Error('must not fetch'); });
  const capture = responseCapture();
  await handler({ method: 'POST', headers: { authorization: 'Bearer wrong' }, body: {} }, capture.res);
  assert.deepEqual(capture.result(), { status: 401, body: { error: 'unauthorized' } });
});

test('creates a non-empty baseline, sends later events separately, and suppresses repeats', async (context) => {
  const app = harness(context);
  const old = promo('offers', 'old');
  const one = promo('offers', 'one');
  const two = promo('offers', 'two');
  assert.equal((await app.invoke(poll(['offers'], [old]))).body.sent, 0);
  assert.equal((await app.invoke(poll(['offers'], [two, one, old]))).body.sent, 2);
  assert.equal(app.telegram.length, 2);
  assert(app.telegram.every((message) => message.parse_mode === 'HTML'));
  assert.equal((await app.invoke(poll(['offers'], [two, one, old]))).body.sent, 0);
  assert.equal(app.telegram.length, 2);
});

test('stores an empty baseline and sends the first later event', async (context) => {
  const app = harness(context);
  assert.equal((await app.invoke(poll(['empty-source'], []))).body.sent, 0);
  assert.deepEqual(app.state().sources['empty-source'].sentIds, []);
  assert.equal((await app.invoke(poll(['empty-source'], [promo('empty-source', 'first')]))).body.sent, 1);
});

test('checkpoints each Telegram message and retries only the failed remainder', async (context) => {
  const app = harness(context);
  const old = promo('offers', 'old');
  const one = promo('offers', 'one');
  const two = promo('offers', 'two');
  await app.invoke(poll(['offers'], [old]));
  app.failTelegramAt(2);
  const failed = await app.invoke(poll(['offers'], [two, one, old]));
  assert.equal(failed.status, 500);
  assert(app.state().sources.offers.sentIds.includes('one'));
  assert(!app.state().sources.offers.sentIds.includes('two'));
  app.clearFailure();
  const retried = await app.invoke(poll(['offers'], [two, one, old]));
  assert.equal(retried.body.sent, 1);
  assert.equal(app.telegram.length, 3);
  assert.match(app.telegram[1].text, /Offer two/);
  assert.match(app.telegram[2].text, /Offer two/);
});

test('deduplicates the same campaign across sources and checkpoints aliases', async (context) => {
  const app = harness(context);
  await app.invoke(poll(['one', 'two'], []));
  const shared = ['campaign:welcome-100'];
  const first = promo('one', 'a', { matchKeys: shared });
  const alias = promo('two', 'b', { matchKeys: shared, casino: 'Roobet', emoji: '🦘' });
  assert.equal((await app.invoke(poll(['one', 'two'], [first, alias]))).body.sent, 1);
  assert(app.state().sources.one.sentIds.includes('a'));
  assert(app.state().sources.two.sentIds.includes('b'));
  assert.equal((await app.invoke(poll(['one', 'two'], [first, alias]))).body.sent, 0);
});

test('routes a newly discovered evergreen offer to summaries without realtime delivery', async (context) => {
  const app = harness(context);
  await app.invoke(poll(['offers'], []));
  const evergreen = promo('offers', 'welcome', { evergreen: true, expiry: 'Бессрочно' });
  const result = await app.invoke(poll(['offers'], [evergreen]));
  assert.equal(result.body.sent, 0);
  assert(app.state().sources.offers.sentIds.includes('welcome'));
  assert.equal(app.state().evergreenEvents.offers.length, 1);
  assert.equal(app.telegram.length, 0);
});

test('weekly summary uses evergreen offers cached by successful poll sources', async (context) => {
  const app = harness(context);
  const evergreen = promo('offers', 'cached-welcome', { evergreen: true, expiry: 'Бессрочно' });
  await app.invoke(poll(['offers'], [evergreen]));
  const summary = {
    mode: 'summary', sources: ['summary-static'], events: [],
    summaryKey: '2026-08-15', summaryPeriod: 'weekly',
  };
  const result = await app.invoke(summary);
  assert.equal(result.body.sent, 1);
  assert.equal(result.body.offers, 1);
  assert.match(app.telegram[0].text, /cached-welcome/);
});

test('sends one idempotent weekly summary', async (context) => {
  const app = harness(context);
  const event = promo('evergreen', 'welcome', { evergreen: true, expiry: 'Бессрочно' });
  const body = {
    mode: 'summary',
    sources: ['evergreen'],
    events: [event],
    summaryKey: '2026-08-15',
    summaryPeriod: 'weekly',
  };
  assert.equal((await app.invoke(body)).body.sent, 1);
  assert.match(app.telegram[0].text, /Еженедельная сводка/);
  assert.equal((await app.invoke(body)).body.sent, 0);
  assert.equal(app.telegram.length, 1);
});

test('sends the linked welcome message only once', async (context) => {
  const app = harness(context);
  const body = { mode: 'welcome', sources: [], events: [] };
  assert.equal((await app.invoke(body)).body.sent, 1);
  assert.equal(app.telegram.length, 1);
  assert.match(app.telegram[0].text, /Крипто-Казиках/);
  assert.match(app.telegram[0].text, /href="https:\/\/stake\.com\/casino\/challenges"/);
  assert.equal((await app.invoke(body)).body.sent, 0);
  assert.equal(app.telegram.length, 1);
});

test('rejects malformed payloads and non-HTTPS URLs', async (context) => {
  const app = harness(context);
  assert.equal((await app.invoke({ mode: 'poll', sources: ['x'], events: [{}] })).status, 400);
  assert.equal((await app.invoke(poll(['x'], [promo('x', 'bad', { url: 'http://example.com/bad' })]))).status, 400);
  assert.equal((await app.invoke({
    mode: 'summary', sources: [], events: [], summaryKey: '2026-08-12', summaryPeriod: 'daily',
  })).status, 400);
});

test('uses a bot-specific Redis namespace', () => {
  assert.match(handler._private.STATE_KEY, /^notif-crypto-casino-bot:/);
});
