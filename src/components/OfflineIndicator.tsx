import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed top-28 right-4 z-40 flex items-center gap-2 rounded-xl bg-[#C62828] px-3.5 py-2 text-xs font-bold text-white shadow-lg">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>Sin conexión · Mostrando catálogo en caché</span>
    </div>
  );
};
