"""Build the memory-only worker; child process visibility is controlled by Node."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "work" / "ocr-worker-build"
DIST = ROOT / "outputs"
DEPS = ROOT / "work" / "ocr-build-deps"
for target in (BUILD, DIST, DEPS):
    target.resolve().relative_to(ROOT.resolve())
BUILD.mkdir(parents=True, exist_ok=True)
env = os.environ.copy()
env["PYTHONPATH"] = os.pathsep.join((str(DEPS), str(ROOT)))
subprocess.run([
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--onedir", "--console",
    "--name", "CaptchaWorker-v0.1", "--distpath", str(DIST),
    "--workpath", str(BUILD / "build"), "--specpath", str(BUILD),
    "--paths", str(ROOT), "--add-data", f"{ROOT / 'ocr' / 'models'};ocr/models",
    "--collect-all", "onnxruntime", "--exclude-module", "matplotlib",
    "--exclude-module", "pandas", "--exclude-module", "scipy",
    "--exclude-module", "sklearn", "--exclude-module", "torch",
    "--exclude-module", "tensorflow", str(ROOT / "ocr" / "worker.py"),
], cwd=ROOT, env=env, check=True)
