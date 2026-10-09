import { useEffect, useRef, useState } from "react";
import api from "../../services/api";
import { formatMoney, parseOrder } from "./orderHelpers";
import { checkoutOptions, loadRazorpay, parsePaymentConfig, parsePaymentSession, paymentCallback, paymentError } from "./payment";

export default function PaymentCheckout({ order, onOrder }) {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState("");
  const [revision, setRevision] = useState(0);
  const [phase, setPhase] = useState("idle");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const request = useRef(null);
  const active = useRef(true);
  const modal = useRef(null);
  const verifying = useRef(false);

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    api.get("/orders/payment-config", { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) { setConfig(parsePaymentConfig(data)); setConfigError(""); }
    }).catch((failure) => {
      if (!controller.signal.aborted) setConfigError(failure.response?.data?.message || failure.message || "Payment availability could not be checked.");
    });
    return () => {
      active.current = false;
      controller.abort();
      request.current?.abort();
      modal.current?.close();
    };
  }, [revision]);

  const acceptOrder = (data) => {
    const updated = parseOrder(data?.order);
    if (updated.id !== order.id) throw new Error("The payment response belongs to another order. Refresh to check your order.");
    if (active.current) onOrder(updated);
    return updated;
  };

  const recoverError = (failure) => {
    if (failure.response?.data?.order) {
      try { acceptOrder(failure.response.data); } catch { /* Keep the last validated order. */ }
    }
    if (active.current) {
      setNotice(paymentError(failure));
      setUncertain(failure.response?.data?.code !== "INSUFFICIENT_STOCK" || failure.response?.data?.order?.paymentStatus === "review_required");
    }
  };

  const confirm = async (response, providerOrderId) => {
    if (!active.current || verifying.current || request.current) return;
    verifying.current = true;
    setPhase("confirming");
    setUncertain(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const callback = paymentCallback(response, providerOrderId);
      const { data } = await api.post(`/orders/${encodeURIComponent(order.id)}/payment/confirm`, callback, { signal: controller.signal });
      if (!controller.signal.aborted) {
        const updated = acceptOrder(data);
        setNotice(updated.status === "confirmed" && updated.paymentStatus === "paid" ? "Payment confirmed. Your order has been received." : "Payment is still pending. Check payment status before trying again.");
        setUncertain(updated.paymentStatus !== "paid");
      }
    } catch (failure) { if (!controller.signal.aborted) recoverError(failure); }
    finally {
      request.current = null;
      verifying.current = false;
      modal.current = null;
      if (active.current) setPhase("idle");
    }
  };

  const pay = async () => {
    if (request.current || modal.current || !config?.available || !order.checkoutEligible || uncertain) return;
    const controller = new AbortController();
    request.current = controller;
    setPhase("opening");
    setNotice("");
    try {
      const Razorpay = await loadRazorpay(window, document);
      if (controller.signal.aborted) return;
      const { data } = await api.post(`/orders/${encodeURIComponent(order.id)}/payment`, {}, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const session = parsePaymentSession(data, order);
      acceptOrder(data);
      if (!session.checkout) { setNotice("This order's payment is already confirmed."); return; }
      let failed = false;
      const dismiss = () => {
        modal.current = null;
        if (active.current && !verifying.current && !failed) {
          setPhase("idle"); setUncertain(true);
          setNotice("Checkout closed. Check payment status before trying again.");
        }
      };
      const checkout = new Razorpay(checkoutOptions(session.checkout, {
        onSuccess: (response) => confirm(response, session.checkout.providerOrderId), onDismiss: dismiss,
      }));
      checkout.on("payment.failed", () => {
        failed = true;
        if (active.current && !verifying.current) {
          setNotice("The payment attempt failed. Check payment status, then retry this saved order.");
          setUncertain(true);
          setPhase("idle");
        }
        checkout.close();
        modal.current = null;
      });
      modal.current = checkout;
      request.current = null;
      setPhase("checkout");
      checkout.open();
    } catch (failure) { if (!controller.signal.aborted) recoverError(failure); }
    finally {
      if (request.current === controller) request.current = null;
      if (active.current) setPhase((previous) => previous === "opening" ? "idle" : previous);
    }
  };

  const reconcile = async () => {
    if (request.current || modal.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPhase("checking"); setNotice("");
    try {
      const { data } = await api.post(`/orders/${encodeURIComponent(order.id)}/payment/reconcile`, {}, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const updated = acceptOrder(data);
      setUncertain(Boolean(updated.paymentIssue));
      setNotice(updated.paymentStatus === "paid" && updated.status === "confirmed" ? "Payment confirmed. Your order is ready to track." : "No captured payment was found. You can retry checkout when payment is available.");
    } catch (failure) { if (!controller.signal.aborted) recoverError(failure); }
    finally { request.current = null; if (active.current) setPhase("idle"); }
  };

  if (order.currency !== "EUR" || order.paymentStatus === "paid") return null;
  const busy = phase !== "idle";
  const review = order.paymentStatus === "review_required";
  return (
    <section className="pc-checkout" aria-label="Test payment">
      <div className="pc-heading"><h2>{review ? "Payment needs attention" : "Finish your order"}</h2><span className="pc-test">TEST MODE</span></div>
      {review ? <p>A captured payment needs review before this order can be confirmed. Do not pay again. Contact the administrator or check payment status after stock is available.</p>
        : <p>Checkout stays in euros. Test payments are confirmed by the server before ingredients are reserved and your order enters the kitchen.</p>}
      {order.paymentIssue && !review && <p className="pb-notice">Payment setup or confirmation needs another check. Use “Check payment status” before trying checkout again.</p>}
      {!config && !configError && <p className="pb-status" role="status">Checking payment availability…</p>}
      {configError && <div className="pb-error" role="alert"><p>{configError}</p><button className="pb-secondary" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Retry availability</button></div>}
      {config && !config.available && <div className="pb-notice" role="status"><strong>Payment currently unavailable</strong><p>{config.message || "Razorpay test payments aren't configured for euro checkout yet. Your saved order remains pending."}</p><button className="pb-secondary" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Check again</button></div>}
      {notice && <p className="pb-notice" role="status">{notice}</p>}
      <div className="pc-actions">
        {!review && <button className="pb-primary" onClick={pay} disabled={busy || !config?.available || Boolean(configError) || !order.checkoutEligible || uncertain}>{phase === "opening" ? "Opening checkout…" : phase === "confirming" ? "Confirming payment…" : `Pay ${formatMoney(order.totalMinor, order.currency)} · test`}</button>}
        <button className="pb-secondary" onClick={reconcile} disabled={busy}>{phase === "checking" ? "Checking payment…" : "Check payment status"}</button>
      </div>
      {phase === "checkout" && <p className="pc-note" role="status">Complete or close the Razorpay test window to continue.</p>}
      <p className="pc-note">Use Razorpay test payment details only. No real payment should be made here.</p>
    </section>
  );
}
