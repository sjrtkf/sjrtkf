"""Offline corpus audit and recognition measurement; never talks to a website."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import statistics
import sys
from time import perf_counter

from PIL import Image

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ocr.core import Predictor


def digest(data):
    return hashlib.sha256(data).hexdigest()

def percentile(values, percent):
    values = sorted(values)
    return values[min(len(values) - 1, int((len(values) - 1) * percent))] if values else None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="work/ocr-review/dataset-manifest.json")
    parser.add_argument("--output", default="work/ocr-review/evaluation.json")
    parser.add_argument("--methods", default="legacy,median")
    args = parser.parse_args()
    manifest_path = Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries, errors = [], []
    byte_groups, pixel_groups = defaultdict(list), defaultdict(list)
    for entry in manifest["files"]:
        try:
            path = manifest_path.parent / entry["path"]
            raw = path.read_bytes()
            with Image.open(path) as image:
                image.load()
                image = image.convert("RGB")
            record = {**entry, "actual_bytes": len(raw), "size_matches": len(raw) == entry["size"],
                      "dimensions": list(image.size), "sha256": digest(raw),
                      "pixel_sha256": digest(str(image.size).encode() + image.tobytes())}
            byte_groups[record["sha256"]].append(entry["id"])
            pixel_groups[record["pixel_sha256"]].append(entry["id"])
            record["image"] = image
            entries.append(record)
        except Exception as error:
            errors.append({"id": entry["id"], "error": str(error)})
    by_id = {x["id"]: x for x in entries}
    conflicts = [ids for ids in pixel_groups.values()
                 if len({by_id[id]["label"] for id in ids if by_id[id]["label"]}) > 1]
    labelled = [x for x in entries if x["label"]]
    report = {
        "scope": "Offline replay of historical filename-labelled corpus; not an independent held-out test. Original model training membership is unknown.",
        "label_caveat": "Filename labels have not all been manually verified. Image loading/corruption checks cover every downloaded file.",
        "listed_images": len(manifest["files"]), "readable_images": len(entries),
        "labelled_images": len(labelled), "unlabelled_images": len(entries)-len(labelled),
        "dimensions": dict(Counter(str(x["dimensions"]) for x in entries)),
        "all_sizes_match_metadata": all(x["size_matches"] for x in entries),
        "byte_duplicate_groups": [v for v in byte_groups.values() if len(v)>1],
        "pixel_duplicate_groups": [v for v in pixel_groups.values() if len(v)>1],
        "conflicting_exact_duplicate_labels": conflicts, "read_errors": errors, "methods": {},
        "records": [{k:v for k,v in x.items() if k != "image"} for x in entries]
    }
    for method in args.methods.split(","):
        predictor = Predictor(method=method)
        if entries:
            predictor.predict(entries[0]["image"])
        rows, elapsed = [], []
        for entry in entries:
            prediction = predictor.predict(entry["image"])
            elapsed.append(prediction["elapsed_ms"])
            rows.append({"id": entry["id"], "expected": entry["label"], **prediction,
                         "correct": prediction["text"] == entry["label"] if entry["label"] else None})
        labelled_rows = [x for x in rows if x["expected"]]
        exact = sum(x["correct"] for x in labelled_rows)
        correct_chars = sum(sum(a==b for a,b in zip(x["expected"],x["text"])) for x in labelled_rows)
        valid = sum(x["valid"] for x in labelled_rows)
        report["methods"][method] = {
            "initialization_ms": predictor.initialization_ms,
            "six_character_accuracy": exact / len(labelled_rows) if labelled_rows else None,
            "six_character_correct": exact, "labelled_images": len(labelled_rows),
            "character_accuracy": correct_chars / (len(labelled_rows)*6) if labelled_rows else None,
            "segmented_six_images": valid, "segmentation_failures": len(labelled_rows)-valid,
            "warm_latency_ms": {"median": statistics.median(elapsed) if elapsed else None,
                                 "p95": percentile(elapsed,.95), "max": max(elapsed) if elapsed else None},
            "predictions": rows}
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k not in ("records","methods")}, ensure_ascii=False, indent=2))
    print(json.dumps({k:{key:value for key,value in v.items() if key != "predictions"} for k,v in report["methods"].items()}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()

