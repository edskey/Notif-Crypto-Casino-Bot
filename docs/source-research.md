# Исследование источников

Проверено 11 уникальных адресов из задания (повтор `winna.com/challenges` посчитан один раз). Десять доступны публично. `https://roobet.com/rewards` перенаправляет на авторизацию и намеренно исключён: бот не использует пароль, cookies или личную сессию.

Дополнительно в ежедневную сводку включена официальная постоянная страница Shuffle о первом депозите.

| Источник | Метод | Стабильный ID | Ограничение |
|---|---|---|---|
| Stake Challenges | публичные SvelteKit/GraphQL данные в DOM, Chromium | challenge UUID | Cloudflare может остановить headless runner; источник падает явно и не блокирует остальные |
| Roobet Promotions | SSR, Chromium fallback | detail URL | Rewards требует входа |
| RakeBit / Rainbet | публичный Telegram preview | `channel/post_id` | только видимые новые посты после baseline |
| Shuffle Promotions | `__NEXT_DATA__` | promotion id/slug | схема внутреннего JSON может измениться |
| BC.Game Promotions | публичный DOM, Chromium | detail URL / semantic hash | JS/Cloudflare; SEO/footer исключается |
| Gamdom Promotions | SSR, Chromium fallback | detail URL | пагинация не нужна для realtime: новые карточки появляются в начале |
| Winna VIP | Chromium + открытие VIP modal | link / semantic hash | проверяется наличие modal и reward cards |
| Thrill Casino | Chromium, `casino-banner` | `/promo/...` URL | JS-rendered carousel; headless-IP иногда не получает banner API |
| Rollbit Promotions | официальный Ghost RSS тега | RSS guid | TTL ленты около 60 минут не влияет на 5-минутный опрос страницы, но публикация может появиться с задержкой RSS |
| Shuffle Help | публичная official help article | article id | только ежедневная/недельная evergreen-сводка |

Пять страниц требуют или могут потребовать полноценный render: Stake, Roobet Promotions, BC.Game, Winna и Thrill. Gamdom обычно читается из SSR, но имеет browser fallback.

Scheduled poll запускает каждый адаптер независимо и отправляет успешные payload до итогового статуса workflow. Поэтому Cloudflare/CAPTCHA на Stake или временно пустой banner API Thrill дают видимую ошибку Actions, но не задерживают другие казино. Cookies и обход CAPTCHA не используются.

Ключевые фразы проверяются только внутри поста/карточки/детали. Одиночные слова `new`, `first`, `deposit`, `bonus` не считаются совпадением. Таймеры, число участников и время текущего опроса не входят в ID.
