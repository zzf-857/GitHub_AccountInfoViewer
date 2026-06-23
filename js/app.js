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
    document.getElementById("sortBy").addEventListener("change", (e) => {
      store.patch({ sorting: { ...store.getState().sorting, by: e.target.value } });
    });
    document.getElementById("sortOrder").addEventListener("change", (e) => {
      store.patch({ sorting: { ...store.getState().sorting, order: e.target.value } });
    });
    document.getElementById("source").addEventListener("change", (e) => store.patch({ activeSource: e.target.value }));
    document.getElementById("autoRefreshToggle").addEventListener("change", (e) => {
      const enabled = !!e.target.checked;
      store.patch({ autoRefreshEnabled: enabled });
      if (enabled) refresher.start();
      else refresher.stop();
    });
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
    document.getElementById("githubListsContainer").addEventListener("click", (e) => {
      const button = e.target.closest("[data-list]");
      if (!button) return;
      store.setFilters({ list: button.dataset.list });
    });
    document.getElementById("filterChips").addEventListener("click", (e) => {
      const button = e.target.closest("[data-filter-key]");
      if (!button) return;
      store.setFilters({ [button.dataset.filterKey]: "" });
      syncFilterControls(store.getState().filters);
    });
    document.getElementById("resetFilters").addEventListener("click", () => {
      store.setFilters({ keyword: "", language: "", descType: "", topic: "", status: "", starRange: "", updatedRange: "", list: "" });
      syncFilterControls(store.getState().filters);
    });
    
    let currentAIAborter = null;
    let aiOnline = false;

    // AI 模型连通性探测
    (async function checkAIHealth() {
      const dot = document.getElementById("aiHealthDot");
      const label = document.getElementById("aiHealthLabel");
      try {
        const healthCtrl = new AbortController();
        const healthTimeout = setTimeout(() => healthCtrl.abort(), 35000);
        const resp = await fetch("/api/ai-health", { signal: healthCtrl.signal });
        clearTimeout(healthTimeout);
        const data = await resp.json();
        if (data.ok) {
          aiOnline = true;
          dot.className = "ai-health-dot online";
          label.textContent = `${data.model} 在线`;
          label.style.color = "#22c55e";
        } else {
          aiOnline = false;
          dot.className = "ai-health-dot offline";
          label.textContent = `离线: ${data.message}`;
          label.style.color = "#ef4444";
          document.querySelectorAll(".ai-guide-btn").forEach(b => b.classList.add("ai-offline"));
        }
      } catch (err) {
        aiOnline = false;
        dot.className = "ai-health-dot offline";
        label.textContent = "连接失败";
        label.style.color = "#ef4444";
        document.querySelectorAll(".ai-guide-btn").forEach(b => b.classList.add("ai-offline"));
      }
    })();

    document.getElementById("list").addEventListener("click", async (e) => {
      const btn = e.target.closest(".ai-guide-btn");
      if (!btn) return;
      if (!aiOnline) return; // 离线时不响应
      
      const repo = btn.dataset.repo;
      const desc = btn.dataset.desc || "";
      const [owner, repoName] = repo.split("/");
      
      const modalOverlay = document.getElementById("aiModalOverlay");
      const modalTitle = document.getElementById("aiModalTitle");
      const panel = document.getElementById("aiModalContent");
      
      // Abort any ongoing request
      if (currentAIAborter) {
        currentAIAborter.abort();
        currentAIAborter = null;
      }
      currentAIAborter = new AbortController();
      
      modalTitle.innerHTML = `✨ AI 引导：${escapeHtml(owner)}/${escapeHtml(repoName)}`;
      panel.innerHTML = `
        <div class="ai-loading-container" id="aiLoadingContainer">
          <div class="ai-loading-step">正在获取 GitHub README...</div>
          <div class="ai-loading-step thinking">AI 正在深度思考中...</div>
        </div>
      `;
      modalOverlay.classList.add("visible");
      
      btn.disabled = true;
      btn.textContent = "✨ 正在解读...";
      
      const badge = document.getElementById("aiModelBadge");
      badge.style.display = "none";
      badge.textContent = "";

      try {
        const url = `/api/ai-guide?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repoName)}&description=${encodeURIComponent(desc)}`;
        const response = await fetch(url, { signal: currentAIAborter.signal });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const usedModel = response.headers.get("X-AI-Model");
        if (usedModel) {
          badge.textContent = `Model: ${usedModel}`;
          badge.style.display = "inline-block";
        }
        
        let fullText = "";
        let displayLength = 0;
        let isDone = false;
        
        let renderFrame;
        const renderLoop = () => {
          if (displayLength < fullText.length) {
            const diff = fullText.length - displayLength;
            const step = Math.max(1, Math.ceil(diff / 4));
            displayLength += step;
            
            const currentText = fullText.slice(0, displayLength);
            if (window.marked) {
              panel.innerHTML = marked.parse(currentText) + '<span class="ai-cursor"></span>';
            } else {
              panel.innerHTML = currentText.replace(/\n/g, '<br>') + '<span class="ai-cursor"></span>';
            }
            panel.scrollTop = panel.scrollHeight;
          } else if (isDone) {
            const currentText = fullText;
            if (currentText.length > 0) {
              if (window.marked) {
                panel.innerHTML = marked.parse(currentText);
              } else {
                panel.innerHTML = currentText.replace(/\n/g, '<br>');
              }
            }
            return;
          }
          renderFrame = requestAnimationFrame(renderLoop);
        };
        renderFrame = requestAnimationFrame(renderLoop);
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        let sseBuffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          // 保留最后一行（可能不完整）
          sseBuffer = lines.pop() || "";
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.slice(6);
              if (dataStr === '[DONE]') continue;
              try {
                const data = JSON.parse(dataStr);
                if (data.content) {
                  fullText += data.content;
                }
              } catch (err) {}
            }
          }
        }
        
      } catch (err) {
        if (renderFrame) cancelAnimationFrame(renderFrame);
        if (err.name === 'AbortError') {
          panel.innerHTML = `<span style="color: #a3aab5">解读已取消</span>`;
        } else {
          panel.innerHTML = `<span style="color: var(--rose)">解读失败：${err.message}</span>`;
        }
      } finally {
        isDone = true;
        btn.disabled = false;
        btn.textContent = "✨ AI 引导";
      }
    });

    const closeAIModal = () => {
      document.getElementById("aiModalOverlay").classList.remove("visible");
      if (currentAIAborter) {
        currentAIAborter.abort();
        currentAIAborter = null;
      }
    };

    document.getElementById("aiModalClose")?.addEventListener("click", closeAIModal);
    
    document.getElementById("aiModalOverlay")?.addEventListener("click", (e) => {
      if (e.target === document.getElementById("aiModalOverlay")) {
        closeAIModal();
      }
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
