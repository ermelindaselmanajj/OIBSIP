const path = require("node:path");
const mongoose = require("mongoose");
const Inventory = require("../models/Inventory");

const options = {
  base: ["Classic Thin", "Italian", "Whole Wheat", "Cheese Stuffed", "Gluten Free"],
  sauce: ["Classic Tomato", "BBQ", "Garlic", "Pesto", "Spicy Tomato"],
  cheese: ["Mozzarella", "Cheddar", "Parmesan", "Four Cheese"],
  vegetable: ["Mushrooms", "Olives", "Peppers", "Onions", "Sweet Corn", "Tomatoes"],
};

const seedInventory = async ({ mongoose: db = mongoose, Inventory: Model = Inventory } = {}) => {
  try {
    await db.connect(process.env.MONGO_URI);
    // Refuse to proceed if legacy duplicate records prevent the unique index.
    await Model.createIndexes();
    for (const [category, names] of Object.entries(options)) {
      for (const name of names) {
        const now = new Date();
        try {
          await Model.updateOne({ category, name }, {
            $setOnInsert: { category, name, stock: 50, threshold: 20, createdAt: now, updatedAt: now },
          }, { upsert: true, runValidators: true, timestamps: false });
        } catch (error) {
          // A simultaneous seed may have inserted the same unique key. Verify
          // that exact option now exists; never overwrite or delete it.
          if (error.code !== 11000 || !(await Model.exists({ category, name }))) throw error;
        }
      }
    }
  } finally {
    await db.disconnect();
  }
};

const main = async () => {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI must be configured before seeding inventory.");
    process.exitCode = 1;
    return;
  }
  try {
    await seedInventory();
    console.log("Inventory options seeded; existing items were preserved.");
  } catch {
    console.error("Inventory seed failed. Check database configuration and duplicate category/name records. No records are deleted or overwritten; duplicate records require manual review.");
    process.exitCode = 1;
  }
};

if (require.main === module) main();
module.exports = { seedInventory, options };
