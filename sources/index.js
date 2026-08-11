'use strict';

const { CASINOS } = require('../lib/catalog');
const { telegramChannel } = require('./telegram-channel');

const adapters = [
  require('./stake-challenges'),
  require('./roobet-promotions'),
  telegramChannel({ name: 'telegram-rakebit', channel: 'RakeBit_Channel', casino: CASINOS.rakebit }),
  telegramChannel({ name: 'telegram-rainbet', channel: 'Rainbetcom', casino: CASINOS.rainbet }),
  require('./shuffle-promotions'),
  require('./bcgame-promotions'),
  require('./gamdom-promotions'),
  require('./winna-vip'),
  require('./thrill-casino'),
  require('./rollbit-promotions'),
  require('./shuffle-welcome-help'),
];

// This page redirects to authentication and is deliberately not scraped with
// personal cookies. Keeping it explicit prevents silent false coverage.
adapters.disabledSources = [{
  name: 'roobet-rewards',
  pageUrl: 'https://roobet.com/rewards',
  reason: 'requires-authentication',
}];

module.exports = adapters;
