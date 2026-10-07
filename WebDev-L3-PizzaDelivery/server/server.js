const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const orderRoutes = require("./routes/orderRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const pizzaRoutes = require("./routes/pizzaRoutes");
const { lowStockScheduler } = require("./services/lowStockScheduler");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/orders", orderRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pizzas", pizzaRoutes);
app.use("/api/ingredients", inventoryRoutes);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected successfully");
    try { lowStockScheduler.start(); }
    catch { console.error("Low-stock scheduler could not start. Check LOW_STOCK_CRON configuration."); }
  })
  .catch(() => console.error("MongoDB connection failed. Check database configuration and network access."));

app.get("/", (req, res) => {
  res.send("Pizza Delivery API is running");
});

app.get("/test", (req, res) => {
  res.send("Server test works");
});

const PORT = Number(process.env.PORT || 5001);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
