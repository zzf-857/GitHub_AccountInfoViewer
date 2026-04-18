const TOKEN_STORAGE_KEY = "starred-dashboard-tokens";
const CACHE_STORAGE_KEY = "starred-dashboard-cache";

function loadSavedTokens() {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return { tokenA: "", tokenB: "" };
    const parsed = JSON.parse(raw);
    return { tokenA: parsed.tokenA || "", tokenB: parsed.tokenB || "" };
  } catch (_err) {
    return { tokenA: "", tokenB: "" };
  }
}

function saveTokens(tokens) {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
}

function clearTokens() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

function saveCache(payload) {
  localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(payload));
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_err) {
    return null;
  }
}

function clearAllLocalData() {
  clearTokens();
  localStorage.removeItem(CACHE_STORAGE_KEY);
}

window.SecurityStore = {
  loadSavedTokens,
  saveTokens,
  clearTokens,
  saveCache,
  loadCache,
  clearAllLocalData
};
