function hasChinese(s) {
  return /[\u4e00-\u9fff]/.test(s || "");
}

function zhAuto(desc) {
  const d = (desc || "").trim();
  if (!d || d === "暂无简介") return "暂无中文简介。";
  if (hasChinese(d)) return "已包含中文简介。";
  const rules = [
    [/open[- ]source/i, "开源"], [/framework/i, "框架"], [/tool/i, "工具"], [/library/i, "库"],
    [/platform/i, "平台"], [/editor/i, "编辑器"], [/automation/i, "自动化"], [/testing/i, "测试"],
    [/game/i, "游戏"], [/unity/i, "Unity"], [/\bai\b/i, "AI"], [/model/i, "模型"]
  ];
  const tags = [];
  for (const [re, cn] of rules) if (re.test(d) && !tags.includes(cn)) tags.push(cn);
  return tags.length
    ? `自动解读：这是一个与${tags.slice(0, 6).join("、")}相关的项目。`
    : "自动解读：这是一个开发者相关项目，建议查看仓库 README 获取完整细节。";
}

function descKind(item) {
  const d = (item.description || "").trim();
  if (d === "暂无简介") return "empty";
  return hasChinese(d) ? "zh" : "en";
}

function langAgg(items) {
  const map = {};
  for (const it of items) map[it.language] = (map[it.language] || 0) + 1;
  return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function formatCountdown(nextRefreshAt) {
  if (!nextRefreshAt) return "--:--";
  const remain = Math.max(0, Math.floor((nextRefreshAt - Date.now()) / 1000));
  const mm = String(Math.floor(remain / 60)).padStart(2, "0");
  const ss = String(remain % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatTime(ts) {
  if (!ts) return "--";
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

function createView() {
  let pieChart;
  let barChart;
  let expandZh = false;

  function ensureCharts() {
    if (!pieChart) pieChart = echarts.init(document.getElementById("pie"));
    if (!barChart) barChart = echarts.init(document.getElementById("bar"));
  }

  function getFilteredRepos(state) {
    const source = state.activeSource;
    let repos = state.repos;
    if (source.startsWith("account:")) {
      const accountId = source.replace("account:", "");
      repos = state.accounts[accountId]?.repos || [];
    }

    const q = state.filters.keyword.trim().toLowerCase();
    return repos.filter((r) => {
      if (state.filters.language && r.language !== state.filters.language) return false;
      if (state.filters.descType && descKind(r) !== state.filters.descType) return false;
      if (!q) return true;
      return (r.repo || "").toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q) || zhAuto(r.description).toLowerCase().includes(q);
    });
  }

  function renderKpi(state, filtered) {
    const repos = state.repos;
    const enOnly = repos.filter((r) => descKind(r) === "en").length;
    const zhCount = repos.filter((r) => descKind(r) === "zh").length;
    const empty = repos.filter((r) => descKind(r) === "empty").length;
    const langSet = new Set(repos.map((r) => r.language));
    const enRatio = repos.length ? ((enOnly / repos.length) * 100).toFixed(1) : "0.0";
    document.getElementById("kpi").innerHTML = `
      <div class="kpi-card"><div class="k-label">总仓库数</div><div class="k-value">${repos.length}</div><div class="k-hint">当前筛选：${filtered.length}</div></div>
      <div class="kpi-card"><div class="k-label">语言分类数</div><div class="k-value">${langSet.size}</div><div class="k-hint">技术广度</div></div>
      <div class="kpi-card"><div class="k-label">仅英文简介</div><div class="k-value">${enOnly}</div><div class="k-hint">${enRatio}%</div></div>
      <div class="kpi-card"><div class="k-label">暂无简介</div><div class="k-value">${empty}</div><div class="k-hint">可补充信息</div></div>
    `;
  }

  function renderCharts(items) {
    ensureCharts();
    const data = langAgg(items);
    const top1 = data[0];
    const top2 = data[1];
    const insightEl = document.getElementById("pieInsight");
    if (insightEl) {
      insightEl.textContent = top1
        ? `你的 Star 主要集中在 ${top1.name}${top2 ? `，其次是 ${top2.name}` : ""}。`
        : "暂无足够数据生成洞察。";
    }
    pieChart.setOption({
      tooltip: { trigger: "item" },
      legend: { type: "scroll", top: 0, textStyle: { color: "#9aa4b2", fontSize: 11 } },
      series: [{
        type: "pie",
        radius: ["46%", "70%"],
        center: ["50%", "58%"],
        data: data.slice(0, 8),
        label: { color: "#9aa4b2", fontSize: 11, formatter: "{b}" },
        itemStyle: { borderColor: "#12192b", borderWidth: 2 }
      }]
    });
    const top10 = data.slice(0, 10).reverse();
    barChart.setOption({
      grid: { left: 90, right: 20, top: 18, bottom: 18 },
      xAxis: { type: "value", axisLabel: { color: "#9aa4b2", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(148,163,184,0.12)" } } },
      yAxis: { type: "category", data: top10.map((d) => d.name), axisLabel: { color: "#cfd6e4", fontSize: 12 } },
      series: [{
        type: "bar",
        data: top10.map((d) => d.value),
        barWidth: 14,
        itemStyle: { color: "#7aa2ff", borderRadius: [0, 6, 6, 0] },
        label: { show: true, position: "right", color: "#9aa4b2", fontSize: 11 }
      }]
    });
  }

  function renderLanguageFilter(filtered) {
    const langSel = document.getElementById("lang");
    const current = langSel.value;
    const options = ['<option value="">全部分类</option>'];
    for (const d of langAgg(filtered)) options.push(`<option value="${d.name}">${d.name} (${d.value})</option>`);
    langSel.innerHTML = options.join("");
    if ([...langSel.options].some((o) => o.value === current)) langSel.value = current;
  }

  function renderStatus(state) {
    const statusEl = document.getElementById("liveStatus");
    const rateLimitText = Object.entries(state.rateLimitByAccount).map(([k, v]) => `${k}: ${v.remaining}/${v.limit}`).join(" | ");
    statusEl.textContent = `最近更新: ${formatTime(state.lastUpdatedAt)} ｜ 下次刷新: ${formatCountdown(state.nextRefreshAt)} ｜ ${state.isLoading ? "正在同步..." : "空闲"}${rateLimitText ? ` ｜ 限流: ${rateLimitText}` : ""}`;
    document.getElementById("diffInfo").textContent = `本次变化: +${state.diffSummary.added} / -${state.diffSummary.removed}`;
    let sourceLabel = "全部账号合并";
    if (state.activeSource.startsWith("account:")) {
      const accountId = state.activeSource.replace("account:", "");
      sourceLabel = state.accounts[accountId]?.label || accountId;
    }
    const badge = document.getElementById("currentAccountBadge");
    if (badge) badge.textContent = `当前账号：${sourceLabel}`;
    const filterSummary = document.getElementById("filterSummary");
    if (filterSummary) {
      const parts = [sourceLabel];
      if (state.filters.language) parts.push(`语言 ${state.filters.language}`);
      if (state.filters.descType) parts.push(`简介 ${state.filters.descType}`);
      if (state.filters.keyword) parts.push(`关键词 "${state.filters.keyword}"`);
      filterSummary.textContent = `当前：${parts.join(" · ")}`;
    }
  }

  function renderList(items) {
    document.getElementById("resultCount").textContent = `${items.length} 项`;
    const html = items.map((r) => `
      <div class="repo-row ${expandZh ? "expanded" : ""}">
        <div>
          <div class="repo-title"><a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.repo}</a></div>
          <div class="repo-meta">${r.sourceAccountLabel || r.sourceAccount}</div>
        </div>
        <div>
          ${r.language}
          <div><span class="pill ${descKind(r)}">${descKind(r) === "en" ? "仅英文" : descKind(r) === "zh" ? "含中文" : "暂无简介"}</span></div>
        </div>
        <div><div class="desc-en">${r.description}</div>${descKind(r) === "en" ? `<div class="desc-cn">中文简介：${zhAuto(r.description)}</div>` : ""}</div>
      </div>
    `).join("");
    document.getElementById("list").innerHTML = html || '<div class="error">没有匹配结果。</div>';
  }

  function render(state) {
    const filtered = getFilteredRepos(state);
    renderLanguageFilter(filtered.length ? filtered : state.repos);
    renderKpi(state, filtered);
    renderCharts(filtered.length ? filtered : state.repos);
    renderStatus(state);
    renderList(filtered);
  }

  function setExpandZh(value) {
    expandZh = value;
  }

  function resize() {
    if (pieChart) pieChart.resize();
    if (barChart) barChart.resize();
  }

  return { render, setExpandZh, resize };
}

window.DashboardView = { createView };
