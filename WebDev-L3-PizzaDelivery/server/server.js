const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const pizzaRoutes = require("./routes/pizzaRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pizzas", pizzaRoutes);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((error) => console.log("MongoDB connection error:", error));

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
