'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { FilterPanel } from '@/components/layout/FilterPanel';
import { Tabs } from '@/components/shipments/Tabs';
import { ShipmentGrid } from '@/components/shipments/ShipmentGrid';
import { CollectModal } from '@/components/modals/CollectModal';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { DetailsModal } from '@/components/modals/DetailsModal';
import { NameModal } from '@/components/modals/NameModal';
import { OrderCompletedModal } from '@/components/modals/OrderCompletedModal';
import { useShipments } from '@/hooks/useShipments';
import { useCollect } from '@/hooks/useCollect';
import { useConfirm } from '@/hooks/useConfirm';
import { useModal } from '@/hooks/useModal';
import type { Shipment } from '@/types';

export default function Home() {
  const router = useRouter();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    // Проверяем авторизацию
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (!data.user) {
          router.push('/login');
        } else {
          setIsCheckingAuth(false);
        }
      })
      .catch(() => {
        router.push('/login');
      });
  }, [router]);

  const {
    filteredShipments,
    isLoading,
    currentTab,
    setCurrentTab,
    filters,
    setFilters,
    newCount,
    pendingCount,
    refreshShipments,
    userRole,
  } = useShipments();

  const collectHook = useCollect();
  const confirmHook = useConfirm();
  const detailsModal = useModal();
  const nameModal = useModal();
  const orderCompletedModal = useModal();
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [completedOrderData, setCompletedOrderData] = useState<{
    number: string;
    tasksCount: number;
    finalData: any;
  } | null>(null);

  // Автоматическое открытие модального окна при появлении данных
  useEffect(() => {
    if (completedOrderData && !orderCompletedModal.isOpen) {
      const timer = setTimeout(() => {
        orderCompletedModal.open();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [completedOrderData, orderCompletedModal]);
  const [nameModalData, setNameModalData] = useState({
    name: '',
    sku: '',
    location: '',
    qty: 0,
    collected: 0,
  });

  const handleCollect = async (shipment: Shipment) => {
    await collectHook.openModal(shipment);
  };

  const handleConfirmProcessing = async () => {
    try {
      console.log('handleConfirmProcessing вызван');
      const response = await collectHook.confirmProcessing();
      console.log('Подтверждение обработки завершено, обновляем список заказов');
      // Обновляем список заказов после подтверждения
      await refreshShipments();
      console.log('Список заказов обновлен');
    } catch (error) {
      console.error('Ошибка при подтверждении обработки:', error);
      // Не пробрасываем ошибку дальше, чтобы модальное окно не закрывалось при ошибке
    }
  };

  const handleConfirm = (shipment: Shipment) => {
    confirmHook.openModal(shipment);
  };

  const handleCollectAll = async (shipment: Shipment) => {
    try {
      await collectHook.collectAll(shipment);
      await refreshShipments();
    } catch (error) {
      console.error('Ошибка при автоматической сборке всех позиций:', error);
    }
  };

  const handleConfirmAll = async (shipment: Shipment) => {
    try {
      const result = await confirmHook.confirmAll(shipment);
      
      if (result && 'completed' in result && result.completed === true && 'orderData' in result && result.orderData) {
        console.log('✅ Заказ отправлен в офис:', result.orderData.number, `(${result.orderData.tasksCount} заданий)`);
        
        setCompletedOrderData(result.orderData);
        
        setTimeout(() => {
          orderCompletedModal.open();
        }, 200);
      }
      
      await refreshShipments();
    } catch (error: any) {
      console.error('[Page] Ошибка при подтверждении всех позиций:', error);
      await refreshShipments();
    }
  };

  const handleDetails = (shipment: Shipment) => {
    setSelectedShipment(shipment);
    detailsModal.open();
  };

  const handleNameClick = (name: string, sku: string, location: string, qty: number, collected: number) => {
    setNameModalData({ name, sku, location, qty, collected });
    nameModal.open();
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <Header newCount={newCount} pendingCount={pendingCount} onRefresh={refreshShipments} />
      <FilterPanel shipments={filteredShipments} filters={filters} onFiltersChange={setFilters} />
      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6">
        <Tabs currentTab={currentTab} pendingCount={pendingCount} onTabChange={setCurrentTab} userRole={userRole} />
        <ShipmentGrid
          shipments={filteredShipments}
          isLoading={isLoading}
          onCollect={handleCollect}
          onConfirm={handleConfirm}
          onDetails={handleDetails}
          onCollectAll={userRole === 'admin' ? handleCollectAll : undefined}
          onConfirmAll={userRole === 'admin' ? handleConfirmAll : undefined}
          userRole={userRole}
        />
      </main>

      <CollectModal
        currentShipment={collectHook.currentShipment}
        checklistState={collectHook.checklistState}
        editState={collectHook.editState}
        isOpen={collectHook.isOpen}
        onClose={collectHook.closeModal}
        onUpdateCollected={collectHook.updateCollected}
        onUpdateCollectedQty={collectHook.updateCollectedQty}
        onStartEditQty={collectHook.startEditQty}
        onConfirmEditQty={collectHook.confirmEditQty}
        onCancelEditQty={collectHook.cancelEditQty}
        onConfirmProcessing={handleConfirmProcessing}
        getProgress={collectHook.getProgress}
        isReady={collectHook.isReady}
      />
      <ConfirmModal
        currentShipment={confirmHook.currentShipment}
        checklistState={confirmHook.checklistState}
        editState={confirmHook.editState}
        isOpen={confirmHook.isOpen}
        onClose={confirmHook.closeModal}
        onUpdateCollectedQty={confirmHook.updateCollectedQty}
        onStartEditQty={confirmHook.startEditQty}
        onConfirmEditQty={confirmHook.confirmEditQty}
        onCancelEditQty={confirmHook.cancelEditQty}
        onConfirmItem={confirmHook.confirmItem}
        onConfirmShipment={async () => {
          try {
            const result = await confirmHook.confirmShipment();
            
            if (result && result.completed === true && 'orderData' in result && result.orderData) {
              console.log('✅ Заказ отправлен в офис:', result.orderData.number, `(${result.orderData.tasksCount} заданий)`);
              
              setCompletedOrderData(result.orderData);
              confirmHook.closeModal();
              
              setTimeout(() => {
                orderCompletedModal.open();
              }, 200);
            }
            
            await refreshShipments();
          } catch (error: any) {
            console.error('[Page] Ошибка при подтверждении заказа:', error);
            await refreshShipments();
          }
        }}
        getProgress={confirmHook.getProgress}
        isReady={confirmHook.isReady}
        getWarnings={confirmHook.getWarnings}
      />
      <DetailsModal
        isOpen={detailsModal.isOpen}
        onClose={detailsModal.close}
        shipment={selectedShipment}
      />
      <NameModal
        isOpen={nameModal.isOpen}
        onClose={nameModal.close}
        name={nameModalData.name}
        sku={nameModalData.sku}
        location={nameModalData.location}
        qty={nameModalData.qty}
        collected={nameModalData.collected}
      />
      <OrderCompletedModal
        isOpen={orderCompletedModal.isOpen}
        onClose={() => {
          orderCompletedModal.close();
          setCompletedOrderData(null);
        }}
        orderData={completedOrderData}
      />
    </div>
  );
}
