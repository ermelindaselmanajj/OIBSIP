import { useEffect, useState } from "react";
import api from "../../services/api";
import { orderSelection, parseQuote, selectionSignature } from "./orderHelpers";

export default function useQuote(selection, quantity, enabled, revision) {
  const signature = selectionSignature(selection, quantity);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const key = `${signature}:${attempt}:${revision}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const payload = JSON.parse(signature);
    api.post("/orders/quote", payload, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setResult({ key, status: "ready", quote: parseQuote(data.quote, payload.quantity, payload) });
    }).catch((error) => {
      if (!controller.signal.aborted) setResult({ key, status: "error", error: error.response?.data || { message: error.message } });
    });
    return () => controller.abort();
  }, [signature, enabled, key]);

  return {
    status: !enabled ? "idle" : result?.key === key ? result.status : "loading",
    quote: enabled && result?.key === key && result.status === "ready" ? result.quote : null,
    error: enabled && result?.key === key ? result.error : null,
    retry: () => setAttempt((previous) => previous + 1),
    replace: (quote) => setResult({ key, status: "ready", quote: parseQuote(quote, quantity, orderSelection(selection, quantity)) }),
  };
}
