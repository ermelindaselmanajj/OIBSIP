import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../services/api";
import IngredientOptions from "../components/builder/IngredientOptions";
import SelectionSummary from "../components/builder/SelectionSummary";
import { parseIngredients } from "../components/builder/ingredients";
import { canAdvance, categories, emptySelection, refreshBuilder, selectIngredient } from "../components/builder/selection";
import ReviewPrice from "../components/orders/ReviewPrice";
import useQuote from "../components/orders/useQuote";
import { errorMessage, orderSelection, parseOrder, parseQuote } from "../components/orders/orderHelpers";
import { draftKey, matchingAttempt, prepareAttempt, readDraft, writeDraft } from "../components/orders/draft";
import "../styles/builder.css";

const steps = ["Base", "Sauce", "Cheese", "Vegetables", "Review"];
const titles = ["Start with a great base.", "Make it your kind of sauce.", "A cheese worth choosing.", "Add a little color.", "Made just the way you like it."];

export default function PizzaBuilder() {
  const navigate = useNavigate();
  const location = useLocation();
  const [quantity, setQuantity] = useState(1);
  const [scope, setScope] = useState(null);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [orderAttempt, setOrderAttempt] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapRetry, setBootstrapRetry] = useState(0);
  const creation = useRef(false);
  const activePage = useRef(true);
  const createController = useRef(null);
  const attemptRef = useRef(null);
  const initialized = useRef(false);
  const [ingredients, setIngredients] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [builder, setBuilder] = useState(() => ({ selection: emptySelection(), step: 1, notice: "" }));
  const request = useRef({ sequence: 0, controller: null });

  const refresh = useCallback(async (requestedStep = null) => {
    if (creation.current) return;
    request.current.controller?.abort();
    const controller = new AbortController();
    const sequence = ++request.current.sequence;
    request.current.controller = controller;
    setStatus("loading");
    setError("");
    try {
      const { data } = await api.get("/ingredients", { signal: controller.signal });
      if (controller.signal.aborted || request.current.sequence !== sequence) return;
      const items = parseIngredients(data);
      setIngredients(items);
      setBuilder((previous) => {
        // An uncertain create request must be recoverable with its original IDs.
        if (attemptRef.current?.state === "uncertain") return { ...previous, step: 5 };
        return refreshBuilder(previous, items, requestedStep);
      });
      setQuoteRevision((previous) => previous + 1);
      setStatus("ready");
    } catch (failure) {
      if (controller.signal.aborted || request.current.sequence !== sequence) return;
      setError(failure.response?.data?.message || "We couldn't check ingredient availability. Please try again.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    activePage.current = true;
    const controller = new AbortController();
    const requests = request.current;
    initialized.current = false;
    api.get("/auth/me", { signal: controller.signal }).then(({ data }) => {
      if (!active) return;
      if (data.user?.role !== "user" || !data.user.id) throw new Error("Unable to identify your account.");
      const key = draftKey(api.defaults.baseURL, data.user.id);
      const stored = readDraft(sessionStorage, key);
      const edited = location.state?.editOrder;
      const draft = edited || stored;
      if (edited) {
        if (!writeDraft(sessionStorage, key, { ...edited, attempt: null })) {
          throw new Error("Unable to save your edited choices in this browser.");
        }
        // Consume the edit intent once; subsequent reloads restore the latest draft.
        navigate(location.pathname, { replace: true, state: null });
        return;
      }
      if (draft) {
        const savedAttempt = edited ? null : matchingAttempt(draft.attempt, draft.selection, draft.quantity);
        attemptRef.current = savedAttempt;
        setOrderAttempt(savedAttempt);
        setQuantity(draft.quantity);
        setBuilder({ selection: draft.selection, step: savedAttempt?.state === "uncertain" ? 5 : (draft.step >= 1 && draft.step <= 5 ? draft.step : 1), notice: "" });
      }
      setScope(key);
      setBootstrapError("");
      initialized.current = true;
      refresh();
    }).catch((failure) => {
      if (active && !controller.signal.aborted) {
        setBootstrapError(failure.response?.data?.message || "We couldn't load your saved selection. Please retry.");
        setStatus("error");
      }
    });
    const onFocus = () => {
      if (initialized.current && document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      activePage.current = false;
      controller.abort();
      createController.current?.abort();
      requests.controller?.abort();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, location.state, location.pathname, navigate, bootstrapRetry]);

  useEffect(() => {
    if (!scope) return;
    const attempt = matchingAttempt(orderAttempt, builder.selection, quantity);
    writeDraft(sessionStorage, scope, { selection: builder.selection, quantity, step: builder.step, attempt });
  }, [scope, builder.selection, builder.step, quantity, orderAttempt]);

  const { selection, step, notice } = builder;
  const advance = canAdvance(step, selection, ingredients, status);
  const savedAttempt = matchingAttempt(orderAttempt, selection, quantity);
  const uncertain = savedAttempt?.state === "uncertain";
  const quoteState = useQuote(selection, quantity, Boolean(scope) && step === 5 && advance && !uncertain, quoteRevision);
  const choose = (ingredient) => {
    if (status !== "ready" || creation.current || uncertain) return;
    setCreateError("");
    setBuilder((previous) => ({
      ...previous,
      selection: selectIngredient(previous.selection, ingredient, ingredients),
      notice: "",
    }));
  };
  const move = (nextStep) => {
    if (!creation.current && !uncertain) setBuilder((previous) => ({ ...previous, step: nextStep }));
  };

  const createOrder = async () => {
    if (creation.current || !scope) return;
    if (!uncertain && (!advance || !quoteState.quote)) return;
    const attempt = prepareAttempt(savedAttempt, selection, quantity, quoteState.quote, () => crypto.randomUUID());
    if (!writeDraft(sessionStorage, scope, { selection, quantity, step: 5, attempt })) {
      setCreateError("Your browser couldn't save the order retry key. Enable session storage and try again; no order was submitted.");
      return;
    }
    attemptRef.current = attempt;
    setOrderAttempt(attempt);
    creation.current = true;
    setCreating(true);
    setCreateError("");
    request.current.controller?.abort();
    const controller = new AbortController();
    createController.current = controller;
    try {
      const { data } = await api.post("/orders", {
        ...orderSelection(selection, quantity),
        quoteFingerprint: attempt.quote.fingerprint,
        idempotencyKey: attempt.idempotencyKey,
      }, { signal: controller.signal });
      if (!activePage.current || controller.signal.aborted) return;
      const order = parseOrder(data.order);
      attemptRef.current = null;
      setOrderAttempt(null);
      writeDraft(sessionStorage, scope, { selection, quantity, step: 5, attempt: null });
      navigate(`/orders/${order.id}`);
    } catch (failure) {
      if (!activePage.current || controller.signal.aborted) return;
      const data = failure.response?.data;
      if (failure.response && failure.response.status < 500) {
        let next = { ...attempt, state: "ready" };
        if (data?.code === "PRICE_CHANGED" && data.quote) {
          try {
            const updated = parseQuote(data.quote, quantity, orderSelection(selection, quantity));
            quoteState.replace(updated);
            next = { ...next, quote: updated };
          } catch {
            quoteState.retry();
          }
        } else quoteState.retry();
        attemptRef.current = next;
        setOrderAttempt(next);
        writeDraft(sessionStorage, scope, { selection, quantity, step: 5, attempt: next });
      }
      setCreateError(data ? errorMessage(data) : "We couldn't confirm whether your order was saved. Retry the saved request to recover the same order.");
      if (data?.code === "INGREDIENT_UNAVAILABLE") {
        creation.current = false;
        refresh();
      }
    } finally {
      creation.current = false;
      if (activePage.current) setCreating(false);
    }
  };

  return (
    <main className="pb-page">
      <div className="pb-shell">
        <header className="pb-header">
          <button className="pb-back" onClick={() => navigate("/dashboard")}>
            ← Back to menu
          </button>
          <span className="pb-brand">
            Pizza Delivery <span aria-hidden="true">🍕</span>
          </span>
        </header>

        <div className="pb-intro">
          <p className="pb-eyebrow">A PIZZA WITH YOUR NAME ON IT</p>
          <h1>Make it yours.</h1>
          <p>Good ingredients. Your favorite combination. One delicious creation.</p>
        </div>

        <ol className="pb-progress" aria-label="Pizza building steps">
          {steps.map((label, index) => (
            <li
              key={label}
              className={step === index + 1 ? "pb-current" : step > index + 1 ? "pb-complete" : ""}
              aria-current={step === index + 1 ? "step" : undefined}
            >
              <span>{step > index + 1 ? "✓" : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        <div className="pb-layout">
          <section className="pb-main" aria-busy={status === "loading"}>
            <div className="pb-section-heading">
              <div>
                <p className="pb-eyebrow">STEP {step} OF 5</p>
                <h2>{titles[step - 1]}</h2>
              </div>
              <button
                className="pb-refresh"
                onClick={() => refresh()}
                disabled={status === "loading" || creating || !scope || uncertain}
              >
                ↻ Refresh ingredients
              </button>
            </div>

            <p className="pb-description">
              {step === 4
                ? "Choose as many vegetables as you like, or keep it simple."
                : step === 5
                  ? "Review your choices below. Availability is checked against our current stock."
                  : "Choose one available ingredient to continue."}
            </p>

            {status === "loading" && (
              <p className="pb-status" role="status">
                Checking fresh ingredient availability…
              </p>
            )}
            {bootstrapError && (
              <div className="pb-error" role="alert">
                <p>{bootstrapError}</p>
                <button className="pb-secondary" onClick={() => setBootstrapRetry((value) => value + 1)}>Retry saved selection</button>
              </div>
            )}
            {status === "error" && !bootstrapError && (
              <div className="pb-error" role="alert">
                <p>{error}</p>
                <button className="pb-primary" onClick={() => refresh()}>
                  Retry
                </button>
              </div>
            )}
            {notice && <p className="pb-notice" role="status">{notice}</p>}

            {status === "ready" && step < 5 && (
              <IngredientOptions
                ingredients={ingredients.filter((item) => item.category === categories[step - 1])}
                inventoryEmpty={ingredients.length === 0}
                selection={selection}
                blocked={status !== "ready"}
                onSelect={choose}
              />
            )}
            {step === 5 && scope && (status === "ready" || uncertain) && (
              <>
                <SelectionSummary selection={selection} ingredients={ingredients} final />
                <ReviewPrice
                  quantity={quantity}
                  onQuantity={(value) => { setQuantity(value); setCreateError(""); }}
                  quoteState={quoteState}
                  creating={creating}
                  savedAttempt={savedAttempt}
                  createError={createError}
                  onCreate={createOrder}
                  onRecover={createOrder}
                />
              </>
            )}

            <div className="pb-navigation">
              {step > 1 && (
                <button className="pb-secondary" disabled={creating || uncertain} onClick={() => move(step - 1)}>
                  ← Previous
                </button>
              )}
              {step < 5 ? (
                <button
                  className="pb-primary"
                  disabled={!advance || creating || uncertain}
                  onClick={() => { if (advance) refresh(step + 1); }}
                >
                  {step === 4 ? "Review my pizza" : "Continue"} →
                </button>
              ) : (
                <button
                  className="pb-primary"
                  onClick={() => refresh()}
                  disabled={status === "loading" || creating || !scope || uncertain}
                >
                  Refresh availability
                </button>
              )}
            </div>
          </section>

          <aside className="pb-sidebar">
            <SelectionSummary selection={selection} ingredients={ingredients} />
            <div className="pb-side-note">
              <span aria-hidden="true">✦</span>
              <p>Made your way.<br />Only available ingredients can be selected.</p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
