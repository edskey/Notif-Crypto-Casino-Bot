const adapters = require('../sources');
const { closeBrowser } = require('../lib/browser');

const MAX_EVENTS = 500;
const ADAPTER_TIMEOUT_MS = Number(process.env.ADAPTER_TIMEOUT_MS || 90000);

function validateEvent(event, sourceName) {
  if (!event || event.source !== sourceName || !event.id || !event.title || !event.url) {
    throw new Error(`Invalid event returned by ${sourceName}`);
  }
  return {
    source: String(event.source).slice(0, 100),
    id: String(event.id).slice(0, 1000),
    title: String(event.title).slice(0, 300),
    url: String(event.url).slice(0, 2000),
    fields: Array.isArray(event.fields)
      ? event.fields.slice(0, 30).map(([label, value]) => [String(label).slice(0, 100), String(value).slice(0, 500)])
      : [],
    matchKeys: Array.isArray(event.matchKeys)
      ? [...new Set(event.matchKeys.map(String).filter(Boolean))].slice(0, 20).map((key) => key.slice(0, 500))
      : [],
    casino: String(event.casino || '').slice(0, 100),
    emoji: String(event.emoji || '').slice(0, 20),
    evergreen: Boolean(event.evergreen),
    publishedAt: String(event.publishedAt || '').slice(0, 100),
  };
}

function summaryMetadata(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tbilisi', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    summaryKey: `${value('year')}-${value('month')}-${value('day')}`,
    summaryPeriod: 'weekly',
  };
}

async function collect(mode = 'poll') {
  const selected = new Set(String(process.env.SOURCE_NAMES || '').split(',').map((name) => name.trim()).filter(Boolean));
  const activeAdapters = adapters.filter((adapter) =>
    (adapter.modes ? adapter.modes.includes(mode) : mode === 'poll') && (!selected.size || selected.has(adapter.name))
  );
  if (selected.size && activeAdapters.length !== selected.size) {
    const found = new Set(activeAdapters.map((adapter) => adapter.name));
    const missing = [...selected].filter((name) => !found.has(name));
    throw new Error(`Unknown or inactive source adapters: ${missing.join(', ')}`);
  }
  const results = await Promise.all(activeAdapters.map(async (adapter) => {
    if (!adapter?.name || typeof adapter.collect !== 'function') throw new Error('Invalid source adapter');
    process.stderr.write(`[${adapter.name}] collecting\n`);
    let timer;
    const events = await Promise.race([
      adapter.collect(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${adapter.name}: exceeded ${ADAPTER_TIMEOUT_MS}ms adapter timeout`)), ADAPTER_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!Array.isArray(events)) throw new Error(`${adapter.name} did not return an array`);
    process.stderr.write(`[${adapter.name}] collected ${events.length} matching events\n`);
    return events.map((event) => validateEvent(event, adapter.name));
  }));
  const allEvents = results.flat();
  const events = (mode === 'summary' ? allEvents.filter((event) => event.evergreen) : allEvents).slice(0, MAX_EVENTS);
  const payload = {
    mode,
    sources: activeAdapters.map((adapter) => adapter.name),
    events,
    disabledSources: adapters.disabledSources,
    ...(mode === 'summary' ? summaryMetadata() : {}),
  };
  return payload;
}

async function main() {
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
  const mode = modeArg?.split('=')[1] || 'poll';
  if (!['poll', 'summary'].includes(mode)) throw new Error(`Unsupported mode: ${mode}`);
  const result = await collect(mode);
  process.stderr.write(`Collected ${result.events.length} ${mode} events from ${result.sources.length} sources\n`);
  process.stdout.write(JSON.stringify(result));
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }).finally(closeBrowser);
}

module.exports = { collect, summaryMetadata, validateEvent };
