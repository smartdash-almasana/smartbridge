import sys
from pathlib import Path
import os

def pytest_configure(config):
    os.environ["WEBHOOK_URL"] = "http://test.local/webhook"

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
