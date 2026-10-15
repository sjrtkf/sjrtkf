"""Small, testable state and explicit confirmed-sample persistence."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import re
from threading import Lock

from PIL import Image


def confirmed_label(value: str) -> str:
    label = str(value).strip().upper()
    if not re.fullmatch(r"[A-Z]{6}", label):
        raise ValueError("정답은 영문 대문자 A~Z 여섯 자리로 입력해 주세요.")
    return label


class RequestGate:
    """A newer image/request or manual edit invalidates an earlier result."""

    def __init__(self):
        self._lock = Lock()
        self._image = 0
        self._request = 0
        self._edit = 0

    def new_image(self):
        with self._lock:
            self._image += 1
            self._edit = 0

    def request(self):
        with self._lock:
            self._request += 1
            return self._image, self._request, self._edit

    def edited(self):
        with self._lock:
            self._edit += 1

    def current_request(self, token):
        with self._lock:
            return tuple(token[:2]) == (self._image, self._request)

    def can_replace_text(self, token):
        with self._lock:
            return tuple(token) == (self._image, self._request, self._edit)


def save_confirmed_sample(image: Image.Image, answer: str, directory, *, now=None):
    """Save only after an explicit user action; never overwrite existing samples."""
    label = confirmed_label(answer)
    if not isinstance(image, Image.Image):
        raise ValueError("저장할 이미지를 먼저 열어 주세요.")
    stamp = now or datetime.now(timezone.utc)
    stem = f"{label}_{stamp.strftime('%Y%m%d_%H%M%S_%f')}"
    directory = Path(directory)
    image_path = directory / f"{stem}.png"
    metadata_path = directory / f"{stem}.json"
    metadata = {"answer": label, "confirmed_by_user": True,
                "created_at": stamp.isoformat(), "image": image_path.name,
                "image_size": list(image.size)}
    directory.mkdir(parents=True, exist_ok=True)
    created = []
    try:
        # A fresh image removes original file metadata from the saved sample.
        clean = Image.new("RGB", image.size, "white")
        clean.paste(image.convert("RGB"))
        with image_path.open("xb") as target:
            created.append(image_path)
            clean.save(target, format="PNG")
        with metadata_path.open("x", encoding="utf-8") as target:
            created.append(metadata_path)
            json.dump(metadata, target, ensure_ascii=False, indent=2)
    except BaseException:
        for item in reversed(created):
            item.unlink(missing_ok=True)
        raise
    return image_path, metadata_path
