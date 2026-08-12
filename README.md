# Notif Crypto Casino Bot

Telegram-монитор промоакций для новых пользователей и первого депозита. Каждые 5 минут он читает публичные источники и отправляет только новые публикации. Постоянные welcome-предложения входят только в еженедельную сводку по субботам в 18:00 по Тбилиси.

## Что мониторится

- Stake 🎯 — Challenges;
- Roobet 🦘 — Promotions (`/rewards` требует входа и безопасно исключён);
- RakeBit 🐻 и Rainbet 🌧️ — текст новых Telegram-постов;
- Shuffle 🔀 — Promotions и официальная бессрочная first-deposit статья;
- BC.Game 🐊 — промо-карточки;
- Gamdom 👑 — Promotions;
- Winna 🏆 — VIP popup на Challenges;
- Thrill ⚡ — центральные casino banners;
- Rollbit 🎲 — Promotions RSS/tag.

В исходном списке 11 уникальных страниц: 10 публичных и 1 закрытая авторизацией. Детали методов и ограничений находятся в [docs/source-research.md](docs/source-research.md).

## Правила совпадения

Поддерживаются английские и русские формы:

- `new user/player/customer`, `newly registered user`;
- `first deposit`, `first-time deposit`, `1st deposit`;
- `welcome bonus/offer/package/reward`, signup/registration bonus;
- формы «новый пользователь/игрок/клиент», «первый депозит/пополнение», «приветственный бонус», «бонус за регистрацию».

Одиночные `new`, `first`, `deposit` или `bonus` не подходят. Фраза должна находиться в конкретном посте, промо-карточке или её detail-блоке, а не в SEO/footer. Новизна определяется provider ID или канонической detail-ссылкой; таймер и динамические числа в ID не участвуют.

## Поток данных

`GitHub Actions -> source adapters -> normalized events -> Vercel /api/check -> Upstash Redis -> Telegram`

- Первая успешная проверка каждого source записывает baseline и отправляет 0 сообщений, включая пустую baseline.
- Каждая новая срочная акция отправляется отдельно.
- Бессрочная акция не отправляется немедленно, а попадает в ближайшую сводку.
- Каждый успешный poll обновляет Redis-кэш бессрочных предложений своего source. Сводка использует этот кэш, поэтому временно недоступная страница не стирает уже известный welcome-бонус.
- Межисточниковые дубли подавляются по campaign ID, каноническому URL и резервному semantic key.
- После каждого принятого Telegram-сообщения состояние немедленно сохраняется. При сбое продолжение повторяется со следующего неотправленного события.
- Повреждённая/неожиданно пустая страница завершает workflow ошибкой и не стирает состояние.
- Scheduled runner изолирует источники: успешные payload обрабатываются, даже если другой сайт упёрся в Cloudflare. Workflow всё равно завершится ошибкой с именем проблемной страницы.

## Локальная проверка

Требуется Node.js 20+.

```bash
pnpm install --frozen-lockfile
pnpm test
node scripts/collect.js --mode=poll > /tmp/casino-events.json
```

Collector только читает публичные страницы и печатает JSON. Он не знает Telegram token, не обращается к Redis и ничего не отправляет. Для browser-источников нужен Chromium: `npx playwright install chromium` или `CHROME_EXECUTABLE_PATH`.

Для диагностики одного адаптера можно задать `SOURCE_NAMES=stake-challenges`; несколько имён разделяются запятой. Каждый адаптер ограничен `ADAPTER_TIMEOUT_MS` (90 секунд по умолчанию), поэтому один защищённый сайт не может повесить весь workflow.

## Vercel

Создайте отдельный Vercel-проект из этого репозитория и добавьте Environment Variables:

- `CASINO_NOTIF_TELEGRAM_BOT_TOKEN`;
- `CASINO_NOTIF_TELEGRAM_CHAT_ID` — обычно `-100...` или публичный `@channel`;
- `CASINO_NOTIF_CHECK_SECRET`;
- `CASINO_NOTIF_UPSTASH_REDIS_REST_URL` — именно HTTPS REST URL;
- `CASINO_NOTIF_UPSTASH_REDIS_REST_TOKEN`;
- `CASINO_NOTIF_STATE_TTL_SECONDS` — необязательно, по умолчанию 90 дней.

Добавьте бота администратором Telegram-канала с правом публикации. GET на production URL `/api/check` должен вернуть `{"error":"method_not_allowed"}` — это подтверждает наличие route. Реальный POST вручную не нужен: первый scheduled poll безопасно создаст baseline.

## GitHub Actions

Добавьте Actions Secrets:

- `CASINO_NOTIF_VERCEL_CHECK_URL` — полный production URL, обязательно `https://.../api/check`;
- `CASINO_NOTIF_CHECK_SECRET` — то же значение, что в Vercel.

Workflow запускает poll по cron `*/5 * * * *`. Еженедельная сводка запускается по субботам в `14:00 UTC`, что соответствует `18:00 Asia/Tbilisi`. GitHub cron может задерживаться на несколько минут — дедупликация не зависит от точного времени.

Важно: приватный репозиторий с Chromium каждые 5 минут расходует GitHub Actions minutes и, вероятно, превысит бесплатную месячную квоту. Для непрерывной бесплатной/дешёвой работы практичнее self-hosted runner или небольшой VPS; логика бота от этого не меняется.

## Безопасность и диагностика

- Секреты не хранятся в git и передаются endpoint только через Bearer header.
- Redis namespace: `notif-crypto-casino-bot`, поэтому состояние не пересекается с другими ботами.
- `401 unauthorized` означает несовпадающий `CHECK_SECRET`.
- `already_running` означает активную короткую Redis lock; дождитесь её истечения.
- `Telegram: chat not found` — неверный channel ID или бот не добавлен в канал.
- Ошибка конкретного source должна быть видна в Actions. Не превращайте её в пустой список вручную.
- Stake иногда показывает Cloudflare verification headless-runner’у, а Thrill иногда не отдаёт banner API. Бот не обходит CAPTCHA и не переносит cookies; остальные источники продолжают работать независимо.
