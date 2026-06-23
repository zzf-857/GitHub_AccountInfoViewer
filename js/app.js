async function getBase64ImageFromUrl(imageUrl) {
  try {
    const res = await fetch(imageUrl);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error("Failed to fetch image as base64:", err);
    return null;
  }
}

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
  // 从本地存储恢复各账号头像缓存
  for (const accountId of store.getState().accountOrder) {
    const cached = localStorage.getItem(`avatar_cache_${accountId}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.base64) {
          store.patchAccount(accountId, { avatarUrl: parsed.avatarUrl, localAvatarBase64: parsed.base64 });
        }
      } catch (_) {}
    }
  }
  renderSourceOptions(store.getState());
  const sourceInfo = document.getElementById("sourceInfo");
  if (sourceInfo) {
    sourceInfo.textContent = `已从 .env 读取 ${envAccounts.length} 个账号配置。`;
  }

  async function updateAvatarCache(accountId, avatarUrl) {
    if (!avatarUrl) return;
    const cachedKey = `avatar_cache_${accountId}`;
    const cached = localStorage.getItem(cachedKey);
    let needFetch = true;
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.avatarUrl === avatarUrl && parsed.base64) {
          needFetch = false;
          const currentAccount = store.getState().accounts[accountId];
          if (currentAccount && currentAccount.localAvatarBase64 !== parsed.base64) {
            store.patchAccount(accountId, { avatarUrl, localAvatarBase64: parsed.base64 });
          }
        }
      } catch (_) {}
    }
    if (needFetch) {
      console.log(`[Avatar Cache] Fetching new avatar for account ${accountId} from: ${avatarUrl}`);
      const base64 = await getBase64ImageFromUrl(avatarUrl);
      if (base64) {
        localStorage.setItem(cachedKey, JSON.stringify({ avatarUrl, base64 }));
        store.patchAccount(accountId, { avatarUrl, localAvatarBase64: base64 });
        
        SecurityStore.saveCache({
          repos: store.getState().repos,
          accounts: store.getState().accounts,
          accountOrder: store.getState().accountOrder,
          lastUpdatedAt: store.getState().lastUpdatedAt
        });
      }
    }
  }

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
          if (result.avatarUrl) {
            await updateAvatarCache(accountId, result.avatarUrl);
          }
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
    const sourceEl = document.getElementById("source");
    if (sourceEl && sourceEl.value !== (state.activeSource || "merged")) {
      sourceEl.value = state.activeSource || "merged";
    }
  });

  function bindEvents() {
    let lastCheckedId = null;
    let isSelecting = false;
    let startX = 0;
    let startY = 0;
    let selectionBox = null;
    let initialSelectedRepoIds = [];
    let isCtrlActive = false;
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
    document.getElementById("sortOrderToggle").addEventListener("click", () => {
      const state = store.getState();
      const currentOrder = state.sorting?.order || "desc";
      const nextOrder = currentOrder === "desc" ? "asc" : "desc";
      store.patch({ sorting: { ...state.sorting, order: nextOrder } });
    });
    document.getElementById("source").addEventListener("change", (e) => store.patch({ activeSource: e.target.value }));

    // 账号选择 Dropdown 交互逻辑
    const accountDropdownMenu = document.getElementById("accountDropdownMenu");
    const accountAvatarBtn = document.getElementById("accountAvatarBtn");
    if (accountAvatarBtn && accountDropdownMenu) {
      accountAvatarBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isClosed = accountDropdownMenu.classList.contains("scale-95");
        if (isClosed) {
          accountDropdownMenu.classList.remove("scale-95", "opacity-0", "pointer-events-none");
          accountDropdownMenu.classList.add("scale-100", "opacity-100");
        } else {
          accountDropdownMenu.classList.remove("scale-100", "opacity-100");
          accountDropdownMenu.classList.add("scale-95", "opacity-0", "pointer-events-none");
        }
      });

      document.addEventListener("click", (e) => {
        if (!accountAvatarBtn.contains(e.target) && !accountDropdownMenu.contains(e.target)) {
          accountDropdownMenu.classList.remove("scale-100", "opacity-100");
          accountDropdownMenu.classList.add("scale-95", "opacity-0", "pointer-events-none");
        }
      });

      const dropdownList = document.getElementById("accountDropdownList");
      if (dropdownList) {
        dropdownList.addEventListener("click", (e) => {
          const item = e.target.closest(".account-menu-item");
          if (!item) return;
          const val = item.dataset.sourceVal;
          if (val) {
            const sourceEl = document.getElementById("source");
            if (sourceEl) {
              sourceEl.value = val;
              sourceEl.dispatchEvent(new Event("change"));
            }
            accountDropdownMenu.classList.remove("scale-100", "opacity-100");
            accountDropdownMenu.classList.add("scale-95", "opacity-0", "pointer-events-none");
          }
        });
      }
    }
    
    // 自动刷新事件委托，防止 innerHTML 重绘导致事件丢失
    document.getElementById("liveStatus").addEventListener("change", (e) => {
      if (e.target && e.target.id === "autoRefreshToggle") {
        const enabled = !!e.target.checked;
        store.patch({ autoRefreshEnabled: enabled });
        if (enabled) refresher.start();
        else refresher.stop();
      }
    });
    document.getElementById("manualRefresh").addEventListener("click", () => refresher.trigger("manual"));
    document.getElementById("clearCredentials").addEventListener("click", () => {
      SecurityStore.clearAllLocalData();
      store.patch({ repos: [], error: "已清空本地缓存（.env 配置不会被删除）。" });
      for (const accountId of store.getState().accountOrder) {
        store.patchAccount(accountId, { repos: [], etag: "", avatarUrl: "", localAvatarBase64: "" });
        localStorage.removeItem(`avatar_cache_${accountId}`);
      }
    });
    document.getElementById("toggleExpandAll").addEventListener("click", () => {
      const nextState = !view.getExpandZh();
      view.setExpandZh(nextState);
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
      if (!dot || !label) return;
      try {
        const healthCtrl = new AbortController();
        const healthTimeout = setTimeout(() => healthCtrl.abort(), 35000);
        const resp = await fetch("/api/ai-health", { signal: healthCtrl.signal });
        clearTimeout(healthTimeout);
        const data = await resp.json();
        if (data.ok) {
          aiOnline = true;
          dot.className = "w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgba(78,222,163,0.5)]";
          label.textContent = `${data.model} 在线`;
          label.style.color = "#4edea3";
        } else {
          aiOnline = false;
          dot.className = "w-2 h-2 rounded-full bg-error shadow-[0_0_8px_rgba(239,68,68,0.5)]";
          label.textContent = `离线: ${data.message}`;
          label.style.color = "#ef4444";
          document.querySelectorAll(".ai-guide-btn").forEach(b => b.classList.add("ai-offline"));
        }
      } catch (err) {
        aiOnline = false;
        dot.className = "w-2 h-2 rounded-full bg-error shadow-[0_0_8px_rgba(239,68,68,0.5)]";
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
      
      modalTitle.innerHTML = `✨ AI 导读：${escapeHtml(owner)}/${escapeHtml(repoName)}`;
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
        btn.innerHTML = '<span class="material-symbols-outlined text-[13px]">magic_button</span> AI 导读';
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

    async function executeBatchAddToList(repoIds, targetListName, targetListId, targetAccountId) {
      if (!repoIds || !repoIds.length) return;
      const state = store.getState();
      const reposByAccount = {};
      const updatedRepos = state.repos.map(repo => {
        if (repoIds.includes(repo.id)) {
          if (!reposByAccount[repo.sourceAccount]) reposByAccount[repo.sourceAccount] = [];
          reposByAccount[repo.sourceAccount].push(repo);
          const lists = repo.lists || [];
          if (targetListName && !lists.includes(targetListName)) {
            return { ...repo, lists: [...lists, targetListName] };
          }
        }
        return repo;
      });

      store.patch({ repos: updatedRepos });
      const promises = [];
      for (const [accountId, repos] of Object.entries(reposByAccount)) {
        const account = state.accounts[accountId];
        const token = (account?.token || "").trim();
        if (!token) continue;

        let listNodeId = targetListId;
        if (accountId !== targetAccountId) {
          const matchedList = account.lists?.find(l => l.name === targetListName);
          listNodeId = matchedList?.id || "";
        }

        if (!listNodeId) {
          try {
            const newList = await GitHubApi.createUserList({ token, name: targetListName });
            if (newList && newList.id) {
              listNodeId = newList.id;
              const updatedAccountLists = [...(account.lists || []), newList];
              store.patchAccount(accountId, { lists: updatedAccountLists });
            }
          } catch (err) {
            console.error(`Failed to create list '${targetListName}' in account ${accountId}:`, err);
            continue;
          }
        }

        for (const repo of repos) {
          if (!repo.nodeId) continue;
          const otherListNames = (repo.lists || []).filter(name => name !== targetListName);
          const listNodeIds = [listNodeId];
          for (const name of otherListNames) {
            const matched = account.lists?.find(l => l.name === name);
            if (matched && matched.id) {
              listNodeIds.push(matched.id);
            }
          }
          promises.push(
            GitHubApi.updateRepositoryLists({
              token,
              repositoryNodeId: repo.nodeId,
              listNodeIds
            }).catch(err => console.error(`Failed to update lists for repo ${repo.fullName}:`, err))
          );
        }
      }

      await Promise.all(promises);
      store.clearRepoSelection();
      store.patch({ error: "批量归类成功！" });
      setTimeout(() => store.patch({ error: "" }), 3000);
      SecurityStore.saveCache({
        repos: store.getState().repos,
        accounts: store.getState().accounts,
        accountOrder: store.getState().accountOrder,
        lastUpdatedAt: Date.now()
      });
      view.render(store.getState());
    }

    document.getElementById("list").addEventListener("click", (e) => {
      if (e.target.closest("a, button, input:not(.repo-checkbox)")) {
        return;
      }
      
      const card = e.target.closest(".repo-card");
      if (!card) {
        // 点击列表空白处，且没有按修饰键时，清空选择
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
          store.patch({ selectedRepoIds: [] });
          lastCheckedId = null;
        }
        return;
      }
      
      const currentId = card.dataset.id;
      const state = store.getState();
      
      if (e.shiftKey && lastCheckedId) {
        const filtered = view.getFilteredRepos(state);
        const filteredIds = filtered.map(r => r.id);
        const fromIdx = filteredIds.indexOf(lastCheckedId);
        const toIdx = filteredIds.indexOf(currentId);
        if (fromIdx !== -1 && toIdx !== -1) {
          const start = Math.min(fromIdx, toIdx);
          const end = Math.max(fromIdx, toIdx);
          const rangeIds = filteredIds.slice(start, end + 1);
          
          const wasSelected = state.selectedRepoIds.includes(currentId);
          const targetChecked = !wasSelected;
          
          let currentSelected = [...state.selectedRepoIds];
          if (targetChecked) {
            for (const id of rangeIds) {
              if (!currentSelected.includes(id)) {
                currentSelected.push(id);
              }
            }
          } else {
            currentSelected = currentSelected.filter(id => !rangeIds.includes(id));
          }
          store.patch({ selectedRepoIds: currentSelected });
          lastCheckedId = currentId;
          return;
        }
      }
      
      const isCheckbox = !!e.target.closest(".repo-checkbox");
      if (isCheckbox || e.ctrlKey || e.metaKey) {
        store.toggleRepoSelection(currentId);
        lastCheckedId = currentId;
        return;
      }
      
      const isAlreadySelected = state.selectedRepoIds.includes(currentId);
      const isOnlySelected = isAlreadySelected && state.selectedRepoIds.length === 1;
      
      if (isOnlySelected) {
        store.patch({ selectedRepoIds: [] });
        lastCheckedId = null;
      } else {
        store.patch({ selectedRepoIds: [currentId] });
        lastCheckedId = currentId;
      }
    });

    // 禁用列表区域的浏览器默认右键菜单，防止框选时弹出菜单
    document.getElementById("list").addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    function onMouseMove(e) {
      if (!isSelecting || !selectionBox) return;
      
      const currentX = e.clientX;
      const currentY = e.clientY;
      
      const boxLeft = Math.min(startX, currentX);
      const boxTop = Math.min(startY, currentY);
      const boxWidth = Math.abs(startX - currentX);
      const boxHeight = Math.abs(startY - currentY);
      
      selectionBox.style.left = `${boxLeft}px`;
      selectionBox.style.top = `${boxTop}px`;
      selectionBox.style.width = `${boxWidth}px`;
      selectionBox.style.height = `${boxHeight}px`;
      
      const cards = document.querySelectorAll("#list .repo-card");
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        const intersect = !(
          rect.left > boxLeft + boxWidth ||
          rect.right < boxLeft ||
          rect.top > boxTop + boxHeight ||
          rect.bottom < boxTop
        );
        
        const id = card.dataset.id;
        const checkbox = card.querySelector(".repo-checkbox");
        // 如果按住了 Ctrl/Cmd 进行框选，那么在原本选中的基础上进行叠加，否则只有框住的被选中
        const shouldBeSelected = isCtrlActive ? (initialSelectedRepoIds.includes(id) || intersect) : intersect;
        
        if (shouldBeSelected) {
          card.classList.add("selected");
          if (checkbox) checkbox.checked = true;
        } else {
          card.classList.remove("selected");
          if (checkbox) checkbox.checked = false;
        }
      });
    }

    function onMouseUp(e) {
      if (!isSelecting) return;
      isSelecting = false;
      
      if (selectionBox) {
        selectionBox.remove();
        selectionBox = null;
      }
      
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      
      const selectedIds = [];
      const cards = document.querySelectorAll("#list .repo-card.selected");
      cards.forEach((card) => {
        if (card.dataset.id) {
          selectedIds.push(card.dataset.id);
        }
      });
      
      store.patch({ selectedRepoIds: selectedIds });
    }

    document.getElementById("list").addEventListener("mousedown", (e) => {
      // 避免在卡片内的交互元素（链接、按钮等）上触发右键拖拽框选
      if (e.target.closest("a, button, input:not(.repo-checkbox)")) {
        return;
      }
      
      if (e.button === 2) {
        e.preventDefault();
        isSelecting = true;
        startX = e.clientX;
        startY = e.clientY;
        isCtrlActive = e.ctrlKey || e.metaKey;
        initialSelectedRepoIds = [...store.getState().selectedRepoIds];
        
        selectionBox = document.createElement("div");
        selectionBox.className = "selection-box";
        selectionBox.style.left = `${startX}px`;
        selectionBox.style.top = `${startY}px`;
        selectionBox.style.width = "0px";
        selectionBox.style.height = "0px";
        document.body.appendChild(selectionBox);
        
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      }
    });

    document.getElementById("list").addEventListener("dragstart", (e) => {
      const card = e.target.closest(".repo-card");
      if (!card) return;
      const repoId = card.dataset.id;
      const state = store.getState();
      if (!state.selectedRepoIds.includes(repoId)) {
        store.patch({ selectedRepoIds: [repoId] });
      }

      const currentSelected = store.getState().selectedRepoIds;
      const count = currentSelected.length;
      
      // 获取当前被拖拽的仓库名字
      const repoName = card.querySelector("h3 a")?.innerText || card.querySelector("h3")?.innerText || "GitHub Repository";
      
      let html = "";
      if (count > 1) {
        html = `
          <div class="drag-avatar-stack">
            <div class="drag-avatar-card drag-avatar-card-base2"></div>
            <div class="drag-avatar-card drag-avatar-card-base1"></div>
            <div class="drag-avatar-card drag-avatar-card-top">
              <div class="text-[10px] text-slate-400 font-mono truncate">拖拽中...</div>
              <div class="text-xs font-bold text-slate-100 truncate mt-1">${repoName}</div>
              <div class="drag-avatar-badge">+${count}</div>
            </div>
          </div>
        `;
      } else {
        html = `
          <div class="drag-avatar-stack" style="width: 200px; height: 70px;">
            <div class="drag-avatar-card drag-avatar-card-top" style="height: 100%;">
              <div class="text-[10px] text-slate-400 font-mono truncate">拖拽中...</div>
              <div class="text-xs font-bold text-slate-100 truncate mt-1">${repoName}</div>
            </div>
          </div>
        `;
      }
      
      const container = document.getElementById("drag-avatar-container");
      container.innerHTML = html;
      
      // 设置自定义拖拽快照图像
      // xOffset = 100, yOffset = 45 使得鼠标差不多在卡片堆中心
      e.dataTransfer.setDragImage(container.firstElementChild, 100, 45);

      // 使用 setTimeout 延迟把原卡片半透明化，防止拖拽默认生成的快照在拖拽开始的一瞬间变透明
      setTimeout(() => {
        document.querySelectorAll("#list .repo-card").forEach(c => {
          if (currentSelected.includes(c.dataset.id)) {
            c.classList.add("opacity-30");
          }
        });
      }, 0);

      e.dataTransfer.setData("text/plain", JSON.stringify(currentSelected));
      e.dataTransfer.effectAllowed = "move";
      document.querySelectorAll(".github-list-btn").forEach(btn => {
        if (btn.dataset.list !== undefined && btn.dataset.list !== "unclassified") {
          btn.classList.add("drop-target-active");
        }
      });
    });

    document.getElementById("list").addEventListener("dragend", (e) => {
      document.querySelectorAll(".github-list-btn").forEach(btn => {
        btn.classList.remove("drop-target-active", "drag-over");
      });
      document.querySelectorAll("#list .repo-card.opacity-30").forEach(c => {
        c.classList.remove("opacity-30");
      });
    });

    const listsContainer = document.getElementById("githubListsContainer");
    listsContainer.addEventListener("dragover", (e) => {
      const btn = e.target.closest(".github-list-btn");
      if (btn && btn.dataset.list !== undefined && btn.dataset.list !== "unclassified") {
        e.preventDefault();
      }
    });

    listsContainer.addEventListener("dragenter", (e) => {
      const btn = e.target.closest(".github-list-btn");
      if (btn && btn.dataset.list !== undefined && btn.dataset.list !== "unclassified") {
        btn.classList.add("drag-over");
      }
    });

    listsContainer.addEventListener("dragleave", (e) => {
      const btn = e.target.closest(".github-list-btn");
      if (btn) {
        btn.classList.remove("drag-over");
      }
    });

    listsContainer.addEventListener("drop", async (e) => {
      e.preventDefault();
      const btn = e.target.closest(".github-list-btn");
      if (!btn || btn.dataset.list === undefined || btn.dataset.list === "unclassified") return;
      btn.classList.remove("drag-over");
      const targetListName = btn.dataset.list;
      const targetListId = btn.dataset.id;
      const targetAccountId = btn.dataset.account;
      try {
        const repoIds = JSON.parse(e.dataTransfer.getData("text/plain"));
        await executeBatchAddToList(repoIds, targetListName, targetListId, targetAccountId);
      } catch (err) {
        console.error("Drop handling failed:", err);
      }
    });


    document.getElementById("batchClearBtn").addEventListener("click", () => {
      store.clearRepoSelection();
    });

    listsContainer.addEventListener("click", async (e) => {
      const addBtn = e.target.closest("#addNewListBtn");
      if (addBtn) {
        const name = prompt("请输入新建 List 的名称：");
        if (!name || !name.trim()) return;
        const state = store.getState();
        const promises = [];
        for (const accountId of state.accountOrder) {
          const account = state.accounts[accountId];
          const token = (account?.token || "").trim();
          if (!token) continue;
          promises.push(
            GitHubApi.createUserList({ token, name: name.trim() })
              .then(newList => {
                if (newList) {
                  const updatedLists = [...(account.lists || []), newList];
                  store.patchAccount(accountId, { lists: updatedLists });
                }
              })
              .catch(err => console.error(`Create list failed for ${accountId}:`, err))
          );
        }
        await Promise.all(promises);
        store.patch({ error: `List “${name}” 创建成功！` });
        setTimeout(() => store.patch({ error: "" }), 3000);
        view.render(store.getState());
        return;
      }

      const editBtn = e.target.closest(".list-action-btn.edit");
      if (editBtn) {
        e.stopPropagation();
        const listNodeId = editBtn.dataset.id;
        const accountId = editBtn.dataset.account;
        const oldName = editBtn.dataset.name;
        const newName = prompt(`请输入 List “${oldName}” 的新名称：`, oldName);
        if (!newName || !newName.trim() || newName.trim() === oldName) return;

        const state = store.getState();
        const updatedRepos = state.repos.map(repo => {
          if (repo.lists && repo.lists.includes(oldName)) {
            const listArr = repo.lists.map(name => name === oldName ? newName.trim() : name);
            return { ...repo, lists: listArr };
          }
          return repo;
        });

        for (const actId of state.accountOrder) {
          const act = state.accounts[actId];
          if (act.lists) {
            const updatedLists = act.lists.map(l => {
              if (l.name === oldName) return { ...l, name: newName.trim() };
              return l;
            });
            store.patchAccount(actId, { lists: updatedLists });
          }
        }

        store.patch({ repos: updatedRepos });
        const promises = [];
        for (const actId of state.accountOrder) {
          const act = state.accounts[actId];
          const token = (act?.token || "").trim();
          if (!token) continue;
          
          const matched = act.lists?.find(l => l.name === oldName);
          if (matched && matched.id) {
            promises.push(
              GitHubApi.updateUserList({
                token,
                listNodeId: matched.id,
                name: newName.trim()
              }).catch(err => console.error(`Rename failed for list in ${actId}:`, err))
            );
          }
        }

        await Promise.all(promises);
        store.patch({ error: "重命名成功！" });
        setTimeout(() => store.patch({ error: "" }), 3000);
        SecurityStore.saveCache({
          repos: store.getState().repos,
          accounts: store.getState().accounts,
          accountOrder: store.getState().accountOrder,
          lastUpdatedAt: Date.now()
        });
        view.render(store.getState());
        return;
      }

      const deleteBtn = e.target.closest(".list-action-btn.delete");
      if (deleteBtn) {
        e.stopPropagation();
        const oldName = deleteBtn.dataset.name;
        if (!confirm(`确定要删除 List “${oldName}” 吗？\n注意：这会同步删除您 GitHub 账号中的该自定义 List。`)) return;

        const state = store.getState();
        const updatedRepos = state.repos.map(repo => {
          if (repo.lists) {
            return { ...repo, lists: repo.lists.filter(name => name !== oldName) };
          }
          return repo;
        });

        const promises = [];
        for (const accountId of state.accountOrder) {
          const account = state.accounts[accountId];
          const token = (account?.token || "").trim();
          if (!token) continue;
          const matched = account.lists?.find(l => l.name === oldName);
          if (matched && matched.id) {
            promises.push(
              GitHubApi.deleteUserList({
                token,
                listNodeId: matched.id
              }).catch(err => console.error(`Delete list failed for ${accountId}:`, err))
            );
            const updatedLists = account.lists.filter(l => l.name !== oldName);
            store.patchAccount(accountId, { lists: updatedLists });
          }
        }

        store.patch({ repos: updatedRepos });
        await Promise.all(promises);
        store.patch({ error: "删除 List 成功！" });
        setTimeout(() => store.patch({ error: "" }), 3000);
        SecurityStore.saveCache({
          repos: store.getState().repos,
          accounts: store.getState().accounts,
          accountOrder: store.getState().accountOrder,
          lastUpdatedAt: Date.now()
        });
        view.render(store.getState());
        return;
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
        if (v) store.patchAccount(accountId, { repos: v.repos || [], etag: v.etag || "", lists: v.lists || [] });
      }
    }
  }

  bindEvents();
  view.render(store.getState());
  await refresher.trigger("startup");
}

window.addEventListener("DOMContentLoaded", bootstrap);
