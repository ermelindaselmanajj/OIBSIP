import { useEffect, useRef, useState } from "react";
import { startVisiblePolling } from "./visiblePoll";

export default function useOrderPolling(client, endpoint, parse, paused = false) {
  const [result, setResult] = useState(null);
  const controls = useRef(null);
  useEffect(() => {
    if (paused) return;
    const polling = startVisiblePolling({
      document,
      load: async (signal) => parse((await client.get(endpoint, { signal })).data),
      onSuccess: (data) => setResult({ endpoint, data, error: "", refreshedAt: new Date() }),
      onError: (failure) => setResult((previous) => ({
        endpoint,
        data: ![401, 403, 404].includes(failure.response?.status) && previous?.endpoint === endpoint ? previous.data : null,
        refreshedAt: previous?.endpoint === endpoint ? previous.refreshedAt : null,
        error: failure.response?.status === 404 ? "This order was not found for this account." : failure.response?.data?.message || failure.message || "Unable to refresh orders. Please retry.",
      })),
    });
    controls.current = polling;
    return () => polling.stop();
  }, [client, endpoint, parse, paused]);
  const current = result?.endpoint === endpoint ? result : null;
  return { data: current?.data, error: current?.error, loading: !current, refreshedAt: current?.refreshedAt, refresh: () => controls.current?.refresh(), replace: (data) => setResult({ endpoint, data, error: "", refreshedAt: new Date() }) };
}
