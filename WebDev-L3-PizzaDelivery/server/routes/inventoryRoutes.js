const express = require("express");
const { getIngredients } = require("../controllers/inventoryController");
const { requireRole } = require("../middleware/auth");
const router = express.Router();
router.get("/", requireRole("user"), getIngredients);
module.exports = router;
