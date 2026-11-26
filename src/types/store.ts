export type ProductCategory =
  | 'Todo'
  | 'Combos'
  | 'Cervezas'
  | 'Licores'
  | 'Snacks'
  | 'Cigarrillos';

export type StorageCategory = Exclude<ProductCategory, 'Todo'>;

export type TemperatureOption = 'Fría' | 'Al clima' | 'N/A';

export type PaymentMethod = 'Nequi' | 'Daviplata' | 'Bancolombia / Bre-B';

export type LegacyPaymentMethod =
  | 'Nequi / Daviplata (Transferencia)'
  | 'Efectivo contraentrega'
  | 'Datáfono contraentrega';

export type PosPaymentMethod = 'Efectivo' | 'Nequi / Daviplata' | 'Datáfono';

export type AnyOrderPaymentMethod = PaymentMethod | PosPaymentMethod | LegacyPaymentMethod;

export type OrderOrigin = 'App PWA' | 'POS / WhatsApp';

export type OrderStatus =
  | 'Pendiente'
  | 'Confirmado'
  | 'En camino'
  | 'Entregado'
  | 'Cancelado';

export type PurchasePaymentSource = 'Caja Efectivo' | 'Transferencia / Banco';

export type ExpenseCategory =
  | 'Domiciliarios / Gasolina'
  | 'Hielo y Bolsas'
  | 'Servicios / Arriendo'
  | 'Nómina / Turnos'
  | 'Otros';

export type ExpensePaymentSource = 'Efectivo de caja' | 'Nequi / Banco';

export interface Product {
  id: string;
  name: string;
  presentation: string;
  category: StorageCategory;
  priceCop: number;
  costPrice: number;
  stock: number;
  supportsColdOption: boolean;
  imageUrl: string;
  active: boolean;
  sortOrder: number;
  searchLower: string;
}

export interface StoreSettings {
  catalogVersion: number;
  storeOpen: boolean;
  deliveryFeeCop: number;
  freeDeliveryMinCop: number;
  transferNequi: string;
  transferDaviplata: string;
  transferBancolombiaKey: string;
  transferHolderName: string;
  storeLat: number;
  storeLng: number;
  maxDeliveryKm: number;
  allowedNeighborhoods: string[];
}

export interface CartItem {
  product: Product;
  qty: number;
  temperature: TemperatureOption;
}

export interface CustomerProfile {
  fullName: string;
  phone: string;
  address: string;
  neighborhood: string;
  referencePoint: string;
  preferredPayment: PaymentMethod;
  email?: string;
  role?: 'customer' | 'admin';
  isAdmin?: boolean;
}

export interface OrderItem {
  productId: string;
  name: string;
  presentation: string;
  qty: number;
  unitPriceCop: number;
  unitCostCop?: number;
  temperature: TemperatureOption;
}

export interface OrderRecord {
  id: string;
  userId: string;
  isGuest: boolean;
  customerName: string;
  phone: string;
  address: string;
  neighborhood: string;
  referencePoint: string;
  paymentMethod: AnyOrderPaymentMethod;
  receiptLast4?: string;
  cashTenderCop: number;
  notes: string;
  items: OrderItem[];
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  cogsCop?: number;
  dateKey?: string;
  status: OrderStatus;
  origin: OrderOrigin;
  createdAtMs: number;
}

export interface PurchaseItem {
  productId: string;
  name: string;
  presentation: string;
  qty: number;
  unitCostCop: number;
}

export interface PurchaseRecord {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  paymentSource: PurchasePaymentSource;
  items: PurchaseItem[];
  totalCostCop: number;
  notes: string;
  dateKey: string;
  createdBy: string;
  createdAtMs: number;
}

export interface ExpenseRecord {
  id: string;
  concept: string;
  category: ExpenseCategory;
  amountCop: number;
  paymentSource: ExpensePaymentSource;
  notes: string;
  dateKey: string;
  createdBy: string;
  createdAtMs: number;
}

export interface DailyStatsRecord {
  dateKey: string;
  salesTotalCop: number;
  salesCashCop: number;
  salesNequiCop: number;
  salesCardCop: number;
  cogsTotalCop: number;
  purchasesTotalCop: number;
  purchasesCashCop: number;
  purchasesBankCop: number;
  expensesTotalCop: number;
  expensesCashCop: number;
  expensesBankCop: number;
  ordersCount: number;
  purchasesCount: number;
  expensesCount: number;
}

export const CATEGORIES: ProductCategory[] = [
  'Todo',
  'Combos',
  'Cervezas',
  'Licores',
  'Snacks',
  'Cigarrillos',
];

export const STORAGE_CATEGORIES: StorageCategory[] = [
  'Combos',
  'Cervezas',
  'Licores',
  'Snacks',
  'Cigarrillos',
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  'Nequi',
  'Daviplata',
  'Bancolombia / Bre-B',
];

export function normalizeCustomerPaymentMethod(raw?: string): PaymentMethod {
  if (raw === 'Daviplata') return 'Daviplata';
  if (raw === 'Bancolombia / Bre-B') return 'Bancolombia / Bre-B';
  return 'Nequi';
}

export const POS_PAYMENT_METHODS: PosPaymentMethod[] = [
  'Efectivo',
  'Nequi / Daviplata',
  'Datáfono',
];

export const PURCHASE_PAYMENT_SOURCES: PurchasePaymentSource[] = [
  'Caja Efectivo',
  'Transferencia / Banco',
];

export const COMMON_SUPPLIERS: string[] = [
  'Bavaria',
  'Distribuidora',
  'Cigarrería',
  'Fábrica de Licores',
  'Otro',
];

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Domiciliarios / Gasolina',
  'Hielo y Bolsas',
  'Servicios / Arriendo',
  'Nómina / Turnos',
  'Otros',
];

export const EXPENSE_PAYMENT_SOURCES: ExpensePaymentSource[] = [
  'Efectivo de caja',
  'Nequi / Banco',
];

export const WHATSAPP_NUMBER = '573043806922';
export const ADMIN_EMAIL = 'elbodegondellicor247@gmail.com';

export const SCHEMA_LIMITS = {
  NAME_MAX: 120,
  PRESENTATION_MAX: 80,
  IMAGE_URL_MAX: 500,
  CUSTOMER_NAME_MAX: 100,
  PHONE_MAX: 20,
  ADDRESS_MAX: 180,
  NEIGHBORHOOD_MAX: 100,
  REFERENCE_MAX: 180,
  NOTES_MAX: 280,
  ORDER_ITEMS_MAX: 30,
  SUPPLIER_MAX: 120,
  INVOICE_MAX: 60,
  CONCEPT_MAX: 140,
  RECEIPT_LAST4_MAX: 4,
  TRANSFER_FIELD_MAX: 80,
};
