import { ingredientPhoto, ingredientPhotoStyle } from "./photos";

export default function IngredientOptions({ ingredients, inventoryEmpty, selection, blocked, onSelect }) {
  if (!ingredients.length) {
    return (
      <p className="pb-empty" role="status">
        {inventoryEmpty
          ? "No ingredients have been added yet. Refresh ingredients or check back soon."
          : "No ingredients in this category yet. Refresh availability or check back soon."}
      </p>
    );
  }

  return (
    <div className="pb-options">
      {ingredients.map((ingredient) => {
        const selected = ingredient.category === "vegetable"
          ? selection.vegetables.includes(ingredient.id)
          : selection[ingredient.category] === ingredient.id;
        const photo = ingredientPhoto(ingredient);

        return (
          <button
            key={ingredient.id}
            type="button"
            className={`pb-option${selected ? " pb-selected" : ""}`}
            disabled={blocked || !ingredient.available}
            aria-pressed={selected}
            onClick={() => onSelect(ingredient)}
          >
            <div className="pb-photo">
              {photo
                ? <img src={photo} alt="" style={ingredientPhotoStyle(ingredient)} />
                : <span aria-hidden="true">🍕</span>}
            </div>
            <div className="pb-option-copy">
              <strong>{ingredient.name}</strong>
              <span className={!ingredient.available ? "pb-stock-out" : "pb-stock"}>
                {ingredient.available
                  ? (selected ? "Selected · Available" : "Available")
                  : "Out of stock"}
              </span>
            </div>
            {selected && <span className="pb-check" aria-hidden="true">✓</span>}
          </button>
        );
      })}
    </div>
  );
}
