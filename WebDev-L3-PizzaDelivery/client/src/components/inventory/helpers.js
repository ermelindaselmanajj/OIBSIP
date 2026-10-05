export const categories = [
  { key: 'base', label: 'Pizza bases', note: 'The foundation of every pizza' },
  { key: 'sauce', label: 'Sauces', note: 'A little character, a lot of flavour' },
  { key: 'cheese', label: 'Cheeses', note: 'Keep the favourites well stocked' },
  { key: 'vegetable', label: 'Vegetables', note: 'Fresh finishing touches' },
];
export function stockStatus(stock, threshold) {
  return stock === 0 ? 'out-of-stock' : stock <= threshold ? 'low-stock' : 'available';
}
export function inventorySnapshot(items) {
  return { total: items.length, low: items.filter(i => stockStatus(i.stock, i.threshold) === 'low-stock').length, out: items.filter(i => i.stock === 0).length };
}
export function groupInventory(items) {
  return categories.map(category => ({ ...category, items: items.filter(item => item.category === category.key) }));
}
export function parseCount(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Enter a whole number of zero or more.');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('This number is too large.');
  return number;
}
export function inventoryUpdate(item, draft) {
  const stock = parseCount(draft.stock);
  const threshold = parseCount(draft.threshold);
  const changes = {};
  if (stock !== item.stock) changes.stock = stock;
  if (threshold !== item.threshold) changes.threshold = threshold;
  if (!Object.keys(changes).length) throw new Error('Change stock or the low-stock threshold before saving.');
  return changes;
}
export function replaceInventoryItem(items, updated) {
  return items.map(item => item.id === updated.id ? updated : item);
}

export function validateInventoryItems(items) {
  if (!Array.isArray(items) || items.some(item => !item ||
    typeof item.id !== 'string' || !item.id ||
    typeof item.name !== 'string' || !item.name.trim() ||
    !categories.some(category => category.key === item.category) ||
    !Number.isSafeInteger(item.stock) || item.stock < 0 ||
    !Number.isSafeInteger(item.threshold) || item.threshold < 0) ||
    new Set(items.map(item => item.id)).size !== items.length) {
    throw new Error('The server returned an invalid inventory. Please try again.');
  }
  return items;
}
