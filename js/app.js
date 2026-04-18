function diffRepos(prev, next) {
  const prevSet = new Set(prev.map((r) => r.fullName));
  const nextSet = new Set(next.map((r) => r.fullName));
  let added = 0;
  let removed = 0;
  for (const x of nextSet) if (!prevSet.has(x)) added += 1;
  for (const x of prevSet) if (!nextSet.has(x)) removed += 1;
  return { added, removed };
}

function mergeRepos(repoGroups) {
  const map = new Map();
  for (const group of repoGroups) {
    for (const item of group) {
      if (!map.has(item.fullName)) map.set(item.fullName, item);
    }
  }
  return [...map.values()];
}

function lowRateLimit(rateLimit) {
  return rateLimit && rateLimit.remaining > 0 && rateLimit.remaining < 20;
}

function parseEnv(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    result[key] = val;
  }
  return result;
}

function extractAccountsFromEnv(envMap) {
  const indexed = {};
  for (const [key, value] of Object.entries(envMap)) {
    const nameMatch = key.match(/^ACCOUNT_(\d+)_NAME$/);
    const tokenMatch = key.match(/^ACCOUNT_(\d+)_TOKEN$/);
    if (nameMatch) {
      const id = Number(nameMatch[1]);
      indexed[id] = indexed[id] || { name: "", token: "" };
      indexed[id].name = value;
    }
    if (tokenMatch) {
      const id = Number(tokenMatch[1]);
      indexed[id] = indexed[id] || { name: "", token: "" };
      indexed[id].token = value;
    }
  }
  return Object.keys(indexed)
    .map((k) => ({ index: Number(k), name: indexed[k].name, token: indexed[k].token }))
    .filter((x) => x.token)
    .sort((a, b) => a.index - b.index)
    .map((x) => ({
      id: `account${x.index}`,
      label: x.name || `账号${x.index}`,
      token: x.token
    }));
}

async function loadEnvAccounts() {
  try {
    const res = await fetch(`./.env?v=${Date.now()}`);
    if (!res.ok) return [];
    const text = await res.text();
    return extractAccountsFromEnv(parseEnv(text));
  } catch (_err) {
    return [];
  }
}

function renderSourceOptions(state) {
  const sourceSel = document.getElementById("source");
  const options = ['<option value="merged">全部账号合并</option>'];
  for (const accountId of state.accountOrder) {
    const label = state.accounts[accountId]?.label || accountId;
    options.push(`<option value="account:${accountId}">仅${label}</option>`);
  }
  sourceSel.innerHTML = options.join("");
}

function syncFilterControls(filters) {
  const controlMap = {
    globalSearch: "keyword",
    lang: "language",
    topicFilter: "topic",
    descType: "descType",
    statusFilter: "status",
    starsFilter: "starRange",
    updatedFilter: "updatedRange"
  };
  for (const [id, key] of Object.entries(controlMap)) {
    const el = document.getElementById(id);
    if (el) el.value = filters[key] || "";
  }
}

