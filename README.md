# GitHub_AccountInfoViewer

一个本地运行的 GitHub Star 仓库洞察面板，用来整理多个 GitHub 账号的收藏仓库，并通过筛选、图表、排序和 AI 引导辅助快速回看自己的技术收藏。

## 当前完成情况

当前版本已经从最初的简单 Star 列表升级为一个本地数据看板：

- 支持从 `.env` 读取多个 GitHub 账号配置，并合并展示 Star 仓库。
- 支持按账号单独查看，也支持全部账号合并查看。
- 支持关键词、语言、主题、更新时间、Star 数、仓库状态、简介类型筛选。
- 支持按更新时间、Star 数、Fork 数、仓库名称排序。
- 支持自动刷新、手动刷新、缓存回退和 API rate limit 状态展示。
- 支持仓库卡片列表、语言结构图、热门主题面板、最近活跃图表和关键指标区域。
- 支持顶部 GitHub 入口卡片：Explore、Topics、Trending、Collections。
- 支持 AI 引导功能，通过本地 `server.py` 代理读取 README 并调用兼容 OpenAI Chat Completions 或火山引擎 Responses 格式的模型接口。
- 支持 AI 连通性检测、流式输出、取消请求和离线状态提示。
- 已补充 Python 契约测试、安全扫描测试和 JavaScript 洞察逻辑测试。

## 运行环境

- Python 3
- 现代浏览器
- 可选：Node.js，用于运行 JavaScript 测试

前端页面仍是静态 HTML/CSS/JS，`server.py` 只负责本地静态服务和 AI API 代理。

## 配置方式

在项目根目录创建 `.env` 文件：

```env
ACCOUNT_1_NAME=主账号
ACCOUNT_1_TOKEN=你的 GitHub Token
ACCOUNT_2_NAME=备用账号
ACCOUNT_2_TOKEN=你的第二个 GitHub Token

AI_API_KEY=你的 AI API Key
AI_API_BASE=https://api.openai.com/v1
AI_MODEL=gpt-3.5-turbo
```

说明：

- `ACCOUNT_<N>_TOKEN` 用于读取对应账号的 Star 仓库。
- 如果只查看公开数据，GitHub Token 权限可以保持最小化；如果后续读取 private 仓库或更多账号数据，需要给 token 增加对应权限。
- `AI_API_KEY` 不配置时，AI 引导会进入模拟返回模式。
- `.env` 已被 `.gitignore` 忽略，不应提交真实密钥。

## 启动方式

推荐使用批处理脚本启动本地服务：

```powershell
.\start_server.bat
```

启动后访问：

```text
http://127.0.0.1:8000/starred_repos_dashboard.html
```

停止服务：

```powershell
.\stop_server.bat
```

也可以直接运行：

```powershell
python server.py 8000
```

## 测试

运行 Python 测试：

```powershell
python -m unittest discover -s tests
```

运行 JavaScript 洞察逻辑测试：

```powershell
node tests/js/insights.test.js
```

## 主要文件

```text
starred_repos_dashboard.html  主页面和样式
server.py                     本地静态服务与 AI API 代理
js/app.js                     页面启动、账号读取、刷新和事件绑定
js/github-api.js              GitHub Star API 请求与数据归一化
js/insights.js                筛选、统计、摘要等纯逻辑
js/store.js                   前端状态管理
js/view.js                    页面渲染
js/refresh-controller.js      自动刷新控制
tests/                        自动化测试
```

## 注意事项

- 当前程序面向本地使用，不建议把带真实 `.env` 的目录直接部署到公网。
- 浏览器端会读取 `.env` 中的账号 token，因此目前更适合作为个人本地工具。
- AI 引导会把仓库名、简介和 README 片段发送给配置的模型接口，敏感私有仓库需要谨慎使用。
- 仓库权限盘点功能暂不加入当前版本，避免偏离 Star 收藏洞察的主线。

## 后续方向

- 增加仓库详情抽屉。
- 增加导出当前筛选结果到 JSON、CSV 或 Markdown。
- 增加本地备注、个人标签、已读状态和复盘队列。
- 增加更明确的规则分类体系，不只依赖 GitHub topics。
- 逐步引入前端构建流程，拆分样式和模块。
- 评估 Electron 或 Tauri 桌面版本，进一步降低 token 暴露风险。
