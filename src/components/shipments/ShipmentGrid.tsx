'use client';

import { ShipmentCard } from './ShipmentCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Shipment } from '@/types';

interface ShipmentGridProps {
  shipments: Shipment[];
  isLoading: boolean;
  onCollect: (shipment: Shipment) => void;
  onConfirm: (shipment: Shipment) => void;
  onDetails: (shipment: Shipment) => void;
  onCollectAll?: (shipment: Shipment) => void;
  onConfirmAll?: (shipment: Shipment) => void;
  userRole?: 'admin' | 'collector' | 'checker' | null;
}

export function ShipmentGrid({
  shipments,
  isLoading,
  onCollect,
  onConfirm,
  onDetails,
  onCollectAll,
  onConfirmAll,
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
      {shipments.map((shipment) => (
        <ShipmentCard
          key={shipment.id}
          shipment={shipment}
          onCollect={onCollect}
          onConfirm={onConfirm}
          onDetails={onDetails}
          onCollectAll={onCollectAll}
          onConfirmAll={onConfirmAll}
          userRole={userRole}
        />
      ))}
    </div>
  );
}

