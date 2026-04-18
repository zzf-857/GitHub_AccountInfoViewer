function createRefreshController({ store, onRefresh }) {
  let countdownTimer = null;
  let intervalMs = store.getState().refreshIntervalMs;
  let inFlight = false;

  function stop() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
  }

  function updateNextTick() {
    const s = store.getState();
    if (!s.nextRefreshAt) return;
    if (Date.now() >= s.nextRefreshAt) {
      trigger("auto");
      return;
    }
    store.patch({});
  }

  function start(msOverride) {
    intervalMs = msOverride || intervalMs;
    const nextRefreshAt = Date.now() + intervalMs;
    store.patch({ nextRefreshAt });
    stop();
    countdownTimer = setInterval(updateNextTick, 1000);
  }

  async function trigger(source = "manual") {
    if (inFlight) return;
    inFlight = true;
    try {
      await onRefresh(source);
      start(intervalMs);
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
