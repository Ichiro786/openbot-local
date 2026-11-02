#!/usr/bin/env python3
"""Run the Antigravity ACP server's Python frontend (extracted from the PAR) on a stock CPython.

Layout expected (made by prepare.py on the device, never shipped):
  $AGY_HYBRID_SRC/google3/...            pure-Python files copied from the PAR's ZIP overlay (.so removed)
  a venv on sys.path providing the native deps from public wheels
Env:
  AGY_HYBRID_SRC   root that contains google3/ (default: <this dir>/../src)
  AGY_HYBRID_TRACE=1  print every imported module file to stderr (debug)
"""
import os, sys, importlib, types

here = os.path.dirname(os.path.abspath(__file__))
src = os.environ.get("AGY_HYBRID_SRC") or os.path.join(os.path.dirname(here), "src")
tp = os.path.join(src, "google3", "third_party", "py")

# 1. argv: drop the registry's empty --uid= (init_google is not used here).
sys.argv = [a for a in sys.argv if a != "--uid="]
# main.py looks for localharness_external next to argv[0]; point argv[0] at the launcher dir.
if os.environ.get("AGY_HYBRID_ARGV0"):
    sys.argv[0] = os.environ["AGY_HYBRID_ARGV0"]

# 2. sys.path: google3 root first, then venv site-packages (already on path), then bundled pure-Python third_party.
sys.path.insert(0, src)
sys.path.append(tp)

# 3. `google` is a regular package in the PAR (google/__init__.py) and a namespace in the venv.
#    Merge them: venv portions first (public protobuf/genai/auth wheels), bundled second (google.antigravity).
venv_google = [os.path.join(p, "google") for p in sys.path
               if p not in (src, tp) and os.path.isdir(os.path.join(p, "google"))]
g = types.ModuleType("google"); g.__path__ = venv_google + [os.path.join(tp, "google")]
g.__package__ = "google"; sys.modules["google"] = g

if os.environ.get("AGY_HYBRID_TRACE") == "1":
    class _T:
        def find_spec(self, name, path=None, target=None):
            for f in sys.meta_path[1:]:
                fs = getattr(f, "find_spec", None)
                if not fs: continue
                s = fs(name, path, target)
                if s:
                    sys.stderr.write(f"IMPORT {name} {s.origin}\n"); return s
            return None
    sys.meta_path.insert(0, _T())

# 4. Same override the official entrypoint applies before loading generated code.
import google.protobuf.runtime_version as _rv
_rv.ValidateProtobufRuntimeVersion = lambda *a, **k: None

# 5. Run the official entry module as __main__.
if os.environ.get("AGY_HYBRID_IMPORT_ONLY") == "1":
    importlib.import_module("google3.cloud.developer_experience.antigravity_extensions.acp_server.main")
    print("IMPORT_OK"); sys.exit(0)
import runpy
runpy.run_module("google3.cloud.developer_experience.antigravity_extensions.acp_server.main",
                 run_name="__main__", alter_sys=True)
