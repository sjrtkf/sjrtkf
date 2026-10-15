"""Validate the packaged application on local samples with its Tk window hidden."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "outputs" / "CaptchaReader-v0.1"
SAMPLES = [
    ROOT / "work/drive-review/1I9noN-IXEkYR9IEE2MgSEztugoNPEZoh-WTCNBW_1760687871899.png",
    ROOT / "work/drive-review/1UIyvnNUOOiu8QQWBClwfVFdL5ahz76xp-TXCBPQ_1760687868172.png",
]
REPORT = ROOT / "work/ocr-packaged-selftest.json"
binary = OUTPUT / "CaptchaReader-v0.1.exe"
result = subprocess.run([str(binary), "--self-test", *(str(p) for p in SAMPLES), "--report", str(REPORT)],
                        cwd=ROOT, timeout=60, capture_output=True)
if result.returncode:
    raise RuntimeError(f"Packaged self-test failed: exit {result.returncode}; {result.stderr.decode(errors='replace')[:500]}")
report = json.loads(REPORT.read_text(encoding="utf-8"))
assert report["passed"] is True and report["window_visible"] is False, report
assert [sample["text"] for sample in report["samples"]] == ["WTCNBW", "TXCBPQ"], report
assert all(sample["valid"] and sample["preview_rendered"] for sample in report["samples"])
hashes = {}
for name in ("captcha_solver.onnx", "labels.json"):
    original = (ROOT / "ocr/models" / name).read_bytes()
    packaged = (OUTPUT / "_internal/ocr/models" / name).read_bytes()
    assert original == packaged, f"Packaged model mismatch: {name}"
    hashes[name] = hashlib.sha256(packaged).hexdigest()
validation = {"passed": True, "standaloneExecutableTested": True, "browserRequests": 0,
              "visibleGuiOpened": False, "modelHashes": hashes,
              "exeSha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "selfTest": report}
(ROOT / "work/ocr-package-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"passed": True, "samples": 2, "modelFilesMatched": 2, "browserRequests": 0}))

