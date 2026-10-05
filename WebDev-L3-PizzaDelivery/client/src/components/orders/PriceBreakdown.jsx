import { formatMoney } from "./orderHelpers";

export default function PriceBreakdown({ quote, heading = "Your price summary" }) {
  return (
    <section className="pb-pricing" aria-label={heading}>
      <h2>{heading}</h2>
      <div className="pb-price-table-wrap">
        <table className="pb-price-table">
          <thead><tr><th scope="col">Ingredient</th><th scope="col">Per pizza</th><th scope="col">Quantity</th><th scope="col">Total</th></tr></thead>
          <tbody>
            {quote.items.map((item) => (
              <tr key={item.ingredientId}>
                <th scope="row">{item.name}<span>{item.category}</span></th>
                <td>{formatMoney(item.unitPriceMinor, quote.currency)}</td>
                <td>{item.quantity}</td>
                <td>{formatMoney(item.lineTotalMinor, quote.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="pb-totals">
        <div><dt>Per pizza</dt><dd>{formatMoney(quote.unitTotalMinor, quote.currency)}</dd></div>
        <div><dt>Total for {quote.quantity} {quote.quantity === 1 ? "pizza" : "pizzas"}</dt><dd>{formatMoney(quote.totalMinor, quote.currency)}</dd></div>
      </dl>
    </section>
  );
}
