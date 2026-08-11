'use strict';

const DEFAULT_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 30000);
const USER_AGENT = 'Mozilla/5.0 (compatible; NotifCryptoCasinoBot/1.0; +https://github.com/)';

async function fetchResponse(url, options = {}) {
  let lastError;
  const attempts = options.attempts || 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        ...options,
        headers: {
          'user-agent': USER_AGENT,
          accept: options.accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchText(url, options = {}) {
  const response = await fetchResponse(url, options);
  const text = await response.text();
  const minimumBytes = options.minimumBytes ?? 200;
  if (text.length < minimumBytes) throw new Error(`Unexpectedly short response (${text.length} bytes) for ${url}`);
  return { text, finalUrl: response.url || url, headers: response.headers };
}

async function fetchJson(url, options = {}) {
  const response = await fetchResponse(url, { ...options, accept: 'application/json' });
  try {
    return await response.json();
  } catch {
    throw new Error(`Malformed JSON from ${url}`);
  }
}

module.exports = { fetchJson, fetchResponse, fetchText, USER_AGENT };
