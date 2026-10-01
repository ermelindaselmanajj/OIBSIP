const Pizza = require("../models/Pizza");

const getPizzas = async (req, res) => {
  try {
    const pizzas = await Pizza.find();

    res.status(200).json(pizzas);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch pizzas",
      error: error.message,
    });
  }
};

module.exports = {
  getPizzas,
};
