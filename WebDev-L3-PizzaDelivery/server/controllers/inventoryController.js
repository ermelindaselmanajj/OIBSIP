const Inventory = require("../models/Inventory");
const { CURRENCY, isEURPrice } = require("../services/pricing");

const inventoryStatus = ({ stock, threshold }) => stock === 0 ? "out-of-stock" : stock <= threshold ? "low-stock" : "available";
const inventoryItem = (item) => ({
  id: String(item._id), name: item.name, category: item.category,
  stock: item.stock, threshold: item.threshold, priceMinor: isEURPrice(item) ? item.priceMinor : null,
  status: inventoryStatus(item), updatedAt: item.updatedAt,
});

const getInventory = async (req, res) => {
  try {
    const items = await Inventory.find().sort({ category: 1, name: 1 });
    return res.json({ currency: CURRENCY, items: items.map(inventoryItem) });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

const updateInventory = async (req, res) => {
  if (typeof req.params.id !== "string" || !/^[a-f\d]{24}$/i.test(req.params.id)) {
    return res.status(400).json({ message: "Invalid inventory ID" });
  }
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ message: "Provide stock and/or threshold as nonnegative safe integers" });
  }
  const fields = Object.keys(body);
  if (!fields.length || fields.some(key => !["stock", "threshold"].includes(key)) ||
      fields.some(key => !Number.isSafeInteger(body[key]) || body[key] < 0)) {
    return res.status(400).json({ message: "Provide only stock and/or threshold as nonnegative safe integers" });
  }
  try {
    const changes = {};
    for (const key of fields) changes[key] = body[key];
    const item = await Inventory.findByIdAndUpdate(req.params.id, { $set: changes }, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ message: "Inventory item not found" });
    return res.json({ message: "Inventory updated", item: inventoryItem(item) });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

const getIngredients = async (req, res) => {
  try {
    const items = await Inventory.find().sort({ category: 1, name: 1 });
    return res.json({ currency: CURRENCY, ingredients: items.map(item => ({
      id: String(item._id), name: item.name, category: item.category, available: item.stock > 0, priceMinor: isEURPrice(item) ? item.priceMinor : null,
    })) });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = { getInventory, updateInventory, getIngredients, inventoryStatus };
