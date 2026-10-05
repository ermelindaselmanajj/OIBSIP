# Inventory and ingredient availability

`GET /api/admin/inventory` requires an authenticated administrator and returns `{items:[{id,name,category,stock,threshold,status,updatedAt}]}`. Status is `out-of-stock` for stock 0, `low-stock` for positive stock at or below the threshold, and `available` above the threshold.

`PATCH /api/admin/inventory/:id` requires an administrator. Send stock, threshold, or both as numeric nonnegative safe integers; zero is allowed. Unknown fields, numeric strings, fractions, invalid IDs and empty bodies receive 400. Missing items receive 404. Missing/invalid sessions receive 401 and valid user sessions receive 403. Database failures return a generic 500. This phase supports manual updates only and does not decrement stock.

`GET /api/ingredients` requires a verified user session. It returns `{ingredients:[{id,name,category,available}]}`, including out-of-stock items with available=false. It does not expose stock counts or thresholds. Administrators receive 403 for this user endpoint.

Categories are base, sauce, cheese and vegetable. Names are trimmed and internal whitespace is collapsed. A unique index on category and name prevents duplicate exact options. Stock and threshold have schema validation for nonnegative safe integers.

To populate the 20 builder options, manually run `npm run seed-inventory` from server/. It loads server/.env using an absolute path and initializes the unique index before inserting. New entries receive stock 50 and threshold 20. Existing entries, including edited stock, thresholds and timestamps, are preserved using only $setOnInsert. Repeated and concurrent runs do not overwrite or delete records. If legacy duplicates prevent the index, the script fails and reports a generic message; review those records manually. Failures after some inserts may leave a partial seed; rerunning safely fills missing options. Database connections are closed on success or failure. Never use the unrelated destructive pizza seed as an inventory seed.

The automated tests mock the database. Local verification also ran the seed against real MongoDB and confirmed that both inventory APIs returned all 20 ingredients with matching record IDs. The builder's response parser accepted the real API payload. An empty ingredient array means the inventory has no records; failed requests or malformed responses show an error with Retry.

The builder checks availability on refresh, when returning to the tab, and before advancing. Unavailable ingredients remain visible but disabled; selections that become unavailable are removed. Ingredient photos retain their original files and use consistent 4:3 frames with individual framing adjustments. All four categories were inspected in Chrome headless at desktop and mobile widths (1440, 390 and 320 pixels).
