'use client';

interface EmptyStateProps {
  message?: string;
  className?: string;
}

export function EmptyState({ 
  message = 'Нет данных для отображения',
  className = ''
}: EmptyStateProps) {
  return (
    <div className={`text-center py-12 ${className}`}>
      <p className="text-slate-400 text-lg">{message}</p>
    </div>
  );
}

