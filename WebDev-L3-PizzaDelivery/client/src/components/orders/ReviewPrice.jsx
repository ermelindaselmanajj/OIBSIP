import PriceBreakdown from "./PriceBreakdown";
import { errorMessage } from "./orderHelpers";

export default function ReviewPrice({ quantity, onQuantity, quoteState, creating, savedAttempt, createError, onCreate, onRecover }) {
  const uncertain = savedAttempt?.state === "uncertain";
  const legacyAttempt = uncertain && savedAttempt.quote.currency !== "EUR";
  const displayQuote = uncertain ? savedAttempt.quote : quoteState.quote;
  return (
    <div className="pb-review-price">
      <div className="pb-quantity">
        <label htmlFor="pizza-quantity">How many pizzas?</label>
        <select id="pizza-quantity" value={quantity} onChange={(event) => onQuantity(Number(event.target.value))} disabled={creating || uncertain}>
          {Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
        </select>
        <p>Prices and stock are confirmed by the server for your quantity.</p>
      </div>
      {uncertain && (
        <p className="pb-notice" role="status">
          {legacyAttempt
            ? "Recover your previous INR order first. It must be rebuilt with current euro prices before checkout."
            : "Your last request may already have created an order. Retry the saved request to recover it before changing your choices."}
        </p>
      )}
      {!uncertain && quoteState.status === "loading" && <p className="pb-status" role="status">Calculating your current price…</p>}
      {!uncertain && quoteState.status === "error" && (
        <div className="pb-error" role="alert">
          <p>{errorMessage(quoteState.error)}</p>
          <button className="pb-secondary" onClick={quoteState.retry}>Retry price check</button>
        </div>
      )}
      {displayQuote && <PriceBreakdown quote={displayQuote} />}
      {createError && <p className="pb-error" role="alert">{createError}</p>}
      <p className="pb-summary-note">Creating an order saves your selection as pending payment. No payment is collected at this step.</p>
      <button className="pb-primary" disabled={creating || (!uncertain && quoteState.status !== "ready")} onClick={uncertain ? onRecover : onCreate}>
        {creating ? "Saving your order…" : legacyAttempt ? "Recover previous order" : uncertain ? "Retry saved order request" : "Continue to checkout"}
      </button>
    </div>
  );
}
