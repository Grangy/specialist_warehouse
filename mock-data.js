// Пример данных для тестирования страницы без реального API
// Используйте этот файл для мокирования API в development

const mockShipments = [
    {
        "id": "1",
        "number": "РН-000123",
        "created_at": "2025-01-15T10:15:00Z",
        "customer_name": "ООО Ромашка",
        "destination": "Основной склад / Рампа 3",
        "items_count": 12,
        "total_qty": 57,
        "weight": 245.5,
        "comment": "Срочный заказ",
        "status": "new",
        "business_region": "Москва",
        "lines": [
            {
                "sku": "123-456",
                "name": "Товар 1",
                "qty": 10,
                "uom": "шт",
                "location": "Стеллаж A3 / Полка 2"
            },
            {
                "sku": "123-457",
                "name": "Товар 2",
                "qty": 15,
                "uom": "шт",
                "location": "Стеллаж B1 / Полка 1"
            },
            {
                "sku": "123-458",
                "name": "Товар 3",
                "qty": 32,
                "uom": "шт",
                "location": "Стеллаж C2 / Полка 3"
            }
        ]
    },
    {
        "id": "2",
        "number": "РН-000124",
        "created_at": "2025-01-15T09:30:00Z",
        "customer_name": "ИП Иванов",
        "destination": "Основной склад / Рампа 1",
        "items_count": 5,
        "total_qty": 23,
        "weight": 89.2,
        "comment": "",
        "status": "new",
        "business_region": "Москва",
        "lines": [
            {
                "sku": "456-789",
                "name": "Товар A",
                "qty": 10,
                "uom": "шт",
                "location": "Стеллаж D1 / Полка 1"
            },
            {
                "sku": "456-790",
                "name": "Товар B",
                "qty": 13,
                "uom": "шт",
                "location": "Стеллаж D1 / Полка 2"
            }
        ]
    },
    {
        "id": "3",
        "number": "РН-000125",
        "created_at": "2025-01-15T08:45:00Z",
        "customer_name": "ООО Тюльпан",
        "destination": "Основной склад / Рампа 2",
        "items_count": 8,
        "total_qty": 45,
        "weight": 156.8,
        "comment": "Срочный заказ, доставить до 18:00",
        "status": "new",
        "business_region": "Санкт-Петербург",
        "lines": [
            {
                "sku": "789-012",
                "name": "Товар X",
                "qty": 20,
                "uom": "шт",
                "location": "Стеллаж E2 / Полка 1"
            },
            {
                "sku": "789-013",
                "name": "Товар Y",
                "qty": 25,
                "uom": "шт",
                "location": "Стеллаж E2 / Полка 2"
            }
        ]
    },
    {
        "id": "4",
        "number": "РН-000120",
        "created_at": "2025-01-15T07:00:00Z",
        "customer_name": "ООО Подсолнух",
        "destination": "Основной склад / Рампа 3",
        "items_count": 15,
        "total_qty": 78,
        "weight": 312.4,
        "comment": "",
        "status": "processed",
        "lines": [
            {
                "sku": "111-222",
                "name": "Товар Z",
                "qty": 30,
                "uom": "шт",
                "location": "Стеллаж F1 / Полка 1"
            },
            {
                "sku": "111-223",
                "name": "Товар W",
                "qty": 48,
                "uom": "шт",
                "location": "Стеллаж F1 / Полка 2"
            }
        ]
    },
    {
        "id": "5",
        "number": "РН-000121",
        "created_at": "2025-01-15T06:30:00Z",
        "customer_name": "ИП Петров",
        "destination": "Основной склад / Рампа 1",
        "items_count": 3,
        "total_qty": 12,
        "weight": null,
        "comment": "",
        "status": "processed",
        "lines": [
            {
                "sku": "333-444",
                "name": "Товар M",
                "qty": 12,
                "uom": "шт",
                "location": "Стеллаж G1 / Полка 1"
            }
        ]
    },
    {
        "id": "6",
        "number": "РН-000200",
        "created_at": "2025-01-15T11:00:00Z",
        "customer_name": "ООО Большой Заказ",
        "destination": "Основной склад / Рампа 4",
        "items_count": 124,
        "total_qty": 1240,
        "weight": 5420.5,
        "comment": "Тестовый заказ на 124 позиции",
        "status": "new",
        "lines": Array.from({ length: 124 }, (_, i) => {
            const itemNum = i + 1;
            const shelf = String.fromCharCode(65 + (i % 26)); // A-Z
            const shelfNum = Math.floor(i / 26) + 1;
            const shelfLevel = (i % 3) + 1;
            return {
                "sku": `TEST-${String(itemNum).padStart(6, '0')}`,
                "name": `Тестовый товар ${itemNum}`,
                "qty": Math.floor(Math.random() * 20) + 1, // от 1 до 20
                "uom": "шт",
                "location": `Стеллаж ${shelf}${shelfNum} / Полка ${shelfLevel}`
            };
        })
    },
    {
        "id": "7",
        "number": "РН-000300",
        "created_at": "2025-01-15T12:00:00Z",
        "customer_name": "ООО Тест Длинных Названий",
        "destination": "Основной склад / Рампа 5",
        "items_count": 8,
        "total_qty": 45,
        "weight": 234.5,
        "comment": "Тестовый заказ с длинными наименованиями товаров",
        "status": "new",
        "business_region": "Москва",
        "lines": [
            {
                "sku": "LONG-001",
                "name": "Очень длинное наименование товара для тестирования переноса текста на несколько строк в интерфейсе сборки заказов",
                "qty": 5,
                "uom": "шт",
                "location": "Стеллаж A1 / Полка 1"
            },
            {
                "sku": "LONG-002",
                "name": "Еще одно чрезвычайно длинное и подробное наименование товарной позиции с множеством характеристик и описанием",
                "qty": 8,
                "uom": "шт",
                "location": "Стеллаж A1 / Полка 2"
            },
            {
                "sku": "LONG-003",
                "name": "Товар с максимально длинным названием которое должно корректно отображаться в мобильной версии интерфейса и переноситься на две строки",
                "qty": 12,
                "uom": "шт",
                "location": "Стеллаж A2 / Полка 1"
            },
            {
                "sku": "LONG-004",
                "name": "Промышленное оборудование для складского хозяйства с расширенным функционалом и дополнительными опциями",
                "qty": 3,
                "uom": "шт",
                "location": "Стеллаж A2 / Полка 2"
            },
            {
                "sku": "LONG-005",
                "name": "Комплектующие изделия для производственных линий с гарантийным обслуживанием и технической поддержкой",
                "qty": 7,
                "uom": "шт",
                "location": "Стеллаж B1 / Полка 1"
            },
            {
                "sku": "LONG-006",
                "name": "Специализированный инструмент для выполнения высокоточных операций в условиях промышленного производства",
                "qty": 4,
                "uom": "шт",
                "location": "Стеллаж B1 / Полка 2"
            },
            {
                "sku": "LONG-007",
                "name": "Расходные материалы повышенного качества для использования в критически важных технологических процессах",
                "qty": 6,
                "uom": "шт",
                "location": "Стеллаж B2 / Полка 1"
            },
            {
                "sku": "LONG-008",
                "name": "Универсальное приспособление многофункционального назначения с возможностью адаптации под различные задачи",
                "qty": 0,
                "uom": "шт",
                "location": "Стеллаж B2 / Полка 2"
            }
        ]
    },
    {
        "id": "8",
        "number": "РН-000400",
        "created_at": "2025-01-15T13:30:00Z",
        "customer_name": "ООО Северный Регион",
        "destination": "Основной склад / Рампа 2",
        "items_count": 6,
        "total_qty": 34,
        "weight": 178.9,
        "comment": "Срочный заказ для северного региона",
        "status": "pending_confirmation",
        "business_region": "Санкт-Петербург",
        "collector_name": "Иванов Иван",
        "lines": [
            {
                "sku": "NORTH-001",
                "name": "Товар для северного региона 1",
                "qty": 10,
                "collected_qty": 10,
                "uom": "шт",
                "location": "Стеллаж C1 / Полка 1"
            },
            {
                "sku": "NORTH-002",
                "name": "Товар для северного региона 2",
                "qty": 8,
                "collected_qty": 8,
                "uom": "шт",
                "location": "Стеллаж C1 / Полка 2"
            },
            {
                "sku": "NORTH-003",
                "name": "Товар для северного региона 3",
                "qty": 5,
                "collected_qty": 3,
                "uom": "шт",
                "location": "Стеллаж C2 / Полка 1"
            },
            {
                "sku": "NORTH-004",
                "name": "Товар для северного региона 4",
                "qty": 7,
                "collected_qty": 7,
                "uom": "шт",
                "location": "Стеллаж C2 / Полка 2"
            },
            {
                "sku": "NORTH-005",
                "name": "Товар для северного региона 5",
                "qty": 4,
                "collected_qty": 4,
                "uom": "шт",
                "location": "Стеллаж C3 / Полка 1"
            },
            {
                "sku": "NORTH-006",
                "name": "Товар для северного региона 6",
                "qty": 0,
                "collected_qty": 0,
                "uom": "шт",
                "location": "Стеллаж C3 / Полка 2"
            }
        ]
    },
    {
        "id": "9",
        "number": "РН-000500",
        "created_at": "2025-01-15T14:00:00Z",
        "customer_name": "ООО Южный Регион",
        "destination": "Основной склад / Рампа 1",
        "items_count": 10,
        "total_qty": 67,
        "weight": 289.3,
        "comment": "Обычный заказ",
        "status": "pending_confirmation",
        "business_region": "Краснодар",
        "collector_name": "Петров Петр",
        "lines": [
            {
                "sku": "SOUTH-001",
                "name": "Товар для южного региона 1",
                "qty": 12,
                "collected_qty": 12,
                "uom": "шт",
                "location": "Стеллаж D1 / Полка 1"
            },
            {
                "sku": "SOUTH-002",
                "name": "Товар для южного региона 2",
                "qty": 8,
                "collected_qty": 8,
                "uom": "шт",
                "location": "Стеллаж D1 / Полка 2"
            },
            {
                "sku": "SOUTH-003",
                "name": "Товар для южного региона 3",
                "qty": 15,
                "collected_qty": 15,
                "uom": "шт",
                "location": "Стеллаж D2 / Полка 1"
            },
            {
                "sku": "SOUTH-004",
                "name": "Товар для южного региона 4",
                "qty": 6,
                "collected_qty": 6,
                "uom": "шт",
                "location": "Стеллаж D2 / Полка 2"
            },
            {
                "sku": "SOUTH-005",
                "name": "Товар для южного региона 5",
                "qty": 9,
                "collected_qty": 9,
                "uom": "шт",
                "location": "Стеллаж D3 / Полка 1"
            },
            {
                "sku": "SOUTH-006",
                "name": "Товар для южного региона 6",
                "qty": 7,
                "collected_qty": 5,
                "uom": "шт",
                "location": "Стеллаж D3 / Полка 2"
            },
            {
                "sku": "SOUTH-007",
                "name": "Товар для южного региона 7",
                "qty": 4,
                "collected_qty": 4,
                "uom": "шт",
                "location": "Стеллаж D4 / Полка 1"
            },
            {
                "sku": "SOUTH-008",
                "name": "Товар для южного региона 8",
                "qty": 3,
                "collected_qty": 3,
                "uom": "шт",
                "location": "Стеллаж D4 / Полка 2"
            },
            {
                "sku": "SOUTH-009",
                "name": "Товар для южного региона 9",
                "qty": 2,
                "collected_qty": 2,
                "uom": "шт",
                "location": "Стеллаж D5 / Полка 1"
            },
            {
                "sku": "SOUTH-010",
                "name": "Товар для южного региона 10",
                "qty": 1,
                "collected_qty": 1,
                "uom": "шт",
                "location": "Стеллаж D5 / Полка 2"
            }
        ]
    },
    {
        "id": "10",
        "number": "РН-000600",
        "created_at": "2025-01-15T15:00:00Z",
        "customer_name": "ООО Центральный Регион",
        "destination": "Основной склад / Рампа 3",
        "items_count": 5,
        "total_qty": 25,
        "weight": 145.6,
        "comment": "Срочный заказ, доставить сегодня",
        "status": "new",
        "business_region": "Воронеж",
        "lines": [
            {
                "sku": "CENTER-001",
                "name": "Товар центрального региона 1",
                "qty": 10,
                "uom": "шт",
                "location": "Стеллаж E1 / Полка 1"
            },
            {
                "sku": "CENTER-002",
                "name": "Товар центрального региона 2",
                "qty": 8,
                "uom": "шт",
                "location": "Стеллаж E1 / Полка 2"
            },
            {
                "sku": "CENTER-003",
                "name": "Товар центрального региона 3",
                "qty": 4,
                "uom": "шт",
                "location": "Стеллаж E2 / Полка 1"
            },
            {
                "sku": "CENTER-004",
                "name": "Товар центрального региона 4",
                "qty": 2,
                "uom": "шт",
                "location": "Стеллаж E2 / Полка 2"
            },
            {
                "sku": "CENTER-005",
                "name": "Товар центрального региона 5",
                "qty": 1,
                "uom": "шт",
                "location": "Стеллаж E3 / Полка 1"
            }
        ]
    },
    {
        "id": "11",
        "number": "РН-000700",
        "created_at": "2025-01-15T16:00:00Z",
        "customer_name": "ИП Сидоров",
        "destination": "Основной склад / Рампа 4",
        "items_count": 3,
        "total_qty": 15,
        "weight": 67.8,
        "comment": "",
        "status": "new",
        "business_region": "Екатеринбург",
        "lines": [
            {
                "sku": "URAL-001",
                "name": "Товар уральского региона 1",
                "qty": 10,
                "uom": "шт",
                "location": "Стеллаж F1 / Полка 1"
            },
            {
                "sku": "URAL-002",
                "name": "Товар уральского региона 2",
                "qty": 3,
                "uom": "шт",
                "location": "Стеллаж F1 / Полка 2"
            },
            {
                "sku": "URAL-003",
                "name": "Товар уральского региона 3",
                "qty": 2,
                "uom": "шт",
                "location": "Стеллаж F2 / Полка 1"
            }
        ]
    },
    {
        "id": "12",
        "number": "РН-000800",
        "created_at": "2025-01-15T17:00:00Z",
        "customer_name": "ООО Дальний Восток",
        "destination": "Основной склад / Рампа 5",
        "items_count": 7,
        "total_qty": 42,
        "weight": 198.4,
        "comment": "Срочный заказ для дальневосточного региона",
        "status": "pending_confirmation",
        "business_region": "Владивосток",
        "collector_name": "Сидоров Сидор",
        "lines": [
            {
                "sku": "EAST-001",
                "name": "Товар дальневосточного региона 1",
                "qty": 10,
                "collected_qty": 10,
                "uom": "шт",
                "location": "Стеллаж G1 / Полка 1"
            },
            {
                "sku": "EAST-002",
                "name": "Товар дальневосточного региона 2",
                "qty": 8,
                "collected_qty": 6,
                "uom": "шт",
                "location": "Стеллаж G1 / Полка 2"
            },
            {
                "sku": "EAST-003",
                "name": "Товар дальневосточного региона 3",
                "qty": 7,
                "collected_qty": 0,
                "uom": "шт",
                "location": "Стеллаж G2 / Полка 1"
            },
            {
                "sku": "EAST-004",
                "name": "Товар дальневосточного региона 4",
                "qty": 5,
                "collected_qty": 5,
                "uom": "шт",
                "location": "Стеллаж G2 / Полка 2"
            },
            {
                "sku": "EAST-005",
                "name": "Товар дальневосточного региона 5",
                "qty": 6,
                "collected_qty": 6,
                "uom": "шт",
                "location": "Стеллаж G3 / Полка 1"
            },
            {
                "sku": "EAST-006",
                "name": "Товар дальневосточного региона 6",
                "qty": 4,
                "collected_qty": 3,
                "uom": "шт",
                "location": "Стеллаж G3 / Полка 2"
            },
            {
                "sku": "EAST-007",
                "name": "Товар дальневосточного региона 7",
                "qty": 2,
                "collected_qty": 2,
                "uom": "шт",
                "location": "Стеллаж G4 / Полка 1"
            }
        ]
    }
];

// Экспорт для использования в server.js
module.exports = { mockShipments };

// Для использования в development:
// 1. Создайте простой mock-сервер или
// 2. Временно замените fetch в index.html на использование этих данных

