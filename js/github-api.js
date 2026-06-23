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
    nodeId: repoItem.node_id || "",
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
  let avatarUrl = "";
  let login = "";

  const query = `
    query($after: String) {
      viewer {
        login
        avatarUrl
        lists(first: 100, after: $after) {
          nodes {
            id
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
      if (data?.viewer) {
        if (!avatarUrl) avatarUrl = data.viewer.avatarUrl || "";
        if (!login) login = data.viewer.login || "";
      }
      const listsConnection = data?.viewer?.lists;
      if (listsConnection) {
        if (listsConnection.nodes) {
          for (const node of listsConnection.nodes) {
            if (node) {
              const repos = (node.items?.nodes || [])
                .filter(item => item && item.nameWithOwner)
                .map(item => item.nameWithOwner);
              lists.push({ id: node.id, name: node.name, repos });
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
      return { lists: [], avatarUrl: "", login: "" };
    }
  }
  return { lists, avatarUrl, login };
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
  const listsData = await fetchAllLists(token);
  const lists = listsData.lists || [];
  const avatarUrl = listsData.avatarUrl || "";
  const login = listsData.login || "";
  
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

  return { repos: normalized, lists, etag, rateLimit: lastRateLimit, unchanged: false, avatarUrl, login };
}

async function unstarRepository({ token, owner, repo }) {
  const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/subscription`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION
    }
  });
  // Note: subscription is watch, stars is /user/starred/{owner}/{repo}
  const res2 = await fetch(`${GITHUB_API_BASE}/user/starred/${owner}/${repo}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION
    }
  });
  if (!res2.ok && res2.status !== 404) {
    const text = await res2.text();
    throw new Error(`取消 Star 失败: ${text || res2.statusText}`);
  }
}

async function starRepository({ token, owner, repo }) {
  const res = await fetch(`${GITHUB_API_BASE}/user/starred/${owner}/${repo}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "Content-Length": "0"
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Star 失败: ${text || res.statusText}`);
  }
}

async function updateRepositoryLists({ token, repositoryNodeId, listNodeIds }) {
  const query = `
    mutation($itemId: ID!, $listIds: [ID!]!) {
      updateUserListsForItem(input: { itemId: $itemId, listIds: $listIds }) {
        item {
          ... on Repository {
            id
          }
        }
      }
    }
  `;
  await fetchGraphQL(token, query, { itemId: repositoryNodeId, listIds: listNodeIds });
}

async function createUserList({ token, name, description = "" }) {
  const query = `
    mutation($name: String!, $description: String) {
      createUserList(input: { name: $name, description: $description }) {
        list {
          id
          name
        }
      }
    }
  `;
  const data = await fetchGraphQL(token, query, { name, description });
  return data?.createUserList?.list;
}

async function updateUserList({ token, listNodeId, name }) {
  const query = `
    mutation($listId: ID!, $name: String!) {
      updateUserList(input: { listId: $listId, name: $name }) {
        list {
          id
          name
        }
      }
    }
  `;
  const data = await fetchGraphQL(token, query, { listId: listNodeId, name });
  return data?.updateUserList?.list;
}

async function deleteUserList({ token, listNodeId }) {
  const query = `
    mutation($listId: ID!) {
      deleteUserList(input: { listId: $listId }) {
        clientMutationId
      }
    }
  `;
  await fetchGraphQL(token, query, { listId: listNodeId });
}

window.GitHubApi = {
  fetchAllStarred,
  starRepository,
  unstarRepository,
  updateRepositoryLists,
  createUserList,
  updateUserList,
  deleteUserList
};
