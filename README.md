# 🏭 Система управления складом (Warehouse Management System)

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-14.0-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)
![Prisma](https://img.shields.io/badge/Prisma-6.19-2D3748)
![SQLite](https://img.shields.io/badge/SQLite-3.0-003B57)

**Современная система управления складскими операциями с разделением ролей, PWA поддержкой и автоматическим разбиением заказов на задания**

[🚀 Быстрый старт](#-быстрый-старт) • [📚 Документация](#-документация) • [🔐 Авторизация](#-авторизация) • [📡 API Endpoints](#-api-endpoints) • [👥 Роли пользователей](#-роли-пользователей)

</div>

---

## 📋 Содержание

- [✨ Особенности](#-особенности)
- [🛠 Технологический стек](#-технологический-стек)
- [🚀 Быстрый старт](#-быстрый-старт)
- [📁 Структура проекта](#-структура-проекта)
- [👥 Роли пользователей](#-роли-пользователей)
- [📡 API Endpoints](#-api-endpoints)
  - [🔐 Авторизация](#-авторизация)
  - [📦 Заказы (Shipments)](#-заказы-shipments)
  - [👤 Пользователи (Users)](#-пользователи-users)
- [💾 База данных](#-база-данных)
- [📱 PWA (Progressive Web App)](#-pwa-progressive-web-app)
- [🔧 Разработка](#-разработка)
- [📝 Примеры использования](#-примеры-использования)
- [🤝 Вклад в проект](#-вклад-в-проект)
- [📄 Лицензия](#-лицензия)

---

## ✨ Особенности

### 🎯 Основной функционал

- ✅ **Система ролей** - Три уровня доступа: администратор, сборщик, проверяющий
- ✅ **Управление заказами** - Полный цикл от создания до отправки в офис
- ✅ **Автоматическое разбиение** - Заказы автоматически разбиваются на задания по складам (макс. 35 наименований на задание)
- ✅ **Блокировка заказов** - Защита от одновременной работы нескольких пользователей
- ✅ **PWA поддержка** - Установка как приложение на мобильные устройства
- ✅ **Адаптивный дизайн** - Оптимизация для мобильных устройств и планшетов
- ✅ **Реальное время** - Отслеживание прогресса выполнения заказов
- ✅ **Админ-панель** - Управление пользователями и просмотр статистики

### 🎨 UI/UX

- 📱 **Мобильная оптимизация** - Удобный интерфейс для работы на складе
- 🎯 **Интуитивная навигация** - Простое и понятное управление
- 🔔 **Уведомления** - Toast-уведомления для важных событий
- 📊 **Прогресс-бары** - Визуальное отображение прогресса выполнения
- 🎭 **Модальные окна** - Детальная информация о заказах и товарах

---

## 🛠 Технологический стек

### Frontend
- **Next.js 14** - React фреймворк с App Router
- **TypeScript** - Типизированный JavaScript
- **Tailwind CSS** - Utility-first CSS фреймворк
- **React Hooks** - Управление состоянием

### Backend
- **Next.js API Routes** - Серверные API endpoints
- **Prisma ORM** - Работа с базой данных
- **SQLite** - Легковесная база данных
- **bcryptjs** - Хеширование паролей

### Инфраструктура
- **PWA** - Progressive Web App поддержка
- **Service Worker** - Офлайн-кэширование
- **Cookie-based Auth** - Аутентификация через сессии

---

## 🚀 Быстрый старт

### Предварительные требования

- Node.js 18+ 
- npm или yarn
- Git

### Установка

1. **Клонируйте репозиторий**
   ```bash
   git clone https://github.com/Grangy/specialist_warehouse.git
   cd specialist_warehouse
   ```

2. **Установите зависимости**
   ```bash
   npm install
   ```

3. **Настройте переменные окружения**
   ```bash
   cp .env.example .env
   ```
   
   Отредактируйте `.env` файл при необходимости:
   ```env
   DATABASE_URL="file:./prisma/dev.db"
   ```

4. **Примените миграции базы данных**
   ```bash
   npx prisma migrate deploy
   ```

5. **Сгенерируйте Prisma Client**
   ```bash
   npx prisma generate
   ```

6. **Заполните базу данных тестовыми данными**
   ```bash
   npm run db:seed
   ```

7. **Запустите сервер разработки**
   ```bash
   npm run dev
   ```

8. **Откройте в браузере**
   ```
   http://localhost:3000
   ```

### Тестовые пользователи

После выполнения `npm run db:seed` доступны следующие пользователи:

| Роль | Логин | Пароль | Доступ |
|------|-------|--------|--------|
| 👑 Администратор | `admin` | `admin123` | Полный доступ |
| 📦 Сборщик | `collector` | `collector123` | Только "Новые" заказы |
| ✅ Проверяющий | `checker` | `checker123` | "Новые" и "Подтверждения" |

---

## 📁 Структура проекта

```
specialist_warehouse/
├── prisma/                 # Prisma схема и миграции
│   ├── schema.prisma      # Схема базы данных
│   ├── seed.ts            # Начальные данные
│   └── migrations/        # Миграции БД
├── src/
│   ├── app/               # Next.js App Router
│   │   ├── api/           # API endpoints
│   │   ├── admin/         # Админ-панель
│   │   ├── login/         # Страница входа
│   │   └── page.tsx       # Главная страница
│   ├── components/        # React компоненты
│   │   ├── admin/         # Компоненты админки
│   │   ├── layout/        # Компоненты layout
│   │   ├── modals/        # Модальные окна
│   │   └── shipments/     # Компоненты заказов
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Утилиты и библиотеки
│   │   ├── api/           # API клиенты
│   │   └── utils/         # Вспомогательные функции
│   └── types/             # TypeScript типы
├── public/                # Статические файлы
│   ├── icons/             # Иконки PWA
│   ├── manifest.json      # PWA манифест
│   └── sw.js              # Service Worker
├── scripts/               # Вспомогательные скрипты
└── README.md              # Документация
```

---

## 👥 Роли пользователей

### 👑 Администратор (`admin`)

**Полный доступ ко всем функциям:**
- ✅ Создание и управление пользователями
- ✅ Создание заказов
- ✅ Просмотр всех заказов (все статусы)
- ✅ Сборка и подтверждение заказов
- ✅ Просмотр статистики и завершенных заказов
- ✅ Кнопки "Собрать все" и "Подтвердить все" для быстрой обработки

### 📦 Сборщик (`collector`)

**Доступ только к разделу "Новые":**
- ✅ Просмотр новых заказов
- ✅ Блокировка/разблокировка заказов
- ✅ Сборка товаров
- ✅ Перевод заказов в статус "Ожидание подтверждения"

### ✅ Проверяющий (`checker`)

**Доступ к разделам "Новые" и "Подтверждения":**
- ✅ Просмотр новых заказов
- ✅ Просмотр заказов, ожидающих подтверждения
- ✅ Подтверждение собранных заказов
- ✅ Перевод заказов в статус "Обработан"

---

## 📡 API Endpoints

### Базовый URL

```
http://localhost:3000/api
```

> **Примечание:** Все endpoints (кроме `/auth/login` и `/auth/session`) требуют авторизации через cookie `session_token`.

---

### 🔐 Авторизация

#### `POST /api/auth/login`

Авторизация пользователя в системе.

**Запрос:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "login": "admin",
    "password": "admin123"
  }' \
  -c cookies.txt
```

**Ответ (200 OK):**
```json
{
  "success": true,
  "user": {
    "id": "cmirmu1ir0000ry7cierltrf8",
    "login": "admin",
    "name": "Администратор",
    "role": "admin"
  }
}
```

**Ошибки:**
- `400` - Логин и пароль обязательны
- `401` - Неверный логин или пароль
- `500` - Ошибка сервера

---

#### `POST /api/auth/logout`

Выход из системы (удаление сессии).

**Запрос:**
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -b cookies.txt
```

**Ответ (200 OK):**
```json
{
  "success": true
}
```

---

#### `GET /api/auth/session`

Проверка текущей сессии пользователя.

**Запрос:**
```bash
curl -X GET http://localhost:3000/api/auth/session \
  -b cookies.txt
```

**Ответ (200 OK):**
```json
{
  "user": {
    "id": "cmirmu1ir0000ry7cierltrf8",
    "login": "admin",
    "name": "Администратор",
    "role": "admin"
  }
}
```

Если не авторизован:
```json
{
  "user": null
}
```

---

### 📦 Заказы (Shipments)

#### `GET /api/shipments`

Получение списка заказов с фильтрацией по статусу.

**Права доступа:**
- `admin` - все статусы
- `collector` - только `new`
- `checker` - `new` и `pending_confirmation`

**Параметры запроса:**
- `status` (опционально) - Фильтр по статусу: `new`, `pending_confirmation`, `processed`

**Запрос:**
```bash
# Все доступные заказы
curl -X GET http://localhost:3000/api/shipments \
  -b cookies.txt

# Заказы со статусом "new"
curl -X GET "http://localhost:3000/api/shipments?status=new" \
  -b cookies.txt
```

**Ответ (200 OK):**
```json
[
  {
    "id": "cmirmu1ir0000ry7cierltrf8",
    "shipment_number": "РН-000123",
    "warehouse": "Склад 1",
    "status": "new",
    "items_count": 10,
    "total_qty": 100,
    "tasks_progress": {
      "confirmed": 0,
      "total": 4
    },
    "lines": [
      {
        "sku": "SKU-001",
        "name": "Товар 1",
        "qty": 20,
        "collected_qty": null,
        "checked": false
      }
    ]
  }
]
```

**Ошибки:**
- `401` - Требуется авторизация
- `403` - Нет доступа к этому статусу
- `500` - Ошибка сервера

---

#### `POST /api/shipments`

Создание нового заказа с автоматическим разбиением на задания.

**Права доступа:** `admin`

**Логика разбиения:**
- Заказы автоматически разбиваются на задания по складам
- Максимум 35 наименований на одно задание
- Если на складе больше 35 наименований, создается несколько заданий

**Запрос:**
```bash
curl -X POST http://localhost:3000/api/shipments \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "number": "РН-000123",
    "customerName": "ООО Компания",
    "destination": "Основной склад",
    "itemsCount": 3,
    "totalQty": 50,
    "weight": 150.5,
    "comment": "Срочный заказ",
    "businessRegion": "Москва",
    "lines": [
      {
        "sku": "SKU-001",
        "name": "Товар 1",
        "qty": 20,
        "uom": "шт",
        "location": "Стеллаж A1 / Полка 1",
        "warehouse": "Склад 1"
      },
      {
        "sku": "SKU-002",
        "name": "Товар 2",
        "qty": 15,
        "uom": "шт",
        "location": "Стеллаж A2 / Полка 2",
        "warehouse": "Склад 2"
      }
    ]
  }'
```

**Ответ (201 Created):**
```json
{
  "success": true,
  "message": "Заказ успешно создан",
  "shipment": {
    "id": "cmirmu1ir0000ry7cierltrf8",
    "number": "РН-000123",
    "tasks_count": 2,
    "tasks": [
      {
        "id": "task1",
        "warehouse": "Склад 1",
        "items_count": 1,
        "status": "new"
      },
      {
        "id": "task2",
        "warehouse": "Склад 2",
        "items_count": 1,
        "status": "new"
      }
    ]
  }
}
```

**Ошибки:**
- `400` - Необходимо указать: number, customerName, destination, lines
- `401` - Требуется авторизация
- `403` - Недостаточно прав доступа
- `409` - Заказ с таким номером уже существует
- `500` - Ошибка сервера

---

#### `POST /api/shipments/[id]/lock`

Блокировка заказа (взятие в работу).

**Права доступа:** все авторизованные пользователи

**Запрос:**
```bash
curl -X POST http://localhost:3000/api/shipments/cmirmu1ir0000ry7cierltrf8/lock \
  -b cookies.txt
```

**Ответ (200 OK):**
```json
{
  "success": true
}
```

**Ошибки:**
- `401` - Требуется авторизация
- `404` - Заказ не найден
- `409` - Заказ уже заблокирован другим пользователем
- `500` - Ошибка сервера

**Примечания:**
- Блокировка автоматически снимается через 30 минут
- Пользователь может заблокировать только незаблокированные заказы или свои собственные

---

#### `POST /api/shipments/[id]/unlock`

Разблокировка заказа.

**Права доступа:** все авторизованные пользователи

**Запрос:**
```bash
curl -X POST http://localhost:3000/api/shipments/cmirmu1ir0000ry7cierltrf8/unlock \
  -b cookies.txt
```

**Ответ (200 OK):**
```json
{
  "success": true
}
```

**Ошибки:**
- `401` - Требуется авторизация
- `403` - Заказ заблокирован другим пользователем
- `404` - Заказ не найден
- `500` - Ошибка сервера

---

#### `POST /api/shipments/[id]/pending_confirmation`

Перевод заказа в статус "ожидание подтверждения" (после сборки).

**Права доступа:** `admin`, `collector`

**Запрос:**
```bash
curl -X POST http://localhost:3000/api/shipments/cmirmu1ir0000ry7cierltrf8/pending_confirmation \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "lines": [
      {
        "sku": "SKU-001",
        "collected_qty": 20
      },
      {
        "sku": "SKU-002",
        "collected_qty": 15
      }
    ]
  }'
```

**Ответ (200 OK):**
```json
{
  "success": true,
  "message": "Заказ успешно переведен в статус ожидания подтверждения",
  "shipment": {
    "id": "cmirmu1ir0000ry7cierltrf8",
    "number": "РН-000123",
    "status": "pending_confirmation",
    "collector_name": "Сборщик"
  }
}
```

**Ошибки:**
- `400` - Заказ должен быть в статусе "новый"
- `401` - Требуется авторизация
- `403` - Недостаточно прав доступа
- `404` - Заказ не найден
- `500` - Ошибка сервера

**Примечания:**
- Имя сборщика автоматически берется из текущей сессии
- Статус заказа меняется с `new` на `pending_confirmation`

---

#### `POST /api/shipments/[id]/confirm`

Подтверждение заказа проверяющим (перевод в статус "обработан").

**Права доступа:** `admin`, `checker`

**Особенности:**
- При подтверждении последнего задания родительского заказа, весь заказ отправляется в офис
- Возвращает `all_tasks_confirmed: true` и `final_order_data` если все задания подтверждены

**Запрос:**
```bash
curl -X POST http://localhost:3000/api/shipments/cmirmu1ir0000ry7cierltrf8/confirm \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "lines": [
      {
        "sku": "SKU-001",
        "collected_qty": 20,
        "checked": true
      },
      {
        "sku": "SKU-002",
        "collected_qty": 15,
        "checked": true
      }
    ]
  }'
```

**Ответ (200 OK):**
```json
{
  "success": true,
  "message": "Задание подтверждено. Все задания заказа подтверждены - заказ отправлен в офис",
  "shipment_number": "РН-000123",
  "all_tasks_confirmed": true,
  "tasks_progress": {
    "confirmed": 4,
    "total": 4
  },
  "final_order_data": {
    "number": "РН-000123",
    "customer_name": "ООО Компания",
    "status": "processed",
    "tasks_count": 4,
    "items_count": 100,
    "lines": [...],
    "tasks": [...]
  },
  "task": {
    "id": "task1",
    "warehouse": "Склад 1",
    "status": "processed"
  }
}
```

**Ошибки:**
- `400` - Заказ не находится в статусе ожидания подтверждения
- `401` - Требуется авторизация
- `403` - Недостаточно прав доступа
- `404` - Заказ не найден
- `500` - Ошибка сервера

**Примечания:**
- Статус заказа меняется с `pending_confirmation` на `processed`
- Поле `checked` автоматически устанавливается в `true`, если не указано
- При подтверждении всех заданий родительского заказа, возвращается `final_order_data` с полной информацией

---

### 👤 Пользователи (Users)

#### `GET /api/users`

Получение списка всех пользователей.

**Права доступа:** `admin`

**Запрос:**
```bash
curl -X GET http://localhost:3000/api/users \
  -b cookies.txt
```

**Ответ (200 OK):**
```json
[
  {
    "id": "cmirmu1ir0000ry7cierltrf8",
    "login": "admin",
    "name": "Администратор",
    "role": "admin",
    "createdAt": "2025-12-04T16:10:32.111Z",
    "updatedAt": "2025-12-04T16:10:32.111Z"
  }
]
```

---

#### `POST /api/users`

Создание нового пользователя.

**Права доступа:** `admin`

**Запрос:**
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "login": "newuser",
    "password": "password123",
    "name": "Новый пользователь",
    "role": "collector"
  }'
```

**Ответ (201 Created):**
```json
{
  "id": "cmirmu1ir0000ry7cierltrf8",
  "login": "newuser",
  "name": "Новый пользователь",
  "role": "collector",
  "createdAt": "2025-12-04T16:10:32.111Z",
  "updatedAt": "2025-12-04T16:10:32.111Z"
}
```

**Допустимые роли:**
- `admin` - Администратор
- `collector` - Сборщик
- `checker` - Проверяющий

---

#### `PATCH /api/users/[id]`

Обновление пользователя.

**Права доступа:** `admin`

**Запрос:**
```bash
curl -X PATCH http://localhost:3000/api/users/cmirmu1ir0000ry7cierltrf8 \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name": "Обновленное имя",
    "role": "checker",
    "password": "newpassword123"
  }'
```

**Примечания:**
- Все поля опциональны
- Пароль обновляется только если указан и не пустой

---

#### `DELETE /api/users/[id]`

Удаление пользователя.

**Права доступа:** `admin`

**Запрос:**
```bash
curl -X DELETE http://localhost:3000/api/users/cmirmu1ir0000ry7cierltrf8 \
  -b cookies.txt
```

**Ошибки:**
- `400` - Нельзя удалить самого себя

---

## 💾 База данных

### Схема базы данных

Проект использует **SQLite** с **Prisma ORM**. Основные модели:

- **User** - Пользователи системы
- **Shipment** - Заказы
- **ShipmentLine** - Позиции заказа
- **ShipmentTask** - Задания на сборку (создаются автоматически)
- **ShipmentTaskLine** - Позиции задания
- **ShipmentTaskLock** - Блокировки заданий
- **Session** - Сессии пользователей

### Миграции

```bash
# Применить миграции
npx prisma migrate deploy

# Создать новую миграцию
npx prisma migrate dev --name migration_name

# Просмотр БД в Prisma Studio
npx prisma studio
```

### Seed данные

```bash
npm run db:seed
```

Создает тестовых пользователей и примеры заказов.

---

## 📱 PWA (Progressive Web App)

Проект поддерживает установку как PWA приложение на мобильные устройства.

### Установка

1. Откройте приложение в браузере (Chrome/Edge/Safari)
2. Нажмите на иконку "Установить" в адресной строке
3. Приложение будет установлено на устройство

### Особенности

- ✅ Работа в офлайн режиме (кэширование статических ресурсов)
- ✅ Полноэкранный режим
- ✅ Иконка на рабочем столе
- ✅ Адаптивный дизайн для мобильных устройств

### Service Worker

Service Worker автоматически регистрируется при загрузке приложения и кэширует статические ресурсы для офлайн работы.

---

## 🔧 Разработка

### Доступные команды

```bash
# Разработка
npm run dev              # Запуск dev сервера

# База данных
npm run db:migrate       # Применить миграции
npm run db:generate      # Сгенерировать Prisma Client
npm run db:seed          # Заполнить БД тестовыми данными

# Сборка
npm run build            # Сборка production версии
npm run start            # Запуск production сервера

# Линтинг
npm run lint             # Проверка кода
```

### Структура API

API endpoints находятся в `src/app/api/`:
- `auth/` - Авторизация
- `shipments/` - Заказы
- `users/` - Пользователи

### Кастомные хуки

- `useShipments` - Управление заказами
- `useCollect` - Логика сборки
- `useConfirm` - Логика подтверждения
- `useModal` - Управление модальными окнами
- `useToast` - Уведомления

---

## 📝 Примеры использования

### Полный цикл работы с заказом

```bash
# 1. Авторизация как сборщик
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"collector","password":"collector123"}' \
  -c cookies.txt

# 2. Получение списка новых заказов
curl -X GET "http://localhost:3000/api/shipments?status=new" \
  -b cookies.txt

# 3. Блокировка заказа
curl -X POST http://localhost:3000/api/shipments/SHIPMENT_ID/lock \
  -b cookies.txt

# 4. Перевод в статус ожидания подтверждения
curl -X POST http://localhost:3000/api/shipments/SHIPMENT_ID/pending_confirmation \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"lines":[{"sku":"SKU-001","collected_qty":20}]}'

# 5. Выход и авторизация как проверяющий
curl -X POST http://localhost:3000/api/auth/logout -b cookies.txt
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"checker","password":"checker123"}' \
  -c cookies.txt

# 6. Подтверждение заказа
curl -X POST http://localhost:3000/api/shipments/SHIPMENT_ID/confirm \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"lines":[{"sku":"SKU-001","collected_qty":20,"checked":true}]}'
```

### Создание тестового заказа

Используйте скрипт для создания тестовых заказов:

```bash
# Заказ на 100 наименований (разобьется на 4 задания)
npx tsx scripts/create-test-shipment.ts

# Два тестовых заказа (100 и 20 наименований)
npx tsx scripts/create-two-test-orders.ts
```

---

## 🤝 Вклад в проект

Мы приветствуем вклад в развитие проекта! Пожалуйста:

1. Fork репозиторий
2. Создайте feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit изменения (`git commit -m 'Add some AmazingFeature'`)
4. Push в branch (`git push origin feature/AmazingFeature`)
5. Откройте Pull Request

---

## 📄 Лицензия

Этот проект является приватным и предназначен для внутреннего использования.

---

<div align="center">

**Сделано с ❤️ для эффективного управления складом**

[⬆ Наверх](#-система-управления-складом-warehouse-management-system)

</div>
