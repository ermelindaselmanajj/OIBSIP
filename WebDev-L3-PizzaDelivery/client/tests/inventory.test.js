import assert from 'node:assert/strict';
import test from 'node:test';
import { stockStatus, inventorySnapshot, groupInventory, parseCount, inventoryUpdate, replaceInventoryItem } from '../src/components/inventory/helpers.js';
test('status boundaries put zero ahead of threshold and include equality', () => {
  assert.equal(stockStatus(0, 0), 'out-of-stock');
  assert.equal(stockStatus(20, 20), 'low-stock');
  assert.equal(stockStatus(21, 20), 'available');
});
test('counts do not overlap and grouping always includes all four categories', () => {
  const items = [{ id: 'a', category: 'base', stock: 0, threshold: 20 }, { id: 'b', category: 'sauce', stock: 20, threshold: 20 }, { id: 'c', category: 'base', stock: 21, threshold: 20 }];
  assert.deepEqual(inventorySnapshot(items), { total: 3, low: 1, out: 1 });
  const grouped = groupInventory(items);
  assert.deepEqual(grouped.map(g => g.items.length), [2, 1, 0, 0]);
});
test('editor rejects blank, signed, decimal, exponent and unsafe counts', () => {
  for (const value of ['', ' ', '-1', '1.2', '1e3', '+2', '9007199254740992', undefined, 1]) assert.throws(() => parseCount(value));
  assert.equal(parseCount('0'), 0);
  assert.equal(parseCount('9007199254740991'), Number.MAX_SAFE_INTEGER);
});
test('update emits changed fields as numbers and rejects empty changes', () => {
  const item = { stock: 50, threshold: 20 };
  assert.deepEqual(inventoryUpdate(item, { stock: '0', threshold: '20' }), { stock: 0 });
  assert.deepEqual(inventoryUpdate(item, { stock: '50', threshold: '25' }), { threshold: 25 });
  assert.throws(() => inventoryUpdate(item, { stock: '50', threshold: '20' }));
});
test('separate saves replace their own row without losing another update', () => {
  const original = [{ id: 'a', stock: 50 }, { id: 'b', stock: 50 }];
  const result = replaceInventoryItem(replaceInventoryItem(original, { id: 'b', stock: 12 }), { id: 'a', stock: 9 });
  assert.deepEqual(result, [{ id: 'a', stock: 9 }, { id: 'b', stock: 12 }]);
  assert.equal(original[0].stock, 50);
});

test('malformed inventory responses are rejected before rendering', async () => {
  const { validateInventoryItems } = await import('../src/components/inventory/helpers.js');
  const item = { id: 'a', name: 'Italian', category: 'base', stock: 50, threshold: 20 };
  assert.deepEqual(validateInventoryItems([item]), [item]);
  for (const items of [undefined, {}, [null], [{ ...item, stock: '50' }], [{ ...item, threshold: -1 }], [{ ...item, category: 'unknown' }], [item, item]]) {
    assert.throws(() => validateInventoryItems(items));
  }
});
