import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  LogIn,
  LogOut,
  Mail,
  Package,
  RotateCcw,
  Shield,
  User as UserIcon,
  X,
} from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { formatCop } from '../lib/format';
import { fetchMyOrders, saveUserProfile } from '../services/orderService';
import {
  normalizeCustomerPaymentMethod,
  PAYMENT_METHODS,
  SCHEMA_LIMITS,
  type CustomerProfile,
  type OrderItem,
  type OrderRecord,
  type PaymentMethod,
} from '../types/store';

interface ProfileAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: FirebaseUser | null;
  isAdmin: boolean;
  profile: CustomerProfile;
  lastOrderId?: string | null;
  onSaveProfileLocal: (next: CustomerProfile) => void;
  onReorderItems: (items: OrderItem[]) => void;
  onOpenTracking: (orderId: string) => void;
  onOpenAdminPage: () => void;
}

function mapFirebaseAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (msg.includes('auth/email-already-in-use')) {
    return 'Este correo ya está registrado. Inicia sesión.';
  }
  if (msg.includes('auth/weak-password')) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (msg.includes('auth/invalid-email')) {
    return 'Ingresa un correo electrónico válido.';
  }
  if (msg.includes('auth/operation-not-allowed')) {
    return 'Habilita Correo/Contraseña o Google en Firebase Authentication para el-bodegon-del-licor.';
  }
  return 'No se pudo completar la autenticación. Verifica tus datos o conexión.';
}

