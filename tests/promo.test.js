'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CASINOS } = require('../lib/catalog');
const { createPromoEvent, findMatch } = require('../lib/promo');

test('matches supported English and Russian forms', () => {
  const samples = [
    'Bonus for new users',
    'Available to newly registered players',
    '100% first-time deposit bonus',
    'Claim your 1st deposit reward',
    'Welcome package',
    'Бонус для новых пользователей',
    'Предложение новым игрокам',
    'Бонус за первый депозит',
    'Приветственный бонус',
  ];
  samples.forEach((sample) => assert(findMatch(sample), sample));
});
test('does not match broad standalone words or Stake first-to-hit challenges', () => {
  const samples = [
    'New tournament',
    'First to hit 1000x wins',
    'Deposit crypto now',
    'Weekly bonus',
    'Новый турнир',
    'Первый участник получает приз',
  ];
  samples.forEach((sample) => assert.equal(findMatch(sample), null, sample));
});

test('countdown changes do not change the stable event id', () => {
  const base = {
    source: 'stake-challenges',
    casino: CASINOS.stake,
    title: 'New player welcome offer',
    url: 'https://stake.com/casino/challenges/welcome',
  };
  const first = createPromoEvent({ ...base, text: 'New player welcome offer. Timer 01:00:00' });
  const second = createPromoEvent({ ...base, text: 'New player welcome offer. Timer 00:59:00' });
  assert.equal(first.id, second.id);
});

test('canonical detail URL ignores locale, query, hash, and trailing slash', () => {
  const first = createPromoEvent({
    source: 'one', casino: CASINOS.shuffle, title: 'First deposit bonus', text: 'First deposit bonus',
    url: 'https://shuffle.com/ru/promotions/welcome/?ref=abc#terms',
  });
  const second = createPromoEvent({
    source: 'two', casino: CASINOS.shuffle, title: 'First deposit bonus', text: 'First deposit bonus',
    url: 'https://shuffle.com/en/promotions/welcome',
  });
  assert.equal(first.matchKeys[0], second.matchKeys[0]);
});
