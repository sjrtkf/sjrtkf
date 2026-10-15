"""Local image OCR. No browser, network, keyboard or submission integration."""
from __future__ import annotations

import json
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps


class Predictor:
    def __init__(self, model_path=None, labels_path=None, *, method="filtered", adaptive=True):
        started = perf_counter()
        models = Path(__file__).resolve().parent / "models"
        self.model_path = Path(model_path) if model_path else models / "captcha_solver.onnx"
        self.labels_path = Path(labels_path) if labels_path else models / "labels.json"
        labels_config = json.loads(self.labels_path.read_text(encoding="utf-8"))
        self.labels = labels_config["labels"]
        if method not in ("legacy", "median", "filtered"):
            raise ValueError("지원하지 않는 전처리 방식입니다.")
        if not self.labels or any(not isinstance(x, str) or len(x) != 1 for x in self.labels):
            raise ValueError("모델 문자표 형식이 올바르지 않습니다.")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(str(self.model_path), sess_options=options, providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0]
        output = self.session.get_outputs()[0]
        if self.input.shape[-3:] != [28, 28, 1] or output.shape[-1] != len(self.labels):
            raise ValueError("이미지 모델과 문자표의 입출력 형식이 맞지 않습니다.")
        self.method = method
        self.adaptive = bool(adaptive)
        self.initialization_ms = (perf_counter() - started) * 1000

    @staticmethod
    def read_image(image):
        if isinstance(image, (str, Path)):
            with Image.open(image) as opened:
                Predictor._check_size(opened)
                image = ImageOps.exif_transpose(opened).convert("RGB")
        elif isinstance(image, Image.Image):
            Predictor._check_size(image)
            image = ImageOps.exif_transpose(image).convert("RGB")
        else:
            raise TypeError("이미지 파일 경로 또는 PIL.Image가 필요합니다.")
        return image

    @staticmethod
    def _check_size(image):
        if image.width < 20 or image.height < 15:
            raise ValueError("이미지가 너무 작습니다.")
        if image.width * image.height > 16_000_000:
            raise ValueError("이미지가 너무 큽니다. 보안문자 부분만 잘라서 열어 주세요.")

    @staticmethod
    def _threshold_mask(image, method, threshold=140):
        gray = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
        if method in ("median", "filtered"):
            gray = cv2.medianBlur(gray, 3)
        if threshold == "otsu":
            return cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        return cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)

    @staticmethod
    def _boxes_from_mask(mask, image_width, method):
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        boxes = sorted((cv2.boundingRect(c) for c in contours if cv2.boundingRect(c)[2] > 5 and cv2.boundingRect(c)[3] > 10), key=lambda b: b[0])
        if method == "filtered":
            # The refresh/audio buttons sit at the right edge and off the text line.
            # Keep genuine right-edge letters in tightly cropped input images.
            if boxes:
                center_y = float(np.median([y+h/2 for x,y,w,h in boxes]))
                typical_h = float(np.median([h for x,y,w,h in boxes]))
                boxes = [b for b in boxes if not ((b[0]+b[2]/2) >= image_width*.91
                                                  and abs(b[1]+b[3]/2-center_y) > typical_h*.45)]
            merged = []
            for box in boxes:
                if merged:
                    x,y,w,h = merged[-1]
                    xx,yy,ww,hh = box
                    overlap = max(0, min(y+h,yy+hh)-max(y,yy))
                    gap = xx-(x+w)
                    # Slanted W/M/N may be separated into two nearby components.
                    if gap <= 3 and overlap >= min(h,hh)*.7 and xx+ww-x <= max(h,hh)*1.65:
                        merged[-1] = (x,min(y,yy),max(x+w,xx+ww)-x,max(y+h,yy+hh)-min(y,yy))
                        continue
                merged.append(box)
            boxes = merged
        return boxes

    @staticmethod
    def _segments(image, method, threshold=140):
        # The default remains exactly the original training/evaluation pipeline.
        _, mask = Predictor._threshold_mask(image, method, threshold)
        return mask, Predictor._boxes_from_mask(mask, image.width, method)

    def _predict_segments(self, image, mask, boxes):
        warnings = []
        result = {"text": "", "confidence": 0.0, "characters": [], "warnings": warnings,
                  "method": self.method, "valid": False, "image_size": [image.width, image.height]}
        if len(boxes) != 6:
            warnings.append(f"글자를 6개로 분리하지 못했습니다. 감지한 후보: {len(boxes)}개")
        else:
            batch = np.asarray([cv2.resize(mask[y:y+h, x:x+w], (28, 28)).astype(np.float32) / 255.0
                                for x, y, w, h in boxes], dtype=np.float32)[..., np.newaxis]
            probabilities = np.asarray(self.session.run(None, {self.input.name: batch})[0])
            if probabilities.shape != (6, len(self.labels)) or not np.all(np.isfinite(probabilities)):
                raise ValueError("모델이 예상한 문자 확률을 반환하지 않았습니다.")
            for box, probs in zip(boxes, probabilities):
                index = int(np.argmax(probs))
                result["characters"].append({"char": self.labels[index], "confidence": float(probs[index]),
                                               "box": [int(v) for v in box]})
            result["text"] = "".join(x["char"] for x in result["characters"])
            result["confidence"] = min(x["confidence"] for x in result["characters"])
            result["valid"] = True
            if result["confidence"] < 0.8:
                warnings.append("확신도가 낮은 문자가 있습니다. 원본 이미지와 비교해 확인해 주세요.")
            warnings.append("모델 확률은 실제 정답률을 뜻하지 않습니다.")
        return result

    def predict(self, image):
        started = perf_counter()
        image = self.read_image(image)
        mask, boxes = self._segments(image, self.method)
        result = self._predict_segments(image, mask, boxes)
        if (self.adaptive and self.method == "filtered"
                and (not result["valid"] or result["confidence"] < 0.75)):
            # Only difficult images pay the cost of up to three extra passes.
            # Distinct actual thresholds must agree; repeated Otsu thresholds
            # and the original threshold cannot act as independent votes.
            seen_thresholds = {140.0}
            agreements = {}
            for threshold in (120, 160, "otsu"):
                actual, extra_mask = self._threshold_mask(image, self.method, threshold)
                actual = float(actual)
                if actual in seen_thresholds:
                    continue
                seen_thresholds.add(actual)
                extra_boxes = self._boxes_from_mask(extra_mask, image.width, self.method)
                candidate = self._predict_segments(image, extra_mask, extra_boxes)
                if candidate["valid"] and candidate["confidence"] >= 0.90:
                    agreements.setdefault(candidate["text"], []).append((actual, candidate))
            qualifying = [values for values in agreements.values() if len(values) >= 2]
            if len(qualifying) == 1:
                agreeing = qualifying[0]
                # Keep boxes, character scores, and aggregate confidence from
                # the same conservative candidate instead of mixing passes.
                _, result = min(agreeing, key=lambda pair: pair[1]["confidence"])
                thresholds = ", ".join(f"{value:g}" for value, _ in agreeing)
                result["method"] = "filtered+threshold-consensus"
                result["warnings"].append(
                    f"기본 분석이 불확실하여 임계값 {thresholds}의 6글자 일치 결과를 사용했습니다.")
        result["elapsed_ms"] = (perf_counter() - started) * 1000
        return result

