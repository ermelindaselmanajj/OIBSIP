const crypto = require("node:crypto");
const Inventory = require("../models/Inventory");
const { CURRENCY, isEURPrice } = require("./pricing");
const idPattern = /^[a-f\d]{24}$/i;
const error = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const normalizeSelection = (body, creating = false) => {
  const fields = ["baseId", "sauceId", "cheeseId", "vegetableIds", "quantity"];
  if (creating) fields.push("quoteFingerprint", "idempotencyKey");
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== fields.length || Object.keys(body).some(key => !fields.includes(key)) ||
      ![body.baseId, body.sauceId, body.cheeseId].every(id => typeof id === "string" && idPattern.test(id)) ||
      !Array.isArray(body.vegetableIds) || body.vegetableIds.length > 100 ||
      !body.vegetableIds.every(id => typeof id === "string" && idPattern.test(id)) ||
      !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 10) {
    throw error(400, "INVALID_SELECTION", "Provide valid ingredient IDs and quantity from 1 to 10.");
  }
  const selection = {
    baseId: body.baseId.toLowerCase(), sauceId: body.sauceId.toLowerCase(), cheeseId: body.cheeseId.toLowerCase(),
    vegetableIds: body.vegetableIds.map(id => id.toLowerCase()).sort(), quantity: body.quantity,
  };
  if (new Set(selection.vegetableIds).size !== selection.vegetableIds.length) {
    throw error(400, "INVALID_SELECTION", "Select each vegetable only once.");
  }
  if (creating && (typeof body.quoteFingerprint !== "string" || !/^[a-f\d]{64}$/i.test(body.quoteFingerprint) ||
      typeof body.idempotencyKey !== "string" || !/^[A-Za-z\d_-]{16,128}$/.test(body.idempotencyKey))) {
    throw error(400, "INVALID_SELECTION", "Provide a valid quote fingerprint and idempotency key.");
  }
  return selection;
};
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const selectionHash = selection => hash(selection);
const safeSum = (a, b) => {
  const value = a + b;
  if (!Number.isSafeInteger(value)) throw error(409, "PRICE_UNAVAILABLE", "The selection price is outside the supported range.");
  return value;
};
const buildQuote = async selection => {
  const expected = [
    [selection.baseId, "base"], [selection.sauceId, "sauce"], [selection.cheeseId, "cheese"],
    ...selection.vegetableIds.map(id => [id, "vegetable"]),
  ];
  const records = await Inventory.find({ _id: { $in: expected.map(([id]) => id) } });
  const byId = new Map(records.map(item => [String(item._id).toLowerCase(), item]));
  if (expected.some(([id, category]) => !byId.has(id) || byId.get(id).category !== category)) {
    throw error(400, "INVALID_SELECTION", "One or more ingredients do not exist or have the wrong category.");
  }
  const unavailable = expected.filter(([id]) => !Number.isSafeInteger(byId.get(id).stock) || byId.get(id).stock < selection.quantity).map(([id]) => id);
  if (unavailable.length) throw error(409, "INGREDIENT_UNAVAILABLE", "Lower the quantity or refresh the available ingredients.", { ingredientIds: unavailable });
  const unpriced = expected.filter(([id]) => !isEURPrice(byId.get(id))).map(([id]) => id);
  if (unpriced.length) throw error(409, "PRICE_UNAVAILABLE", "Prices are unavailable for some ingredients. Refresh or try again later.", { ingredientIds: unpriced });
  let unitTotalMinor = 0;
  const items = expected.map(([ingredientId, category]) => {
    const ingredient = byId.get(ingredientId);
    unitTotalMinor = safeSum(unitTotalMinor, ingredient.priceMinor);
    const lineTotalMinor = ingredient.priceMinor * selection.quantity;
    if (!Number.isSafeInteger(lineTotalMinor)) throw error(409, "PRICE_UNAVAILABLE", "The selection price is outside the supported range.");
    return { ingredientId, name: ingredient.name, category, unitPriceMinor: ingredient.priceMinor, quantity: selection.quantity, lineTotalMinor };
  });
  const totalMinor = unitTotalMinor * selection.quantity;
  if (!Number.isSafeInteger(totalMinor)) throw error(409, "PRICE_UNAVAILABLE", "The selection price is outside the supported range.");
  const snapshot = { currency: CURRENCY, quantity: selection.quantity, items, unitTotalMinor, totalMinor };
  return { ...snapshot, fingerprint: hash(snapshot) };
};
module.exports = { normalizeSelection, selectionHash, buildQuote, error };
