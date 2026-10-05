import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import IngredientOptions from "../components/builder/IngredientOptions";
import SelectionSummary from "../components/builder/SelectionSummary";
import { parseIngredients } from "../components/builder/ingredients";
import { canAdvance, categories, emptySelection, refreshBuilder, selectIngredient } from "../components/builder/selection";
import "../styles/builder.css";

const steps = ["Base", "Sauce", "Cheese", "Vegetables", "Review"];
const titles = ["Start with a great base.", "Make it your kind of sauce.", "A cheese worth choosing.", "Add a little color.", "Made just the way you like it."];

export default function PizzaBuilder() {
  const navigate = useNavigate();
  const [ingredients, setIngredients] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [builder, setBuilder] = useState(() => ({ selection: emptySelection(), step: 1, notice: "" }));
  const request = useRef({ sequence: 0, controller: null });

  const refresh = useCallback(async (requestedStep = null) => {
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
      setBuilder((previous) => refreshBuilder(previous, items, requestedStep));
      setStatus("ready");
    } catch (failure) {
      if (controller.signal.aborted || request.current.sequence !== sequence) return;
      setError(failure.response?.data?.message || "We couldn't check ingredient availability. Please try again.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const requests = request.current;
    Promise.resolve().then(() => { if (active) refresh(); });
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onVisibility = onFocus;
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      requests.controller?.abort();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const { selection, step, notice } = builder;
  const advance = canAdvance(step, selection, ingredients, status);
  const choose = (ingredient) => {
    if (status !== "ready") return;
    setBuilder((previous) => ({
      ...previous,
      selection: selectIngredient(previous.selection, ingredient, ingredients),
      notice: "",
    }));
  };
  const move = (nextStep) => setBuilder((previous) => ({ ...previous, step: nextStep }));

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
                disabled={status === "loading"}
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
            {status === "error" && (
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
            {status === "ready" && step === 5 && (
              <SelectionSummary selection={selection} ingredients={ingredients} final />
            )}

            <div className="pb-navigation">
              {step > 1 && (
                <button className="pb-secondary" onClick={() => move(step - 1)}>
                  ← Previous
                </button>
              )}
              {step < 5 ? (
                <button
                  className="pb-primary"
                  disabled={!advance}
                  onClick={() => { if (advance) refresh(step + 1); }}
                >
                  {step === 4 ? "Review my pizza" : "Continue"} →
                </button>
              ) : (
                <button
                  className="pb-primary"
                  onClick={() => refresh()}
                  disabled={status === "loading"}
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
