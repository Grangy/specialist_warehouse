import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;

if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: finalDatabaseUrl || databaseUrl,
    },
  },
});

async function checkStats() {
  console.log('\n📊 СТАТИСТИКА ЛОКАЛЬНОЙ БД:\n');
  
  const totalShipments = await prisma.shipment.count();
  console.log(`Всего заказов: ${totalShipments}`);
  
  const byStatus = await prisma.shipment.groupBy({
    by: ['status'],
    _count: true,
  });
  
  console.log('\nПо статусам:');
  byStatus.forEach(s => {
    console.log(`  ${s.status}: ${s._count}`);
  });
  
  const totalTasks = await prisma.shipmentTask.count();
  console.log(`\nВсего заданий: ${totalTasks}`);
  
  const totalLines = await prisma.shipmentLine.count();
  console.log(`Всего позиций заказов: ${totalLines}`);
  
  const totalTaskLines = await prisma.shipmentTaskLine.count();
  console.log(`Всего позиций заданий: ${totalTaskLines}`);
  
  const totalUsers = await prisma.user.count();
  console.log(`Всего пользователей: ${totalUsers}`);
  
  const totalRegions = await prisma.regionPriority.count();
  console.log(`Всего регионов: ${totalRegions}`);
  
  await prisma.$disconnect();
}

checkStats().catch(console.error);
