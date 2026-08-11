'use strict';

const cheerio = require('cheerio');
const { fetchText } = require('../lib/network');
const { cleanText, createPromoEvent } = require('../lib/promo');

function telegramChannel({ name, channel, casino }) {
  const previewUrl = `https://t.me/s/${channel}`;
  return {
    name,
    pageUrl: `https://t.me/${channel}`,
    async collect() {
      const { text: html } = await fetchText(previewUrl, { minimumBytes: 1000 });
      const $ = cheerio.load(html);
      const messages = $('.tgme_widget_message');
      if (!messages.length) throw new Error(`${name}: Telegram preview returned no messages`);
      const events = [];
      messages.each((_, node) => {
        const message = $(node);
        const providerId = cleanText(message.attr('data-post'));
        const body = cleanText(message.find('.tgme_widget_message_text').text());
        const url = message.find('.tgme_widget_message_date').attr('href') || `https://t.me/${providerId}`;
        const publishedAt = message.find('time').attr('datetime') || '';
        const title = body.split(/[.!?\n]/u)[0].slice(0, 180) || `Публикация ${providerId}`;
        const event = createPromoEvent({ source: name, casino, providerId, title, text: body, url, publishedAt });
        if (event) events.push(event);
      });
      return events;
    },
  };
}

module.exports = { telegramChannel };
