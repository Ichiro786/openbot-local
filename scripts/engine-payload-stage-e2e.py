#!/usr/bin/env python3
"""Drive the real payload staging process with synthetic artifact data."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
out = root / ".openbot-build/engine-payload-stage"
out.mkdir(parents=True, exist_ok=True)
results = []
with tempfile.TemporaryDirectory(dir=out, prefix="fixture-") as fixture:
    fixture = Path(fixture)
    scripts = fixture / "module/scripts"
    scripts.mkdir(parents=True)
    script = scripts / "stage-engine-payload.sh"
    script.symlink_to(root / "apps/mobile/modules/openbot-engine/scripts/stage-engine-payload.sh")
    artifact = fixture / "artifact"
    artifact.mkdir()
    payload = b"Synthetic rootfs payload. No user data.\n"
    digest = hashlib.sha256(payload).hexdigest()
    manifest = {
        "name": "openbot-local-engine", "arch": "arm64", "asset": "rootfs-arm64.tar.xz",
        "version": "0.67.1", "openbot_version": "0.67.1", "tag": "engine-0.67.1-1",
        "git": "b" * 40, "source_sha": "a" * 40, "sha256": digest,
        "compressed_bytes": len(payload), "installed_bytes": 1000,
    }
    env = dict(os.environ)
    for name in ("GH_TOKEN", "GITHUB_TOKEN"):
        env.pop(name, None)
    env.update(ENGINE_ARTIFACT_DIR=str(artifact), ENGINE_SOURCE_SHA="a" * 40,
               ENGINE_GIT_SHA="b" * 40, ENGINE_TAG="engine-0.67.1-1",
               ENGINE_ARTIFACT_NAME="engine-0.67.1-1-rootfs-arm64")
    for case in ("valid", "default-valid", "source", "run", "tag", "tag-default", "name", "hash", "size", "missing"):
        env["ENGINE_TAG"] = "" if case in ("default-valid", "tag-default") else "engine-0.67.1-1"
        env["ENGINE_ARTIFACT_NAME"] = "engine-0.67.0-1-rootfs-arm64" if case == "name" else "engine-0.67.1-1-rootfs-arm64"
        candidate = dict(manifest)
        if case == "source":
            candidate["source_sha"] = "c" * 40
        if case == "run":
            candidate["git"] = "c" * 40
        if case in ("tag", "tag-default"):
            candidate["tag"] = "engine-0.67.0-1"
        if case == "size":
            candidate["compressed_bytes"] += 1
        (artifact / "engine.json").write_text(json.dumps(candidate))
        (artifact / "rootfs-arm64.tar.xz").write_bytes(payload)
        (artifact / "rootfs-arm64.tar.xz.sha256").write_text(
            ("0" * 64 if case == "hash" else digest) + "  rootfs-arm64.tar.xz\n")
        if case == "missing":
            (artifact / "rootfs-arm64.tar.xz.sha256").unlink()
        process = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True, timeout=20)
        expected = process.returncode == 0 if case in ("valid", "default-valid") else process.returncode != 0
        results.append({"case": case, "pass": expected, "exitCode": process.returncode})
        if case in ("valid", "default-valid") and expected:
            staged = fixture / "module/android/src/main/assets/engine"
            assert (staged / "rootfs-arm64.tar.xz").read_bytes() == payload
            assert json.loads((staged / "engine.json").read_text())["sha256"] == digest
        if not expected:
            break
report = {"results": results, "pass": len(results) == 10 and all(row["pass"] for row in results)}
(out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
raise SystemExit(0 if report["pass"] else 1)
