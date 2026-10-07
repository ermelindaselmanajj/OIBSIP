// Isolated test fixtures only. Never used by an HTTP creation/payment endpoint.
const pendingOrder = (overrides = {}) => ({
  _id: '444444444444444444444444', user: '111111111111111111111111', status: 'pending_payment',
  currency: 'EUR', quantity: 1,
  items: ['base','sauce','cheese'].map((category,index) => ({ ingredientId: String(index+5).repeat(24), name: `Fixture ${category}`, category, unitPriceMinor: 100, quantity: 1, lineTotalMinor: 100 })),
  unitTotalMinor: 300, totalMinor: 300,
  idempotencyKey: 'isolated-tracking-fixture-key', selectionHash: 'a'.repeat(64),
  createdAt: new Date('2026-10-07T10:00:00Z'), updatedAt: new Date('2026-10-07T10:00:00Z'),
  ...overrides,
});
const confirmedOrder = (overrides = {}) => pendingOrder({
  status: 'confirmed', paymentStatus: 'paid', fulfillmentStatus: 'order_received',
  confirmedAt: new Date('2026-10-07T10:01:00Z'),
  fulfillmentHistory: [{ status: 'order_received', at: new Date('2026-10-07T10:01:00Z') }],
  ...overrides,
});
module.exports = { pendingOrder, confirmedOrder };
