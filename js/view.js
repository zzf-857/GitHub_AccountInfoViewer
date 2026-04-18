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
    return DashboardInsights.filterRepositories(sourceRepos(state), state.filters);
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

  function renderInsights(state, filtered) {
    const cards = DashboardInsights.buildInsightCards(sourceRepos(state), filtered);
    document.getElementById("insightSummary").innerHTML = cards.map((card) => `
      <article class="insight-card">
        <h3>${escapeHtml(card.title)}</h3>
        <p>${escapeHtml(card.body)}</p>
      </article>
    `).join("");
  }

  function renderKpi(state, filtered) {
    const repos = sourceRepos(state);
    const languageCount = DashboardInsights.buildLanguageStats(repos).length;
    const topicCount = DashboardInsights.buildTopicStats(repos).length;
    const missing = repos.filter((repo) => DashboardInsights.getDescriptionKind(repo) === "empty").length;
    document.getElementById("kpi").innerHTML = `
      <div class="kpi-card"><div class="k-label">总仓库数</div><div class="k-value">${repos.length}</div><div class="k-hint">当前筛选显示 ${filtered.length} 个</div></div>
      <div class="kpi-card"><div class="k-label">语言数</div><div class="k-value">${languageCount}</div><div class="k-hint">衡量收藏技术广度</div></div>
      <div class="kpi-card"><div class="k-label">主题数</div><div class="k-value">${topicCount}</div><div class="k-hint">来自 GitHub topics</div></div>
      <div class="kpi-card"><div class="k-label">缺少简介</div><div class="k-value">${missing}</div><div class="k-hint">适合后续回看整理</div></div>
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
        itemStyle: { color: "#3dd6c6", borderRadius: [0, 6, 6, 0] },
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
    document.getElementById("filterChips").innerHTML = labels.map(([key, label]) =>
      `<button class="filter-chip" data-filter-key="${key}" title="移除此筛选">${escapeHtml(label)} ×</button>`
    ).join("");
  }

  function renderStatus(state, filtered) {
    const statusEl = document.getElementById("liveStatus");
    const rateLimitText = Object.entries(state.rateLimitByAccount)
      .map(([key, value]) => `${key}: ${value.remaining}/${value.limit}`)
      .join(" | ");
    statusEl.textContent = `最近更新: ${formatTime(state.lastUpdatedAt)} ｜ 下次刷新: ${formatCountdown(state.nextRefreshAt)} ｜ ${state.isLoading ? "正在刷新，旧数据保持可见" : "空闲"}${rateLimitText ? ` ｜ 限流: ${rateLimitText}` : ""}`;
    document.getElementById("diffInfo").textContent = `本次变化: +${state.diffSummary.added} / -${state.diffSummary.removed}`;

    let sourceLabel = "全部账号合并";
    if (state.activeSource.startsWith("account:")) {
      const accountId = state.activeSource.replace("account:", "");
      sourceLabel = state.accounts[accountId]?.label || accountId;
    }
    document.getElementById("currentAccountBadge").textContent = `当前账号：${sourceLabel}`;
    document.getElementById("filterSummary").textContent = `当前：${sourceLabel}`;
    document.getElementById("activeFilterSummary").textContent = DashboardInsights.buildResultSummary(filtered, state.filters);
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
      const descriptionKind = DashboardInsights.getDescriptionKind(repo);
      return `
        <article class="repo-card ${expandZh ? "expanded" : ""}">
          <div>
            <h3 class="repo-title"><a href="${escapeHtml(repo.url || repo.htmlUrl || "#")}" target="_blank" rel="noopener noreferrer"><span class="repo-owner">${escapeHtml(owner)}/</span>${escapeHtml(name)}</a></h3>
            <p class="repo-desc">${escapeHtml(repo.description || "暂无简介")}</p>
            ${descriptionKind === "en" ? `<p class="repo-desc-cn">中文补充：${escapeHtml(DashboardInsights.zhAuto(repo.description))}</p>` : ""}
            <div class="repo-topics">
              ${topics.map((topic) => `<span class="repo-topic">${escapeHtml(topic)}</span>`).join("")}
              ${descriptionKind === "empty" ? '<span class="repo-topic">暂无简介</span>' : ""}
            </div>
          </div>
          <aside class="repo-side">
            <span class="repo-language"><span class="language-dot" style="background:${languageColor(repo.language)}"></span>${escapeHtml(repo.language || "Others")}</span>
            <span class="repo-meta">★ ${Number(repo.stars || 0).toLocaleString("zh-CN")} ｜ Fork ${Number(repo.forks || 0).toLocaleString("zh-CN")}</span>
            <span class="repo-meta">${formatDate(repo.updatedAt || repo.updated_at)}</span>
            ${repo.archived ? '<span class="repo-topic">已归档</span>' : ""}
          </aside>
        </article>
      `;
    }).join("");
  }

  function render(state) {
    const filtered = getFilteredRepos(state);
    renderFilterOptions(state);
    renderInsights(state, filtered);
    renderKpi(state, filtered);
    renderCharts(state, filtered);
    renderTopicPanel(filtered);
    renderFilterChips(state);
    renderStatus(state, filtered);
    renderList(state, filtered);
  }

  function setExpandZh(value) {
    expandZh = value;
  }

  function resize() {
    if (languageChart) languageChart.resize();
    if (activityChart) activityChart.resize();
  }

  return { render, setExpandZh, resize };
}

window.DashboardView = { createView };
