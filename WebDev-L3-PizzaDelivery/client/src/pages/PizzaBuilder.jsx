import { useState } from "react";
import { useNavigate } from "react-router-dom";

// BASES
import classicThinImg from "../assets/pizza-builder/bases/classic-thin.jpg";
import italianImg from "../assets/pizza-builder/bases/italian.jpg";
import wholeWheatImg from "../assets/pizza-builder/bases/whole-wheat.jpg";
import cheeseStuffedImg from "../assets/pizza-builder/bases/cheese-stuffed.webp";
import glutenFreeImg from "../assets/pizza-builder/bases/gluten-free.jpg";

// SAUCES
import classicTomatoImg from "../assets/pizza-builder/sauces/classic-tomato.avif";
import bbqImg from "../assets/pizza-builder/sauces/bbq.avif";
import garlicImg from "../assets/pizza-builder/sauces/garlic.webp";
import pestoImg from "../assets/pizza-builder/sauces/pesto.webp";
import spicyTomatoImg from "../assets/pizza-builder/sauces/spicy-tomato.avif";

// CHEESES
import mozzarellaImg from "../assets/pizza-builder/cheeses/mozzarella.jpg";
import cheddarImg from "../assets/pizza-builder/cheeses/cheddar.jpg";
import parmesanImg from "../assets/pizza-builder/cheeses/parmesan.webp";
import fourCheeseImg from "../assets/pizza-builder/cheeses/four-cheese.webp";

// VEGETABLES
import mushroomsImg from "../assets/pizza-builder/vegetables/mushrooms.webp";
import olivesImg from "../assets/pizza-builder/vegetables/olives.jpg";
import peppersImg from "../assets/pizza-builder/vegetables/peppers.jpg";
import onionsImg from "../assets/pizza-builder/vegetables/onions.jpg";
import sweetCornImg from "../assets/pizza-builder/vegetables/sweet-corn.webp";
import tomatoesImg from "../assets/pizza-builder/vegetables/tomatoes.webp";

