'use client';

import { ShipmentCard } from './ShipmentCard';
import { WaitingShipmentCard } from './WaitingShipmentCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Shipment, Tab } from '@/types';

interface ShipmentGridProps {
  shipments: Shipment[];
  isLoading: boolean;
  currentTab: Tab;
  onCollect: (shipment: Shipment) => void;
  onConfirm: (shipment: Shipment) => void;
  onDetails: (shipment: Shipment) => void;
  onCollectAll?: (shipment: Shipment) => void;
  onConfirmAll?: (shipment: Shipment) => void;
  onDeleteCollection?: (shipment: Shipment) => void;
  userRole?: 'admin' | 'collector' | 'checker' | null;
}

interface WaitingShipmentCardProps {
  shipment: Shipment;
  tasks?: Array<{
    id: string;
    warehouse?: string;
    status: string;
    collector_name?: string;
    created_at: string;
  }>;
  userRole?: 'admin' | 'collector' | 'checker' | null;
}

export function ShipmentGrid({
  shipments,
  isLoading,
  currentTab,
  onCollect,
  onConfirm,
  onDetails,
  onCollectAll,
  onConfirmAll,
  onDeleteCollection,
  userRole,
}: ShipmentGridProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (shipments.length === 0) {
    return <EmptyState message="Нет заказов для отображения" />;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
      {shipments.map((shipment) => {
        // Для режима ожидания используем WaitingShipmentCard
        if (currentTab === 'waiting') {
          return (
            <WaitingShipmentCard
              key={shipment.id}
              shipment={shipment}
              tasks={shipment.tasks}
              userRole={userRole}
            />
          );
        }
        
        // Для остальных режимов используем обычную ShipmentCard
        return (
          <ShipmentCard
            key={shipment.id}
            shipment={shipment}
            onCollect={onCollect}
            onConfirm={onConfirm}
            onDetails={onDetails}
            onCollectAll={onCollectAll}
            onConfirmAll={onConfirmAll}
            onDeleteCollection={onDeleteCollection}
            userRole={userRole}
          />
        );
      })}
    </div>
  );
}

