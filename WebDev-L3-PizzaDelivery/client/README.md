# Pizza Delivery — Level 3

This README covers both React/Vite `client/` and Express/MongoDB `server/`. Commands below start in `WebDev-L3-PizzaDelivery/` unless stated otherwise.

**Stripe-hosted Checkout is the active EUR test-mode provider. Real Stripe sandbox EUR card checkout, authenticated status fallback and signed Stripe CLI webhook forwarding were verified using isolated MongoDB data.** Automated payment regression tests use mocked Stripe. Webhook-only confirmation was verified with the checkout return intercepted and browser confirmation/status endpoints disabled; concurrent replays of the real signed event did not repeat stock deduction or history. The older Razorpay integration remains unverified without Razorpay test keys. No live payments are enabled.

## Requirements and current behavior

| Requirement | Implementation |
| --- | --- |
| Registration and email verification | Password hashing; verification link; login blocked until verified; failed delivery can be retried with the same email/password without replacing the account. |
| JWT authorization | Backend verifies signature, expiration, role and account. Frontend validates sessions through `/api/auth/me` or `/api/admin/me`; user/admin sessions are separate. |
| Forgot/reset password | Email link expires after 15 minutes and is consumed atomically once. SMTP failure preserves the previous reset link. |
| Dashboard and builder | Menu and ingredient loading/error/Retry/empty states. Seeded builder has 5 bases, 5 sauces, 4 cheeses and 6 vegetables. Sold-out options remain visible and disabled; refresh revalidates choices. |
| EUR review and orders | Server-calculated integer cents, quantity 1–10, availability validation, immutable ingredient/price snapshots and idempotency keys. Summaries survive refresh. Existing INR orders retain INR and require rebuilding for EUR checkout. |
| Stripe test checkout | Hosted checkout; authenticated ownership checks; server-verified paid status, session/order association, amount, currency and payment intent. Signed webhook plus authenticated status fallback. Razorpay orders keep their original provider and cannot switch to Stripe. |
| Automatic stock deduction | Transaction deducts every ingredient by pizza quantity and marks paid/confirmed with one Order Received timestamp. Concurrency and rollback were tested with isolated MongoDB and mocked Stripe and Razorpay. |
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

## Stripe test payments

The provider sandbox check created a quantity-two EUR order through the real quote/order API, opened Stripe-hosted Checkout and completed an official test-card payment. On return, the backend retrieved and validated the real test session, payment intent and charge; the UI showed confirmed payment and one **Order Received** entry after refresh. The four selected ingredients each decreased from stock 10 to 8; the other 16 stayed unchanged. Three concurrent status checks caused no additional deduction/history, and paid checkout returned no new session. Wrong-owner access returned 404 and admin access to user payment routes returned 403. Sequential admin updates reached **Sent to Delivery** with three history entries, including repeated-update checks, and user tracking showed the same state. Desktop and mobile layouts were checked. This used a disposable database and no real funds. It verifies the successful card/fallback path, not every decline, cancellation or provider-failure scenario.

A separate webhook-only sandbox check used official Stripe CLI forwarding and its privately captured signing secret. A real EUR 12.00 payment for two pizzas was confirmed by `checkout.session.completed` with HTTP 200, while the checkout return was intercepted and both browser confirmation and status fallback endpoints were disabled (zero requests). Four selected ingredient stocks changed from 10 to 8 and one **Order Received** entry was saved. Three concurrent HTTP replays of that exact real signed event each returned 200 and left the complete order, timestamps and inventory unchanged. These were captured-event replays, not a claim of Stripe automatic retry delivery. Both disposable databases were removed; existing `.env` files and real inventory/orders were preserved. The signing secret was temporary test-process configuration, so normal local forwarding still requires privately configuring the secret for your own active listener.

