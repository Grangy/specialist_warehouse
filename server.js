const express = require('express');
const cors = require('cors');
const path = require('path');
const { mockShipments } = require('./mock-data');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Хранилище заказов (в реальном приложении это была бы БД)
let shipments = JSON.parse(JSON.stringify(mockShipments)); // Глубокая копия для возможности изменений

// Хранилище блокировок заказов { shipmentId: { userId, lockedAt } }
let shipmentLocks = {};

// Время жизни блокировки (30 минут)
const LOCK_TIMEOUT = 30 * 60 * 1000;

// Очистка устаревших блокировок
function cleanupLocks() {
    const now = Date.now();
    Object.keys(shipmentLocks).forEach(id => {
        if (now - shipmentLocks[id].lockedAt > LOCK_TIMEOUT) {
            delete shipmentLocks[id];
        }
    });
}

// GET /api/shipments - получение списка заказов
app.get('/api/shipments', (req, res) => {
    try {
        const { status, userId } = req.query;
        
        cleanupLocks();
        
        let filteredShipments = shipments;
        
        // Фильтрация по статусу, если указан
        if (status) {
            filteredShipments = shipments.filter(s => s.status === status);
        }
        
        // Фильтруем заблокированные заказы: показываем только если заблокированы текущим пользователем
        if (userId) {
            filteredShipments = filteredShipments.filter(s => {
                const lock = shipmentLocks[s.id];
                // Показываем заказ если:
                // 1. Он не заблокирован
                // 2. Или заблокирован текущим пользователем
                return !lock || lock.userId === userId;
            });
        } else {
            // Если userId не передан, скрываем все заблокированные
            filteredShipments = filteredShipments.filter(s => !shipmentLocks[s.id]);
        }
        
        // Добавляем информацию о блокировке
        filteredShipments = filteredShipments.map(s => {
            const lock = shipmentLocks[s.id];
            return {
                ...s,
                locked: !!lock,
                lockedBy: lock ? lock.userId : null
            };
        });
        
        // Сортировка: новые сверху
        filteredShipments.sort((a, b) => {
            return new Date(b.created_at) - new Date(a.created_at);
        });
        
        res.json(filteredShipments);
    } catch (error) {
        console.error('Ошибка при получении заказов:', error);
        res.status(500).json({ error: 'Ошибка сервера при получении заказов' });
    }
});

// POST /api/shipments/:id/pending_confirmation - перевод заказа в статус ожидания подтверждения
app.post('/api/shipments/:id/pending_confirmation', (req, res) => {
    try {
        const { id } = req.params;
        const { collector_name } = req.body;
        
        const shipment = shipments.find(s => s.id === id);
        
        if (!shipment) {
            return res.status(404).json({ error: 'Заказ не найден' });
        }
        
        // Обновляем статус и сохраняем имя сборщика
        shipment.status = 'pending_confirmation';
        if (collector_name) {
            shipment.collector_name = collector_name;
        }
        
        // Сохраняем информацию о собранных количествах из тела запроса
        if (req.body.lines && Array.isArray(req.body.lines)) {
            if (!shipment.lines) shipment.lines = [];
            req.body.lines.forEach((lineData, index) => {
                if (shipment.lines[index]) {
                    shipment.lines[index].collected_qty = lineData.collected_qty;
                }
            });
        }
        
        console.log(`Заказ ${shipment.number} (ID: ${id}) переведен в статус ожидания подтверждения. Сборщик: ${collector_name || 'не указан'}`);
        
        res.json({ 
            success: true, 
            message: 'Заказ успешно переведен в статус ожидания подтверждения',
            shipment 
        });
    } catch (error) {
        console.error('Ошибка при обновлении статуса заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера при обновлении статуса' });
    }
});

// POST /api/shipments/:id/confirm - подтверждение заказа проверяющим
app.post('/api/shipments/:id/confirm', (req, res) => {
    try {
        const { id } = req.params;
        const { lines } = req.body;
        
        const shipment = shipments.find(s => s.id === id);
        
        if (!shipment) {
            return res.status(404).json({ error: 'Заказ не найден' });
        }
        
        if (shipment.status !== 'pending_confirmation') {
            return res.status(400).json({ error: 'Заказ не находится в статусе ожидания подтверждения' });
        }
        
        // Обновляем статус на обработанный (отправлен на офис)
        shipment.status = 'processed';
        
        // Сохраняем обновленные количества, если они переданы
        if (lines && Array.isArray(lines)) {
            if (!shipment.lines) shipment.lines = [];
            lines.forEach((lineData, index) => {
                if (shipment.lines[index] && lineData.collected_qty !== undefined) {
                    shipment.lines[index].collected_qty = lineData.collected_qty;
                }
            });
        }
        
        console.log(`Заказ ${shipment.number} (ID: ${id}) подтвержден проверяющим и отправлен на офис`);
        
        res.json({ 
            success: true, 
            message: 'Заказ успешно подтвержден и отправлен на офис',
            shipment 
        });
    } catch (error) {
        console.error('Ошибка при подтверждении заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера при подтверждении заказа' });
    }
});

