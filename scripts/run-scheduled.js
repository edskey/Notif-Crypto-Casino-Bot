'use strict';

const adapters = require('../sources');
const { closeBrowser } = require('../lib/browser');
const { collect } = require('./collect');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function postPayload(payload) {
  const url = required('CASINO_NOTIF_VERCEL_CHECK_URL');
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('CASINO_NOTIF_VERCEL_CHECK_URL must be a valid URL'); }
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/api/check' || parsed.search || parsed.hash) {
    throw new Error('CASINO_NOTIF_VERCEL_CHECK_URL must be HTTPS and end with /api/check');
  }
  const secret = required('CASINO_NOTIF_CHECK_SECRET');
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await response.text();
      let result;
      try { result = JSON.parse(body); } catch { result = null; }
      if (response.status === 202 && result?.skipped === 'already_running' && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
        continue;
      }
      if (!response.ok || result?.skipped === 'already_running') {
        throw new Error(`Vercel endpoint returned ${response.status}: ${body.slice(0, 500)}`);
      }
      process.stderr.write(`Endpoint accepted ${payload.mode} payload for ${payload.sources.join(', ')}: ${body}\n`);
      return;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function runPoll() {
  const failures = [];
  const pollAdapters = adapters.filter((adapter) => !adapter.modes || adapter.modes.includes('poll'));
  for (const adapter of pollAdapters) {
    process.env.SOURCE_NAMES = adapter.name;
    try {
      await postPayload(await collect('poll'));
    } catch (error) {
      failures.push(`${adapter.name}: ${error.message}`);
      process.stderr.write(`[${adapter.name}] FAILED: ${error.stack || error.message}\n`);
      await closeBrowser().catch(() => {});
    }
  }
  delete process.env.SOURCE_NAMES;
  if (failures.length) throw new Error(`Source failures after successful adapters were posted:\n${failures.join('\n')}`);
}

async function runSummary() {
  delete process.env.SOURCE_NAMES;
  await postPayload(await collect('summary'));
}

async function main() {
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
  const mode = modeArg?.split('=')[1] || 'poll';
  if (mode === 'poll') await runPoll();
  else if (mode === 'summary') await runSummary();
  else if (mode === 'welcome') await postPayload({ mode: 'welcome', sources: [], events: [] });
  else throw new Error(`Unsupported mode: ${mode}`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }).finally(closeBrowser);
}

module.exports = { main, postPayload, runPoll, runSummary };
