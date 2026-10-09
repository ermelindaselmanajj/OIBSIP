import { validateTracking } from "./tracking.js";
import { emptySelection } from "../builder/selection.js";

export function orderSelection(selection, quantity) {
  return {
    baseId: selection.base,
    sauceId: selection.sauce,
    cheeseId: selection.cheese,
    vegetableIds: [...selection.vegetables].sort(),
    quantity,
  };
}

export const selectionSignature = (selection, quantity) => JSON.stringify(orderSelection(selection, quantity));
export const formatMoney = (minor, currency = "EUR") => new Intl.NumberFormat("en-IE", {
  style: "currency", currency,
}).format(minor / 100);

export function validateQuote(value, expectedQuantity, currencies = ["EUR"]) {
  const integer = (amount) => Number.isSafeInteger(amount) && amount >= 0;
  if (!value || !currencies.includes(value.currency) || !Number.isInteger(value.quantity) ||
    value.quantity < 1 || value.quantity > 10 ||
    (expectedQuantity !== undefined && value.quantity !== expectedQuantity) ||
    !Array.isArray(value.items) || value.items.length < 3 ||
    value.items.some((item) => !item || typeof item.ingredientId !== "string" ||
      typeof item.name !== "string" || !item.name.trim() || !["base", "sauce", "cheese", "vegetable"].includes(item.category) ||
      item.quantity !== value.quantity || !integer(item.unitPriceMinor) || !integer(item.lineTotalMinor) ||
      item.lineTotalMinor !== item.unitPriceMinor * item.quantity) ||
    new Set(value.items.map((item) => item.ingredientId)).size !== value.items.length ||
    ["base", "sauce", "cheese"].some((category) => value.items.filter((item) => item.category === category).length !== 1) ||
    !integer(value.unitTotalMinor) || !integer(value.totalMinor) ||
    value.items.reduce((total, item) => total + item.unitPriceMinor, 0) !== value.unitTotalMinor ||
    value.totalMinor !== value.unitTotalMinor * value.quantity) {
    throw new Error("We couldn't read the price summary. Please retry.");
  }
  return value;
}

export function parseQuote(value, quantity, selection, currencies = ["EUR"]) {
  validateQuote(value, quantity, currencies);
  if (!/^[a-f0-9]{64}$/.test(value.fingerprint)) throw new Error("Invalid quote confirmation. Please retry.");
  if (selection) {
    const expected = [selection.baseId, selection.sauceId, selection.cheeseId, ...selection.vegetableIds].sort();
    const received = value.items.map((item) => item.ingredientId).sort();
    const matchesRequired = ["base", "sauce", "cheese"].every((category) =>
      value.items.find((item) => item.category === category)?.ingredientId === selection[`${category}Id`]);
    if (!matchesRequired || JSON.stringify(expected) !== JSON.stringify(received)) {
      throw new Error("The price summary doesn't match your selections. Please retry.");
    }
  }
  return value;
}

export function parseOrder(value) {
  validateQuote(value, undefined, ["EUR", "INR"]);
  if (typeof value.id !== "string" || !value.id || !["pending_payment", "confirmed"].includes(value.status) ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
    !(value.paymentIssue === undefined || value.paymentIssue === null || (typeof value.paymentIssue === "string" && value.paymentIssue.length > 0)) ||
    value.checkoutEligible !== (value.currency === "EUR" && value.status === "pending_payment" && value.paymentStatus === "pending" && !value.paymentIssue)) {
    throw new Error("We couldn't read this order. Please retry.");
  }
  return validateTracking(value);
}

export function selectionFromItems(items) {
  const selection = emptySelection();
  for (const item of items) {
    if (item.category === "vegetable") selection.vegetables.push(item.ingredientId);
    else selection[item.category] = item.ingredientId;
  }
  return selection;
}

export function errorMessage(data) {
  if (data?.code === "INGREDIENT_UNAVAILABLE") return "Some ingredients don't have enough stock for this quantity. Lower the quantity or refresh ingredients and review your choices.";
  if (data?.code === "PRICE_UNAVAILABLE") return "A selected ingredient doesn't have a price yet. Choose another ingredient or try again later.";
  if (data?.code === "PRICE_CHANGED") return "Prices have changed. Review the updated total before creating your order again.";
  if (data?.code === "IDEMPOTENCY_CONFLICT") return "This saved order attempt conflicts with another selection. Please return to the menu and review your saved order before trying again.";
  return data?.message || "We couldn't complete this request. Please retry.";
}