async function bootstrap() {
  const store = DashboardStore.createStore();
  const view = DashboardView.createView();
  const envAccounts = await loadEnvAccounts();

  if (!envAccounts.length) {
    store.patch({ error: "未在 .env 中读取到有效账号，请配置 ACCOUNT_<N>_NAME / TOKEN。" });
  }
  store.setAccounts(envAccounts);
  renderSourceOptions(store.getState());
  const sourceInfo = document.getElementById("sourceInfo");
  sourceInfo.textContent = `已从 .env 读取 ${envAccounts.length} 个账号配置。`;

  async function refreshData(source) {
    const state = store.getState();
    if (!state.accountOrder.length) return;

    store.patch({ isLoading: true, error: "" });
    const rateLimitByAccount = {};
    let retryDelayMs = 0;
    const repoGroups = [];

    try {
      for (const accountId of state.accountOrder) {
        const account = store.getState().accounts[accountId];
        const token = (account.token || "").trim();
        if (!token) continue;
        const result = await GitHubApi.fetchAllStarred({
          token,
          sourceAccount: accountId,
          sourceAccountLabel: account.label,
          previousEtag: account.etag
        });
        rateLimitByAccount[accountId] = result.rateLimit;
        if (lowRateLimit(result.rateLimit)) retryDelayMs = Math.max(retryDelayMs, 10 * 60 * 1000);
        if (result.unchanged) {
          repoGroups.push(account.repos || []);
        } else {
          store.patchAccount(accountId, { repos: result.repos, etag: result.etag });
          repoGroups.push(result.repos || []);
        }
      }

      const merged = mergeRepos(repoGroups);
      const diffSummary = diffRepos(store.getState().repos, merged);

      store.patch({
        previousRepos: store.getState().repos,
        repos: merged,
        diffSummary,
        isLoading: false,
        lastUpdatedAt: Date.now(),
        rateLimitByAccount,
        error: ""
      });

      SecurityStore.saveCache({
        repos: merged,
        accounts: store.getState().accounts,
        accountOrder: store.getState().accountOrder,
        lastUpdatedAt: Date.now()
      });

      if (retryDelayMs > 0) refresher.setIntervalMs(retryDelayMs);
      else refresher.setIntervalMs(5 * 60 * 1000);
    } catch (err) {
      const cached = SecurityStore.loadCache();
      if (cached && Array.isArray(cached.repos) && cached.repos.length > 0) {
        if (cached.accounts) {
          for (const [accountId, value] of Object.entries(cached.accounts)) {
            if (store.getState().accounts[accountId]) {
              store.patchAccount(accountId, { repos: value.repos || [], etag: value.etag || "" });
            }
          }
        }
        store.patch({
          repos: cached.repos,
          isLoading: false,
          error: `同步失败，已回退缓存：${err.message}`,
          lastUpdatedAt: cached.lastUpdatedAt || null
        });
      } else {
        store.patch({ isLoading: false, error: `同步失败：${err.message}` });
      }
      const backoffMs = source === "auto" ? 60 * 1000 : 10 * 1000;
      refresher.setIntervalMs(backoffMs);
    }
  }

  const refresher = RefreshController.createRefreshController({ store, onRefresh: refreshData });

  store.subscribe((state) => {
    view.render(state);
    document.getElementById("errorInfo").textContent = state.error || "";
  });

  function bindEvents() {
    document.getElementById("globalSearch").addEventListener("input", (e) => store.setFilters({ keyword: e.target.value }));
    document.getElementById("lang").addEventListener("change", (e) => store.setFilters({ language: e.target.value }));
    document.getElementById("topicFilter").addEventListener("change", (e) => store.setFilters({ topic: e.target.value }));
    document.getElementById("descType").addEventListener("change", (e) => store.setFilters({ descType: e.target.value }));
    document.getElementById("statusFilter").addEventListener("change", (e) => store.setFilters({ status: e.target.value }));
    document.getElementById("starsFilter").addEventListener("change", (e) => store.setFilters({ starRange: e.target.value }));
    document.getElementById("updatedFilter").addEventListener("change", (e) => store.setFilters({ updatedRange: e.target.value }));
    document.getElementById("source").addEventListener("change", (e) => store.patch({ activeSource: e.target.value }));
    document.getElementById("manualRefresh").addEventListener("click", () => refresher.trigger("manual"));
    document.getElementById("clearCredentials").addEventListener("click", () => {
      SecurityStore.clearAllLocalData();
      store.patch({ repos: [], error: "已清空本地缓存（.env 配置不会被删除）。" });
      for (const accountId of store.getState().accountOrder) {
        store.patchAccount(accountId, { repos: [], etag: "" });
      }
    });
    document.getElementById("expandAll").addEventListener("click", () => {
      view.setExpandZh(true);
      view.render(store.getState());
    });
    document.getElementById("collapseAll").addEventListener("click", () => {
      view.setExpandZh(false);
      view.render(store.getState());
    });
    document.getElementById("savedViews").addEventListener("click", (e) => {
      const button = e.target.closest("[data-view]");
      if (!button) return;
      const base = { keyword: "", language: "", descType: "", topic: "", status: "", starRange: "", updatedRange: "" };
      const nextFilters = { ...base, ...DashboardInsights.getSavedViewFilter(button.dataset.view) };
      store.setFilters(nextFilters);
      syncFilterControls(store.getState().filters);
    });
    document.getElementById("filterChips").addEventListener("click", (e) => {
      const button = e.target.closest("[data-filter-key]");
      if (!button) return;
      store.setFilters({ [button.dataset.filterKey]: "" });
      syncFilterControls(store.getState().filters);
    });
    document.getElementById("resetFilters").addEventListener("click", () => {
      store.setFilters({ keyword: "", language: "", descType: "", topic: "", status: "", starRange: "", updatedRange: "" });
      syncFilterControls(store.getState().filters);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const activeTag = document.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
      e.preventDefault();
      document.getElementById("globalSearch").focus();
    });
    window.addEventListener("resize", view.resize);
  }

  const cache = SecurityStore.loadCache();
  if (cache && cache.repos) {
    store.patch({ repos: cache.repos, lastUpdatedAt: cache.lastUpdatedAt || null });
    if (cache.accounts) {
      for (const accountId of store.getState().accountOrder) {
        const v = cache.accounts[accountId];
        if (v) store.patchAccount(accountId, { repos: v.repos || [], etag: v.etag || "" });
      }
    }
  }

  bindEvents();
  view.render(store.getState());
  await refresher.trigger("startup");
}

window.addEventListener("DOMContentLoaded", bootstrap);
