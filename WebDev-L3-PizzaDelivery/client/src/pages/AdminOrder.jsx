import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { adminApi } from "../services/api";
import useOrderPolling from "../components/orders/useOrderPolling";
import { parseOrder } from "../components/orders/orderHelpers";
import { nextAction, paymentLabel, stageLabels } from "../components/orders/tracking";
import FulfillmentTimeline from "../components/orders/FulfillmentTimeline";
import PriceBreakdown from "../components/orders/PriceBreakdown";
import "../styles/builder.css";
import "../styles/orders.css";

const parseDetail = (data) => parseOrder(data.order);

export default function AdminOrder() {
  const { id } = useParams();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const mutation = useRef(null);
  const result = useOrderPolling(adminApi, `/admin/orders/${encodeURIComponent(id)}`, parseDetail, saving);
  const order = result.data;
  const next = order && nextAction(order);
  useEffect(() => {
    const currentMutation = mutation;
    return () => currentMutation.current?.abort();
  }, []);

  const update = async () => {
    if (!next || mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setSaving(true);
    setMessage("");
    try {
      const { data } = await adminApi.patch(`/admin/orders/${encodeURIComponent(id)}/status`, { status: next, expectedStatus: order.fulfillmentStatus }, { signal: controller.signal });
      const updated = parseOrder(data.order);
      if (controller.signal.aborted) return;
      result.replace(updated);
      setMessage(`Updated to ${stageLabels[updated.fulfillmentStatus]}.`);
    } catch (failure) {
      if (!controller.signal.aborted) setMessage(failure.response?.status === 409 ? "The order changed while you were viewing it. We are refreshing its latest status; review it before trying again." : failure.response?.data?.message || "Status could not be saved. Please retry.");
    } finally {
      mutation.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  return (
    <main className="ot-page pb-page">
      <div className="ot-shell pb-order-shell">
        <header className="ot-header"><Link to="/admin/orders">← Orders</Link><span>Pizza Delivery <small>ADMIN</small></span></header>
        <div className="ot-title">
          <div><p className="ot-eyebrow">ORDER MANAGEMENT</p><h1>From kitchen to doorstep.</h1></div>
          <button className="ot-button" disabled={saving} onClick={result.refresh}>Refresh</button>
        </div>
        {result.loading && <p className="ot-state" role="status">Loading order…</p>}
        {result.error && <div className="ot-state ot-error" role="alert"><p>{result.error}</p><button className="ot-button" onClick={result.refresh}>Retry</button></div>}
        {order && (
          <section className="pb-main">
          <div className="pb-order-heading"><h2>Order {order.id.slice(-8)}</h2><span className="ot-badge">{order.paymentStatus === "paid" ? (order.status === "confirmed" ? "Paid · Confirmed" : "Paid · Awaiting confirmation") : paymentLabel(order)}</span></div>
          {order.paymentStatus === "review_required" && <p className="pb-notice">A captured payment needs review. Fulfillment is blocked; payment status cannot be changed from this screen.</p>}
          {order.paymentIssue && order.paymentStatus !== "review_required" && <p className="pb-notice">Checkout or payment confirmation needs a status check before this order can progress.</p>}
          {order.customer && <div className="ot-customer"><h3>Customer</h3><p>{order.customer.name}</p><p>{order.customer.email}</p></div>}
          <p className="ot-reference">Reference: {order.id}</p>
          <FulfillmentTimeline order={order} />
          <div className="ot-update-panel">
            {next ? (
              <>
                <p>Next valid step: <strong>{stageLabels[next]}</strong></p>
                <button className="ot-primary" disabled={saving || Boolean(result.error)} onClick={update}>
                  {saving ? "Saving status…" : `Mark ${stageLabels[next]}`}
                </button>
              </>
            ) : (
              <p>{order.paymentStatus !== "paid" || order.status !== "confirmed"
                ? "Only paid, confirmed orders can move into the kitchen. This screen cannot change payment status."
                : order.fulfillmentStatus === "sent_to_delivery"
                  ? "This order has reached Sent to Delivery. No further status changes are available."
                  : "No valid next step is available yet. Refresh to check the latest order confirmation and progress."}</p>
            )}
            {message && <p role="status">{message}</p>}
          </div>
          <PriceBreakdown quote={order} heading="Saved ingredient prices" />
          <p className="ot-live">Tracking refreshes every 5 seconds while this tab is visible.</p>
          </section>
        )}
      </div>
    </main>
  );
}
