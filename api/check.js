'use strict';

const crypto = require('node:crypto');

const NAMESPACE = 'notif-crypto-casino-bot';
const STATE_KEY = `${NAMESPACE}:state:v1`;
const LOCK_KEY = `${NAMESPACE}:lock:v1`;
const MAX_SENT_IDS = 1500;
const MAX_MATCH_KEYS = 6000;
const MAX_EVENTS = 500;

function env(name) {
  const value = process.env[`CASINO_NOTIF_${name}`];
  if (!value) throw new Error(`Missing environment variable: CASINO_NOTIF_${name}`);
  return value;
}

function respond(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function matchesSecret(req) {
  const expected = process.env.CASINO_NOTIF_CHECK_SECRET || '';
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function redis(command) {
  const response = await fetch(env('UPSTASH_REDIS_REST_URL').replace(/\/$/, ''), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('UPSTASH_REDIS_REST_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(`Upstash: ${result.error || response.status}`);
  return result.result;
}

async function loadState() {
  const raw = await redis(['GET', STATE_KEY]);
  if (!raw) return { sources: {}, matchKeys: [], summaries: {} };
  try {
    const state = JSON.parse(raw);
    return state && typeof state === 'object' ? state : { sources: {}, matchKeys: [], summaries: {} };
  } catch {
    throw new Error('Upstash state is malformed JSON');
  }
}

async function saveState(state) {
  const ttl = Number(process.env.CASINO_NOTIF_STATE_TTL_SECONDS || 7776000);
  await redis(['SET', STATE_KEY, JSON.stringify(state), 'EX', ttl]);
}

function unique(values, maximum) {
  return [...new Set((values || []).map(String).filter(Boolean))].slice(0, maximum);
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isSafeUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function fieldValue(event, label) {
  return event.fields.find(([name]) => name === label)?.[1] || '';
}

function formatEvent(event) {
  const rows = event.fields.map(([label, value]) => `🔹 <b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`);
  return [
    '🔥 <b>Новая промоакция для новых пользователей</b>',
    '',
    `${escapeHtml(event.emoji)} <b>${escapeHtml(event.casino)}</b> — ${escapeHtml(event.title)}`,
    ...rows,
    '',
    `🔗 <a href="${escapeHtml(event.url)}">Открыть промоакцию</a>`,
  ].join('\n');
}

function summaryBlocks(events) {
  const seenKeys = new Set();
  const deduplicated = [];
  for (const event of events) {
    const keys = event.matchKeys.length ? event.matchKeys : [`${event.source}:${event.id}`];
    if (keys.some((key) => seenKeys.has(key))) continue;
    keys.forEach((key) => seenKeys.add(key));
    deduplicated.push(event);
  }
  return deduplicated
    .sort((a, b) => `${a.casino}:${a.title}`.localeCompare(`${b.casino}:${b.title}`, 'ru'))
    .map((event) => [
      `${escapeHtml(event.emoji)} <b>${escapeHtml(event.casino)} — ${escapeHtml(event.title)}</b>`,
      `Условия: ${escapeHtml(fieldValue(event, 'Бонус / условия'))}`,
      `Срок: ${escapeHtml(fieldValue(event, 'Срок действия') || 'Бессрочно')}`,
      `<a href="${escapeHtml(event.url)}">Открыть</a>`,
    ].join('\n'));
}

function formatSummaryChunks(input) {
  const title = input.summaryPeriod === 'weekly'
    ? '📅 <b>Еженедельная сводка бессрочных welcome-бонусов</b>'
    : '📆 <b>Ежедневная сводка бессрочных welcome-бонусов</b>';
  const header = `${title}\nДата: ${escapeHtml(input.summaryKey)}`;
  const blocks = summaryBlocks(input.events);
  if (!blocks.length) return [];
  const chunks = [];
  let current = header;
  for (const block of blocks) {
    const addition = `\n\n${block}`;
    if ((current + addition).length > 3800 && current !== header) {
      chunks.push(current);
      current = `${header}\n\n${block}`;
    } else {
      current += addition;
    }
  }
  chunks.push(current);
  return chunks;
}

async function sendTelegram(text) {
  const response = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN').trim()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env('TELEGRAM_CHAT_ID').trim(),
      text,
      parse_mode: 'HTML',
      disable_notification: false,
      link_preview_options: { is_disabled: true },
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(`Telegram: ${body.description || response.status}`);
}

function boundedString(value, maximum) {
  return String(value || '').slice(0, maximum);
}

function parsePayload(req) {
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  if (!body || !Array.isArray(body.sources) || !Array.isArray(body.events) || body.events.length > MAX_EVENTS) return null;
  const mode = body.mode || 'poll';
  if (!['poll', 'summary'].includes(mode)) return null;
  const sources = unique(body.sources, MAX_EVENTS).filter((name) => /^[a-z0-9_-]{1,100}$/i.test(name));
  if (sources.length !== body.sources.length) return null;
  const events = body.events.map((event) => ({
    source: boundedString(event?.source, 100),
    id: boundedString(event?.id, 1000),
    title: boundedString(event?.title, 300),
    url: boundedString(event?.url, 2000),
    casino: boundedString(event?.casino, 100),
    emoji: boundedString(event?.emoji, 20),
    evergreen: Boolean(event?.evergreen),
    publishedAt: boundedString(event?.publishedAt, 100),
    fields: Array.isArray(event?.fields)
      ? event.fields.slice(0, 30).map((pair) => [boundedString(pair?.[0], 100), boundedString(pair?.[1], 500)])
      : [],
    matchKeys: Array.isArray(event?.matchKeys)
      ? unique(event.matchKeys.map((key) => boundedString(key, 500)), 20)
      : [],
  }));
  const valid = events.every((event) => sources.includes(event.source) && event.id && event.title &&
    event.casino && event.emoji && isSafeUrl(event.url) && event.fields.every(([a, b]) => a && b));
  if (!valid) return null;
  if (mode === 'summary') {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(body.summaryKey) || !['daily', 'weekly'].includes(body.summaryPeriod)) return null;
    if (events.some((event) => !event.evergreen)) return null;
  }
  return {
    mode,
    sources,
    events,
    summaryKey: body.summaryKey,
    summaryPeriod: body.summaryPeriod,
  };
}

function stateHelpers(state) {
  state.sources ||= {};
  state.summaries ||= {};
  state.evergreenEvents ||= {};
  state.matchKeys = unique(state.matchKeys, MAX_MATCH_KEYS);
  const globalSeen = new Set(state.matchKeys);
  return {
    remember(keys) {
      const fresh = [];
      for (const key of keys || []) {
        if (!globalSeen.has(key)) fresh.push(key);
        globalSeen.add(key);
      }
      if (fresh.length) state.matchKeys = unique([...fresh, ...state.matchKeys], MAX_MATCH_KEYS);
    },
    hasAny(keys) { return (keys || []).some((key) => globalSeen.has(key)); },
  };
}

async function processPoll(input, state) {
  const helpers = stateHelpers(state);
  const pendingOwners = new Map();
  const deliveries = [];

  for (const source of input.sources) {
    const events = input.events.filter((event) => event.source === source);
    state.evergreenEvents[source] = events.filter((event) => event.evergreen);
    const ids = events.map((event) => event.id);
    const existing = state.sources[source];
    if (!existing || !Array.isArray(existing.sentIds)) {
      state.sources[source] = { sentIds: unique(ids, MAX_SENT_IDS) };
      events.forEach((event) => helpers.remember(event.matchKeys));
      continue;
    }
    const seen = new Set(existing.sentIds);
    for (const event of [...events].reverse()) {
      if (seen.has(event.id)) {
        helpers.remember(event.matchKeys);
        continue;
      }
      if (event.evergreen || helpers.hasAny(event.matchKeys)) {
        existing.sentIds = unique([event.id, ...existing.sentIds], MAX_SENT_IDS);
        seen.add(event.id);
        helpers.remember(event.matchKeys);
        continue;
      }
      const pendingOwner = event.matchKeys.map((key) => pendingOwners.get(key)).find(Boolean);
      if (pendingOwner) {
        pendingOwner.aliases.push({ source, id: event.id, matchKeys: event.matchKeys });
        continue;
      }
      const delivery = { event, aliases: [] };
      deliveries.push(delivery);
      event.matchKeys.forEach((key) => pendingOwners.set(key, delivery));
    }
  }

  state.checkedAt = new Date().toISOString();
  await saveState(state);
  for (const delivery of deliveries) {
    await sendTelegram(formatEvent(delivery.event));
    const all = [{ source: delivery.event.source, id: delivery.event.id, matchKeys: delivery.event.matchKeys }, ...delivery.aliases];
    for (const item of all) {
      state.sources[item.source].sentIds = unique([item.id, ...state.sources[item.source].sentIds], MAX_SENT_IDS);
      helpers.remember(item.matchKeys);
    }
    state.checkedAt = new Date().toISOString();
    await saveState(state);
  }
  return { sent: deliveries.length, sources: input.sources.length };
}

async function processSummary(input, state) {
  stateHelpers(state);
  for (const source of input.sources) {
    state.evergreenEvents[source] = input.events.filter((event) => event.source === source && event.evergreen);
  }
  const cachedEvents = Object.values(state.evergreenEvents)
    .flat()
    .filter((event) => event && event.evergreen && event.id && event.title && isSafeUrl(event.url));
  const summaryInput = { ...input, events: cachedEvents };
  const summaryId = `${input.summaryPeriod}:${input.summaryKey}`;
  const chunks = formatSummaryChunks(summaryInput);
  const entry = state.summaries[summaryId] || { sentChunks: [], completed: false };
  if (entry.completed) return { sent: 0, offers: cachedEvents.length, skipped: 'summary_already_sent' };
  for (let index = 0; index < chunks.length; index += 1) {
    if (entry.sentChunks.includes(index)) continue;
    await sendTelegram(chunks[index]);
    entry.sentChunks = unique([index, ...entry.sentChunks], 100).map(Number);
    state.summaries[summaryId] = entry;
    state.checkedAt = new Date().toISOString();
    await saveState(state);
  }
  entry.completed = true;
  entry.completedAt = new Date().toISOString();
  state.summaries[summaryId] = entry;
  state.summaries = Object.fromEntries(Object.entries(state.summaries).slice(-120));
  await saveState(state);
  return { sent: chunks.length, offers: cachedEvents.length };
}

async function handler(req, res) {
  if (req.method !== 'POST') return respond(res, 405, { error: 'method_not_allowed' });
  if (!matchesSecret(req)) return respond(res, 401, { error: 'unauthorized' });
  const input = parsePayload(req);
  if (!input) return respond(res, 400, { error: 'invalid_payload' });

  let locked = false;
  try {
    locked = (await redis(['SET', LOCK_KEY, '1', 'NX', 'EX', 180])) === 'OK';
    if (!locked) return respond(res, 202, { ok: true, skipped: 'already_running' });
    const state = await loadState();
    const result = input.mode === 'summary'
      ? await processSummary(input, state)
      : await processPoll(input, state);
    return respond(res, 200, { ok: true, mode: input.mode, ...result });
  } catch (error) {
    return respond(res, 500, { ok: false, error: error.message });
  } finally {
    if (locked) {
      try { await redis(['DEL', LOCK_KEY]); } catch { /* lock expires */ }
    }
  }
}

handler._private = {
  formatEvent,
  formatSummaryChunks,
  parsePayload,
  processPoll,
  STATE_KEY,
};

module.exports = handler;
