const path = require("node:path");
const mongoose = require("mongoose");
const Inventory = require("../models/Inventory");
const { CURRENCY, isEURPrice } = require("../services/pricing");
// Demo prices in euro cents; these replace the old, unlabelled INR demo prices.
const demoPrices = {
  base: { "Classic Thin": 350, Italian: 400, "Whole Wheat": 450, "Cheese Stuffed": 550, "Gluten Free": 500 },
  sauce: { "Classic Tomato": 50, BBQ: 75, Garlic: 60, Pesto: 100, "Spicy Tomato": 75 },
  cheese: { Mozzarella: 125, Cheddar: 150, Parmesan: 175, "Four Cheese": 200 },
  vegetable: { Mushrooms: 75, Olives: 100, Peppers: 60, Onions: 50, "Sweet Corn": 75, Tomatoes: 60 },
};
const seedPrices = async ({ mongoose: db = mongoose, Inventory: Model = Inventory } = {}) => {
  try {
    await db.connect(process.env.MONGO_URI);
    let updated = 0;
    for (const [category, prices] of Object.entries(demoPrices)) {
      for (const [name, priceMinor] of Object.entries(prices)) {
        const result = await Model.updateOne({ category, name, $or: [
          { priceCurrency: { $exists: false } }, { priceCurrency: "INR" },
          { priceCurrency: CURRENCY, priceMinor: { $exists: false } },
        ] }, { $set: { priceMinor, priceCurrency: CURRENCY } }, { runValidators: true, timestamps: false });
        updated += result.modifiedCount || 0;
      }
    }
    const rows = await Model.find({}, { priceMinor: 1, priceCurrency: 1 });
    const unpriced = rows.filter(row => !isEURPrice(row)).length;
    return { updated, unpriced };
  } finally { await db.disconnect(); }
};
const main = async () => {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI must be configured before pricing inventory."); process.exitCode = 1; return;
  }
  try {
    const { updated, unpriced } = await seedPrices();
    console.log(`EUR demo prices updated: ${updated}. Ingredients without a valid EUR price: ${unpriced}. Existing EUR prices and inventory quantities preserved.`);
  } catch {
    console.error("EUR price migration failed. Check database configuration. Rerunning safely completes remaining updates; inventory quantities and existing EUR prices are preserved.");
    process.exitCode = 1;
  }
};
if (require.main === module) main();
module.exports = { seedPrices, demoPrices };
