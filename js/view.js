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
    JavaScript: "#f1e05a",
    TypeScript: "#3178c6",
    Python: "#3572A5",
    Go: "#00ADD8",
    Rust: "#dea584",
    Vue: "#41b883",
    HTML: "#e34c26",
    CSS: "#563d7c",
    C: "#555555",
    "C++": "#f34b7d",
    Java: "#b07219",
    Ruby: "#701516",
    Shell: "#89e051"
  };
  return colors[language] || "#a3aab5";
}

function createView() {
  let languageChart;
  let activityChart;
  let expandZh = false;

  function ensureCharts() {
    if (!languageChart) {
      languageChart = echarts.init(document.getElementById("languageChart"));
    }
    if (!activityChart) {
      activityChart = echarts.init(document.getElementById("activityChart"));
    }
  }

  function getFilteredRepos(state) {
    const filtered = DashboardInsights.filterRepositories(sourceRepos(state), state.filters);
    return sortRepositories(filtered, state.sorting);
  }

  function renderSelectOptions(selectId, rows, placeholder, currentValue) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const options = [`<option value="">${placeholder}</option>`];
    for (const row of rows) {
      options.push(`<option value="${escapeHtml(row.name)}">${escapeHtml(row.name)} (${row.value})</option>`);
    }
    select.innerHTML = options.join("");
    if ([...select.options].some((option) => option.value === currentValue)) {
      select.value = currentValue;
    }
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
    
    const metricsBanner = document.getElementById("metricsBanner");
    if (!metricsBanner) return;

    metricsBanner.innerHTML = `
      <div class="glass-panel p-4 rounded-xl flex flex-col gap-1 border-l-4 border-l-primary cyber-glow-green">
        <span class="font-label-mono text-[11px] uppercase text-on-surface-variant tracking-wider">总仓库数</span>
        <span class="font-metric-display text-2xl text-primary font-bold">${repos.length}</span>
      </div>
      <div class="glass-panel p-4 rounded-xl flex flex-col gap-1 border-l-4 border-l-secondary">
        <span class="font-label-mono text-[11px] uppercase text-on-surface-variant tracking-wider">当前筛选</span>
        <span class="font-metric-display text-2xl text-secondary font-bold">${filtered.length}</span>
      </div>
      <div class="glass-panel p-4 rounded-xl flex flex-col gap-1 border-l-4 border-l-tertiary">
        <span class="font-label-mono text-[11px] uppercase text-on-surface-variant tracking-wider">语言数量</span>
        <span class="font-metric-display text-2xl text-tertiary font-bold">${languageStats.length}</span>
      </div>
      <div class="glass-panel p-4 rounded-xl flex flex-col gap-1 border-l-4 border-l-primary">
        <span class="font-label-mono text-[11px] uppercase text-on-surface-variant tracking-wider">最热语言</span>
        <span class="font-metric-display text-2xl text-primary font-bold truncate" title="${escapeHtml(topLanguage)}">${escapeHtml(topLanguage)}</span>
      </div>
      <div class="glass-panel p-4 rounded-xl flex flex-col gap-1 border-l-4 border-l-secondary">
        <span class="font-label-mono text-[11px] uppercase text-on-surface-variant tracking-wider">最热主题</span>
        <span class="font-metric-display text-2xl text-secondary font-bold truncate" title="${escapeHtml(topTopic)}">${escapeHtml(topTopic)}</span>
      </div>
      <div class="glass-panel p-4 rounded-xl flex flex-col gap-1 border-l-4 border-l-error">
        <span class="font-label-mono text-[11px] uppercase text-on-surface-variant tracking-wider">缺少简介</span>
        <span class="font-metric-display text-2xl text-error font-bold">${missing}</span>
      </div>
    `;
  }

  function renderCharts(state, filtered) {
    ensureCharts();
    const chartTheme = {
      textStyle: { fontFamily: 'Outfit', color: '#a2aab5' },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true }
    };

    const languages = DashboardInsights.buildLanguageStats(filtered).slice(0, 10).reverse();
    const topLanguage = languages[languages.length - 1];
    const languageInsight = document.getElementById("languageInsight");
    if (languageInsight) {
      languageInsight.textContent = topLanguage
        ? `${topLanguage.name} 最多，共 ${topLanguage.value} 个`
        : "暂无洞察数据";
    }

    languageChart.setOption({
      ...chartTheme,
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "value",
        axisLabel: { color: "#a2aab5" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } }
      },
      yAxis: {
        type: "category",
        data: languages.map((item) => item.name),
        axisLabel: { color: "#e3e2e8" }
      },
      series: [{
        type: "bar",
        data: languages.map((item) => item.value),
        barWidth: 12,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: '#10b981' },
            { offset: 1, color: '#4edea3' }
          ]),
          borderRadius: [0, 4, 4, 0]
        }
      }]
    });

    const activity = DashboardInsights.getMonthlyActivity(filtered);
    activityChart.setOption({
      ...chartTheme,
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: activity.map((item) => item.name),
        axisLabel: { color: "#a2aab5" }
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#a2aab5" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } }
      },
      series: [{
        type: "line",
        smooth: true,
        data: activity.map((item) => item.value),
        lineStyle: { color: '#4cd7f6', width: 2.5 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(76, 215, 246, 0.25)' },
            { offset: 1, color: 'transparent' }
          ])
        },
        itemStyle: { color: '#4cd7f6' }
      }]
    });
  }

  function renderTopicPanel(filtered) {
    const topics = DashboardInsights.buildTopicStats(filtered).slice(0, 8);
    const max = Math.max(1, ...topics.map((topic) => topic.value));
    const topicPanel = document.getElementById("topicPanel");
    if (!topicPanel) return;

    topicPanel.innerHTML = topics.length ? topics.map((topic) => `
      <div class="flex flex-col gap-1.5 text-xs text-on-surface-variant font-label-mono">
        <div class="flex justify-between">
          <span class="text-on-surface font-medium truncate max-w-[140px]">${escapeHtml(topic.name)}</span>
          <span>${topic.value}</span>
        </div>
        <div class="w-full h-1 bg-white/5 rounded-full overflow-hidden">
          <div class="h-full bg-tertiary rounded-full shadow-[0_0_8px_rgba(208,188,255,0.4)]" style="width:${Math.max(8, (topic.value / max) * 100)}%"></div>
        </div>
      </div>
    `).join("") : '<p class="text-xs text-on-surface-variant/50 p-4">暂无热门主题</p>';
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
    const container = document.getElementById("filterChips");
    if (!container) return;

    container.innerHTML = labels.map(([key, label]) => `
      <div class="flex items-center gap-1.5 bg-secondary/10 border border-secondary/20 px-2.5 py-1 rounded-full text-secondary font-label-mono text-[11px] select-none">
        <span>${escapeHtml(label)}</span>
        <span class="material-symbols-outlined text-[13px] cursor-pointer hover:text-white" data-filter-key="${key}">close</span>
      </div>
    `).join("");
  }

  function renderStatus(state, filtered) {
    const autoRefreshToggle = document.getElementById("autoRefreshToggle");
    if (autoRefreshToggle) {
      autoRefreshToggle.checked = !!state.autoRefreshEnabled;
    }

    const autoRefreshText = state.autoRefreshEnabled ? "开" : "关";
    const nextRefreshText = state.autoRefreshEnabled ? formatCountdown(state.nextRefreshAt) : "已关闭";
    
    // Status Bar
    const liveStatus = document.getElementById("liveStatus");
    if (liveStatus) {
      liveStatus.innerHTML = `
        <span>最近更新: ${formatTime(state.lastUpdatedAt)}</span>
        <span class="text-secondary flex items-center gap-1 select-none">
          自动刷新: 
          <input type="checkbox" id="autoRefreshToggle" class="rounded w-3.5 h-3.5 bg-transparent border-white/30 text-secondary focus:ring-secondary cursor-pointer" ${state.autoRefreshEnabled ? "checked" : ""} />
        </span>
        <span>下次刷新: ${nextRefreshText}</span>
        <span class="px-1.5 py-0.5 bg-white/5 rounded">${state.isLoading ? "同步中..." : "空闲"}</span>
      `;
    }

    // Rate limits details
    const rateDetails = document.getElementById("rateLimitDetails");
    if (rateDetails) {
      const rateLimitText = Object.entries(state.rateLimitByAccount)
        .map(([key, value]) => `${key}: ${value.remaining}/${value.limit}`)
        .join(" | ");
      rateDetails.textContent = rateLimitText ? `限流: ${rateLimitText}` : "速率详情已就绪";
    }

    // Diff summary
    const diffInfo = document.getElementById("diffInfo");
    if (diffInfo) {
      diffInfo.innerHTML = `本次变化: <span class="text-primary font-bold">+${state.diffSummary.added}</span> / <span class="text-error font-bold">-${state.diffSummary.removed}</span>`;
    }

    // Head status
    let sourceLabel = "全部账号合并";
    if (state.activeSource.startsWith("account:")) {
      const accountId = state.activeSource.replace("account:", "");
      sourceLabel = state.accounts[accountId]?.label || accountId;
    }
    
    const badge = document.getElementById("currentAccountBadge");
    if (badge) badge.textContent = `当前：${sourceLabel}`;

    const summary = document.getElementById("activeFilterSummary");
    if (summary) {
      summary.textContent = DashboardInsights.buildResultSummary(filtered, state.filters);
    }

    const sortByEl = document.getElementById("sortBy");
    if (sortByEl) sortByEl.value = state.sorting?.by || "updatedAt";

    const sortOrderEl = document.getElementById("sortOrder");
    if (sortOrderEl) sortOrderEl.value = state.sorting?.order || "desc";

    // 更新头像图片
    const avatarImg = document.getElementById("userAvatarImg");
    if (avatarImg) {
      const MERGED_AVATAR_SVG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='36' height='36' fill='none'><circle cx='12' cy='12' r='11' fill='rgba(78,222,163,0.15)' stroke='%234edea3' stroke-width='1.5'/><path d='M12 6L6 9l6 3 6-3-6-3zM6 14l6 3 6-3M6 11l6 3 6-3' stroke='%234edea3' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>";
      let targetAvatar = MERGED_AVATAR_SVG;
      
      const currentSource = state.activeSource || "merged";
      if (currentSource.startsWith("account:")) {
        const accountId = currentSource.replace("account:", "");
        const account = state.accounts[accountId];
        if (account) {
          targetAvatar = account.localAvatarBase64 || account.avatarUrl || MERGED_AVATAR_SVG;
        }
      }
      
      if (avatarImg.getAttribute("src") !== targetAvatar) {
        avatarImg.src = targetAvatar;
      }
    }
  }

  function renderGitHubLists(state) {
    const repos = sourceRepos(state);
    const stats = DashboardInsights.buildListStats(repos);
    const container = document.getElementById("githubListsContainer");
    if (!container) return;

    const currentList = state.filters.list || "";
    const html = [];
    
    // 1. 全部 (All)
    const allActive = currentList === "" ? "bg-primary-container text-on-primary-container font-bold" : "text-on-surface-variant hover:text-on-surface hover:bg-white/5";
    html.push(`
      <button class="github-list-btn flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${allActive} w-full text-left" data-list="">
        <span class="flex items-center gap-2.5">
          <span class="material-symbols-outlined text-base">star</span>
          <span>全部 (All)</span>
        </span>
        <span class="bg-black/25 px-2 py-0.5 rounded-full text-[10px] border border-white/5 font-label-mono">${stats.all}</span>
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
      const active = currentList === item.name ? "bg-primary-container text-on-primary-container font-bold" : "text-on-surface-variant hover:text-on-surface hover:bg-white/5";
      const nodeId = listNodeIds[item.name] || "";
      const accountId = listNodeAccounts[item.name] || "";
      
      html.push(`
        <div class="github-list-btn-wrap group relative w-full">
          <button class="github-list-btn flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${active} w-full text-left" data-list="${escapeHtml(item.name)}" data-id="${nodeId}" data-account="${accountId}">
            <span class="flex items-center gap-2.5 truncate max-w-[120px]" title="${escapeHtml(item.name)}">
              <span class="material-symbols-outlined text-base">folder_special</span>
              <span class="truncate">${escapeHtml(item.name)}</span>
            </span>
            <span class="flex items-center gap-1.5 ml-auto">
              <span class="bg-black/25 px-2 py-0.5 rounded-full text-[10px] border border-white/5 font-label-mono">${item.value}</span>
            </span>
          </button>
          ${nodeId ? `
            <div class="absolute right-[42px] top-[6px] flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="list-action-btn edit text-on-surface-variant hover:text-primary p-0.5 rounded bg-black/30 hover:bg-black/50" data-id="${nodeId}" data-account="${accountId}" data-name="${escapeHtml(item.name)}" title="重命名 List">
                <span class="material-symbols-outlined text-[14px]">edit</span>
              </button>
              <button class="list-action-btn delete text-on-surface-variant hover:text-error p-0.5 rounded bg-black/30 hover:bg-black/50" data-id="${nodeId}" data-account="${accountId}" data-name="${escapeHtml(item.name)}" title="删除 List">
                <span class="material-symbols-outlined text-[14px]">delete</span>
              </button>
            </div>
          ` : ""}
        </div>
      `);
    }

    // 3. 未分类 (Unclassified)
    const uncActive = currentList === "unclassified" ? "bg-primary-container text-on-primary-container font-bold" : "text-on-surface-variant hover:text-on-surface hover:bg-white/5";
    html.push(`
      <button class="github-list-btn flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${uncActive} w-full text-left" data-list="unclassified">
        <span class="flex items-center gap-2.5">
          <span class="material-symbols-outlined text-base">category</span>
          <span>未分类 (Unclassified)</span>
        </span>
        <span class="bg-black/25 px-2 py-0.5 rounded-full text-[10px] border border-white/5 font-label-mono">${stats.unclassified}</span>
      </button>
    `);

    // 4. 新建 List 按钮
    html.push(`
      <button id="addNewListBtn" class="w-full mt-3 py-2 px-4 bg-transparent border border-dashed border-primary/30 text-primary hover:bg-primary/5 rounded-xl font-label-mono text-[12px] transition-all flex items-center justify-center gap-2">
        <span class="material-symbols-outlined text-sm">add</span>
        新建 List
      </button>
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
      // Show batch action bar
      bar.classList.remove("translate-y-32", "opacity-0");

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

      const options = ['<option value="">移动到目标 List...</option>'];
      for (const listName of [...uniqueLists].sort()) {
        options.push(`<option value="${escapeHtml(listName)}">${escapeHtml(listName)}</option>`);
      }
      select.innerHTML = options.join("");
    } else {
      // Hide batch action bar
      bar.classList.add("translate-y-32", "opacity-0");
    }
  }

  function renderList(state, filtered) {
    const emptyState = document.getElementById("emptyState");
    const skeleton = document.getElementById("listSkeleton");
    const list = document.getElementById("list");
    if (!list || !skeleton || !emptyState) return;

    const shouldShowSkeleton = state.isLoading && !sourceRepos(state).length;
    
    // Toggle skeletal templates
    if (shouldShowSkeleton) {
      skeleton.classList.add("grid");
      skeleton.classList.remove("hidden");
      emptyState.classList.add("hidden");
      list.innerHTML = "";
      return;
    } else {
      skeleton.classList.add("hidden");
      skeleton.classList.remove("grid");
    }

    if (!filtered.length) {
      emptyState.classList.remove("hidden");
      list.innerHTML = "";
      return;
    } else {
      emptyState.classList.add("hidden");
    }

    list.innerHTML = filtered.map((repo) => {
      const [owner = repo.owner || "", name = repo.name || repo.repo || ""] = (repo.fullName || repo.repo || "").split("/");
      const topics = (repo.topics || []).slice(0, 5);
      const repoLists = repo.lists || [];
      const descriptionKind = DashboardInsights.getDescriptionKind(repo);
      const isSelected = state.selectedRepoIds.includes(repo.id);
      
      return `
        <article class="repo-card glass-panel p-6 rounded-2xl cursor-grab active:cursor-grabbing border-t-2 border-t-transparent hover:border-t-primary ${isSelected ? "selected" : ""}" draggable="true" data-id="${repo.id}">
          <div class="flex justify-between items-start mb-4">
            <input type="checkbox" class="repo-checkbox rounded border-white/20 bg-transparent text-primary focus:ring-primary w-4 h-4 cursor-pointer" ${isSelected ? "checked" : ""} data-id="${repo.id}" />
            <div class="flex items-center gap-1.5 text-on-surface-variant font-label-mono text-xs">
              <span class="material-symbols-outlined text-[16px] text-amber">star</span>
              <span>${Number(repo.stars || 0).toLocaleString("zh-CN")}</span>
              <span class="mx-1 text-white/10">|</span>
              <span class="material-symbols-outlined text-[16px]">fork_left</span>
              <span>${Number(repo.forks || 0).toLocaleString("zh-CN")}</span>
            </div>
          </div>
          <h3 class="font-headline-md text-base mb-2 text-on-surface font-semibold hover:text-primary transition-colors">
            <a href="${escapeHtml(repo.url || repo.htmlUrl || "#")}" target="_blank" rel="noopener noreferrer"><span class="text-on-surface-variant font-normal">${escapeHtml(owner)}/</span>${escapeHtml(name)}</a>
          </h3>
          <p class="font-body-md text-on-surface-variant text-xs mb-4 line-clamp-2 min-h-[32px]">${escapeHtml(repo.description || "暂无简介")}</p>
          ${descriptionKind === "en" ? `
            <div class="repo-desc-cn text-xs border-l-2 border-l-secondary bg-secondary/5 px-3 py-2 rounded-r-lg text-secondary/90 font-body-md mb-4 leading-relaxed ${expandZh ? "block" : "hidden"}">
              <strong>自动解读：</strong>${escapeHtml(DashboardInsights.zhAuto(repo.description))}
            </div>
          ` : ""}
          
          <div class="flex flex-wrap gap-1.5 mb-5">
            ${repoLists.map((listName) => `<span class="px-2 py-0.5 bg-tertiary/10 border border-tertiary/20 rounded-md text-[10px] font-medium text-tertiary font-label-mono">${escapeHtml(listName)}</span>`).join("")}
            ${topics.map((topic) => `<span class="px-2 py-0.5 bg-white/5 border border-white/10 rounded-md text-[10px] font-medium text-on-surface-variant/80 font-label-mono">${escapeHtml(topic)}</span>`).join("")}
            ${descriptionKind === "empty" ? '<span class="px-2 py-0.5 bg-white/5 border border-white/10 rounded-md text-[10px] font-medium text-on-surface-variant/50">暂无简介</span>' : ""}
            ${repo.archived ? '<span class="px-2 py-0.5 bg-error/10 border border-error/20 rounded-md text-[10px] font-medium text-error font-label-mono">已归档</span>' : ""}
          </div>
          
          <div class="flex items-center justify-between pt-3 border-t border-white/5">
            <span class="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${languageColor(repo.language)}"></span>
              <span class="font-label-mono">${escapeHtml(repo.language || "Others")}</span>
            </span>
            <div class="flex items-center gap-3">
              <span class="text-[10px] font-label-mono text-on-surface-variant/50">${formatDate(repo.updatedAt || repo.updated_at)}</span>
              <button class="ai-guide-btn px-2.5 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-lg text-xs font-bold hover:bg-primary/20 transition-all flex items-center gap-1 shadow-sm active:scale-95 select-none" data-repo="${escapeHtml(owner)}/${escapeHtml(name)}" data-desc="${escapeHtml(repo.description || '')}">
                <span class="material-symbols-outlined text-[13px]">magic_button</span>
                AI 引导
              </button>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderAccountDropdown(state) {
    const listContainer = document.getElementById("accountDropdownList");
    if (!listContainer) return;
    
    const currentSource = state.activeSource || "merged";
    const html = [];
    
    const mergedAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='36' height='36' fill='none'><circle cx='12' cy='12' r='11' fill='rgba(78,222,163,0.15)' stroke='%234edea3' stroke-width='1.5'/><path d='M12 6L6 9l6 3 6-3-6-3zM6 14l6 3 6-3M6 11l6 3 6-3' stroke='%234edea3' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>";
    
    // 1. 全部合并项
    const mergedActive = currentSource === "merged";
    
    html.push(`
      <button class="account-menu-item w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm transition-all text-left ${mergedActive ? 'bg-primary/10 text-primary font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] border border-primary/20' : 'text-on-surface-variant hover:bg-white/5 border border-transparent'}" data-source-val="merged">
        <span class="material-symbols-outlined text-base text-primary ${mergedActive ? 'opacity-100' : 'opacity-0'}">check</span>
        <img class="w-8 h-8 rounded-full object-cover border border-white/10" src="${mergedAvatar}"/>
        <span>全部合并</span>
      </button>
    `);
    
    // 2. 账号项
    for (const accountId of state.accountOrder) {
      const account = state.accounts[accountId];
      if (!account) continue;
      const activeVal = `account:${accountId}`;
      const isActive = currentSource === activeVal;
      const avatar = account.localAvatarBase64 || account.avatarUrl || mergedAvatar;
      const displayName = account.label || accountId;
      
      html.push(`
        <button class="account-menu-item w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm transition-all text-left ${isActive ? 'bg-primary/10 text-primary font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] border border-primary/20' : 'text-on-surface-variant hover:bg-white/5 border border-transparent'}" data-source-val="${activeVal}">
          <span class="material-symbols-outlined text-base text-primary ${isActive ? 'opacity-100' : 'opacity-0'}">check</span>
          <img class="w-8 h-8 rounded-full object-cover border border-white/10" src="${avatar}"/>
          <span class="truncate">${escapeHtml(displayName)}</span>
        </button>
      `);
    }
    
    listContainer.innerHTML = html.join("");
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
    renderAccountDropdown(state);
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
