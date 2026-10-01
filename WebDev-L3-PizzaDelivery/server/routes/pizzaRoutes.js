const express = require("express");
const router = express.Router();

const { getPizzas } = require("../controllers/pizzaController");
router.get("/test", (req, res) => {
  res.send("Pizza route works");
});
router.get("/", getPizzas);


module.exports = router;