Keep `STRIPE_SECRET_KEY` in `server/.env` only. It must begin with `sk_test_`; live and restricted-key prefixes are rejected. Stripe-hosted Checkout does not need Stripe.js or a browser publishable key; an existing test `VITE_STRIPE_PUBLISHABLE_KEY` may remain in `client/.env`, but it is not used. Never put a secret key or webhook signing secret in a `VITE_` variable. `STRIPE_WEBHOOK_SECRET` is private and server-only. Missing test keys or MongoDB transaction support produce **Payment currently unavailable**, leaving orders pending.

Checkout uses the saved server-calculated EUR amount in integer cents. A redirect to `?payment=success` does not prove payment. The backend retrieves the saved Stripe session and payment intent and validates test mode, paid/succeeded status, amount, currency, local order metadata and session ownership before confirmation. Webhook signatures are verified against the raw request bytes: `/api/payments/stripe/webhook` is mounted before `express.json()`. Never move the raw-body route below JSON parsing.

Repeated clicks reuse an open session. Expired sessions can be replaced after the server checks their payment status. Paid and review-required orders cannot start another payment. The same shared MongoDB transaction deducts stock, marks paid/confirmed and adds one **Order Received** timestamp, even when webhook and browser status checks race. A received payment blocked by stock/database failures remains pending fulfillment with `review_required`; do not pay again. Use **Check payment status** after legitimate restocking or database recovery. Refunds require manual review and are not automated.

Reopening a saved order works after refresh. Success/cancellation returns trigger an authenticated server status check; **Check payment status** is also available when forwarding is unavailable or a browser return is lost. Webhooks are recommended for confirmation when the customer does not return to the app. There is no automatic background polling of the provider; order tracking polls the local order.

### Local webhook forwarding and isolated manual checkout

Provider testing must use a separate database, not the existing inventory or orders. Start in the project directory and copy configuration privately:

```sh
cp server/.env /private/tmp/pizza-stripe-sandbox.env
chmod 600 /private/tmp/pizza-stripe-sandbox.env
```

Edit only that private copy in your editor. Change the database name in `MONGO_URI` to a new dedicated `pizza_stripe_manual_test` database, preserving the connection credentials. Set `PORT=5002`, `SERVER_URL=http://localhost:5002`, `CLIENT_URL=http://localhost:5174` and `LOW_STOCK_ALERTS_ENABLED=false`. Keep the test Stripe key private. Use a sandbox SMTP inbox for any deliberate manual registration email; automated payment tests never send email. Confirm the database name before any seed or test write. Do not paste configuration contents into terminals, screenshots, messages or Git.

Seed only the isolated database:

```sh
cd server
node --env-file=/private/tmp/pizza-stripe-sandbox.env scripts/seedInventory.js
node --env-file=/private/tmp/pizza-stripe-sandbox.env scripts/seedPrices.js
node --env-file=/private/tmp/pizza-stripe-sandbox.env seedPizzas.js
node --env-file=/private/tmp/pizza-stripe-sandbox.env server.js
```

Preloaded variables take precedence over the existing `server/.env`, which stays unchanged. In another terminal start the client against this sandbox backend:

```sh
cd client
VITE_API_URL=http://localhost:5002/api npm run dev -- --port 5174 --strictPort
```

