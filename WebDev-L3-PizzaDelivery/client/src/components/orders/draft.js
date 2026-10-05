import { emptySelection } from "../builder/selection.js";
import { orderSelection, parseQuote, selectionSignature } from "./orderHelpers.js";

export const draftKey = (apiURL, userId) => `pizza-draft:${apiURL}:${userId}`;

export function readDraft(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key));
    if (!value || ![value.selection?.base, value.selection?.sauce, value.selection?.cheese].every((id) => typeof id === "string") ||
      !Array.isArray(value.selection.vegetables) || !value.selection.vegetables.every((id) => typeof id === "string") ||
      !Number.isInteger(value.quantity) || value.quantity < 1 || value.quantity > 10) return null;
    return value;
  } catch { return null; }
}

export function writeDraft(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function matchingAttempt(attempt, selection, quantity) {
  if (!attempt || attempt.signature !== selectionSignature(selection, quantity) ||
    typeof attempt.idempotencyKey !== "string" || !["ready", "uncertain"].includes(attempt.state)) return null;
  try { parseQuote(attempt.quote, quantity, orderSelection(selection, quantity), ["EUR", "INR"]); return attempt; }
  catch { return null; }
}

export function prepareAttempt(previous, selection, quantity, quote, newKey) {
  const matching = matchingAttempt(previous, selection, quantity);
  return {
    signature: selectionSignature(selection, quantity),
    idempotencyKey: matching?.idempotencyKey || newKey(),
    quote: matching?.state === "uncertain" ? matching.quote : quote,
    state: "uncertain",
  };
}

export const newDraft = () => ({ selection: emptySelection(), quantity: 1, attempt: null, step: 1 });
