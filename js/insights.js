function normalizeText(value) {
  return String(value || "").trim();
}

function hasChinese(value) {
  return /[\u4e00-\u9fff]/.test(value || "");
}

function getDescriptionKind(repo) {
  const description = normalizeText(repo.description);
  if (!description || description === "暂无简介") return "empty";
  return hasChinese(description) ? "zh" : "en";
}

function zhAuto(description) {
  const text = normalizeText(description);
  if (!text || text === "暂无简介") return "暂无中文简介。";
  if (hasChinese(text)) return "已包含中文简介。";
  const rules = [
    [/open[- ]source/i, "开源"],
    [/framework/i, "框架"],
    [/tool/i, "工具"],
    [/library/i, "库"],
    [/platform/i, "平台"],
    [/editor/i, "编辑器"],
    [/automation/i, "自动化"],
    [/testing/i, "测试"],
    [/\bai\b/i, "AI"],
    [/agent/i, "Agent"],
    [/model/i, "模型"],
    [/react|vue|frontend/i, "前端"]
  ];
  const tags = [];
  for (const [pattern, label] of rules) {
    if (pattern.test(text) && !tags.includes(label)) tags.push(label);
  }
  return tags.length
    ? `自动解读：这是一个与${tags.slice(0, 6).join("、")}相关的项目。`
    : "自动解读：这是一个开发者相关项目，建议查看仓库 README 获取完整细节。";
}

function roundPercent(value) {
  return Math.round(value * 10) / 10;
}

function buildLanguageStats(repos) {
  const counts = new Map();
  for (const repo of repos) {
    const language = normalizeText(repo.language) || "Others (未分类)";
    counts.set(language, (counts.get(language) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, value]) => ({
      name,
      value,
      percent: repos.length ? roundPercent((value / repos.length) * 100) : 0
    }))
    .sort((a, b) => b.value - a.value);
}

