import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../../services/api";
import { formatMoney, parseOrder } from "./orderHelpers";
import { parsePaymentConfig, parsePaymentSession, paymentError, paymentReturn } from "./payment";

export default function PaymentCheckout({ order, onOrder }) {
  const location = useLocation();
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState("");
  const [revision, setRevision] = useState(0);
  const [phase, setPhase] = useState("idle");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const request = useRef(null);
  const active = useRef(true);
  const returned = useRef(null);
  const latestOrder = useRef(order);
  const updateOrder = useRef(onOrder);
  useEffect(() => { latestOrder.current = order; updateOrder.current = onOrder; }, [order, onOrder]);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; request.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get("/orders/payment-config", { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) { setConfig(parsePaymentConfig(data)); setConfigError(""); }
    }).catch((failure) => {
      if (!controller.signal.aborted) setConfigError(failure.response?.data?.message || failure.message || "Payment availability could not be checked.");
    });
    return () => controller.abort();
  }, [revision]);

  const acceptOrder = useCallback((data) => {
    const updated = parseOrder(data?.order);
    if (updated.id !== latestOrder.current.id) throw new Error("The payment response belongs to another order. Refresh to check your order.");
    if (active.current) updateOrder.current(updated);
    return updated;
  }, []);

  const recoverError = useCallback((failure) => {
    if (failure.response?.data?.order) {
      try { acceptOrder(failure.response.data); } catch { /* Keep the last validated order. */ }
    }
    if (active.current) {
      setNotice(paymentError(failure));
      setUncertain(failure.response?.data?.code !== "INSUFFICIENT_STOCK" || failure.response?.data?.order?.paymentStatus === "review_required");
    }
  }, [acceptOrder]);

  const reconcile = useCallback(async (reason = null) => {
    if (request.current && !request.current.signal.aborted) return;
    const controller = new AbortController();
    request.current = controller;
    setPhase("checking");
    setNotice(reason === "cancelled" ? "Checkout cancelled. Checking whether a payment was completed…" : "");
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(latestOrder.current.id)}/payment/reconcile`, {}, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const updated = acceptOrder(data);
      setUncertain(Boolean(updated.paymentIssue) || (reason === "success" && updated.paymentStatus !== "paid"));
      setNotice(updated.paymentStatus === "paid" && updated.status === "confirmed"
        ? "Payment confirmed. Your order is ready to track."
        : updated.paymentStatus === "review_required"
          ? "Payment needs review. Do not pay again; contact the administrator."
          : reason === "cancelled" ? "Checkout cancelled. Your order is still pending; you can return to checkout."
            : "Payment is still pending. Check its status before trying again.");
    } catch (failure) { if (!controller.signal.aborted) recoverError(failure); }
    finally {
      if (request.current === controller) { request.current = null; if (active.current) setPhase("idle"); }
    }
  }, [acceptOrder, recoverError]);

  useEffect(() => {
    const reason = paymentReturn(location.search);
    if (!reason || latestOrder.current.paymentStatus === "paid" || returned.current === location.search) return;
    returned.current = location.search;
    reconcile(reason);
    return () => { returned.current = null; };
  }, [location.search, reconcile]);

  const pay = async () => {
    if (request.current || !config?.available || !order.checkoutEligible || order.paymentProvider === "razorpay" || uncertain) return;
    const controller = new AbortController();
    request.current = controller;
    setPhase("opening"); setNotice("");
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(order.id)}/payment`, {}, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const session = parsePaymentSession(data, order);
      acceptOrder(data);
      if (!session.checkout) { setNotice("This order's payment is already confirmed."); return; }
      setPhase("checkout");
      window.location.assign(session.checkout.url);
    } catch (failure) { if (!controller.signal.aborted) recoverError(failure); }
    finally {
      if (request.current === controller) { request.current = null; if (active.current) setPhase((previous) => previous === "opening" ? "idle" : previous); }
    }
  };

  if (order.currency !== "EUR" || order.paymentStatus === "paid") return null;
  const busy = phase !== "idle";
  const review = order.paymentStatus === "review_required";
  const legacy = order.paymentProvider === "razorpay";
  return (
    <section className="pc-checkout" aria-label="Test payment">
      <div className="pc-heading"><h2>{review ? "Payment needs attention" : "Finish your order"}</h2><span className="pc-test">TEST MODE</span></div>
      {review ? <p>A received payment needs review before this order can be confirmed. Do not pay again. Contact the administrator or check payment status after stock is available.</p>
        : legacy ? <p>This order uses Razorpay and cannot switch to Stripe. Check its existing payment status before creating another order.</p>
          : <p>Continue to secure Stripe checkout in euros. Your order is confirmed only after the server checks payment and reserves the ingredients.</p>}
      {order.paymentIssue && !review && <p className="pb-notice">Payment setup or confirmation needs another check. Use “Check payment status” before trying checkout again.</p>}
      {!legacy && !config && !configError && <p className="pb-status" role="status">Checking payment availability…</p>}
      {!legacy && configError && <div className="pb-error" role="alert"><p>{configError}</p><button className="pb-secondary" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Retry availability</button></div>}
      {!legacy && config && !config.available && <div className="pb-notice" role="status"><strong>Payment currently unavailable</strong><p>{config.message || "Stripe test payments aren't configured yet. Your saved order remains pending."}</p><button className="pb-secondary" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Check again</button></div>}
      {notice && <p className="pb-notice" role="status">{notice}</p>}
      <div className="pc-actions">
        {!review && !legacy && <button className="pb-primary" onClick={pay} disabled={busy || !config?.available || Boolean(configError) || !order.checkoutEligible || uncertain}>{phase === "opening" ? "Opening checkout…" : `Pay ${formatMoney(order.totalMinor, order.currency)} · test`}</button>}
        <button className="pb-secondary" onClick={() => reconcile()} disabled={busy}>{phase === "checking" ? "Checking payment…" : "Check payment status"}</button>
      </div>
      {phase === "checkout" && <p className="pc-note" role="status">Opening Stripe's secure test checkout…</p>}
      <p className="pc-note">Use {legacy ? "Razorpay" : "Stripe"} test payment details only. No real payment should be made here.</p>
    </section>
  );
}