Install the [official Stripe CLI](https://docs.stripe.com/stripe-cli), then run in another terminal:

```sh
stripe login
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired --forward-to localhost:5002/api/payments/stripe/webhook
```

Do not add `--live` or pass an API key as a command argument. The CLI displays a webhook signing secret locally. Add it privately as `STRIPE_WEBHOOK_SECRET` in `/private/tmp/pizza-stripe-sandbox.env`; do not share or print it again. Restart the sandbox backend and keep `stripe listen` running. A CLI listener's signing secret differs from a Dashboard webhook endpoint's secret; use the one for the active listener.

Open `http://localhost:5174`, register and verify a disposable user through the normal sandbox-email flow, and create an isolated administrator with `node --env-file=/private/tmp/pizza-stripe-sandbox.env scripts/createAdmin.js`. Never modify real accounts or set real payment statuses manually.

Manual checks:

1. Build a pizza, change quantity, review the EUR total and save its pending order. Note isolated stock levels.
2. Choose **Pay … · test**. Confirm the Stripe-hosted page shows the same EUR total and is in test mode. Use Stripe's test card `4242 4242 4242 4242`, a future expiry such as `12/34`, and CVC `123`; enter only disposable test details. See [official testing guidance](https://docs.stripe.com/testing).
3. On return, wait for the backend-confirmed order. Refresh and press **Check payment status** repeatedly. Stock must fall by order quantity exactly once and the history must contain one **Order Received** entry.
4. Cancel a new checkout and refresh its pending summary. Retry should reuse or safely replace the saved provider session without creating another paid order. Test a declined payment with `4000 0000 0000 9995`.
5. In this isolated admin session only, set a selected ingredient's stock to zero after creating a checkout, then finish the test payment. The order must require review, keep fulfillment blocked and prevent another payment. Restock the isolated ingredient and use **Check payment status** to confirm the same payment once.
6. Stop the listener for another test checkout and use the authenticated status fallback after returning. Restart forwarding for subsequent tests. Inspect both roles: confirmed orders can advance sequentially; pending/review-required orders cannot.

Stop the sandbox processes afterward and remove the private temporary configuration when no longer needed. Delete only the specifically created isolated database after confirming its name. These are manual instructions, not a claim that every scenario has already been run against Stripe.

### Existing Razorpay orders

`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_EUR_ENABLED` remain legacy server-only configuration. Stored Razorpay provider IDs and payment snapshots are preserved. **Check payment status** dispatches to the saved provider; it never sends a Razorpay order to Stripe. Existing Razorpay orders cannot launch a new Stripe payment. Resolve any old provider payment before rebuilding the selection as a new EUR order.

**Razorpay provider checkout remains unverified because Razorpay test keys are unavailable.** Its signature/capture/currency checks and atomic stock logic were tested with mocks and isolated MongoDB. Passing these tests does not establish merchant EUR eligibility. See [official international-payments documentation](https://razorpay.com/docs/payments/international-payments/). Existing INR snapshots stay INR and cannot enter EUR checkout.

Pending orders are viewable but cannot enter fulfillment. Never mark real pending orders paid to demonstrate tracking; use isolated fixtures.

## Verification

From `server/`:

```sh
npm test
npm run test:auth:integration
npm run test:admin-verification:integration
npm run test:stock-alerts:integration
npm run test:payments:integration
npm run test:stripe:integration
```

Default backend tests simulate database/provider/SMTP dependencies; local HTTP/JWT tests also exercise routing and cryptography. Integration commands create new randomly named test databases using existing connection settings, exercise real MongoDB behavior and drop only those generated databases. SMTP/Stripe/Razorpay are simulated in automated integration tests. Tests do not start the production scheduler or change real accounts, stock, orders or payment statuses. The database user needs permission to create/drop those isolated databases; forcibly interrupted tests can leave a test database requiring cleanup.

From `client/`:

```sh
node --test tests/*.test.js
npm run lint
npm run build
```

From the Git repository root: `git diff --check`. Frontend tests cover sessions, parsing, selections, drafts, payment handling and visibility-aware polling using simulated responses. Browser checks using mocked API responses and a stubbed hosted checkout do not verify Stripe payment processing or webhook forwarding. Razorpay remains a separate unverified legacy provider.

Manual checks: register/verify/login, request/reset a password, build with different quantities, and refresh a saved order. In a separate admin session, inspect inventory and pending orders. Use a disposable development database to test zero-stock builder options and restore stock afterward. Use the isolated Stripe procedure above to verify provider checkout, one stock deduction, one Order Received timestamp and subsequent admin/user tracking without changing existing data.

Run scheduled alerts in one backend process; multiple replicas require a distributed lock. A crash after SMTP acceptance but before saving delivery state can cause a duplicate retry because SMTP and MongoDB cannot commit together. Normal runs/restarts after persisted delivery do not resend. Details: [INVENTORY.md](../server/INVENTORY.md).