export const ProfileAdminModal: React.FC<ProfileAdminModalProps> = ({
  isOpen,
  onClose,
  user,
  isAdmin,
  profile,
  lastOrderId,
  onSaveProfileLocal,
  onReorderItems,
  onOpenTracking,
  onOpenAdminPage,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'orders'>('profile');
  const [form, setForm] = useState<CustomerProfile>({
    ...profile,
    preferredPayment: normalizeCustomerPaymentMethod(profile?.preferredPayment),
  });
  const [savedNotice, setSavedNotice] = useState(false);
  const [profileError, setProfileError] = useState('');

  // Email/Password Auth State
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  // Orders state
  const [myOrders, setMyOrders] = useState<OrderRecord[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [reorderNotice, setReorderNotice] = useState('');

  useEffect(() => {
    setForm({
      ...profile,
      preferredPayment: normalizeCustomerPaymentMethod(profile?.preferredPayment),
    });
  }, [profile]);

  useEffect(() => {
    if (!isOpen) return;
    if (user) {
      setLoadingOrders(true);
      fetchMyOrders(user.uid)
        .then(setMyOrders)
        .catch(() => setMyOrders([]))
        .finally(() => setLoadingOrders(false));
    } else {
      setMyOrders([]);
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleGoogleLogin = async () => {
    setAuthError('');
    setAuthBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(mapFirebaseAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!authEmail.trim() || authPassword.length < 6) {
      setAuthError('Ingresa un correo válido y una contraseña de mínimo 6 caracteres.');
      return;
    }
    setAuthBusy(true);
    try {
      if (authMode === 'register') {
        const cred = await createUserWithEmailAndPassword(
          auth,
          authEmail.trim(),
          authPassword
        );
        const fullName = authName.trim() || authEmail.split('@')[0];
        await updateProfile(cred.user, { displayName: fullName });
        const initialProfile: CustomerProfile = {
          ...form,
          fullName: form.fullName || fullName,
        };
        onSaveProfileLocal(initialProfile);
        await saveUserProfile(cred.user.uid, initialProfile);
      } else {
        await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
      }
      setAuthPassword('');
    } catch (err) {
      setAuthError(mapFirebaseAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setActiveTab('profile');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    onSaveProfileLocal(form);
    if (user) {
      try {
        await saveUserProfile(user.uid, form);
      } catch {
        setProfileError(
          'Se guardó localmente, pero Firestore rechazó la escritura. Verifica las reglas en el-bodegon-del-licor.'
        );
        return;
      }
    }
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleReorder = (order: OrderRecord) => {
    onReorderItems(order.items);
    setReorderNotice(`Se agregaron ${order.items.length} productos al carrito.`);
    setTimeout(() => setReorderNotice(''), 2500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#072146]/70 backdrop-blur-xs p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Perfil de usuario, inicio de sesión y pedidos"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#072146] px-4 sm:px-6 py-3.5 text-white">
          <div className="flex items-center gap-2.5">
            <UserIcon className="h-5 w-5 text-[#F5A623]" />
            <h2 className="font-display text-lg font-extrabold">
              {!user
                ? 'Iniciar Sesión o Perfil'
                : isAdmin
                  ? 'Mi Cuenta & Admin'
                  : 'Mi Perfil y Pedidos'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-white/80 hover:bg-[#1B4F9C]/40 hover:text-white"
            aria-label="Cerrar perfil"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs when signed in */}
        {user && (
          <div className="flex gap-2 border-b border-[#1B4F9C]/15 bg-[#F4F6F9] px-4 sm:px-6 py-2 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className={`min-h-[40px] rounded-xl px-4 text-xs font-bold transition whitespace-nowrap shrink-0 ${
                activeTab === 'profile'
                  ? 'bg-[#072146] text-[#F5A623]'
                  : 'text-[#072146] hover:bg-white'
              }`}
            >
              Mis Datos
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('orders')}
              className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl px-4 text-xs font-bold transition whitespace-nowrap shrink-0 ${
                activeTab === 'orders'
                  ? 'bg-[#072146] text-[#F5A623]'
                  : 'text-[#072146] hover:bg-white'
              }`}
            >
              <Package className="h-3.5 w-3.5" />
              Mis Pedidos ({myOrders.length})
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={onOpenAdminPage}
                className="min-h-[40px] ml-auto inline-flex items-center gap-1.5 rounded-xl bg-[#F5A623] px-4 text-xs font-extrabold text-[#072146] hover:brightness-95 transition whitespace-nowrap shrink-0"
              >
                <Shield className="h-3.5 w-3.5" />
                Abrir Panel /admin
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {!user ? (
            /* AUTH GATE: Google, Correo y Contraseña, o Pedir como invitado */
            <div className="space-y-5">
              {lastOrderId && (
                <div className="rounded-2xl bg-[#072146] p-4 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-wide text-[#F5A623]">
                      Pedido reciente guardado en este dispositivo
                    </p>
                    <p className="mt-0.5 text-sm font-bold">
                      Orden #{lastOrderId.slice(0, 8).toUpperCase()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenTracking(lastOrderId)}
                    className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#F5A623] px-4 text-xs font-extrabold text-[#072146] hover:brightness-95 transition shrink-0"
                  >
                    <Package className="h-4 w-4" />
                    Ver seguimiento en vivo
                  </button>
                </div>
              )}

              <div className="rounded-2xl bg-[#F4F6F9] p-4 sm:p-5 border border-[#1B4F9C]/15 space-y-3">
                <div>
                  <h3 className="font-display text-base font-extrabold text-[#072146]">
                    Guarda tu dirección para futuros pedidos
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm text-[#072146]/75">
                    Inicia sesión o crea tu cuenta para autocompletar tu dirección y repetir pedidos anteriores en segundos.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={authBusy}
                  onClick={handleGoogleLogin}
                  className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#072146] px-4 py-2.5 text-sm font-extrabold text-[#F5A623] hover:bg-[#1B4F9C] disabled:opacity-60 transition"
                >
                  <LogIn className="h-4 w-4" />
                  Continuar con Google
                </button>
              </div>

              {/* Correo y Contraseña */}
              <div className="rounded-2xl bg-white p-4 sm:p-5 border border-[#1B4F9C]/20 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-display text-sm font-extrabold text-[#072146]">
                    <Mail className="h-4 w-4 text-[#1B4F9C]" />
                    Correo y contraseña
                  </span>
                  <div className="inline-flex rounded-xl bg-[#F4F6F9] p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('login');
                        setAuthError('');
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        authMode === 'login'
                          ? 'bg-[#072146] text-white'
                          : 'text-[#072146]/75'
                      }`}
                    >
                      Iniciar sesión
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('register');
                        setAuthError('');
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        authMode === 'register'
                          ? 'bg-[#072146] text-white'
                          : 'text-[#072146]/75'
                      }`}
                    >
                      Crear cuenta
                    </button>
                  </div>
                </div>

                <form onSubmit={handleEmailAuth} className="space-y-3">
                  {authMode === 'register' && (
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Nombre completo
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={SCHEMA_LIMITS.CUSTOMER_NAME_MAX}
                        value={authName}
                        onChange={(e) => setAuthName(e.target.value)}
                        placeholder="Ej. Laura Gómez"
                        className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                      Correo electrónico
                    </label>
                    <input
                      type="email"
                      required
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="tucorreo@ejemplo.com"
                      className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                      Contraseña (mínimo 6 caracteres)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                    />
                  </div>

                  {authError && (
                    <p className="rounded-xl bg-[#C62828]/10 px-3 py-2 text-xs font-bold text-[#C62828]">
                      {authError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={authBusy}
                    className="w-full min-h-[46px] rounded-xl bg-[#F5A623] px-4 py-2.5 text-sm font-extrabold text-[#072146] hover:brightness-95 disabled:opacity-60 transition"
                  >
                    {authBusy
                      ? 'Procesando...'
                      : authMode === 'register'
                        ? 'Crear cuenta e ingresar'
                        : 'Iniciar sesión con correo'}
                  </button>
                </form>
              </div>

              {/* Pedir como invitado */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full min-h-[44px] rounded-xl border border-[#1B4F9C]/25 bg-[#F4F6F9] px-4 py-2.5 text-sm font-bold text-[#072146] hover:bg-[#1B4F9C]/10 transition"
                >
                  Pedir como invitado
                </button>
              </div>
            </div>
          ) : activeTab === 'profile' ? (
            /* SIGNED-IN PROFILE FORM (colección users) */
            <>
              <div className="rounded-2xl bg-[#F4F6F9] p-4 border border-[#1B4F9C]/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#1B4F9C]">Cuenta activa</p>
                  <p className="font-display text-base font-bold text-[#072146] truncate">
                    {form.fullName || user.displayName || user.email}
                  </p>
                  <p className="text-xs text-[#072146]/70 truncate">{user.email}</p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#1B4F9C]/30 bg-white px-4 py-2 text-xs font-bold text-[#072146] hover:bg-[#C62828]/10 hover:text-[#C62828] transition shrink-0"
                >
                  <LogOut className="h-4 w-4" />
                  Cerrar sesión
                </button>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-3">
                <h3 className="font-display text-sm font-extrabold text-[#072146]">
                  Datos guardados para tus domicilios
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                      Nombre completo *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={SCHEMA_LIMITS.CUSTOMER_NAME_MAX}
                      value={form.fullName}
                      onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                      className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                      Celular / WhatsApp *
                    </label>
                    <input
                      type="tel"
                      required
                      maxLength={SCHEMA_LIMITS.PHONE_MAX}
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="300 123 4567"
                      className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                    Dirección exacta *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={SCHEMA_LIMITS.ADDRESS_MAX}
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="Calle 45 # 18-32 Apto 401"
                    className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                      Barrio *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={SCHEMA_LIMITS.NEIGHBORHOOD_MAX}
                      value={form.neighborhood}
                      onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
                      placeholder="Chapinero / El Poblado"
                      className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                      Punto de referencia
                    </label>
                    <input
                      type="text"
                      maxLength={SCHEMA_LIMITS.REFERENCE_MAX}
                      value={form.referencePoint}
                      onChange={(e) => setForm({ ...form, referencePoint: e.target.value })}
                      placeholder="Frente al supermercado / Edificio gris"
                      className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                    Método de pago preferido
                  </label>
                  <select
                    value={form.preferredPayment}
                    onChange={(e) =>
                      setForm({ ...form, preferredPayment: e.target.value as PaymentMethod })
                    }
                    className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 bg-white px-3 text-sm"
                  >
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>

                {profileError && (
                  <p className="rounded-xl bg-[#C62828]/10 px-3 py-2 text-xs font-bold text-[#C62828]">
                    {profileError}
                  </p>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="submit"
                    className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#F5A623] px-5 py-2.5 text-sm font-extrabold text-[#072146] hover:brightness-95 transition"
                  >
                    Guardar perfil
                  </button>
                  {savedNotice && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-[#128C4A]">
                      <Check className="h-4 w-4" />
                      Perfil guardado en Firestore
                    </span>
                  )}
                </div>
              </form>
            </>
          ) : (
            /* MIS PEDIDOS (limit(10) + Volver a pedir) */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-extrabold text-[#072146]">
                  Mis últimos 10 pedidos
                </h3>
                {reorderNotice && (
                  <span className="text-xs font-bold text-[#128C4A]">{reorderNotice}</span>
                )}
              </div>

              {loadingOrders ? (
                <p className="text-xs text-[#072146]/65">Cargando historial...</p>
              ) : myOrders.length === 0 ? (
                <div className="rounded-2xl bg-[#F4F6F9] p-6 text-center text-sm text-[#072146]/70">
                  Aún no tienes pedidos registrados con tu cuenta.
                </div>
              ) : (
                <div className="space-y-3">
                  {myOrders.map((order) => (
                    <div
                      key={order.id}
                      className="rounded-2xl bg-[#F4F6F9] p-4 border border-[#1B4F9C]/15 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-display text-sm font-extrabold text-[#072146]">
                            Orden #{order.id.slice(0, 8).toUpperCase()} · {order.status}
                          </p>
                          <p className="text-xs text-[#072146]/70">
                            {new Date(order.createdAtMs).toLocaleString('es-CO', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}{' '}
                            · {order.paymentMethod}
                          </p>
                        </div>
                        <span className="font-display text-base font-extrabold text-[#072146] tabular-nums shrink-0">
                          {formatCop(order.totalCop)}
                        </span>
                      </div>

                      <ul className="text-xs text-[#072146]/80 space-y-0.5">
                        {order.items.map((item, idx) => (
                          <li key={`${order.id}_${idx}`}>
                            • {item.qty}x {item.name} ({item.presentation})
                            {item.temperature !== 'N/A' ? ` · ${item.temperature}` : ''}
                          </li>
                        ))}
                      </ul>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#1B4F9C]/10">
                        <span className="text-xs text-[#072146]/65 truncate max-w-[210px]">
                          {order.address}, {order.neighborhood}
                        </span>
                        <div className="flex items-center gap-2 ml-auto">
                          <button
                            type="button"
                            onClick={() => onOpenTracking(order.id)}
                            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#072146] px-3 py-2 text-xs font-bold text-white hover:bg-[#1B4F9C] transition whitespace-nowrap shrink-0"
                          >
                            <Package className="h-3.5 w-3.5 text-[#F5A623]" />
                            Seguimiento en vivo
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReorder(order)}
                            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#F5A623] px-3.5 py-2 text-xs font-extrabold text-[#072146] hover:brightness-95 transition whitespace-nowrap shrink-0"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Volver a pedir
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
