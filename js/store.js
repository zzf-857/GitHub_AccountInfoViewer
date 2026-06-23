const defaultState = {
  activeSource: "merged",
  filters: { keyword: "", language: "", descType: "", topic: "", status: "", starRange: "", updatedRange: "", list: "" },
  sorting: { by: "updatedAt", order: "desc" },
  accounts: {},
  accountOrder: [],
  repos: [],
  previousRepos: [],
  lastUpdatedAt: null,
  nextRefreshAt: null,
  isLoading: false,
  error: "",
  refreshIntervalMs: 5 * 60 * 1000,
  autoRefreshEnabled: true,
  rateLimitByAccount: {},
  diffSummary: { added: 0, removed: 0 }
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function createStore() {
  const state = clone(defaultState);
  const subscribers = [];

  function notify() {
    subscribers.forEach((fn) => fn(state));
  }

  return {
    getState: () => state,
    subscribe(fn) {
      subscribers.push(fn);
      return () => {
        const i = subscribers.indexOf(fn);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },
    patch(partial) {
      Object.assign(state, partial);
      notify();
    },
    patchAccount(accountId, partial) {
      if (!state.accounts[accountId]) return;
      Object.assign(state.accounts[accountId], partial);
      notify();
    },
    setAccounts(accountList) {
      state.accounts = {};
      state.accountOrder = [];
      for (const account of accountList) {
        state.accounts[account.id] = {
          id: account.id,
          label: account.label,
          token: account.token || "",
          repos: [],
          etag: "",
          enabled: true
        };
        state.accountOrder.push(account.id);
      }
      notify();
    },
    setFilters(partial) {
      Object.assign(state.filters, partial);
      notify();
    },
    setTokensByAccount(tokenMap) {
      for (const [accountId, token] of Object.entries(tokenMap)) {
        if (state.accounts[accountId]) state.accounts[accountId].token = token;
      }
      notify();
    },
    setRepos(allRepos) {
      state.previousRepos = state.repos;
      state.repos = allRepos;
      notify();
    }
  };
}

window.DashboardStore = { createStore };
