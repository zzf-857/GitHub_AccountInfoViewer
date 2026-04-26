function createRefreshController({ store, onRefresh }) {
  let countdownTimer = null;
  let intervalMs = store.getState().refreshIntervalMs;
  let inFlight = false;

  function stop() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    store.patch({ nextRefreshAt: null });
  }

  function updateNextTick() {
    const s = store.getState();
    if (!s.nextRefreshAt) return;
    if (Date.now() >= s.nextRefreshAt) {
      if (!s.autoRefreshEnabled) {
        stop();
        return;
      }
      trigger("auto");
      return;
    }
    store.patch({});
  }

  function start(msOverride) {
    intervalMs = msOverride || intervalMs;
    if (!store.getState().autoRefreshEnabled) {
      stop();
      return;
    }
    stop();
    const nextRefreshAt = Date.now() + intervalMs;
    store.patch({ nextRefreshAt });
    countdownTimer = setInterval(updateNextTick, 1000);
  }

  async function trigger(source = "manual") {
    if (source === "auto" && !store.getState().autoRefreshEnabled) return;
    if (inFlight) return;
    inFlight = true;
    try {
      await onRefresh(source);
      if (source === "manual" || source === "startup" || store.getState().autoRefreshEnabled) {
        start(intervalMs);
      } else {
        stop();
      }
    } finally {
      inFlight = false;
    }
  }

  function setIntervalMs(ms) {
    intervalMs = ms;
  }

  return { start, stop, trigger, setIntervalMs };
}

window.RefreshController = { createRefreshController };
