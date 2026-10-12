const mongoose = require("mongoose");
const path = require("node:path");

const Pizza = require("./models/Pizza");

const pizzas = [
  {
    name: "Margherita",
    description: "Tomato sauce, mozzarella and fresh basil",
    price: 7.5,
    image: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002",
    category: "Classic",
  },
  {
    name: "Pepperoni",
    description: "Tomato sauce, mozzarella and pepperoni",
    price: 9,
    image: "https://images.unsplash.com/photo-1628840042765-356cda07504e",
    category: "Classic",
  },
  {
    name: "Vegetarian",
    description: "Peppers, mushrooms, onions and olives",
    price: 8.5,
    image: "https://images.unsplash.com/photo-1579751626657-72bc17010498",
    category: "Vegetarian",
  },
  {
    name: "Four Cheese",
    description: "Mozzarella, parmesan, gorgonzola and cheddar",
    price: 10,
    image: "https://images.unsplash.com/photo-1571407970349-bc81e7e96d47",
    category: "Cheese",
  },
  {
    name: "BBQ Chicken",
    description: "Chicken, BBQ sauce, mozzarella and red onion",
    price: 11,
    image: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38",
    category: "Special",
  },
  {
    name: "Mushroom Deluxe",
    description: "Mushrooms, mozzarella, garlic and herbs",
    price: 9.5,
    image: "https://images.unsplash.com/photo-1593560708920-61dd98c46a4e",
    category: "Vegetarian",
  },
];

const seedPizzas = async ({ mongoose: db = mongoose, Pizza: Model = Pizza } = {}) => {
  try {
    await db.connect(process.env.MONGO_URI);
    for (const pizza of pizzas) {
      await Model.updateOne({ name: pizza.name }, { $setOnInsert: pizza }, {
        upsert: true, runValidators: true, timestamps: false,
      });
    }
  } finally { await db.disconnect(); }
};

const main = async () => {
  require("dotenv").config({ path: path.resolve(__dirname, ".env"), quiet: true });
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI must be configured before seeding the menu.");
    process.exitCode = 1;
    return;
  }
  try {
    await seedPizzas();
    console.log("Demo menu seeded; existing pizzas, prices and photos were preserved.");
  } catch {
    console.error("Menu seed failed. Check database configuration privately. Existing pizzas are never deleted or overwritten.");
    process.exitCode = 1;
  }
};

if (require.main === module) main();
module.exports = { seedPizzas, pizzas };
