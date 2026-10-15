"""Build the local OCR application; never opens a browser or the visible GUI."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "work" / "ocr-build"
DIST = ROOT / "outputs"
DEPS = ROOT / "work" / "ocr-build-deps"
for target in (BUILD, DIST, DEPS):
    target.resolve().relative_to(ROOT.resolve())
BUILD.mkdir(parents=True, exist_ok=True)
env = os.environ.copy()
env["PYTHONPATH"] = os.pathsep.join((str(DEPS), str(ROOT)))
subprocess.run([
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--onedir", "--windowed",
    "--name", "CaptchaReader-v0.1", "--distpath", str(DIST),
    "--workpath", str(BUILD / "build"), "--specpath", str(BUILD),
    "--paths", str(ROOT), "--add-data", f"{ROOT / 'ocr' / 'models'};ocr/models",
    "--collect-all", "onnxruntime", "--exclude-module", "matplotlib",
    "--exclude-module", "pandas", "--exclude-module", "scipy",
    "--exclude-module", "sklearn", "--exclude-module", "torch",
    "--exclude-module", "tensorflow", str(ROOT / "ocr_ui" / "app.py"),
], cwd=ROOT, env=env, check=True)

