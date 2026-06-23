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
  const repoItem = item.repo || item;
  const fullName = repoItem.full_name || "";
  const [owner = "", name = ""] = fullName.split("/");
  const language = repoItem.language || "Others (未分类)";
  return {
    id: `${sourceAccount}:${fullName}`,
    fullName,
    repo: fullName,
    owner,
    name,
    description: repoItem.description || "暂无简介",
    url: repoItem.html_url,
    htmlUrl: repoItem.html_url,
    language,
    stars: repoItem.stargazers_count || 0,
    forks: repoItem.forks_count || 0,
    updatedAt: repoItem.updated_at || null,
    starredAt: item.starred_at || null,
    archived: Boolean(repoItem.archived),
    topics: Array.isArray(repoItem.topics) ? repoItem.topics : [],
    sourceAccount,
    sourceAccountLabel: sourceAccountLabel || sourceAccount,
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

async function fetchGraphQL(token, query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GraphQL API 失败 (${res.status}): ${text}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GitHub GraphQL 错误: ${json.errors.map(e => e.message).join("; ")}`);
  }
  return json.data;
}

async function fetchAllLists(token) {
  let hasNext = true;
  let endCursor = null;
  const lists = [];

  const query = `
    query($after: String) {
      viewer {
        lists(first: 100, after: $after) {
          nodes {
            name
            items(first: 100) {
              nodes {
                ... on Repository {
                  nameWithOwner
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

  while (hasNext) {
    try {
      const data = await fetchGraphQL(token, query, { after: endCursor });
      const listsConnection = data?.viewer?.lists;
      if (listsConnection) {
        if (listsConnection.nodes) {
          for (const node of listsConnection.nodes) {
            if (node) {
              const repos = (node.items?.nodes || [])
                .filter(item => item && item.nameWithOwner)
                .map(item => item.nameWithOwner);
              lists.push({ name: node.name, repos });
            }
          }
        }
        hasNext = listsConnection.pageInfo?.hasNextPage || false;
        endCursor = listsConnection.pageInfo?.endCursor || null;
      } else {
        hasNext = false;
      }
    } catch (err) {
      console.warn("获取 GitHub Lists 失败，将忽略 List 分类功能:", err);
      return [];
    }
  }
  return lists;
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

  // Fetch lists and map them
  const lists = await fetchAllLists(token);
  const repoToLists = {};
  for (const list of lists) {
    for (const fullName of list.repos) {
      if (!repoToLists[fullName]) repoToLists[fullName] = [];
      repoToLists[fullName].push(list.name);
    }
  }

  for (const repo of normalized) {
    repo.lists = repoToLists[repo.fullName] || [];
  }

  return { repos: normalized, etag, rateLimit: lastRateLimit, unchanged: false };
}

window.GitHubApi = { fetchAllStarred };
