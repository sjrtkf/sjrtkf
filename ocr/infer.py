"""CLI: python -m ocr.infer --image example.png --json"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ocr.core import Predictor

def main():
    parser = argparse.ArgumentParser(description="로컬 이미지의 문자 6개를 인식합니다. 웹사이트 연결이나 입력 기능은 없습니다.")
    parser.add_argument("--image", required=True, help="이미지 파일 경로")
    parser.add_argument("--model", help="선택할 ONNX 모델 경로")
    parser.add_argument("--labels", help="문자표 JSON 경로")
    parser.add_argument("--json", action="store_true", help="JSON 출력")
    args = parser.parse_args()
    try:
        predictor = Predictor(args.model, args.labels)
        result = predictor.predict(args.image)
        result["initialization_ms"] = predictor.initialization_ms
        print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else result["text"])
        return 0 if result["valid"] else 2
    except Exception as error:
        if args.json:
            print(json.dumps({"valid": False, "error": str(error)}, ensure_ascii=False))
        else:
            print(str(error), file=sys.stderr)
        return 1

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())

