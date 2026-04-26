import os
import sys
import json
import requests
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import threading
import traceback

def log(msg):
    """写入 stderr 以避免 stdout 缓冲问题"""
    print(msg, file=sys.stderr, flush=True)

# 尝试加载 .env 文件（简易实现，不依赖 python-dotenv）
try:
    with open(".env", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                key, val = line.split("=", 1)
                os.environ[key.strip()] = val.strip()
except FileNotFoundError:
    pass

AI_API_KEY = os.environ.get("AI_API_KEY", "")
# 默认指向 OpenAI 格式的接口，可根据需要替换为 DeepSeek、硅基流动等
AI_API_BASE = os.environ.get("AI_API_BASE", "https://api.openai.com/v1")
AI_MODEL = os.environ.get("AI_MODEL", "gpt-3.5-turbo")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN") or os.environ.get("GITHUB_PAT")

class APIProxyHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed_url = urlparse(self.path)
        
        if parsed_url.path == "/api/ai-guide":
            self.handle_ai_guide(parsed_url)
            return
        
        if parsed_url.path == "/api/ai-health":
            self.handle_ai_health()
            return
            
        return super().do_GET()
    
    def handle_ai_health(self):
        """向大模型发送"你好"，测试连通性"""
        result = {"ok": False, "model": AI_MODEL, "message": ""}
        
        if not AI_API_KEY:
            result["message"] = "未配置 AI_API_KEY"
            self._send_json(result)
            return
        
        try:
            ai_headers = {
                "Authorization": f"Bearer {AI_API_KEY}",
                "Content-Type": "application/json"
            }
            is_volcengine_responses = ("volces.com" in AI_API_BASE or "volcengine" in AI_API_BASE) and "/coding/" not in AI_API_BASE
            
            if is_volcengine_responses:
                ai_url = f"{AI_API_BASE.rstrip('/')}/responses"
                ai_data = {
                    "model": AI_MODEL,
                    "input": "你好",
                    "stream": False,
                    "store": False
                }
            else:
                ai_url = f"{AI_API_BASE.rstrip('/')}/chat/completions"
                ai_data = {
                    "model": AI_MODEL,
                    "messages": [{"role": "user", "content": "你好"}],
                    "stream": False,
                    "max_tokens": 10
                }
            
            log(f"[Health] Checking: {ai_url} model={AI_MODEL}")
            resp = requests.post(ai_url, headers=ai_headers, json=ai_data, timeout=15)
            log(f"[Health] Status: {resp.status_code}")
            
            if resp.status_code == 200:
                result["ok"] = True
                result["message"] = "模型连接正常"
            else:
                result["message"] = f"HTTP {resp.status_code}: {resp.text[:200]}"
        except requests.Timeout:
            result["message"] = "请求超时 (15s)"
        except Exception as e:
            result["message"] = str(e)
        
        self._send_json(result)
    
    def _send_json(self, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        
    def handle_ai_guide(self, parsed_url):
        query_components = parse_qs(parsed_url.query)
        owner = query_components.get("owner", [""])[0]
        repo = query_components.get("repo", [""])[0]
        description = query_components.get("description", [""])[0]
        
        if not owner or not repo:
            self.send_error(400, "Missing owner or repo")
            return
            
        # 设置响应头为 SSE
        self.send_response(200)
        self.send_header('Content-type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('X-AI-Model', AI_MODEL)
        self.end_headers()
        
        def send_chunk(text):
            data = json.dumps({"content": text})
            self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
            self.wfile.flush()

        def send_status(text):
            data = json.dumps({"status": text})
            self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
            self.wfile.flush()

        try:
            if not AI_API_KEY:
                # Mock Mode if no API key is provided
                import time
                mock_text = f"**{owner}/{repo}** 的 AI 解读 (Mock 模式)：\n\n您没有在 `.env` 中配置 `AI_API_KEY`，这是模拟流式返回的测试数据。\n\n- **这是什么**：这是一个基于模拟数据的仓库解读演示。\n- **核心亮点**：流式打字机效果、毛玻璃UI设计。\n\n配置密钥后即可获取真实的源码级洞察！"
                for i in range(0, len(mock_text), 2):
                    send_chunk(mock_text[i:i+2])
                    time.sleep(0.05)
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                return

            send_status("正在获取 GitHub README...")
            
            # 1. Fetch README
            headers = {"Accept": "application/vnd.github.v3.raw"}
            if GITHUB_TOKEN:
                headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
                
            readme_url = f"https://api.github.com/repos/{owner}/{repo}/readme"
            try:
                readme_resp = requests.get(readme_url, headers=headers, timeout=10)
                if readme_resp.status_code == 200:
                    readme_content = readme_resp.text[:4000]
                elif readme_resp.status_code == 404:
                    readme_content = "该仓库没有 README。"
                else:
                    readme_content = f"获取 README 失败 (HTTP {readme_resp.status_code})。"
            except Exception as e:
                readme_content = "请求 README 时发生网络错误。"

            # 2. Call AI API
            prompt = f"""你是一个严谨且资深的开源技术专家。请根据以下 GitHub 仓库的简介和 README 片段，如果你可以联网，你可以先联网搜索这个github仓库的相关信息，为开发者真实地介绍这个项目。
要求：（使用 Markdown 标题采用“#” 标识 的方式  正文采用无序列表和有序列表的形式，结构清晰易读）。
1. 第一段，大标题：项目简介：（用通俗的话说明它是做什么的。）
2. 第二段，列举 2-3 个核心功能或优势。并且想一个它可以用来干什么,说一个某一个具体的使用场景或用法。解决了什么问题。
3. 语言简练，总字数500-1500字，直接输出内容，不要任何寒暄。
4. 【重要】如果 README 内容显示获取失败或为空，且仅靠简介无法判断该项目真实用途时，请坦诚回答"提供的上下文不足，无法准确解读该仓库"，严禁根据仓库名字自行编造或猜测功能。

仓库名：{owner}/{repo}
简介：{description}
README 片段：
{readme_content}
"""
            ai_headers = {
                "Authorization": f"Bearer {AI_API_KEY}",
                "Content-Type": "application/json"
            }
            
            # 自动检测是否为火山引擎 Responses API
            is_volcengine_responses = ("volces.com" in AI_API_BASE or "volcengine" in AI_API_BASE) and "/coding/" not in AI_API_BASE
            
            if is_volcengine_responses:
                # 火山引擎 Responses API 格式
                ai_url = f"{AI_API_BASE.rstrip('/')}/responses"
                ai_data = {
                    "model": AI_MODEL,
                    "input": [
                        {"role": "system", "content": "你是一个资深的极客开发者。"},
                        {"role": "user", "content": prompt}
                    ],
                    "stream": True,
                    "store": False
                }
            else:
                # 标准 OpenAI Chat Completions API 格式
                ai_url = f"{AI_API_BASE.rstrip('/')}/chat/completions"
                ai_data = {
                    "model": AI_MODEL,
                    "messages": [
                        {"role": "system", "content": "你是一个资深的极客开发者。"},
                        {"role": "user", "content": prompt}
                    ],
                    "stream": True,
                    "temperature": 0.7
                }
            
            log(f"[AI] API Type: {'Volcengine Responses' if is_volcengine_responses else 'OpenAI Chat'}")
            log(f"[AI] Requesting: {ai_url}")
            log(f"[AI] Model: {AI_MODEL}")
            
            with requests.post(ai_url, headers=ai_headers, json=ai_data, stream=True, timeout=60) as r:
                log(f"[AI] Response status: {r.status_code}")
                if r.status_code != 200:
                    err_text = r.text[:500]
                    log(f"[AI] Error body: {err_text}")
                    send_chunk(f"AI 接口请求失败: HTTP {r.status_code}\n{err_text}")
                    self.wfile.write(b"data: [DONE]\n\n")
                    self.wfile.flush()
                    return
                
                received_any = False
                reasoning_started = False
                for line in r.iter_lines():
                    if line:
                        line_str = line.decode('utf-8')
                        log(f"[AI] Raw: {line_str[:300]}")
                        
                        # 跳过 SSE event 类型行 (火山 Responses API: "event: response.output_text.delta")
                        if line_str.startswith('event:'):
                            continue
                        
                        if line_str.startswith('data: '):
                            data_str = line_str[6:]
                            if data_str == '[DONE]':
                                continue
                            try:
                                chunk_data = json.loads(data_str)
                                
                                # 标准 OpenAI Chat 格式
                                delta_content = ""
                                reasoning_content = ""
                                choices = chunk_data.get('choices', [])
                                if choices:
                                    delta = choices[0].get('delta', {})
                                    delta_content = delta.get('content', '') or ''
                                    reasoning_content = delta.get('reasoning_content', '') or ''
                                
                                # 处理思维链（reasoning_content）：给前端一个提示
                                if reasoning_content and not reasoning_started:
                                    reasoning_started = True
                                    send_status("AI 正在深度思考中...")
                                    received_any = True
                                
                                # 当正式内容开始输出时，如果之前有思维链，更新标记
                                if delta_content and reasoning_started and not hasattr(self, '_content_started'):
                                    self._content_started = True
                                
                                if delta_content:
                                    received_any = True
                                    send_chunk(delta_content)
                                else:
                                    # 方式2: 火山 Responses API 格式
                                    evt_type = chunk_data.get('type', '')
                                    if evt_type == 'response.output_text.delta':
                                        resp_delta = chunk_data.get('delta', '')
                                        if resp_delta:
                                            received_any = True
                                            send_chunk(resp_delta)
                                    elif evt_type == 'response.reasoning_summary_text.delta':
                                        pass  # 跳过思维链摘要
                            except json.JSONDecodeError:
                                log(f"[AI] JSON decode failed: {data_str[:200]}")
                        else:
                            # 兜底：尝试直接解析非标准格式
                            try:
                                chunk_data = json.loads(line_str)
                                delta_content = chunk_data.get('choices', [{}])[0].get('delta', {}).get('content', '')
                                if delta_content:
                                    received_any = True
                                    send_chunk(delta_content)
                            except (json.JSONDecodeError, KeyError, IndexError):
                                pass
                
                if not received_any:
                    send_chunk("⚠️ AI 接口已连接但未返回任何内容。请检查模型名称是否在 CodingPlan 支持列表中。")
                                
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            
        except ConnectionAbortedError:
            log("[AI] Client disconnected (AbortError), ignoring.")
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            try:
                send_chunk(f"\n\n**发生系统错误**：{str(e)}")
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except Exception:
                pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server_address = ('127.0.0.1', port)
    httpd = ThreadingHTTPServer(server_address, APIProxyHandler)
    log(f"Starting API proxy server on port {port}...")
    httpd.serve_forever()
