export function parseMenu(data) {
  if (!Array.isArray(data) || data.some(pizza => !pizza ||
    typeof pizza._id !== "string" || !pizza._id ||
    typeof pizza.name !== "string" || !pizza.name.trim() ||
    typeof pizza.price !== "number" || !Number.isFinite(pizza.price) || pizza.price < 0 ||
    ["description", "image", "category"].some(field => pizza[field] != null && typeof pizza[field] !== "string"))) {
    throw new Error("We couldn't read the pizza menu. Please retry.");
  }
  return data;
}
