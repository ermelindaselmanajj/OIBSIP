import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../services/api";
import PriceBreakdown from "../components/orders/PriceBreakdown";
import { parseOrder, selectionFromItems } from "../components/orders/orderHelpers";
import useOrderPolling from "../components/orders/useOrderPolling";
import FulfillmentTimeline from "../components/orders/FulfillmentTimeline";
import PaymentCheckout from "../components/orders/PaymentCheckout";
import { paymentLabel } from "../components/orders/tracking";
import "../styles/builder.css";
import "../styles/orders.css";

const parseDetail = (data) => ({ order: parseOrder(data.order) });

export default function OrderSummary() {
  const { id } = useParams();
  const navigate = useNavigate();
  const result = useOrderPolling(api, `/orders/${encodeURIComponent(id)}`, parseDetail);
  const current = result.data;
  const edit = () => navigate("/build-pizza", {
    state: { editOrder: { selection: selectionFromItems(current.order.items), quantity: current.order.quantity, step: 5 } },
  });

  return (
    <main className="pb-page">
      <div className="pb-shell pb-order-shell">
        <header className="pb-header">
          <Link className="pb-back" to="/orders">← My Orders</Link>
          <span className="pb-brand">Pizza Delivery</span>
        </header>
        <div className="pb-intro">
          <p className="pb-eyebrow">YOUR SAVED ORDER</p>
          <h1>One step closer.</h1>
          <p>Your saved choices and the latest progress from our kitchen.</p>
        </div>
        {result.loading && <p className="pb-status" role="status">Loading your order…</p>}
        {result.error && (
          <div className="pb-error" role="alert">
            <p>{result.error}</p>
            <button className="pb-secondary" onClick={result.refresh}>Retry</button>
          </div>
        )}
        {current?.order && (
          <section className="pb-main">
            <div className="pb-order-heading">
              <div>
                <p className="pb-eyebrow">ORDER SUMMARY</p>
                <h2>Your custom pizza</h2>
              </div>
              <span className="pb-payment-badge">{paymentLabel(current.order)}</span>
            </div>
            {current.order.currency === "INR" && (
              <p className="pb-notice" role="status">
                This order was saved in INR and cannot continue to euro checkout. Rebuild your choices to review current EUR prices.
              </p>
            )}
            <dl className="pb-order-details">
              <div><dt>Order reference</dt><dd>{current.order.id}</dd></div>
              <div><dt>Created</dt><dd>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(current.order.createdAt))}</dd></div>
            </dl>
            <FulfillmentTimeline order={current.order} />
            <p className="ot-live">Updates every 5 seconds while this tab is visible.</p>
            <PriceBreakdown quote={current.order} heading="Saved ingredient prices" />
            <PaymentCheckout key={current.order.id} order={current.order} onOrder={(order) => result.replace({ order })} />
            <p className="pb-summary-note">{current.order.paymentStatus === "paid" ? "Your payment is confirmed. The stages above show your delivery progress." : current.order.paymentStatus === "review_required" || current.order.paymentIssue ? "Payment needs a status check before any new checkout. Your saved order stays unchanged." : "Editing makes a new selection for review; this saved order stays unchanged. Check payment status if a previous checkout was interrupted."}</p>
            <div className="pb-navigation">
              {current.order.paymentStatus === "pending" && !current.order.paymentIssue && <button className="pb-secondary" onClick={edit}>{current.order.currency === "EUR" ? "Edit these choices" : "Rebuild with EUR prices"}</button>}
              <Link className="pb-primary pb-button-link" to="/dashboard">Back to menu</Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
