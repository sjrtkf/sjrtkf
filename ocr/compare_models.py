"""Frozen original-image comparison. This script never trains or selects weights."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import statistics

import cv2
import numpy as np
from PIL import Image

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ocr.core import Predictor

ROOT = Path(__file__).resolve().parent.parent
STRESS_NAMES = ("rotate_minus", "rotate_plus", "shear_minus", "shear_plus",
                "narrow", "wide", "noise", "darker", "lighter")


def stress_images(image, identifier):
    """Prespecified transformations; same pixels/seeds are given to both models."""
    rgb = np.asarray(image.convert("RGB"))
    height, width = rgb.shape[:2]
    for angle, name in ((-3, "rotate_minus"), (3, "rotate_plus")):
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1)
        yield name, Image.fromarray(cv2.warpAffine(rgb, matrix, (width, height),
                                                  borderMode=cv2.BORDER_REPLICATE))
    for amount, name in ((-.06, "shear_minus"), (.06, "shear_plus")):
        matrix = np.float32([[1, amount, -amount * height / 2], [0, 1, 0]])
        yield name, Image.fromarray(cv2.warpAffine(rgb, matrix, (width, height),
                                                  borderMode=cv2.BORDER_REPLICATE))
    for factor, name in ((.9, "narrow"), (1.1, "wide")):
        yield name, Image.fromarray(cv2.resize(rgb, (round(width * factor), height)))
    seed = int(hashlib.sha256((identifier + "frozen-stress-20261015").encode()).hexdigest()[:8], 16)
    noise = np.random.default_rng(seed).normal(0, 6, rgb.shape)
    yield "noise", Image.fromarray(np.clip(rgb.astype(float) + noise, 0, 255).astype(np.uint8))
    for factor, name in ((.85, "darker"), (1.15, "lighter")):
        yield name, Image.fromarray(np.clip(rgb.astype(float) * factor, 0, 255).astype(np.uint8))


def summarize(rows):
    count = len(rows)
    accepted = [row for row in rows if row["valid"] and row["confidence"] >= .75]
    confusions = Counter()
    for row in rows:
        if len(row["text"]) == len(row["label"]):
            confusions.update(f"{a}->{b}" for a, b in zip(row["label"], row["text"]) if a != b)
    elapsed = sorted(row["elapsed_ms"] for row in rows)
    return {
        "images": count, "exact_correct": sum(row["correct"] for row in rows),
        "exact_accuracy": sum(row["correct"] for row in rows) / count if count else None,
        "character_accuracy": sum(row["correct_characters"] for row in rows) / (count * 6) if count else None,
        "segmentation_failures": sum(not row["valid"] for row in rows),
        "accepted_at_075": len(accepted), "accepted_wrong": sum(not row["correct"] for row in accepted),
        "accepted_coverage": len(accepted) / count if count else 0,
        "accepted_error_rate": sum(not row["correct"] for row in accepted) / len(accepted) if accepted else 0,
        "confusions": dict(confusions),
        "latency_ms": {"median": statistics.median(elapsed) if elapsed else None,
                       "p95": elapsed[int((len(elapsed) - 1) * .95)] if elapsed else None},
    }


def compare(split_path, baseline, candidate, partition="test"):
    split = json.loads(split_path.read_text(encoding="utf-8"))
    rows = [row for row in split["items"] if row["split"] == partition]
    if not rows:
        raise ValueError("No images in requested partition")
    paths = {"baseline": Path(baseline), "candidate": Path(candidate)}
    models = {key: Predictor(model_path=value, adaptive=key == "candidate") for key, value in paths.items()}
    results = {key: [] for key in models}
    for row in rows:
        path = ROOT / row["path"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != row["hash"]:
            raise ValueError("Image changed after the split was frozen")
        with Image.open(path) as opened:
            image = opened.convert("RGB")
        images = [("clean", image), *stress_images(image, row["id"])]
        for variation, pixels in images:
            for name, model in models.items():
                value = model.predict(pixels)
                results[name].append({"id": row["id"], "variant": variation, "label": row["label"],
                                      "text": value["text"], "valid": value["valid"],
                                      "confidence": value["confidence"], "elapsed_ms": value["elapsed_ms"],
                                      "correct": value["text"] == row["label"],
                                      "correct_characters": sum(a == b for a, b in zip(value["text"], row["label"]))})
    summary = {}
    for name, values in results.items():
        summary[name] = {
            "model_sha256": hashlib.sha256(paths[name].read_bytes()).hexdigest(),
            "clean": summarize([row for row in values if row["variant"] == "clean"]),
            "stress": summarize([row for row in values if row["variant"] != "clean"]),
            "by_variant": {variant: summarize([row for row in values if row["variant"] == variant])
                           for variant in STRESS_NAMES},
        }
    old, new = summary["baseline"], summary["candidate"]
    checks = {
        "clean_exact_not_worse": new["clean"]["exact_correct"] >= old["clean"]["exact_correct"],
        "stress_characters_not_worse": new["stress"]["character_accuracy"] >= old["stress"]["character_accuracy"],
        "stress_accepted_error_rate_not_worse": new["stress"]["accepted_error_rate"] <= old["stress"]["accepted_error_rate"],
        "stress_accepted_wrong_count_not_worse": new["stress"]["accepted_wrong"] <= old["stress"]["accepted_wrong"],
        "clean_accepted_coverage_not_worse": new["clean"]["accepted_at_075"] >= old["clean"]["accepted_at_075"],
        "w_to_n_not_worse": new["stress"]["confusions"].get("W->N", 0) <= old["stress"]["confusions"].get("W->N", 0),
        "n_to_w_not_worse": new["stress"]["confusions"].get("N->W", 0) <= old["stress"]["confusions"].get("N->W", 0),
    }
    return {
        "partition": partition, "original_images": len(rows), "stress_variants_per_image": len(STRESS_NAMES),
        "pipelines": {"baseline": "fixed threshold 140", "candidate": "fixed threshold first, consensus fallback only when uncertain"},
        "split_sha256": hashlib.sha256(split_path.read_bytes()).hexdigest(), "summary": summary,
        "checks": checks, "passed": all(checks.values()), "predictions": results,
        "limitations": split["limitations"] + [
            "Stress images are synthetic variations, not additional independent real-site samples.",
            "Confidence threshold is unchanged; model scores are not calibrated correctness probabilities.",
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", type=Path, default=ROOT / "work/ocr-training-v0.9.2/split.json")
    parser.add_argument("--baseline", type=Path, default=ROOT / "ocr/models/captcha_solver.onnx")
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--partition", choices=("validation", "test"), default="test")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = compare(args.split, args.baseline, args.candidate, args.partition)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in ("predictions", "limitations")}, ensure_ascii=True))
    return 0 if report["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
