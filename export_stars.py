import requests
import os
from collections import defaultdict

TOKEN = os.environ.get("GITHUB_TOKEN") or os.environ.get("GITHUB_PAT")
if not TOKEN:
    raise RuntimeError("请先设置 GITHUB_TOKEN 或 GITHUB_PAT 环境变量。")

headers = {
    "Accept": "application/vnd.github.v3+json",
    "Authorization": f"Bearer {TOKEN}"
}

def get_current_user():
    """获取当前 Token 对应的用户名"""
    url = "https://api.github.com/user"
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        return response.json().get('login', 'unknown_user')
    return 'unknown_user'

def get_starred_repos():
    repos = []
    page = 1
    while True:
        url = f"https://api.github.com/user/starred?per_page=100&page={page}"
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            print(f"获取失败，请检查 Token。状态码: {response.status_code}")
            break

        data = response.json()
        if not data:
            break

        repos.extend(data)
        if 'next' not in response.links:
            break
        page += 1
    return repos

def generate_markdown(username, repos):
    categorized = defaultdict(list)
    for repo in repos:
        language = repo.get('language') or 'Others (未分类)'
        categorized[language].append(repo)

    sorted_categories = sorted(categorized.items(), key=lambda x: len(x[1]), reverse=True)

    md_content = f"# GitHub Starred Repositories - {username} 🌟\n\n"
    md_content += f"账号: **{username}** | 总计 Star 仓库数: **{len(repos)}**\n\n"

    md_content += "## 目录结构\n\n"
    for language, _ in sorted_categories:
        anchor = language.lower().replace(' ', '-').replace('(', '').replace(')', '').replace('未分类', '')
        md_content += f"- [{language}](#{anchor})\n"
    md_content += "\n---\n\n"

    for language, lang_repos in sorted_categories:
        md_content += f"## {language}\n\n"
        md_content += "| 仓库名 | 简介 | 链接 |\n"
        md_content += "| --- | --- | --- |\n"
        for repo in lang_repos:
            name = repo.get('full_name', '')
            url = repo.get('html_url', '')
            desc = (repo.get('description', '') or '暂无简介').replace('|', '\\|').replace('\n', ' <br> ').strip()
            md_content += f"| **{name}** | {desc} | [查看]({url}) |\n"
        md_content += "\n"

    return md_content

def main():
    username = get_current_user()
    print(f"当前账号: {username}")
    print("正在抓取 Star 仓库...")

    repos = get_starred_repos()
    print(f"成功获取 {len(repos)} 个仓库。")

    if repos:
        md_output = generate_markdown(username, repos)
        filename = f"starred_repos_{username}.md"
        with open(filename, "w", encoding="utf-8") as f:
            f.write(md_output)
        print(f"完成！数据已保存至: {filename}")

if __name__ == "__main__":
    main()
