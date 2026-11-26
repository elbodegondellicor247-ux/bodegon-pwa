# Security Specification — El Bodegón del Licor

## 1. Data Invariants
1. **Default-Deny Safety Net**: Every Firestore path not explicitly matched is denied (`match /{document=**} { allow read, write: if false; }`).
2. **Catalog & Version Integrity**: `settings/store` (`catalogVersion`) and `products/{productId}` (including `costPrice` and inventory counts) can only be created, modified, or deleted by a verified administrator (`email_verified == true` and bootstrapped admin email or `admins/{uid}` document), except atomic stock decrement during active checkout `runTransaction`. Public clients may only read `settings/store` (`get` only) and `products` where `active == true`.
3. **Order Identity & State Integrity**: `App PWA` orders may only be created with `status == 'Pendiente'`, `origin == 'App PWA'`, and `createdAt == request.time`. Admin-only `POS / WhatsApp` sales require `isAdmin()`, `origin == 'POS / WhatsApp'`, and `userId == request.auth.uid`. Guests can never `get`, `list`, `update`, or `delete` orders.
4. **Terminal Order Locking**: Once an order reaches `Entregado` or `Cancelado`, no subsequent updates are allowed.
5. **PII Isolation (`users/{userId}`)**: Customer profiles live at `users/{userId}` and are strictly readable/writable only by the matching owner (`request.auth.uid == userId`). Blanket `isSignedIn()` reads or `list` queries are forbidden.
6. **Financial Operations Isolation (`purchases`, `expenses`, `daily_stats`)**:
   - `purchases/{purchaseId}` and `expenses/{expenseId}` are strictly admin-only (`isAdmin()`), append-only (`allow update, delete: if false`), and require `createdBy == request.auth.uid`, valid `dateKey` (`YYYY-MM-DD`), and `createdAt == request.time`.
   - `daily_stats/{dateKey}` is strictly admin-readable (`allow get, list: if isAdmin()`), enforces `YYYY-MM-DD` document IDs, and allows atomic `increment()` updates from admin POS/purchases/expenses or bounded sales-only increments from `App PWA` checkout.
