import React from 'react';
import { Search, User, X } from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { PWAInstallButton } from './PWAInstallButton';

interface StoreHeaderProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  isSearchingRemote: boolean;
  user: FirebaseUser | null;
  isAdmin: boolean;
  onOpenProfile: () => void;
}

export const StoreHeader: React.FC<StoreHeaderProps> = ({
  searchTerm,
  onSearchChange,
  onSearchSubmit,
  isSearchingRemote,
  user,
  isAdmin,
  onOpenProfile,
}) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchSubmit();
  };

  return (
    <header className="bg-[#072146] text-white shadow-md">
      <div className="mx-auto max-w-7xl px-3 sm:px-6 py-2.5">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Brand + 24/7 urgency badge */}
          <div className="flex items-center gap-2 min-w-0">
            <a
              href="#catalogo"
              className="font-display text-base sm:text-xl font-extrabold tracking-tight text-white truncate"
            >
              El Bodegón del Licor
            </a>
            <span className="inline-flex items-center rounded-md bg-[#C62828] px-2 py-0.5 text-[11px] sm:text-xs font-extrabold text-white whitespace-nowrap shrink-0">
              24/7
            </span>
          </div>

          {/* Desktop inline search */}
          <form onSubmit={handleSubmit} className="hidden md:flex flex-1 max-w-md items-center relative">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-[#072146]/60" />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar cerveza, aguardiente, ron, snacks..."
              aria-label="Buscar productos"
              className="w-full min-h-[40px] rounded-xl bg-white pl-9 pr-20 text-sm text-[#072146] placeholder:text-[#072146]/50 focus:outline-none focus:ring-2 focus:ring-[#F5A623]"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-16 p-1 text-[#072146]/50 hover:text-[#072146]"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={isSearchingRemote}
              className="absolute right-1.5 rounded-lg bg-[#F5A623] px-2.5 py-1 text-xs font-bold text-[#072146] hover:brightness-95 transition whitespace-nowrap"
            >
              {isSearchingRemote ? '...' : 'Buscar'}
            </button>
          </form>

          {/* Actions: PWA Install + Profile */}
          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={onOpenProfile}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#1B4F9C] bg-[#072146] px-3 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[#1B4F9C]/40 transition whitespace-nowrap shrink-0"
              aria-label="Abrir perfil y pedidos"
            >
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Perfil'}
                  referrerPolicy="no-referrer"
                  className="h-6 w-6 rounded-full object-cover border border-[#F5A623]"
                />
              ) : (
                <User className="h-4 w-4 text-[#F5A623] shrink-0" />
              )}
              <span className="hidden sm:inline">
                {isAdmin ? 'Admin' : user ? user.displayName?.split(' ')[0] || 'Mi Perfil' : 'Perfil'}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile compact search bar */}
        <form onSubmit={handleSubmit} className="mt-2 flex md:hidden items-center relative">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-[#072146]/60" />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="¿Qué quieres tomar hoy? Buscar..."
            aria-label="Buscar productos en catálogo"
            className="w-full min-h-[40px] rounded-xl bg-white pl-9 pr-20 text-sm text-[#072146] placeholder:text-[#072146]/50 focus:outline-none focus:ring-2 focus:ring-[#F5A623]"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-16 p-1 text-[#072146]/50 hover:text-[#072146]"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            disabled={isSearchingRemote}
            className="absolute right-1.5 rounded-lg bg-[#F5A623] px-2.5 py-1 text-xs font-bold text-[#072146] whitespace-nowrap"
          >
            {isSearchingRemote ? '...' : 'Ir'}
          </button>
        </form>
      </div>
    </header>
  );
};
