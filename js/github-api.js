const GITHUB_API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

function parseRateLimit(headers) {
  const remaining = Number(headers.get("x-ratelimit-remaining") || "0");
  const reset = Number(headers.get("x-ratelimit-reset") || "0");
  const limit = Number(headers.get("x-ratelimit-limit") || "0");
  return { remaining, reset, limit };
}

function parseLinkHeader(linkHeader) {
  if (!linkHeader) return {};
  const sections = linkHeader.split(",");
  const links = {};
  for (const section of sections) {
    const match = section.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) links[match[2]] = match[1];
  }
  return links;
}

function normalizeRepo(item, sourceAccount, sourceAccountLabel = "") {
  const fullName = item.full_name || "";
  const language = item.language || "Others (未分类)";
  return {
    id: `${sourceAccount}:${fullName}`,
    fullName,
    repo: fullName,
    description: item.description || "暂无简介",
    url: item.html_url,
    htmlUrl: item.html_url,
    language,
    sourceAccount,
    sourceAccountLabel: sourceAccountLabel || sourceAccount,
    starredAt: item.starred_at || null
  };
}

async function fetchStarredPage({ token, page = 1, perPage = 100, etag = "" }) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION
  };
  if (etag) headers["If-None-Match"] = etag;

  const res = await fetch(`${GITHUB_API_BASE}/user/starred?per_page=${perPage}&page=${page}`, {
    method: "GET",
    headers
  });
  const rateLimit = parseRateLimit(res.headers);
  const responseEtag = res.headers.get("etag") || "";

  if (res.status === 304) {
    return { page, repos: null, status: 304, hasNext: false, etag: responseEtag || etag, rateLimit };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API 失败(${res.status}): ${text || res.statusText}`);
  }

  const data = await res.json();
  const links = parseLinkHeader(res.headers.get("link"));
  return {
    page,
    repos: Array.isArray(data) ? data : [],
    status: 200,
    hasNext: Boolean(links.next),
    etag: responseEtag || etag,
    rateLimit
  };
}

async function fetchAllStarred({ token, sourceAccount, sourceAccountLabel = "", previousEtag = "" }) {
  let page = 1;
  let hasNext = true;
  const normalized = [];
  let etag = previousEtag;
  let lastRateLimit = { remaining: 0, reset: 0, limit: 0 };

  while (hasNext) {
    const result = await fetchStarredPage({ token, page, perPage: 100, etag: page === 1 ? previousEtag : "" });
    lastRateLimit = result.rateLimit;
    if (result.status === 304 && page === 1) {
      return { repos: null, etag: result.etag, rateLimit: lastRateLimit, unchanged: true };
    }
    if (result.repos) {
      for (const item of result.repos) {
        normalized.push(normalizeRepo(item, sourceAccount, sourceAccountLabel));
      }
    }
    hasNext = result.hasNext;
    etag = result.etag || etag;
    page += 1;
  }

  return { repos: normalized, etag, rateLimit: lastRateLimit, unchanged: false };
}

window.GitHubApi = { fetchAllStarred };
