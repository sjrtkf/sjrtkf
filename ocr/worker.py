"""Memory-only JSONL OCR worker. stdout is reserved for protocol messages."""
from __future__ import annotations

import base64
import binascii
from contextlib import redirect_stdout
from io import BytesIO
import json
import re
import sys
from time import perf_counter

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_ENCODED_BYTES = 4 * ((MAX_IMAGE_BYTES + 2) // 3)
MAX_REQUEST_BYTES = MAX_ENCODED_BYTES + 1024
MAX_IMAGE_PIXELS = 4_000_000
DATA_URL = re.compile(r"\Adata:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})\Z")
REQUEST_ID = re.compile(r"\A[A-Za-z0-9_-]{1,100}\Z")
ERROR_MESSAGES = {
    "IMAGE_DATA_INVALID": "PNG, JPEG, WebP의 base64 이미지 데이터가 필요합니다.",
    "IMAGE_BASE64_INVALID": "이미지 base64 형식이 올바르지 않습니다.",
    "IMAGE_TOO_LARGE": "이미지 파일은 2 MiB 이하여야 합니다.",
    "IMAGE_TYPE_UNSUPPORTED": "실제 이미지 파일이 PNG, JPEG, WebP 형식이 아닙니다.",
    "IMAGE_SIZE_INVALID": "보안문자 이미지 크기가 허용 범위를 벗어났습니다.",
    "IMAGE_ANIMATED": "움직이는 이미지 대신 정지 이미지를 사용해 주세요.",
    "IMAGE_DECODE_FAILED": "이미지 데이터를 읽을 수 없습니다.",
    "MODEL_INFERENCE_FAILED": "이미지는 읽었지만 모델이 보안문자를 인식하지 못했습니다.",
}


class WorkerError(ValueError):
    """Fixed, non-sensitive protocol error with a stable reason code."""

    def __init__(self, code):
        self.code = code
        super().__init__(ERROR_MESSAGES[code])


def decode_image(data_url):
    if not isinstance(data_url, str):
        raise WorkerError("IMAGE_DATA_INVALID")
    if len(data_url) > MAX_ENCODED_BYTES + 64:
        raise WorkerError("IMAGE_TOO_LARGE")
    match = DATA_URL.fullmatch(data_url)
    if not match or not match.group(2):
        raise WorkerError("IMAGE_DATA_INVALID")
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as error:
        raise WorkerError("IMAGE_BASE64_INVALID") from error
    if not raw:
        raise WorkerError("IMAGE_DATA_INVALID")
    if len(raw) > MAX_IMAGE_BYTES:
        raise WorkerError("IMAGE_TOO_LARGE")
    try:
        with Image.open(BytesIO(raw)) as opened:
            # Some displayed site images declare JPEG while carrying PNG bytes.
            # Trust the decoded format, retaining a strict actual-format allowlist.
            if opened.format not in {"PNG", "JPEG", "WEBP"}:
                raise WorkerError("IMAGE_TYPE_UNSUPPORTED")
            if (opened.width < 20 or opened.height < 15 or opened.width > 4096
                    or opened.height > 4096 or opened.width * opened.height > MAX_IMAGE_PIXELS):
                raise WorkerError("IMAGE_SIZE_INVALID")
            if getattr(opened, "n_frames", 1) != 1:
                raise WorkerError("IMAGE_ANIMATED")
            return ImageOps.exif_transpose(opened).convert("RGB")
    except Image.DecompressionBombError as error:
        raise WorkerError("IMAGE_SIZE_INVALID") from error
    except (UnidentifiedImageError, OSError) as error:
        raise WorkerError("IMAGE_DECODE_FAILED") from error


def emit(stream, message):
    stream.write(json.dumps(message, ensure_ascii=True, allow_nan=False, separators=(",", ":")) + "\n")
    stream.flush()


def handle_request(request, predictor):
    if not isinstance(request, dict):
        raise ValueError("요청 형식이 올바르지 않습니다.")
    identifier = request.get("id")
    if not isinstance(identifier, str) or not REQUEST_ID.fullmatch(identifier):
        raise ValueError("요청 ID가 올바르지 않습니다.")
    operation = request.get("op")
    if operation == "cancel":
        # Inference is synchronous and brief. The client drops canceled IDs;
        # cancellation acknowledgement never carries an image or OCR result.
        return {"type": "cancelled", "id": identifier}
    if operation != "recognize":
        raise ValueError("지원하지 않는 요청입니다.")
    image = decode_image(request.get("image"))
    try:
        with redirect_stdout(sys.stderr):
            result = predictor.predict(image)
    except Exception as error:
        raise WorkerError("MODEL_INFERENCE_FAILED") from error
    return {"type": "result", "id": identifier, "result": result}


def serve(predictor, source, target, initialization_ms=0.0):
    emit(target, {"type": "ready", "protocol": 1, "initialization_ms": initialization_ms})
    while True:
        line = source.readline(MAX_REQUEST_BYTES + 1)
        if not line:
            return
        if len(line) > MAX_REQUEST_BYTES or not line.endswith("\n"):
            emit(target, {"type": "fatal", "code": "REQUEST_TOO_LARGE", "message": "요청 크기 제한을 초과했습니다."})
            return
        identifier = None
        try:
            request = json.loads(line)
            if isinstance(request, dict) and isinstance(request.get("id"), str) and REQUEST_ID.fullmatch(request["id"]):
                identifier = request["id"]
            response = handle_request(request, predictor)
        except WorkerError as error:
            response = {"type": "error", "id": identifier, "code": error.code, "message": str(error)}
        except (ValueError, TypeError, json.JSONDecodeError):
            response = {"type": "error", "id": identifier, "code": "INVALID_REQUEST", "message": "요청 형식이 올바르지 않습니다."}
        except Exception:
            # Do not include input data, file paths, tracebacks or OCR text.
            response = {"type": "error", "id": identifier, "code": "OCR_FAILED", "message": "보안문자를 인식하지 못했습니다."}
        emit(target, response)


def main():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="strict")
    try:
        started = perf_counter()
        with redirect_stdout(sys.stderr):
            import numpy as np
            from ocr.core import Predictor
            predictor = Predictor()
            # Force the ONNX execution path to initialize before declaring ready.
            predictor.session.run(None, {predictor.input.name: np.zeros((6, 28, 28, 1), dtype=np.float32)})
        serve(predictor, sys.stdin, sys.stdout, (perf_counter() - started) * 1000)
        return 0
    except Exception:
        emit(sys.stdout, {"type": "fatal", "code": "INITIALIZATION_FAILED", "message": "인식 모델을 시작하지 못했습니다. 프로그램 폴더를 확인해 주세요."})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
