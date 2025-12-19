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
import { SendToOfficeModal } from '@/components/modals/SendToOfficeModal';
import { useShipments } from '@/hooks/useShipments';
import { useCollect } from '@/hooks/useCollect';
import { useConfirm } from '@/hooks/useConfirm';
import { useModal } from '@/hooks/useModal';
import { useToast } from '@/hooks/useToast';
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
    waitingCount,
    refreshShipments,
    userRole,
  } = useShipments();

  const collectHook = useCollect({ onClose: refreshShipments });
  const confirmHook = useConfirm({ onClose: refreshShipments });
  const detailsModal = useModal();
  const nameModal = useModal();
  const orderCompletedModal = useModal();
  const sendToOfficeModal = useModal();
  const { showError } = useToast();
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [completedOrderData, setCompletedOrderData] = useState<{
    number: string;
    tasksCount: number;
    finalData: any;
  } | null>(null);
  const [pendingShipmentForOffice, setPendingShipmentForOffice] = useState<Shipment | null>(null);

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
    // Проверяем блокировку перед открытием модального окна
    // Если задание заблокировано другим пользователем и текущий пользователь не админ,
    // показываем сообщение и не открываем модальное окно
    if (shipment.locked && shipment.lockedBy && shipment.lockedByCurrentUser === false) {
      // Если пользователь не админ, не позволяем вмешиваться в сборку другого
      if (userRole !== 'admin') {
        const collectorName = shipment.collector_name || 'другой сборщик';
        showError(`Задание уже начато другим сборщиком. Сборку начал: ${collectorName}. Только администратор может вмешаться в сборку другого пользователя.`);
        return;
      }
      // Если админ, показываем предупреждение, но позволяем вмешаться
      const collectorName = shipment.collector_name || 'другой сборщик';
      const confirmed = window.confirm(
        `Задание уже начато другим сборщиком.\nСборку начал: ${collectorName}\n\nВы администратор. Хотите вмешаться в сборку?`
      );
      if (!confirmed) {
        return;
      }
    }
    
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
      // Показываем модальное окно для ввода комментария и количества мест
      setPendingShipmentForOffice(shipment);
      sendToOfficeModal.open();
    } catch (error: any) {
      console.error('[Page] Ошибка при открытии модального окна отправки:', error);
      showError('Ошибка при открытии модального окна отправки');
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

  const handleResetCollectProgress = async () => {
    if (!collectHook.currentShipment) return;
    try {
      const response = await fetch(`/api/shipments/${collectHook.currentShipment.id}/reset-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'collect' }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Ошибка при сбросе прогресса');
      }
      await refreshShipments();
      collectHook.closeModal();
    } catch (error: any) {
      console.error('Ошибка при сбросе прогресса сборки:', error);
      alert(error.message || 'Ошибка при сбросе прогресса сборки');
    }
  };

  const handleResetConfirmProgress = async () => {
    if (!confirmHook.currentShipment) return;
    try {
      const response = await fetch(`/api/shipments/${confirmHook.currentShipment.id}/reset-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'confirm' }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Ошибка при сбросе прогресса');
      }
      await refreshShipments();
      confirmHook.closeModal();
    } catch (error: any) {
      console.error('Ошибка при сбросе прогресса проверки:', error);
      alert(error.message || 'Ошибка при сбросе прогресса проверки');
    }
  };

  const handleDeleteCollection = async (shipment: Shipment) => {
    try {
      const response = await fetch(`/api/shipments/${shipment.id}/reset-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'delete' }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Ошибка при удалении сборки');
      }
      await refreshShipments();
    } catch (error: any) {
      console.error('Ошибка при удалении сборки:', error);
      alert(error.message || 'Ошибка при удалении сборки');
    }
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
        <Tabs currentTab={currentTab} newCount={newCount} pendingCount={pendingCount} waitingCount={waitingCount} onTabChange={setCurrentTab} userRole={userRole} />
        <ShipmentGrid
          shipments={filteredShipments}
          isLoading={isLoading}
          currentTab={currentTab}
          onCollect={handleCollect}
          onConfirm={handleConfirm}
          onDetails={handleDetails}
          onCollectAll={userRole === 'admin' ? handleCollectAll : undefined}
          onConfirmAll={userRole === 'admin' ? handleConfirmAll : undefined}
          onDeleteCollection={userRole === 'admin' ? handleDeleteCollection : undefined}
          userRole={userRole}
        />
      </main>

      <CollectModal
        currentShipment={collectHook.currentShipment}
        checklistState={collectHook.checklistState}
        editState={collectHook.editState}
        removingItems={collectHook.removingItems}
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
        removingItems={confirmHook.removingItems}
        isOpen={confirmHook.isOpen}
        onClose={confirmHook.closeModal}
        onUpdateCollectedQty={confirmHook.updateCollectedQty}
        onStartEditQty={confirmHook.startEditQty}
        onConfirmEditQty={confirmHook.confirmEditQty}
        onCancelEditQty={confirmHook.cancelEditQty}
        onConfirmItem={confirmHook.confirmItem}
        onConfirmShipment={async () => {
          try {
            // Проверяем, все ли товары подтверждены
            if (!confirmHook.isReady()) {
              showError('Необходимо подтвердить все товары перед подтверждением заказа');
              return;
            }

            // Если все подтверждено, показываем модальное окно для ввода комментария и количества мест
            if (confirmHook.currentShipment) {
              setPendingShipmentForOffice(confirmHook.currentShipment);
              sendToOfficeModal.open();
            }
          } catch (error: any) {
            console.error('[Page] Ошибка при проверке готовности заказа:', error);
            showError('Ошибка при проверке готовности заказа');
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
      <SendToOfficeModal
        isOpen={sendToOfficeModal.isOpen}
        onClose={() => {
          sendToOfficeModal.close();
          setPendingShipmentForOffice(null);
        }}
        onConfirm={async (comment: string, places: number) => {
          try {
            sendToOfficeModal.close();
            
            let result;
            
            // Если есть текущий shipment в confirmHook, используем confirmShipment
            // Иначе используем confirmAll для shipment из pendingShipmentForOffice
            if (confirmHook.currentShipment && confirmHook.isOpen) {
              result = await confirmHook.confirmShipment(comment, places);
            } else if (pendingShipmentForOffice) {
              result = await confirmHook.confirmAll(pendingShipmentForOffice, comment, places);
            } else {
              showError('Ошибка: нет данных о заказе для отправки');
              return;
            }
            
            if (result && result.completed === true && 'orderData' in result && result.orderData && typeof result.orderData === 'object' && 'number' in result.orderData) {
              const orderData = result.orderData as { number: string; tasksCount: number; finalData: any };
              console.log('✅ Заказ отправлен в офис:', orderData.number, `(${orderData.tasksCount} заданий)`);
              
              setCompletedOrderData(orderData);
              if (confirmHook.isOpen) {
                confirmHook.closeModal();
              }
              setPendingShipmentForOffice(null);
              
              setTimeout(() => {
                orderCompletedModal.open();
              }, 200);
            } else {
              // Если не все задания подтверждены, просто обновляем список
              await refreshShipments();
            }
          } catch (error: any) {
            console.error('[Page] Ошибка при отправке заказа в офис:', error);
            showError('Не удалось отправить заказ в офис: ' + (error?.message || 'Неизвестная ошибка'));
            await refreshShipments();
          }
        }}
        shipmentNumber={pendingShipmentForOffice?.number || pendingShipmentForOffice?.shipment_number || 'N/A'}
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
