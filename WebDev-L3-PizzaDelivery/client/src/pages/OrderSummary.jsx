import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../services/api";
import PriceBreakdown from "../components/orders/PriceBreakdown";
import { parseOrder, selectionFromItems } from "../components/orders/orderHelpers";
import "../styles/builder.css";

export default function OrderSummary() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState(null);
  const requestKey = `${id}:${retry}`;

  useEffect(() => {
    const controller = new AbortController();
    api.get(`/orders/${encodeURIComponent(id)}`, { signal: controller.signal }).then(({ data }) => {
      const order = parseOrder(data.order);
      if (!controller.signal.aborted) setResult({ requestKey, order });
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setResult({ requestKey, error: error.response?.status === 404
          ? "This order was not found for your account. Check the link or return to the menu."
          : error.response?.data?.message || "We couldn't load your order. Please retry." });
      }
    });
    return () => controller.abort();
  }, [id, requestKey]);

  const current = result?.requestKey === requestKey ? result : null;
  const edit = () => navigate("/build-pizza", {
    state: { editOrder: { selection: selectionFromItems(current.order.items), quantity: current.order.quantity, step: 5 } },
  });

  return (
    <main className="pb-page">
      <div className="pb-shell pb-order-shell">
        <header className="pb-header">
          <Link className="pb-back" to="/dashboard">← Back to menu</Link>
          <span className="pb-brand">Pizza Delivery</span>
        </header>
        <div className="pb-intro">
          <p className="pb-eyebrow">YOUR SAVED ORDER</p>
          <h1>One step closer.</h1>
          <p>Your choices are saved. Payment is still pending.</p>
        </div>
        {!current && <p className="pb-status" role="status">Loading your order…</p>}
        {current?.error && (
          <div className="pb-error" role="alert">
            <p>{current.error}</p>
            <button className="pb-secondary" onClick={() => setRetry((value) => value + 1)}>Retry</button>
          </div>
        )}
        {current?.order && (
          <section className="pb-main">
            <div className="pb-order-heading">
              <div>
                <p className="pb-eyebrow">ORDER SUMMARY</p>
                <h2>Your custom pizza</h2>
              </div>
              <span className="pb-payment-badge">Payment pending</span>
            </div>
            {!current.order.checkoutEligible && (
              <p className="pb-notice" role="status">
                This order was saved in INR and cannot continue to euro checkout. Rebuild your choices to review current EUR prices.
              </p>
            )}
            <dl className="pb-order-details">
              <div><dt>Order reference</dt><dd>{current.order.id}</dd></div>
              <div><dt>Created</dt><dd>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(current.order.createdAt))}</dd></div>
            </dl>
            <PriceBreakdown quote={current.order} heading="Saved ingredient prices" />
            <p className="pb-summary-note">No payment has been collected. Editing makes a new selection for review; this saved order stays unchanged.</p>
            <div className="pb-navigation">
              <button className="pb-secondary" onClick={edit}>{current.order.checkoutEligible ? "Edit these choices" : "Rebuild with EUR prices"}</button>
              <Link className="pb-primary pb-button-link" to="/dashboard">Back to menu</Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
