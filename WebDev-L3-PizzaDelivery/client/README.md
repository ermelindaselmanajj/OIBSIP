# Pizza Delivery — Level 3

This README covers both React/Vite `client/` and Express/MongoDB `server/`. Commands below start in `WebDev-L3-PizzaDelivery/` unless stated otherwise.

**Razorpay was tested with mocks. Provider checkout remains unverified because Razorpay test keys are unavailable.** Passing local tests does not establish this merchant account's EUR eligibility. No real payment or provider test checkout was performed.

## Requirements and current behavior

| Requirement | Implementation |
| --- | --- |
| Registration and email verification | Password hashing; verification link; login blocked until verified; failed delivery can be retried with the same email/password without replacing the account. |
| JWT authorization | Backend verifies signature, expiration, role and account. Frontend validates sessions through `/api/auth/me` or `/api/admin/me`; user/admin sessions are separate. |
| Forgot/reset password | Email link expires after 15 minutes and is consumed atomically once. SMTP failure preserves the previous reset link. |
| Dashboard and builder | Menu and ingredient loading/error/Retry/empty states. Seeded builder has 5 bases, 5 sauces, 4 cheeses and 6 vegetables. Sold-out options remain visible and disabled; refresh revalidates choices. |
| EUR review and orders | Server-calculated integer cents, quantity 1–10, availability validation, immutable ingredient/price snapshots and idempotency keys. Summaries survive refresh. Existing INR orders retain INR and require rebuilding for EUR checkout. |
| Razorpay test checkout | HMAC and provider payment/order/amount/currency/captured checks, cancellation/failure/retry/reconciliation. **Provider behavior was simulated; actual provider checkout is unverified.** |
| Automatic stock deduction | Transaction deducts every ingredient by pizza quantity and marks paid/confirmed with one Order Received timestamp. Concurrency and rollback were tested with isolated MongoDB and mocked Razorpay. |
| Separate administrator access | Manual admin creation only; public registration cannot create admins. No fake-payment endpoint or public admin-registration endpoint. |
| Inventory management | Four categories; stock/threshold editing with nonnegative integer validation; available, low-stock and out-of-stock indicators. |
| Scheduled low-stock alerts | node-cron checks stock at or below each threshold, including zero. Only verified admins receive alerts. Persistent delivery state prevents ordinary repeated/restart sends; restocking enables a new alert. |
| Admin orders and user tracking | Pagination/filters, ownership restrictions, three timestamped stages and server-validated transitions. Only paid, confirmed orders enter fulfillment. Visible tracking pages poll every 5 seconds without overlapping requests. |

Email delivery in automated tests is simulated. SMTP acceptance is not proof of inbox delivery.

## Setup

Use Node.js **22.12 or later** (checks used Node 24.12) and npm. MongoDB must support transactions: Atlas or a local replica set, not standalone MongoDB.

Install locked dependencies:

```sh
cd server
npm ci
cd ../client
npm ci
```

Preserve existing local `.env` files. Never commit them or copy credentials into documentation. Actual environment values must be plain text, without Markdown links, trailing backticks or backslashes. No `.env.example` files are required.

Configure `server/.env` privately:

| Variable | Purpose |
| --- | --- |
| `MONGO_URI` | Private MongoDB connection string including the application database name. |
| `JWT_SECRET` | Private, strong signing secret. |
| `MAILTRAP_HOST`, `MAILTRAP_PORT`, `MAILTRAP_USER`, `MAILTRAP_PASS` | Existing SMTP variable names; values come from your SMTP provider. |
| `PORT` | Local backend port: `5001`. |
| `SERVER_URL` | Backend origin: `http://localhost:5001`; verification links. |
| `CLIENT_URL` | Frontend origin: `http://localhost:5173`; password-reset links and redirects. |
| `LOW_STOCK_CRON` | Optional UTC schedule; default `*/15 * * * *` (every 15 minutes). |
| `LOW_STOCK_ALERTS_ENABLED` | Set to `false` to disable scheduled emails; otherwise scheduling starts after MongoDB connects. |

`CLIENT_URL` and `SERVER_URL` are HTTP(S) origins without `/api` or another path. `client/.env` needs this non-secret value:

```text
VITE_API_URL=http://localhost:5001/api
```

Start two terminals from the project directory:

```sh
# Terminal 1
cd server
npm run dev
```

```sh
# Terminal 2
cd client
npm run dev
```

