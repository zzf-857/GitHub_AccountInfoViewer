const assert = require("node:assert/strict");

const {
  buildLanguageStats,
  buildInsightCards,
  buildResultSummary,
  filterRepositories,
  getSavedViewFilter
} = require("../../js/insights.js");

const repos = [
  {
    repo: "openai/agents",
    fullName: "openai/agents",
    description: "Build AI agents with tools",
    language: "Python",
    topics: ["ai", "agents", "llm"],
    stars: 12000,
    forks: 800,
    updatedAt: "2026-04-10T00:00:00Z",
    archived: false
  },
  {
    repo: "vercel/next.js",
    fullName: "vercel/next.js",
    description: "The React Framework",
    language: "JavaScript",
    topics: ["frontend", "react"],
    stars: 130000,
    forks: 28000,
    updatedAt: "2026-03-01T00:00:00Z",
    archived: false
  },
  {
    repo: "old/empty",
    fullName: "old/empty",
    description: "暂无简介",
    language: "Others (未分类)",
    topics: [],
    stars: 2,
    forks: 0,
    updatedAt: "2020-01-01T00:00:00Z",
    archived: true
  }
];

assert.deepEqual(buildLanguageStats(repos).slice(0, 2), [
  { name: "Python", value: 1, percent: 33.3 },
  { name: "JavaScript", value: 1, percent: 33.3 }
]);

assert.deepEqual(
  filterRepositories(repos, {
    keyword: "agent",
    language: "Python",
    topic: "ai",
    status: "active",
    starRange: "1000+",
    updatedRange: "year"
  }).map((repo) => repo.fullName),
  ["openai/agents"]
);

assert.equal(getSavedViewFilter("AI/LLM").topic, "ai");
assert.equal(getSavedViewFilter("Frontend").topic, "frontend");

const cards = buildInsightCards(repos, repos.slice(0, 2));
assert.equal(cards.length, 4);
assert.match(cards[0].title, /Python|JavaScript|Others/);
assert.match(cards[1].title, /ai|frontend|react|agents|llm/);
assert.match(cards[2].body, /2 个仓库/);
assert.match(cards[3].body, /1 个仓库缺少简介/);

assert.equal(
  buildResultSummary(repos, {
    keyword: "agent",
    language: "Python",
    topic: "ai",
    status: "active",
    starRange: "1000+",
    updatedRange: "year"
  }),
  "匹配到 1 个仓库。当前聚焦 Python、ai、活跃仓库、1000+ stars、最近一年更新，并包含关键词“agent”。"
);

console.log("insights tests passed");
