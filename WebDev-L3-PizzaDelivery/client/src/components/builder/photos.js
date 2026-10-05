import classicThinImg from "../../assets/pizza-builder/bases/classic-thin.jpg";
import italianImg from "../../assets/pizza-builder/bases/italian.jpg";
import wholeWheatImg from "../../assets/pizza-builder/bases/whole-wheat.jpg";
import cheeseStuffedImg from "../../assets/pizza-builder/bases/cheese-stuffed.webp";
import glutenFreeImg from "../../assets/pizza-builder/bases/gluten-free.jpg";
import classicTomatoImg from "../../assets/pizza-builder/sauces/classic-tomato.avif";
import bbqImg from "../../assets/pizza-builder/sauces/bbq.avif";
import garlicImg from "../../assets/pizza-builder/sauces/garlic.webp";
import pestoImg from "../../assets/pizza-builder/sauces/pesto.webp";
import spicyTomatoImg from "../../assets/pizza-builder/sauces/spicy-tomato.avif";
import mozzarellaImg from "../../assets/pizza-builder/cheeses/mozzarella.jpg";
import cheddarImg from "../../assets/pizza-builder/cheeses/cheddar.jpg";
import parmesanImg from "../../assets/pizza-builder/cheeses/parmesan.webp";
import fourCheeseImg from "../../assets/pizza-builder/cheeses/four-cheese.webp";
import mushroomsImg from "../../assets/pizza-builder/vegetables/mushrooms.webp";
import olivesImg from "../../assets/pizza-builder/vegetables/olives.jpg";
import peppersImg from "../../assets/pizza-builder/vegetables/peppers.jpg";
import onionsImg from "../../assets/pizza-builder/vegetables/onions.jpg";
import sweetCornImg from "../../assets/pizza-builder/vegetables/sweet-corn.webp";
import tomatoesImg from "../../assets/pizza-builder/vegetables/tomatoes.webp";

const photos = {
  "base:Classic Thin": classicThinImg,
  "base:Italian": italianImg,
  "base:Whole Wheat": wholeWheatImg,
  "base:Cheese Stuffed": cheeseStuffedImg,
  "base:Gluten Free": glutenFreeImg,
  "sauce:Classic Tomato": classicTomatoImg,
  "sauce:BBQ": bbqImg,
  "sauce:Garlic": garlicImg,
  "sauce:Pesto": pestoImg,
  "sauce:Spicy Tomato": spicyTomatoImg,
  "cheese:Mozzarella": mozzarellaImg,
  "cheese:Cheddar": cheddarImg,
  "cheese:Parmesan": parmesanImg,
  "cheese:Four Cheese": fourCheeseImg,
  "vegetable:Mushrooms": mushroomsImg,
  "vegetable:Olives": olivesImg,
  "vegetable:Peppers": peppersImg,
  "vegetable:Onions": onionsImg,
  "vegetable:Sweet Corn": sweetCornImg,
  "vegetable:Tomatoes": tomatoesImg,
};

const photoFraming = {
  "base:Classic Thin": { fit: "cover", position: "50% 75%" },
  "base:Italian": { scale: 0.95 },
  "base:Cheese Stuffed": { scale: 1.08 },
  "base:Gluten Free": { scale: 0.95 },
  "sauce:Garlic": { scale: 1.35, offsetY: "-10%" },
  "sauce:Pesto": { scale: 0.9 },
  "sauce:Spicy Tomato": { scale: 1.1 },
  "cheese:Mozzarella": { scale: 1.4 },
  "cheese:Parmesan": { scale: 1.2, offsetY: "-10%" },
  "cheese:Four Cheese": { scale: 1.25, offsetY: "-5%" },
  "vegetable:Mushrooms": { scale: 0.96 },
  "vegetable:Olives": { scale: 0.9 },
  "vegetable:Peppers": { scale: 1.06 },
  "vegetable:Onions": { scale: 1.18 },
  "vegetable:Sweet Corn": { scale: 1.05 },
  "vegetable:Tomatoes": { scale: 1.16 },
};

const photoKey = (ingredient) => `${ingredient.category}:${ingredient.name}`;
export const ingredientPhoto = (ingredient) => photos[photoKey(ingredient)];

export function ingredientPhotoStyle(ingredient) {
  const framing = photoFraming[photoKey(ingredient)];
  if (!framing) return undefined;
  return {
    "--photo-fit": framing.fit,
    "--photo-position": framing.position,
    "--photo-scale": framing.scale,
    "--photo-offset-y": framing.offsetY,
  };
}
