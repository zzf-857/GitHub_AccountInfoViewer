function formatCountdown(nextRefreshAt) {
  if (!nextRefreshAt) return "--:--";
  const remain = Math.max(0, Math.floor((nextRefreshAt - Date.now()) / 1000));
  const minutes = String(Math.floor(remain / 60)).padStart(2, "0");
  const seconds = String(remain % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatTime(ts) {
  if (!ts) return "--";
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDate(value) {
  const time = Date.parse(value || "");
  if (!time) return "未知更新";
  return new Date(time).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sourceRepos(state) {
  if (state.activeSource && state.activeSource.startsWith("account:")) {
    const accountId = state.activeSource.replace("account:", "");
    return state.accounts[accountId]?.repos || [];
  }
  return state.repos || [];
}

function parseRepoTimestamp(repo) {
  const t = Date.parse(repo.updatedAt || repo.updated_at || "");
  return Number.isFinite(t) ? t : 0;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "zh-CN", { sensitivity: "base" });
}

function sortRepositories(repos, sorting) {
  const by = sorting?.by || "updatedAt";
  const order = sorting?.order === "asc" ? 1 : -1;
  const sorted = [...repos];
  sorted.sort((left, right) => {
    if (by === "stars") return (toNumber(left.stars) - toNumber(right.stars)) * order;
    if (by === "forks") return (toNumber(left.forks) - toNumber(right.forks)) * order;
    if (by === "name") {
      const leftName = left.fullName || left.repo || left.name || "";
      const rightName = right.fullName || right.repo || right.name || "";
      return compareText(leftName, rightName) * order;
    }
    return (parseRepoTimestamp(left) - parseRepoTimestamp(right)) * order;
  });
  return sorted;
}

function languageColor(language) {
  const colors = {
    JavaScript: "#f4c95d",
    TypeScript: "#6ca8ff",
    Python: "#8bd17c",
    Go: "#3dd6c6",
    Rust: "#ff9b72",
    Vue: "#42d392",
    HTML: "#ff7a90",
    CSS: "#b8a7ff"
  };
  return colors[language] || "#a3aab5";
}

function createView() {
  let languageChart;
  let activityChart;
  let expandZh = false;

  function ensureCharts() {
    if (!languageChart) languageChart = echarts.init(document.getElementById("languageChart"));
    if (!activityChart) activityChart = echarts.init(document.getElementById("activityChart"));
  }

  function getFilteredRepos(state) {
    const filtered = DashboardInsights.filterRepositories(sourceRepos(state), state.filters);
    return sortRepositories(filtered, state.sorting);
  }

  function renderSelectOptions(selectId, rows, placeholder, currentValue) {
    const select = document.getElementById(selectId);
    const options = [`<option value="">${placeholder}</option>`];
    for (const row of rows) options.push(`<option value="${escapeHtml(row.name)}">${escapeHtml(row.name)} (${row.value})</option>`);
    select.innerHTML = options.join("");
    if ([...select.options].some((option) => option.value === currentValue)) select.value = currentValue;
  }

  function renderFilterOptions(state) {
    const repos = sourceRepos(state);
    renderSelectOptions("lang", DashboardInsights.buildLanguageStats(repos), "全部语言", state.filters.language);
    renderSelectOptions("topicFilter", DashboardInsights.buildTopicStats(repos).slice(0, 40), "全部主题", state.filters.topic);
  }

  function renderMetricsBanner(state, filtered) {
    const repos = sourceRepos(state);
    const languageStats = DashboardInsights.buildLanguageStats(repos);
    const topicStats = DashboardInsights.buildTopicStats(repos);
    const missing = repos.filter((repo) => DashboardInsights.getDescriptionKind(repo) === "empty").length;
    
    const topLanguage = languageStats.length ? languageStats[0].name : "N/A";
    const topTopic = topicStats.length ? topicStats[0].name : "N/A";
    
    document.getElementById("metricsBanner").innerHTML = `
      <div class="metric-item">
        <span class="metric-label">总仓库数</span>
        <span class="metric-value highlight">${repos.length}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">当前筛选</span>
        <span class="metric-value">${filtered.length}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">语言数</span>
        <span class="metric-value">${languageStats.length}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">最热语言</span>
        <span class="metric-value highlight">${escapeHtml(topLanguage)}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">最热主题</span>
        <span class="metric-value">${escapeHtml(topTopic)}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">缺少简介</span>
        <span class="metric-value" style="color: #ff0066">${missing}</span>
      </div>
    `;
  }

  function renderCharts(state, filtered) {
    ensureCharts();
    const languages = DashboardInsights.buildLanguageStats(filtered).slice(0, 10).reverse();
    const topLanguage = languages[languages.length - 1];
    const languageInsight = document.getElementById("languageInsight");
    languageInsight.textContent = topLanguage
      ? `当前结果中 ${topLanguage.name} 最多，共 ${topLanguage.value} 个仓库。`
      : "暂无足够数据生成语言洞察。";

    languageChart.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 108, right: 28, top: 18, bottom: 18 },
      xAxis: {
        type: "value",
        axisLabel: { color: "#a3aab5", fontSize: 13 },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } }
      },
      yAxis: {
        type: "category",
        data: languages.map((item) => item.name),
        axisLabel: { color: "#f3f4f6", fontSize: 13 }
      },
      series: [{
        type: "bar",
        data: languages.map((item) => item.value),
        barWidth: 16,
        itemStyle: { color: "#00f0ff", borderRadius: [0, 6, 6, 0] },
        label: { show: true, position: "right", color: "#a3aab5", fontSize: 13 }
      }]
    });

    const activity = DashboardInsights.getMonthlyActivity(filtered);
    activityChart.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      grid: { left: 36, right: 16, top: 18, bottom: 42 },
      xAxis: {
        type: "category",
        data: activity.map((item) => item.name),
        axisLabel: { color: "#a3aab5", fontSize: 13, rotate: 35 }
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#a3aab5", fontSize: 13 },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } }
      },
      series: [{
        type: "bar",
        data: activity.map((item) => item.value),
        barWidth: 14,
        itemStyle: { color: "#8bd17c", borderRadius: [6, 6, 0, 0] }
      }]
    });
  }

  function renderTopicPanel(filtered) {
    const topics = DashboardInsights.buildTopicStats(filtered).slice(0, 8);
    const max = Math.max(1, ...topics.map((topic) => topic.value));
    document.getElementById("topicPanel").innerHTML = topics.length ? topics.map((topic) => `
      <div class="topic-row">
        <span>${escapeHtml(topic.name)}</span>
        <span>${topic.value}</span>
        <div class="topic-bar"><span style="width:${Math.max(8, (topic.value / max) * 100)}%"></span></div>
      </div>
    `).join("") : '<p class="helper">当前结果没有 topic 数据。</p>';
  }

  function renderFilterChips(state) {
    const labels = [];
    const filters = state.filters;
    if (filters.keyword) labels.push(["keyword", `关键词：${filters.keyword}`]);
    if (filters.language) labels.push(["language", `语言：${filters.language}`]);
    if (filters.topic) labels.push(["topic", `主题：${filters.topic}`]);
    if (filters.descType) labels.push(["descType", `简介：${filters.descType}`]);
    if (filters.status) labels.push(["status", filters.status === "active" ? "活跃仓库" : "已归档"]);
    if (filters.starRange) labels.push(["starRange", `${filters.starRange} stars`]);
    if (filters.updatedRange) labels.push(["updatedRange", `更新：${filters.updatedRange}`]);
    if (filters.list) {
      const listLabel = filters.list === "unclassified" ? "未分类" : `List: ${filters.list}`;
      labels.push(["list", listLabel]);
    }
    document.getElementById("filterChips").innerHTML = labels.map(([key, label]) =>
      `<button class="filter-chip" data-filter-key="${key}" title="移除此筛选">${escapeHtml(label)} ×</button>`
    ).join("");
  }

  function renderStatus(state, filtered) {
    const statusEl = document.getElementById("liveStatus");
    const autoRefreshText = state.autoRefreshEnabled ? "开" : "关";
    const nextRefreshText = state.autoRefreshEnabled ? formatCountdown(state.nextRefreshAt) : "已关闭";
    const rateLimitText = Object.entries(state.rateLimitByAccount)
      .map(([key, value]) => `${key}: ${value.remaining}/${value.limit}`)
      .join(" | ");
    statusEl.textContent = `最近更新: ${formatTime(state.lastUpdatedAt)} ｜ 自动刷新: ${autoRefreshText} ｜ 下次刷新: ${nextRefreshText} ｜ ${state.isLoading ? "正在刷新，旧数据保持可见" : "空闲"}${rateLimitText ? ` ｜ 限流: ${rateLimitText}` : ""}`;
    document.getElementById("diffInfo").textContent = `本次变化: +${state.diffSummary.added} / -${state.diffSummary.removed}`;
    const autoRefreshToggle = document.getElementById("autoRefreshToggle");
    if (autoRefreshToggle) autoRefreshToggle.checked = !!state.autoRefreshEnabled;
    const sourceInfo = document.getElementById("sourceInfo");
    if (sourceInfo) sourceInfo.textContent = state.autoRefreshEnabled ? "自动刷新已启用" : "自动刷新已关闭";

    let sourceLabel = "全部账号合并";
    if (state.activeSource.startsWith("account:")) {
      const accountId = state.activeSource.replace("account:", "");
      sourceLabel = state.accounts[accountId]?.label || accountId;
    }
    document.getElementById("currentAccountBadge").textContent = `当前账号：${sourceLabel}`;
    document.getElementById("filterSummary").textContent = `当前：${sourceLabel}`;
    document.getElementById("activeFilterSummary").textContent = DashboardInsights.buildResultSummary(filtered, state.filters);
    const sortByEl = document.getElementById("sortBy");
    const sortOrderEl = document.getElementById("sortOrder");
    if (sortByEl) sortByEl.value = state.sorting?.by || "updatedAt";
    if (sortOrderEl) sortOrderEl.value = state.sorting?.order || "desc";
  }

  function renderGitHubLists(state) {
    const repos = sourceRepos(state);
    const stats = DashboardInsights.buildListStats(repos);
    const container = document.getElementById("githubListsContainer");
    if (!container) return;

    const currentList = state.filters.list || "";

    const html = [];
    
    // 1. 全部 (All)
    const allActive = currentList === "" ? "active" : "";
    html.push(`
      <button class="github-list-btn ${allActive}" data-list="">
        <span>全部 (All)</span>
        <span class="list-count">${stats.all}</span>
      </button>
    `);

    // 2. 自定义 Lists
    const listNodeIds = {};
    const listNodeAccounts = {};
    for (const accountId of state.accountOrder) {
      const account = state.accounts[accountId];
      if (account && account.lists) {
        for (const lst of account.lists) {
          listNodeIds[lst.name] = lst.id;
          listNodeAccounts[lst.name] = accountId;
        }
      }
    }

    for (const item of stats.lists) {
      const active = currentList === item.name ? "active" : "";
      const nodeId = listNodeIds[item.name] || "";
      const accountId = listNodeAccounts[item.name] || "";
      
      html.push(`
        <div class="github-list-btn-wrap" style="position: relative; width: 100%;">
          <button class="github-list-btn ${active}" data-list="${escapeHtml(item.name)}" data-id="${nodeId}" data-account="${accountId}">
            <span class="list-name-text">${escapeHtml(item.name)}</span>
            <span class="list-count" style="margin-right: ${nodeId ? '44px' : '0'}">${item.value}</span>
            ${nodeId ? `
              <span class="list-meta-actions">
                <button class="list-action-btn edit" data-id="${nodeId}" data-account="${accountId}" data-name="${escapeHtml(item.name)}" title="重命名 List">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
                <button class="list-action-btn delete" data-id="${nodeId}" data-account="${accountId}" data-name="${escapeHtml(item.name)}" title="删除 List">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </span>
            ` : ""}
          </button>
        </div>
      `);
    }

    // 3. 未分类 (Unclassified)
    const uncActive = currentList === "unclassified" ? "active" : "";
    html.push(`
      <button class="github-list-btn ${uncActive}" data-list="unclassified">
        <span>未分类 (Unclassified)</span>
        <span class="list-count">${stats.unclassified}</span>
      </button>
    `);

    // 4. 新建 List 按钮
    html.push(`
      <div class="add-list-section">
        <button class="add-list-btn" id="addNewListBtn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          新建 List
        </button>
      </div>
    `);

    container.innerHTML = html.join("");
  }

  function renderBatchActionBar(state) {
    const bar = document.getElementById("batchActionBar");
    const countEl = document.getElementById("batchSelectedCount");
    const select = document.getElementById("batchListSelect");
    if (!bar || !countEl) return;

    const selectedCount = state.selectedRepoIds.length;
    if (selectedCount > 0) {
      countEl.textContent = selectedCount;
      bar.classList.add("visible");

      // Populate lists dropdown
      const uniqueLists = new Set();
      for (const accountId of state.accountOrder) {
        const account = state.accounts[accountId];
        if (account && account.lists) {
          for (const lst of account.lists) {
            uniqueLists.add(lst.name);
          }
        }
      }

      const options = ['<option value="">加入目标 List...</option>'];
      for (const listName of [...uniqueLists].sort()) {
        options.push(`<option value="${escapeHtml(listName)}">${escapeHtml(listName)}</option>`);
      }
      select.innerHTML = options.join("");
    } else {
      bar.classList.remove("visible");
    }
  }

  function renderList(state, filtered) {
    document.getElementById("resultCount").textContent = `${filtered.length} 项`;
    const emptyState = document.getElementById("emptyState");
    const skeleton = document.getElementById("listSkeleton");
    const list = document.getElementById("list");
    const shouldShowSkeleton = state.isLoading && !sourceRepos(state).length;
    skeleton.classList.toggle("visible", shouldShowSkeleton);
    emptyState.classList.toggle("visible", !shouldShowSkeleton && !filtered.length);

    if (shouldShowSkeleton || !filtered.length) {
      list.innerHTML = "";
      return;
    }

    list.innerHTML = filtered.map((repo) => {
      const [owner = repo.owner || "", name = repo.name || repo.repo || ""] = (repo.fullName || repo.repo || "").split("/");
      const topics = (repo.topics || []).slice(0, 5);
      const repoLists = repo.lists || [];
      const descriptionKind = DashboardInsights.getDescriptionKind(repo);
      const isSelected = state.selectedRepoIds.includes(repo.id);
      
      return `
        <article class="repo-card ${expandZh ? "expanded" : ""} ${isSelected ? "selected" : ""}" draggable="true" data-id="${repo.id}">
          <div class="repo-select-container">
            <input type="checkbox" class="repo-checkbox" ${isSelected ? "checked" : ""} data-id="${repo.id}" />
          </div>
          <div class="repo-card-content">
            <div>
              <h3 class="repo-title"><a href="${escapeHtml(repo.url || repo.htmlUrl || "#")}" target="_blank" rel="noopener noreferrer"><span class="repo-owner">${escapeHtml(owner)}/</span>${escapeHtml(name)}</a></h3>
              <p class="repo-desc">${escapeHtml(repo.description || "暂无简介")}</p>
              ${descriptionKind === "en" ? `<div class="repo-desc-cn"><strong>自动解读：</strong>${escapeHtml(DashboardInsights.zhAuto(repo.description))}</div>` : ""}
              <div class="repo-topics">
                ${repoLists.map((listName) => `<span class="repo-list-tag">${escapeHtml(listName)}</span>`).join("")}
                ${topics.map((topic) => `<span class="repo-topic">${escapeHtml(topic)}</span>`).join("")}
                ${descriptionKind === "empty" ? '<span class="repo-topic">暂无简介</span>' : ""}
              </div>
              <button class="ai-guide-btn" data-repo="${escapeHtml(owner)}/${escapeHtml(name)}" data-desc="${escapeHtml(repo.description || '')}" data-panel-id="ai-panel-${escapeHtml(owner)}-${escapeHtml(name)}">✨ AI 引导</button>
            </div>
            <aside class="repo-side">
              <span class="repo-language"><span class="language-dot" style="background:${languageColor(repo.language)}"></span>${escapeHtml(repo.language || "Others")}</span>
              <span class="repo-meta">★ ${Number(repo.stars || 0).toLocaleString("zh-CN")} ｜ Fork ${Number(repo.forks || 0).toLocaleString("zh-CN")}</span>
              <span class="repo-meta">${formatDate(repo.updatedAt || repo.updated_at)}</span>
              ${repo.archived ? '<span class="repo-topic">已归档</span>' : ""}
            </aside>
          </div>
        </article>
      `;
    }).join("");
  }

  function render(state) {
    const filtered = getFilteredRepos(state);
    renderFilterOptions(state);
    renderMetricsBanner(state, filtered);
    renderCharts(state, filtered);
    renderTopicPanel(filtered);
    renderFilterChips(state);
    renderStatus(state, filtered);
    renderGitHubLists(state);
    renderList(state, filtered);
    renderBatchActionBar(state);
  }

  function setExpandZh(value) {
    expandZh = value;
  }

  function resize() {
    if (languageChart) languageChart.resize();
    if (activityChart) activityChart.resize();
  }

  return { render, setExpandZh, resize, getFilteredRepos };
}

window.DashboardView = { createView };