Open `http://localhost:5173`. Vite uses a strict port; identify an existing process before stopping it if 5173 or 5001 is occupied. Restart the appropriate process after configuration changes. `npm start` in `server/` runs without watch mode.

## Demo data and accounts

In `server/`, populate a development database when needed:

```sh
npm run seed-inventory
npm run seed-prices
npm run seed-pizzas
```

Inventory seeding adds missing named options with stock 50 and threshold 20, preserving existing IDs/stock/thresholds. Price seeding uses euro-cent demo prices documented in [seedPrices.js](../server/scripts/seedPrices.js): it fills missing prices and migrates known INR/unlabelled demo ingredients while preserving existing EUR prices and inventory quantities. Saved order snapshots are never migrated. Menu seeding adds missing names and preserves existing records, prices and photos. Seeds write to the configured database, are unnecessary every startup, and were not run against real data during the final review.

For a new administrator, run `npm run create-admin` in an interactive terminal. Email/password are prompted; passwords are hidden, require at least 12 characters and at most 72 UTF-8 bytes. Never supply credentials as command arguments. Existing accounts are rejected rather than overwritten.

Sign in at `/admin/login`, choose **Send verification email** in the inventory dashboard, open the 30-minute link, then refresh email status. Admin login works before verification, but alerts require verified email ownership. Never manually set `isVerified` or change roles to bypass verification. Mailtrap Sandbox captures messages in a testing inbox rather than delivering to real mailboxes; verifying a real address requires SMTP delivery there. Users register and follow their verification link before signing in at `/login`. User passwords must be nonempty and at most 72 UTF-8 bytes.

## Razorpay configuration and remaining limitations

Keep `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `server/.env` only. The app rejects live-key IDs and requires a test key beginning with `rzp_test_`. Do not invent keys or put the secret in a `VITE_` variable. Set `RAZORPAY_EUR_ENABLED=true` only after confirming this merchant account's EUR/international-payment access. Missing keys, EUR opt-in or transaction support produce **Payment currently unavailable**, leaving orders pending.

Razorpay lists EUR with two decimal places; merchant eligibility/activation must be checked separately. See [official international-payments documentation](https://razorpay.com/docs/payments/international-payments/). Configure automatic capture and use only official test payment details when access becomes available; see [official integration/test-mode instructions](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/). The app never converts EUR to INR or trusts frontend totals.

Browser success alone cannot mark an order paid. After a lost callback, cancellation or failed confirmation, reopen the saved order and use **Check payment status**. Recovery is explicit; there is no provider webhook/background reconciliation service. Captured payments blocked by stock/database failures remain `review_required`, cannot pay again and do not enter fulfillment. Legitimate restocking/database recovery allows reconciliation of the same payment. Refunds and unresolved provider setup/account conflicts require manual review; refunds are not automated.

Pending orders are viewable but cannot enter fulfillment. Never mark real pending orders paid to demonstrate tracking; use isolated test fixtures.

## Verification

From `server/`:

```sh
npm test
npm run test:auth:integration
npm run test:admin-verification:integration
npm run test:stock-alerts:integration
npm run test:payments:integration
```

Default backend tests simulate database/provider/SMTP dependencies; local HTTP/JWT tests also exercise routing and cryptography. Integration commands create new randomly named test databases using existing connection settings, exercise real MongoDB behavior and drop only those generated databases. SMTP/Razorpay are always simulated. Tests do not start the production scheduler or change real accounts, stock, orders or payment statuses. The database user needs permission to create/drop those isolated databases; forcibly interrupted tests can leave a test database requiring cleanup.

From `client/`:

```sh
node --test tests/*.test.js
npm run lint
npm run build
```

From the Git repository root: `git diff --check`. Frontend tests cover sessions, parsing, selections, drafts, payment handling and visibility-aware polling using simulated responses. Browser tests with a simulated SDK do not verify the actual Razorpay window.

Manual checks: register/verify/login, request/reset a password, build with different quantities, and refresh a saved order. In a separate admin session, inspect inventory and pending orders. Use a disposable development database to test zero-stock builder options and restore stock afterward. Once legitimate test keys and EUR access exist, test provider checkout, one stock deduction, one Order Received timestamp and subsequent admin/user tracking.

Run scheduled alerts in one backend process; multiple replicas require a distributed lock. A crash after SMTP acceptance but before saving delivery state can cause a duplicate retry because SMTP and MongoDB cannot commit together. Normal runs/restarts after persisted delivery do not resend. Details: [INVENTORY.md](../server/INVENTORY.md).
