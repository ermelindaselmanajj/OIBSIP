import { categories } from "./selection.js";

export function parseIngredients(data) {
  const items = data?.ingredients;
  if (!Array.isArray(items) || items.some((item) => !item ||
    typeof item.id !== "string" || !item.id.trim() ||
    typeof item.name !== "string" || !item.name.trim() ||
    !categories.includes(item.category) || typeof item.available !== "boolean") ||
    new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("We couldn't read the ingredient menu. Please retry.");
  }
  return items;
}