// POST /api/shipments/:id/processed - отметка заказа как обработанного
app.post('/api/shipments/:id/processed', (req, res) => {
    try {
        const { id } = req.params;
        
        const shipment = shipments.find(s => s.id === id);
        
        if (!shipment) {
            return res.status(404).json({ error: 'Заказ не найден' });
        }
        
        // Обновляем статус
        shipment.status = 'processed';
        
        console.log(`Заказ ${shipment.number} (ID: ${id}) отмечен как обработанный`);
        
        res.json({ 
            success: true, 
            message: 'Заказ успешно отмечен как обработанный',
            shipment 
        });
    } catch (error) {
        console.error('Ошибка при обновлении статуса заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера при обновлении статуса' });
    }
});

// POST /api/shipments/:id/lock - заблокировать заказ (взять в работу)
app.post('/api/shipments/:id/lock', (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        
        cleanupLocks();
        
        const shipment = shipments.find(s => s.id === id);
        if (!shipment) {
            return res.status(404).json({ error: 'Заказ не найден' });
        }
        
        const existingLock = shipmentLocks[id];
        
        // Если заказ уже заблокирован другим пользователем
        if (existingLock && existingLock.userId !== userId) {
            return res.status(409).json({ 
                error: 'Заказ уже взят в работу другим пользователем',
                lockedBy: existingLock.userId
            });
        }
        
        // Блокируем заказ
        shipmentLocks[id] = {
            userId: userId,
            lockedAt: Date.now()
        };
        
        console.log(`Заказ ${shipment.number} (ID: ${id}) заблокирован пользователем ${userId}`);
        
        res.json({ 
            success: true, 
            message: 'Заказ заблокирован',
            shipment: {
                ...shipment,
                locked: true,
                lockedBy: userId
            }
        });
    } catch (error) {
        console.error('Ошибка при блокировке заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера при блокировке заказа' });
    }
});

// Middleware для парсинга FormData
const multer = require('multer');
const upload = multer();

// POST /api/shipments/:id/unlock - разблокировать заказ
app.post('/api/shipments/:id/unlock', upload.none(), (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.body?.userId || req.body.userId;
        
        const shipment = shipments.find(s => s.id === id);
        if (!shipment) {
            return res.status(404).json({ error: 'Заказ не найден' });
        }
        
        const lock = shipmentLocks[id];
        
        // Проверяем, что разблокирует тот же пользователь (или просто разблокируем если userId не передан)
        if (lock && userId && lock.userId !== userId) {
            return res.status(403).json({ error: 'Недостаточно прав для разблокировки' });
        }
        
        // Разблокируем заказ
        delete shipmentLocks[id];
        
        console.log(`Заказ ${shipment.number} (ID: ${id}) разблокирован${userId ? ` пользователем ${userId}` : ''}`);
        
        res.json({ 
            success: true, 
            message: 'Заказ разблокирован'
        });
    } catch (error) {
        console.error('Ошибка при разблокировке заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера при разблокировке заказа' });
    }
});

// GET /api/shipments/:id - получение одного заказа (опционально)
app.get('/api/shipments/:id', (req, res) => {
    try {
        const { id } = req.params;
        const shipment = shipments.find(s => s.id === id);
        
        if (!shipment) {
            return res.status(404).json({ error: 'Заказ не найден' });
        }
        
        const lock = shipmentLocks[id];
        res.json({
            ...shipment,
            locked: !!lock,
            lockedBy: lock ? lock.userId : null
        });
    } catch (error) {
        console.error('Ошибка при получении заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера при получении заказа' });
    }
});

// Раздача статических файлов (index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Обработка 404
app.use((req, res) => {
    res.status(404).json({ error: 'Эндпоинт не найден' });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📦 Панель отгрузок доступна по адресу: http://localhost:${PORT}`);
    console.log(`🔌 API эндпоинты:`);
    console.log(`   GET  /api/shipments - список заказов`);
    console.log(`   GET  /api/shipments/:id - заказ по ID`);
    console.log(`   POST /api/shipments/:id/lock - заблокировать заказ`);
    console.log(`   POST /api/shipments/:id/unlock - разблокировать заказ`);
    console.log(`   POST /api/shipments/:id/processed - отметить как обработанный`);
    
    // Периодическая очистка устаревших блокировок
    setInterval(cleanupLocks, 5 * 60 * 1000); // Каждые 5 минут
});

