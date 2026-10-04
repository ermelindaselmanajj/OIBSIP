const express = require("express");
const { loginAdmin, getCurrentAdmin } = require("../controllers/adminController");
const { requireRole } = require("../middleware/auth");
const router = express.Router();
router.post("/login", loginAdmin);
router.get("/me", requireRole("admin"), getCurrentAdmin);
module.exports = router;
