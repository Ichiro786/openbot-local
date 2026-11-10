#!/usr/bin/env python3
"""Run the CI-owned synthetic mobile layout driver."""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parents[1] / ".github/e2e/mobile-chat-layout-e2e.py"), run_name="__main__")
