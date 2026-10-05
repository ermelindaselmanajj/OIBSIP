const labels = { base: "Base", sauce: "Sauce", cheese: "Cheese" };

export default function SelectionSummary({ selection, ingredients, final = false }) {
  const name = (id) => ingredients.find((item) => item.id === id)?.name;

  return (
    <section
      className={`pb-summary${final ? " pb-summary-final" : ""}`}
      aria-label="Your pizza selections"
    >
      <p className="pb-eyebrow">YOUR CREATION</p>
      <h2>{final ? "Your pizza, reviewed." : "A little of what you love."}</h2>
      <dl>
        {Object.entries(labels).map(([category, label]) => (
          <div key={category}>
            <dt>{label}</dt>
            <dd>{name(selection[category]) || "Choose your " + category}</dd>
          </div>
        ))}
        <div>
          <dt>Vegetables</dt>
          <dd>
            {selection.vegetables.length
              ? selection.vegetables.map(name).join(", ")
              : "No vegetables selected"}
          </dd>
        </div>
      </dl>
      <p className="pb-summary-note">
        {final
          ? "Your ingredient choices are complete. You can go back to make changes or refresh availability."
          : "Pick a base, add your favorite flavors, then review everything together."}
      </p>
    </section>
  );
}
