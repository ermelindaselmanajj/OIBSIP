export const categories = ["base", "sauce", "cheese", "vegetable"];
export const emptySelection = () => ({ base: "", sauce: "", cheese: "", vegetables: [] });

export function isAvailable(ingredients, id, category) {
  return ingredients.some((item) => item.id === id && item.category === category && item.available === true);
}

export function reconcileSelection(selection, ingredients) {
  const next = emptySelection();
  for (const category of categories.slice(0, 3)) {
    next[category] = isAvailable(ingredients, selection[category], category) ? selection[category] : "";
  }
  next.vegetables = selection.vegetables.filter((id) => isAvailable(ingredients, id, "vegetable"));
  const changed = categories.slice(0, 3).some((category) => selection[category] !== next[category]) ||
    selection.vegetables.length !== next.vegetables.length;
  return { selection: next, changed };
}

export function earliestInvalidStep(selection, ingredients) {
  const index = categories.slice(0, 3).findIndex((category) => !isAvailable(ingredients, selection[category], category));
  return index < 0 ? 5 : index + 1;
}

export function canAdvance(step, selection, ingredients, status) {
  if (status !== "ready") return false;
  const requiredCount = Math.min(step, 3);
  return categories.slice(0, requiredCount).every((category) => isAvailable(ingredients, selection[category], category)) &&
    selection.vegetables.every((id) => isAvailable(ingredients, id, "vegetable"));
}

export function selectIngredient(selection, ingredient, ingredients) {
  if (!isAvailable(ingredients, ingredient.id, ingredient.category)) return selection;
  if (ingredient.category === "vegetable") {
    const selected = selection.vegetables.includes(ingredient.id);
    return { ...selection, vegetables: selected ? selection.vegetables.filter((id) => id !== ingredient.id) : [...selection.vegetables, ingredient.id] };
  }
  if (!categories.slice(0, 3).includes(ingredient.category)) return selection;
  return { ...selection, [ingredient.category]: ingredient.id };
}

export function refreshBuilder(previous, ingredients, requestedStep = null) {
  const reconciled = reconcileSelection(previous.selection, ingredients);
  const targetStep = requestedStep === previous.step + 1 && canAdvance(previous.step, reconciled.selection, ingredients, "ready") ? requestedStep : previous.step;
  return {
    selection: reconciled.selection,
    step: Math.min(targetStep, earliestInvalidStep(reconciled.selection, ingredients)),
    notice: reconciled.changed ? "Availability changed. We removed ingredients that are no longer available; please review your choices." : previous.notice,
  };
}
