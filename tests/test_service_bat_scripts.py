from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ServiceBatScriptsTest(unittest.TestCase):
    def test_start_server_bat_uses_project_http_server_command(self):
        path = ROOT / "start_server.bat"
        self.assertTrue(path.exists(), "start_server.bat should exist at the project root")

        content = path.read_text(encoding="utf-8", errors="ignore")
        self.assertIn('cd /d "%~dp0"', content)
        self.assertIn("python server.py 8000", content)
        self.assertIn("http://127.0.0.1:8000/starred_repos_dashboard.html", content)

    def test_stop_server_bat_targets_the_same_port(self):
        path = ROOT / "stop_server.bat"
        self.assertTrue(path.exists(), "stop_server.bat should exist at the project root")

        content = path.read_text(encoding="utf-8", errors="ignore")
        self.assertIn('set "PORT=8000"', content)
        self.assertIn("http-server.pid", content)
        self.assertIn("taskkill", content)


if __name__ == "__main__":
    unittest.main()
