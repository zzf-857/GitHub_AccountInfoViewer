from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
TOKEN_PATTERN = re.compile(r"github_(?:pat|ghp)_[A-Za-z0-9_]+")


class SecretScanTest(unittest.TestCase):
    def test_source_files_do_not_contain_github_tokens(self):
        source_files = [
            *ROOT.glob("*.py"),
            *ROOT.glob("*.html"),
            *ROOT.glob("js/**/*.js"),
        ]

        leaked_files = []
        for path in source_files:
            text = path.read_text(encoding="utf-8", errors="ignore")
            if TOKEN_PATTERN.search(text):
                leaked_files.append(str(path.relative_to(ROOT)))

        self.assertEqual([], leaked_files)


if __name__ == "__main__":
    unittest.main()
