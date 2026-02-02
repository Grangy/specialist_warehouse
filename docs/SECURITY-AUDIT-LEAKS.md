# Аудит безопасности: утечки данных и улучшения

## Критические находки (исправлено)

### 1. Yandex OAuth в репозитории
- **Было:** В `yandex.js` захардкожены `CLIENT_ID` и `CLIENT_SECRET` (видны в git).
- **Исправлено:** Значения читаются из переменных окружения `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`. В `.env.example` добавлены комментарии без реальных значений. Локально нужно создать `.env` и задать ключи (файл `.env` в `.gitignore`).

### 2. Утечка деталей ошибок в API (production)
- **Было:** В ответах 500 и части 400 клиенту отдавались `error.message` и `details`, что может раскрывать внутреннюю структуру и пути.
- **Исправлено:** Поле `details` и текст ошибки из исключений отдаются только при `NODE_ENV === 'development'`. В production клиент получает только общее сообщение (например, «Ошибка сервера при получении заказов»).

Затронутые маршруты:
- `GET /api/statistics/ranking`, `overview`, `top`
- `POST /api/shipments/sync-1c`, `ready-for-export`
- `GET /api/ranking/stats`
- `POST /api/shipments/[id]/refresh`, `mark-exported-1c`
- `POST /api/auth/login` — в production при ошибках валидации возвращаются общие фразы («Неверный формат логина» / «Неверный формат пароля») без деталей правил валидации.

## Ужесточение безопасности

- **Permissions-Policy:** В `next.config.js` добавлен заголовок `Permissions-Policy` (camera, microphone, geolocation, interest-cohort отключены).
- **Логин:** Stack trace по ошибке входа выводится в консоль только в development.

## Что уже в порядке

- `.gitignore`: `.env`, `.env*.local`, `token.json`, `backups/`, `*.pem` — не коммитятся.
- `next.config.js`: заголовки X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, HSTS в production.
- Пароли: только хэш в БД, проверка через bcrypt.
- Сессии: токен в httpOnly cookie, без логирования в ответах.

## Рекомендации

1. **Секреты:** Никогда не коммитить реальные значения в `.env` или в код. Использовать `.env.example` только как шаблон без секретов.
2. **После утечки Yandex-ключей:** Если старые `CLIENT_ID`/`CLIENT_SECRET` могли попасть в историю git или наружу — перевыпустить приложение в [OAuth Яндекса](https://oauth.yandex.ru/) и задать новые значения в `.env` на сервере.
3. **Скрипты:** Скрипты в `scripts/` используют `process.env.DATABASE_URL` — корректно, секрет только в окружении.
4. **Логи:** Не логировать пароли, токены и полные URL с секретами. Уже соблюдается.