function buildTopicStats(repos) {
  const counts = new Map();
  for (const repo of repos) {
    for (const topic of repo.topics || []) {
      const key = normalizeText(topic).toLowerCase();
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function getSavedViewFilter(name) {
  const views = {
    All: { keyword: "", language: "", descType: "", topic: "", status: "", starRange: "", updatedRange: "" },
    "AI/LLM": { topic: "ai" },
    Frontend: { topic: "frontend" },
    DevTools: { topic: "tool" },
    Data: { topic: "data" },
    "Recently Starred": { updatedRange: "year" }
  };
  return { ...(views[name] || views.All) };
}

function topicMatches(repoTopics, selectedTopic) {
  if (!selectedTopic) return true;
  const topics = (repoTopics || []).map((topic) => normalizeText(topic).toLowerCase());
  const aliases = {
    ai: ["ai", "llm", "agent", "agents", "machine-learning", "deep-learning"],
    frontend: ["frontend", "react", "vue", "nextjs", "ui", "css"],
    tool: ["tool", "tools", "cli", "developer-tools", "automation", "devtools"],
    data: ["data", "database", "analytics", "visualization", "etl"]
  };
  const candidates = aliases[selectedTopic] || [selectedTopic];
  return candidates.some((candidate) => topics.includes(candidate));
}

function matchesStarRange(repo, range) {
  const stars = Number(repo.stars || 0);
  if (!range) return true;
  if (range === "0-100") return stars <= 100;
  if (range === "100-1000") return stars > 100 && stars <= 1000;
  if (range === "1000+") return stars > 1000;
  return true;
}

function matchesUpdatedRange(repo, range, now = Date.now()) {
  if (!range) return true;
  const updatedAt = Date.parse(repo.updatedAt || repo.updated_at || "");
  if (!updatedAt) return false;
  const days = Math.floor((now - updatedAt) / 86400000);
  if (range === "month") return days <= 31;
  if (range === "quarter") return days <= 93;
  if (range === "year") return days <= 366;
  return true;
}

function filterRepositories(repos, filters = {}, now = Date.now()) {
  const keyword = normalizeText(filters.keyword).toLowerCase();
  return repos.filter((repo) => {
    if (filters.language && repo.language !== filters.language) return false;
    if (filters.descType && getDescriptionKind(repo) !== filters.descType) return false;
    if (filters.status === "active" && repo.archived) return false;
    if (filters.status === "archived" && !repo.archived) return false;
    if (!topicMatches(repo.topics, filters.topic)) return false;
    if (!matchesStarRange(repo, filters.starRange)) return false;
    if (!matchesUpdatedRange(repo, filters.updatedRange, now)) return false;
    if (!keyword) return true;
    const searchable = [
      repo.repo,
      repo.fullName,
      repo.owner,
      repo.name,
      repo.description,
      zhAuto(repo.description),
      ...(repo.topics || [])
    ].join(" ").toLowerCase();
    return searchable.includes(keyword);
  });
}

function buildResultSummary(repos, filters = {}) {
  const count = filterRepositories(repos, filters).length;
  const parts = [];
  if (filters.language) parts.push(filters.language);
  if (filters.topic) parts.push(filters.topic);
  if (filters.status === "active") parts.push("活跃仓库");
  if (filters.status === "archived") parts.push("已归档仓库");
  if (filters.starRange) parts.push(`${filters.starRange} stars`);
  if (filters.updatedRange === "month") parts.push("最近一月更新");
  if (filters.updatedRange === "quarter") parts.push("最近三月更新");
  if (filters.updatedRange === "year") parts.push("最近一年更新");

  let sentence = `匹配到 ${count} 个仓库。`;
  if (parts.length) sentence += `当前聚焦 ${parts.join("、")}`;
  if (filters.keyword) {
    sentence += parts.length ? `，并包含关键词“${filters.keyword}”。` : `包含关键词“${filters.keyword}”。`;
  } else {
    sentence += parts.length ? "。" : "你正在查看完整收藏。";
  }
  return sentence;
}

function countRecentlyUpdated(repos, now = Date.now()) {
  return repos.filter((repo) => matchesUpdatedRange(repo, "year", now)).length;
}

function buildInsightCards(allRepos, filteredRepos) {
  const languageStats = buildLanguageStats(allRepos);
  const topicStats = buildTopicStats(allRepos);
  const topLanguage = languageStats[0];
  const topTopic = topicStats[0];
  const missingDescriptions = allRepos.filter((repo) => getDescriptionKind(repo) === "empty").length;
  const recentlyUpdated = countRecentlyUpdated(filteredRepos);

  return [
    {
      title: topLanguage ? `${topLanguage.name} 是主语言` : "暂无语言数据",
      body: topLanguage ? `${topLanguage.value} 个仓库，占全部收藏 ${topLanguage.percent}%。` : "加载仓库后会自动生成语言洞察。"
    },
    {
      title: topTopic ? `${topTopic.name} 是高频主题` : "主题数据较少",
      body: topTopic ? `${topTopic.value} 个仓库带有该主题，适合作为默认探索入口。` : "当前仓库缺少 topic 信息，可先按语言和关键词筛选。"
    },
    {
      title: "当前结果集",
      body: `${filteredRepos.length} 个仓库正在显示，列表是主要阅读区域。`
    },
    {
      title: "可补充信息",
      body: `${missingDescriptions} 个仓库缺少简介，可优先回看这些收藏的用途。`
    }
  ];
}

function getMonthlyActivity(repos) {
  const buckets = new Map();
  for (const repo of repos) {
    const raw = repo.starredAt || repo.updatedAt || repo.updated_at;
    const time = Date.parse(raw || "");
    if (!time) continue;
    const date = new Date(time);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([name, value]) => ({ name, value }));
}

const api = {
  buildLanguageStats,
  buildTopicStats,
  buildInsightCards,
  buildResultSummary,
  filterRepositories,
  getDescriptionKind,
  getMonthlyActivity,
  getSavedViewFilter,
  hasChinese,
  zhAuto
};

if (typeof module !== "undefined") module.exports = api;
if (typeof window !== "undefined") window.DashboardInsights = api;