function PizzaBuilder() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);

  const [pizza, setPizza] = useState({
    base: "",
    sauce: "",
    cheese: "",
    vegetables: [],
  });

  const bases = [
    {
      name: "Classic Thin",
      image: classicThinImg,
    },
    {
      name: "Italian",
      image: italianImg,
    },
    {
      name: "Whole Wheat",
      image: wholeWheatImg,
    },
    {
      name: "Cheese Stuffed",
      image: cheeseStuffedImg,
    },
    {
      name: "Gluten Free",
      image: glutenFreeImg,
    },
  ];

  const sauces = [
    {
      name: "Classic Tomato",
      image: classicTomatoImg,
    },
    {
      name: "BBQ",
      image: bbqImg,
    },
    {
      name: "Garlic",
      image: garlicImg,
    },
    {
      name: "Pesto",
      image: pestoImg,
    },
    {
      name: "Spicy Tomato",
      image: spicyTomatoImg,
    },
  ];

  const cheeses = [
    {
      name: "Mozzarella",
      image: mozzarellaImg,
    },
    {
      name: "Cheddar",
      image: cheddarImg,
    },
    {
      name: "Parmesan",
      image: parmesanImg,
    },
    {
      name: "Four Cheese",
      image: fourCheeseImg,
    },
  ];

  const vegetables = [
    {
      name: "Mushrooms",
      image: mushroomsImg,
    },
    {
      name: "Olives",
      image: olivesImg,
    },
    {
      name: "Peppers",
      image: peppersImg,
    },
    {
      name: "Onions",
      image: onionsImg,
    },
    {
      name: "Sweet Corn",
      image: sweetCornImg,
    },
    {
      name: "Tomatoes",
      image: tomatoesImg,
    },
  ];

  const selectOption = (field, value) => {
    setPizza({
      ...pizza,
      [field]: value,
    });
  };

  const toggleVegetable = (vegetable) => {
    if (pizza.vegetables.includes(vegetable)) {
      setPizza({
        ...pizza,
        vegetables: pizza.vegetables.filter((item) => item !== vegetable),
      });
    } else {
      setPizza({
        ...pizza,
        vegetables: [...pizza.vegetables, vegetable],
      });
    }
  };

  const canContinue = () => {
    if (step === 1) return pizza.base;
    if (step === 2) return pizza.sauce;
    if (step === 3) return pizza.cheese;

    return true;
  };

  return (
    <div className="builder-page">
      <div className="builder-container">
        <div className="builder-top">
          <button
            className="back-button"
            onClick={() => navigate("/dashboard")}
          >
            ← Back
          </button>

          <div>
            <h1>Build Your Pizza 🍕</h1>
            <p>Create your perfect pizza step by step.</p>
          </div>
        </div>

        <div className="builder-progress">
          {[1, 2, 3, 4, 5].map((number) => (
            <div
              key={number}
              className={
                step >= number ? "progress-step active" : "progress-step"
              }
            >
              {number}
            </div>
          ))}
        </div>

        <div className="builder-card">
          {step === 1 && (
            <>
              <p className="builder-step-text">STEP 1 OF 5</p>

              <h2>Choose your pizza base</h2>

              <div className="option-grid">
                {bases.map((base) => (
                  <button
                    key={base.name}
                    type="button"
                    className={
                      pizza.base === base.name
                        ? "option-card selected"
                        : "option-card"
                    }
                    onClick={() => selectOption("base", base.name)}
                  >
                    <img
                      src={base.image}
                      alt={base.name}
                      className="option-image"
                    />

                    <span>{base.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="builder-step-text">STEP 2 OF 5</p>

              <h2>Choose your sauce</h2>

              <div className="option-grid">
                {sauces.map((sauce) => (
                  <button
                    key={sauce.name}
                    type="button"
                    className={
                      pizza.sauce === sauce.name
                        ? "option-card selected"
                        : "option-card"
                    }
                    onClick={() => selectOption("sauce", sauce.name)}
                  >
                    <img
                      src={sauce.image}
                      alt={sauce.name}
                      className="option-image"
                    />

                    <span>{sauce.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="builder-step-text">STEP 3 OF 5</p>

              <h2>Choose your cheese</h2>

              <div className="option-grid">
                {cheeses.map((cheese) => (
                  <button
                    key={cheese.name}
                    type="button"
                    className={
                      pizza.cheese === cheese.name
                        ? "option-card selected"
                        : "option-card"
                    }
                    onClick={() => selectOption("cheese", cheese.name)}
                  >
                    <img
                      src={cheese.image}
                      alt={cheese.name}
                      className="option-image"
                    />

                    <span>{cheese.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <p className="builder-step-text">STEP 4 OF 5</p>

              <h2>Choose your vegetables</h2>

              <p className="builder-description">
                You can choose more than one.
              </p>

              <div className="option-grid">
                {vegetables.map((vegetable) => (
                  <button
                    key={vegetable.name}
                    type="button"
                    className={
                      pizza.vegetables.includes(vegetable.name)
                        ? "option-card selected"
                        : "option-card"
                    }
                    onClick={() => toggleVegetable(vegetable.name)}
                  >
                    <img
                      src={vegetable.image}
                      alt={vegetable.name}
                      className="option-image"
                    />

                    <span>{vegetable.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <p className="builder-step-text">STEP 5 OF 5</p>

              <h2>Your Pizza</h2>

              <div className="pizza-summary">
                <div>
                  <span>Base</span>
                  <strong>{pizza.base}</strong>
                </div>

                <div>
                  <span>Sauce</span>
                  <strong>{pizza.sauce}</strong>
                </div>

                <div>
                  <span>Cheese</span>
                  <strong>{pizza.cheese}</strong>
                </div>

                <div>
                  <span>Vegetables</span>

                  <strong>
                    {pizza.vegetables.length > 0
                      ? pizza.vegetables.join(", ")
                      : "No vegetables"}
                  </strong>
                </div>
              </div>

              <div className="summary-note">
                <strong>Your custom pizza is ready!</strong>

                <p>Review your selections before continuing to your order.</p>
              </div>
            </>
          )}

          <div className="builder-navigation">
            {step > 1 && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setStep(step - 1)}
              >
                Previous
              </button>
            )}

            {step < 5 && (
              <button
                type="button"
                className="auth-button next-button"
                disabled={!canContinue()}
                onClick={() => setStep(step + 1)}
              >
                Continue
              </button>
            )}

            {step === 5 && (
              <button
                type="button"
                className="auth-button next-button"
                onClick={() => alert("Order Summary will be implemented next!")}
              >
                Continue to Order
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PizzaBuilder;
