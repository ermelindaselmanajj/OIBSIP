// Schedule only after completion: even slow requests never overlap.
export function startVisiblePolling({ load, onSuccess, onError, onLoading, document, setTimer = setTimeout, clearTimer = clearTimeout, interval = 5000 }) {
  let stopped = false;
  let timer;
  let controller;
  let generation = 0;
  async function refresh() {
    if (stopped || document.visibilityState !== "visible" || controller) return;
    clearTimer(timer);
    const current = ++generation;
    controller = new AbortController();
    const request = controller;
    onLoading?.();
    try {
      const data = await load(request.signal);
      if (!stopped && !request.signal.aborted && current === generation) onSuccess(data);
    } catch (error) {
      if (!stopped && !request.signal.aborted && current === generation) onError(error);
    } finally {
      if (current === generation) {
        controller = null;
        if (!stopped && document.visibilityState === "visible") timer = setTimer(refresh, interval);
      }
    }
  }
  function visibility() {
    clearTimer(timer);
    if (document.visibilityState === "visible") refresh();
    else {
      ++generation;
      controller?.abort();
      controller = null;
    }
  }
  document.addEventListener("visibilitychange", visibility);
  refresh();
  return {
    refresh,
    stop() {
      stopped = true;
      ++generation;
      clearTimer(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
