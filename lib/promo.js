'use strict';

const crypto = require('node:crypto');

const MATCHERS = [
  { category: 'Новый пользователь', regex: /\bnew(?:ly)?\s+(?:registered\s+)?(?:user|users|player|players|customer|customers)\b/iu },
  { category: 'Первый депозит', regex: /\b(?:first(?:[-\s]?time)?|1st)\s+deposit\b/iu },
  { category: 'Welcome-бонус', regex: /\bwelcome\s+(?:bonus|offer|package|reward|rewards)\b/iu },
  { category: 'Бонус за регистрацию', regex: /\b(?:sign[-\s]?up|signup|registration)\s+(?:bonus|offer|reward|rewards)\b/iu },
  { category: 'Новый пользователь', regex: /(?<![\p{L}\p{N}])нов(?:ый|ая|ое|ые|ого|ой|ых|ому|ым|ыми|ую)\s+(?:пользовател\p{L}*|игрок\p{L}*|клиент\p{L}*)/iu },
  { category: 'Первый депозит', regex: /(?<![\p{L}\p{N}])(?:перв(?:ый|ого|ому|ым|ом|ую)|1[-\s]?й)\s+(?:депозит\p{L}*|пополнен\p{L}*)/iu },
  { category: 'Welcome-бонус', regex: /(?<![\p{L}\p{N}])приветственн\p{L}*\s+(?:бонус\p{L}*|предложен\p{L}*|пакет\p{L}*|наград\p{L}*)/iu },
  { category: 'Бонус за регистрацию', regex: /(?<![\p{L}\p{N}])бонус\p{L}*\s+(?:за\s+)?регистрац\p{L}*/iu },
];

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value) {
  return cleanText(value)
    .toLocaleLowerCase('en-US')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function findMatch(value) {
  const text = cleanText(value);
  for (const matcher of MATCHERS) {
    const match = matcher.regex.exec(text);
    if (match) return { category: matcher.category, phrase: cleanText(match[0]), index: match.index };
  }
  return null;
}

function canonicalUrl(value) {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname
    .replace(/^\/(?:ru|en)(?=\/)/i, '')
    .replace(/\/+$/, '') || '/';
  return url.toString();
}

function stableHash(...parts) {
  return crypto.createHash('sha256').update(parts.map(normalize).join('|')).digest('hex').slice(0, 32);
}

function extractExpiry(value) {
  const text = cleanText(value);
  const patterns = [
    /(?:ends?|expires?|valid\s+(?:until|through)|end\s+date)\s*[:\-]?\s*((?:\d{1,2}\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\w,\s:\-]*\d{4})/iu,
    /(?:до|окончание|действует\s+до)\s*[:\-]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?:\s+\d{1,2}:\d{2})?)/iu,
    /\b(20\d{2}-\d{2}-\d{2}(?:[T\s][\d:.+\-Z]+)?)\b/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return cleanText(match[1]);
  }
  return '';
}

function matchedSnippet(text, match, max = 500) {
  const cleaned = cleanText(text);
  if (cleaned.length <= max) return cleaned;
  const start = Math.max(0, (match?.index || 0) - Math.floor(max / 3));
  const snippet = cleaned.slice(start, start + max);
  return `${start ? '…' : ''}${snippet}${start + max < cleaned.length ? '…' : ''}`;
}

function explicitEvergreen(text, expiry) {
  if (expiry) return false;
  return /(?<![\p{L}\p{N}])(?:no\s+(?:expiry|end\s+date)|ongoing|permanent|always\s+available|бессроч\p{L}*|без\s+срока)(?![\p{L}\p{N}])/iu.test(cleanText(text));
}

function createPromoEvent(options) {
  const title = cleanText(options.title);
  const text = cleanText(options.text || title);
  const match = findMatch(`${title} ${text}`);
  if (!match) return null;
  const url = new URL(options.url).toString();
  const canonical = canonicalUrl(url);
  const expiry = cleanText(options.expiry || extractExpiry(text));
  const evergreen = Boolean(options.evergreen || explicitEvergreen(text, expiry));
  const providerId = cleanText(options.providerId || '');
  const id = providerId
    ? `${options.source}:${providerId}`
    : `${options.source}:${stableHash(canonical || title, title, expiry)}`;
  const casinoKey = normalize(options.casino.name);
  const fallbackKey = `title:${casinoKey}:${stableHash(title, expiry)}`;
  const matchKeys = [
    canonical && `url:${canonical}`,
    providerId && `campaign:${casinoKey}:${normalize(providerId)}`,
    fallbackKey,
  ].filter(Boolean);

  return {
    source: options.source,
    id,
    title: title || 'Промоакция',
    url,
    casino: options.casino.name,
    emoji: options.casino.emoji,
    evergreen,
    publishedAt: cleanText(options.publishedAt || ''),
    fields: [
      ['Казино', options.casino.name],
      ['Категория', match.category],
      ['Бонус / условия', matchedSnippet(text, match)],
      ['Срок действия', expiry || (evergreen ? 'Бессрочно' : 'Не указан')],
      ['Совпавшая фраза', match.phrase],
    ],
    matchKeys,
  };
}

module.exports = {
  MATCHERS,
  canonicalUrl,
  cleanText,
  createPromoEvent,
  extractExpiry,
  findMatch,
  normalize,
  stableHash,
};
