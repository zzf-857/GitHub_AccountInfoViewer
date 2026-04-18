from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "starred_repos_dashboard.html").read_text(encoding="utf-8")


class DashboardContractTest(unittest.TestCase):
    def test_dashboard_uses_large_readability_tokens(self):
        required_tokens = {
            "--font-page-title": "30px",
            "--font-section-title": "20px",
            "--font-body": "16px",
            "--font-repo-title": "17px",
            "--font-meta": "14px",
            "--font-tag": "13px",
        }
        for token, value in required_tokens.items():
            self.assertRegex(HTML, rf"{re.escape(token)}\s*:\s*{re.escape(value)}")

    def test_dashboard_has_insight_console_structure(self):
        required_ids = [
            "globalSearch",
            "savedViews",
            "filterChips",
            "activeFilterSummary",
            "insightSummary",
            "languageChart",
            "topicPanel",
            "activityChart",
            "emptyState",
            "listSkeleton",
        ]
        for element_id in required_ids:
            self.assertIn(f'id="{element_id}"', HTML)

    def test_dense_table_structure_is_removed(self):
        self.assertNotIn('class="table-head"', HTML)
        self.assertNotIn('id="pie"', HTML)
        self.assertNotIn('id="bar"', HTML)


if __name__ == "__main__":
    unittest.main()
