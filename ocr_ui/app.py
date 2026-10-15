"""Korean standalone image OCR. Does not access a browser or submit text."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import math
from pathlib import Path
from queue import Empty, Queue
import sys
import time
import tkinter as tk
from tkinter import filedialog, ttk

from PIL import Image, ImageGrab, ImageOps, ImageTk, UnidentifiedImageError

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ocr_ui.state import RequestGate, confirmed_label, save_confirmed_sample


def runtime_directory():
    return Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent


def friendly_error(error, *, model=False):
    if model:
        return "인식 모델을 준비하지 못했습니다. 프로그램의 모델·문자표 파일이 함께 있는지 확인해 주세요."
    if isinstance(error, (UnidentifiedImageError, Image.DecompressionBombError)):
        return "읽을 수 없는 이미지입니다. PNG 또는 JPG 이미지로 다시 열어 주세요."
    if isinstance(error, FileNotFoundError):
        return "이미지 파일을 찾지 못했습니다. 파일 위치를 다시 확인해 주세요."
    if isinstance(error, PermissionError):
        return "파일에 접근할 수 없습니다. 파일 권한과 저장 폴더를 확인해 주세요."
    text = str(error)
    if isinstance(error, ValueError) and any("가" <= char <= "힣" for char in text):
        return text
    return "이미지를 처리하지 못했습니다. 보안문자 부분이 선명한 다른 이미지로 다시 시도해 주세요."


def read_image(source):
    if isinstance(source, Image.Image):
        opened = source
        close = False
    else:
        opened = Image.open(source)
        close = True
    try:
        if opened.width * opened.height > 16_000_000:
            raise ValueError("이미지가 너무 큽니다. 1,600만 화소 이하의 이미지나 보안문자 부분만 열어 주세요.")
        if opened.width < 20 or opened.height < 15:
            raise ValueError("이미지가 너무 작습니다. 20×15픽셀 이상의 이미지를 열어 주세요.")
        return ImageOps.exif_transpose(opened).convert("RGB")
    finally:
        if close:
            opened.close()


class ReaderApp:
    def __init__(self, root, *, model_path=None, labels_path=None, data_directory=None,
                 self_test=False, predictor_factory=None):
        self.root = root
        self.self_test = self_test
        self.data_directory = Path(data_directory) if data_directory else runtime_directory() / "data" / "confirmed"
        self.gate = RequestGate()
        self.events = Queue()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="local-image-reader")
        self.predictor = None
        self.model_ready = False
        self.model_failed = False
        self.busy = False
        self.closed = False
        self.active_image = None
        self.original_image = None
        self.last_result = None
        self.last_error = None
        self.source_name = ""
        self.photo = None
        self.preview_rect = None
        self.crop_box = None
        self.drag_start = None
        self._setting_text = False
        self._after_id = None
        self.text = tk.StringVar()
        self.status = tk.StringVar(value="모델을 준비하고 있습니다. 이미지는 먼저 열어도 됩니다.")
        self.model_status = tk.StringVar(value="모델 준비 중")
        self.image_status = tk.StringVar(value="아직 연 이미지가 없습니다.")
        self.score = tk.StringVar(value="이미지를 열면 여섯 글자를 읽어 표시합니다.")
        self.character_scores = tk.StringVar()
        self._build()
        self.text.trace_add("write", self._text_changed)
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self._poll()
        self.executor.submit(self._load_model, predictor_factory, model_path, labels_path)

    def _build(self):
        self.root.title("보안문자 이미지 읽기 · 로컬 도우미")
        self.root.geometry("640x780")
        self.root.minsize(540, 720)
        self.root.configure(bg="#eef3f9")
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("TFrame", background="#eef3f9")
        style.configure("TLabel", background="#eef3f9", foreground="#253a56", font=("맑은 고딕", 10))
        style.configure("Hint.TLabel", foreground="#596d84", font=("맑은 고딕", 9))
        style.configure("Title.TLabel", font=("맑은 고딕", 18, "bold"), foreground="#173d75")
        style.configure("TButton", font=("맑은 고딕", 10), padding=(10, 7))
        style.configure("Primary.TButton", background="#215fc6", foreground="white")
        style.map("Primary.TButton", background=[("active", "#184fae"), ("disabled", "#bac9df")])
        style.configure("Status.TLabel", foreground="#285b99", font=("맑은 고딕", 10))
        # Keep all actions reachable on smaller Windows displays without hiding
        # the result or save controls below the bottom of the window.
        shell = ttk.Frame(self.root)
        shell.pack(fill="both", expand=True)
        self.content_canvas = tk.Canvas(shell, bg="#eef3f9", highlightthickness=0)
        scrollbar = ttk.Scrollbar(shell, orient="vertical", command=self.content_canvas.yview)
        self.content_canvas.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.content_canvas.pack(side="left", fill="both", expand=True)
        outer = ttk.Frame(self.content_canvas, padding=20)
        self.content_window = self.content_canvas.create_window((0, 0), window=outer, anchor="nw", width=620)
        outer.bind("<Configure>", lambda _event: self.content_canvas.configure(scrollregion=self.content_canvas.bbox("all")))
        def resize_content(event):
            self.content_canvas.itemconfigure(self.content_window, width=event.width)
            for widget in outer.winfo_children():
                if isinstance(widget, ttk.Label) and int(widget.cget("wraplength") or 0):
                    widget.configure(wraplength=max(300, event.width - 40))
        self.content_canvas.bind("<Configure>", resize_content)
        self.root.bind("<MouseWheel>", lambda event: self.content_canvas.yview_scroll(-int(event.delta / 120), "units"))
        ttk.Label(outer, text="이미지의 여섯 글자를 확인하세요", style="Title.TLabel").pack(anchor="w")
        ttk.Label(outer, text="이미지와 모델은 이 PC에서만 처리합니다. 결과는 직접 확인하고 복사하세요.",
                  style="Hint.TLabel", wraplength=570).pack(anchor="w", pady=(6, 14))
        toolbar = ttk.Frame(outer)
        toolbar.pack(fill="x")
        ttk.Button(toolbar, text="이미지 열기", style="Primary.TButton", command=self.open_image).pack(side="left")
        ttk.Button(toolbar, text="클립보드 이미지", command=self.paste_image).pack(side="left", padx=8)
        ttk.Label(toolbar, textvariable=self.model_status, style="Hint.TLabel").pack(side="right")
        ttk.Label(outer, textvariable=self.image_status, style="Hint.TLabel", wraplength=570).pack(anchor="w", pady=(10, 5))
        self.canvas = tk.Canvas(outer, width=596, height=190, bg="#dfe7f2", highlightthickness=1,
                                highlightbackground="#c5d2e3", cursor="crosshair")
        self.canvas.pack(fill="x")
        self.canvas.bind("<Configure>", lambda _event: self.draw_preview())
        self.canvas.bind("<ButtonPress-1>", self.drag_begin)
        self.canvas.bind("<B1-Motion>", self.drag_move)
        self.canvas.bind("<ButtonRelease-1>", self.drag_end)
        ttk.Label(outer, text="필요하면 이미지에서 문자 부분을 드래그한 뒤 선택 영역을 읽으세요.",
                  style="Hint.TLabel", wraplength=570).pack(anchor="w", pady=(5, 7))
        crop_row = ttk.Frame(outer)
        crop_row.pack(fill="x")
        self.crop_button = ttk.Button(crop_row, text="선택 영역 읽기", command=self.read_crop, state="disabled")
        self.crop_button.pack(side="left")
        self.restore_button = ttk.Button(crop_row, text="원본으로", command=self.restore_original, state="disabled")
        self.restore_button.pack(side="left", padx=8)
        self.retry_button = ttk.Button(crop_row, text="다시 읽기", command=self.recognize, state="disabled")
        self.retry_button.pack(side="right")
        ttk.Separator(outer).pack(fill="x", pady=14)
        ttk.Label(outer, text="읽은 글자 · 틀린 글자는 직접 고칠 수 있어요").pack(anchor="w")
        self.result_entry = tk.Entry(outer, textvariable=self.text, font=("Consolas", 29, "bold"), justify="center",
                                     bg="white", fg="#173d75", relief="flat", highlightthickness=1,
                                     highlightbackground="#c5d2e3", highlightcolor="#215fc6")
        self.result_entry.pack(fill="x", ipady=8, pady=(7, 8))
        ttk.Label(outer, textvariable=self.score, wraplength=570).pack(anchor="w")
        ttk.Label(outer, textvariable=self.character_scores, style="Hint.TLabel", wraplength=570).pack(anchor="w", pady=(4, 4))
        ttk.Label(outer, text="모델 점수는 실제 정답률이 아닙니다. 높은 점수라도 원본과 비교하세요.",
                  style="Hint.TLabel", wraplength=570).pack(anchor="w", pady=(0, 10))
        actions = ttk.Frame(outer)
        actions.pack(fill="x")
        self.copy_button = ttk.Button(actions, text="여섯 글자 복사", style="Primary.TButton", command=self.copy_result, state="disabled")
        self.copy_button.pack(side="left", fill="x", expand=True)
        self.save_button = ttk.Button(actions, text="정답으로 저장", command=self.save_answer, state="disabled")
        self.save_button.pack(side="left", fill="x", expand=True, padx=(8, 0))
        ttk.Label(outer, text="‘정답으로 저장’을 누를 때만 현재 이미지와 수정한 정답을 저장합니다.",
                  style="Hint.TLabel", wraplength=570).pack(anchor="w", pady=(7, 10))
        ttk.Label(outer, textvariable=self.status, style="Status.TLabel", wraplength=570).pack(anchor="w", fill="x")
        ttk.Label(outer, text="브라우저 연결 · 자동 입력 · 제출 기능은 없습니다.",
                  style="Hint.TLabel").pack(side="bottom", anchor="w", pady=(10, 0))

    def _load_model(self, factory, model_path, labels_path):
        try:
            if factory is None:
                from ocr.core import Predictor
                factory = Predictor
            self.predictor = factory(model_path, labels_path)
            self.events.put(("model", None, self.predictor.initialization_ms))
        except Exception as error:
            self.events.put(("model_error", None, error))

    def _predict(self, token, image):
        if not self.gate.current_request(token):
            return
        try:
            if self.predictor is None:
                raise ValueError("모델을 준비하지 못해 읽을 수 없습니다. 파일 구성을 확인한 뒤 프로그램을 다시 실행해 주세요.")
            self.events.put(("result", token, self.predictor.predict(image)))
        except Exception as error:
            self.events.put(("error", token, error))

    def _poll(self):
        if self.closed:
            return
        try:
            while True:
                kind, token, value = self.events.get_nowait()
                if kind == "model":
                    self.model_ready = True
                    self.model_status.set("모델 준비됨")
                    if not self.busy:
                        self.status.set("이미지를 열거나 클립보드에서 가져오세요.")
                elif kind == "model_error":
                    self.model_failed = True
                    self.model_status.set("모델 확인 필요")
                    self.status.set(friendly_error(value, model=True))
                elif self.gate.current_request(token):
                    self.busy = False
                    if kind == "error":
                        self.last_error = friendly_error(value)
                        self.status.set(self.last_error)
                        self.score.set("확인 필요 · 읽기에 실패했습니다. 직접 입력할 수 있습니다.")
                    else:
                        self.last_result = value
                        if self.gate.can_replace_text(token):
                            self._set_text(value.get("text", ""))
                        self._show_result(value, edited=not self.gate.can_replace_text(token))
                    self._update_buttons()
        except Empty:
            pass
        self._after_id = self.root.after(40, self._poll)

    def _show_result(self, result, *, edited=False):
        minimum = max(0.0, min(1.0, float(result.get("confidence", 0.0))))
        valid = bool(result.get("valid"))
        prefix = "확인 필요" if not valid or minimum < 0.8 else "읽기 완료 · 원본과 대조하세요"
        self.score.set(f"{prefix} · 최소 문자 점수 {minimum:.1%} · {result.get('elapsed_ms', 0):.0f}ms")
        chars = result.get("characters", [])
        self.character_scores.set("    ".join(f"{item['char']} {item['confidence']:.0%}" for item in chars))
        warnings = [str(item) for item in result.get("warnings", []) if "실제 정답률" not in str(item)]
        self.status.set("직접 수정한 글자를 유지했습니다. 모델 제안: " + str(result.get("text", "")) if edited else
                        " · ".join(warnings) if warnings else "원본과 결과를 비교한 뒤 복사하세요. 저장은 선택 사항입니다.")
        self.draw_preview()

    def _set_text(self, value):
        self._setting_text = True
        try:
            self.text.set(str(value))
        finally:
            self._setting_text = False

    def _text_changed(self, *_):
        if not self._setting_text:
            self.gate.edited()
            if self.last_result and self.text.get().strip().upper() != self.last_result.get("text", ""):
                self.score.set("직접 수정됨 · 아래 문자 점수는 수정 전 모델 제안의 점수입니다.")
        self._update_buttons()

    def _update_buttons(self):
        valid = False
        try:
            confirmed_label(self.text.get())
            valid = True
        except ValueError:
            pass
        self.copy_button.configure(state="normal" if valid else "disabled")
        self.save_button.configure(state="normal" if valid and self.active_image is not None else "disabled")
        self.retry_button.configure(state="normal" if self.active_image is not None and not self.busy and not self.model_failed else "disabled")
        self.crop_button.configure(state="normal" if self.crop_box else "disabled")
        self.restore_button.configure(state="normal" if self.original_image is not None and self.active_image is not self.original_image else "disabled")

    def open_image(self):
        path = filedialog.askopenfilename(parent=self.root, title="문자를 읽을 이미지 선택",
                                         filetypes=[("이미지", "*.png *.jpg *.jpeg *.bmp *.webp *.gif"), ("모든 파일", "*.*")])
        if path:
            self.load_path(path)

    def load_path(self, path):
        try:
            image = read_image(path)
        except Exception as error:
            self.status.set(friendly_error(error))
            return False
        self.source_name = Path(path).name
        self.original_image = image
        self._use_image(image)
        return True

    def paste_image(self):
        try:
            image = ImageGrab.grabclipboard()
            if not isinstance(image, Image.Image):
                raise ValueError("클립보드에 이미지가 없습니다. 문자 이미지나 캡처한 이미지를 먼저 복사해 주세요.")
            image = read_image(image)
        except Exception as error:
            self.status.set(friendly_error(error))
            return
        self.source_name = "클립보드 이미지"
        self.original_image = image
        self._use_image(image)

    def _use_image(self, image):
        self.gate.new_image()
        self.active_image = image
        self.last_result = None
        self.last_error = None
        self.crop_box = None
        self.drag_start = None
        self._set_text("")
        self.character_scores.set("")
        crop = " · 선택 영역" if image is not self.original_image else ""
        self.image_status.set(f"{self.source_name}{crop} · {image.width} × {image.height}px")
        self.draw_preview()
        self.recognize()

    def recognize(self):
        if self.active_image is None:
            return
        token = self.gate.request()
        self.busy = True
        self.last_error = None
        self.last_result = None
        self.score.set("읽는 중입니다. 다른 이미지를 열어도 이전 결과가 덮어쓰지 않습니다.")
        self.status.set("모델 준비 후 이미지를 읽습니다." if not self.model_ready else "이미지를 읽고 있습니다.")
        self.executor.submit(self._predict, token, self.active_image.copy())
        self._update_buttons()

    def draw_preview(self):
        if self.closed:
            return
        self.canvas.delete("all")
        if self.active_image is None:
            self.canvas.create_text(max(self.canvas.winfo_width(), 200) / 2, 92, text="이미지를 열어 주세요", fill="#61748f", font=("맑은 고딕", 12))
            return
        width = self.canvas.winfo_width() if self.canvas.winfo_width() > 1 else int(self.canvas.cget("width"))
        height = self.canvas.winfo_height() if self.canvas.winfo_height() > 1 else int(self.canvas.cget("height"))
        image = self.active_image
        scale = min((width - 20) / image.width, (height - 20) / image.height, 4.0)
        shown_w, shown_h = max(1, round(image.width * scale)), max(1, round(image.height * scale))
        x, y = (width - shown_w) / 2, (height - shown_h) / 2
        self.preview_rect = (x, y, shown_w, shown_h)
        self.photo = ImageTk.PhotoImage(image.resize((shown_w, shown_h), Image.Resampling.LANCZOS), master=self.root)
        self.canvas.create_image(x, y, image=self.photo, anchor="nw")
        for item in (self.last_result or {}).get("characters", []):
            bx, by, bw, bh = item["box"]
            color = "#c08000" if item["confidence"] < .8 else "#14846e"
            self.canvas.create_rectangle(x + bx * shown_w / image.width, y + by * shown_h / image.height,
                                         x + (bx + bw) * shown_w / image.width, y + (by + bh) * shown_h / image.height,
                                         outline=color, width=2)
        if self.crop_box:
            left, top, right, bottom = self.crop_box
            self.canvas.create_rectangle(x + left * shown_w / image.width, y + top * shown_h / image.height,
                                         x + right * shown_w / image.width, y + bottom * shown_h / image.height,
                                         outline="#215fc6", width=2, dash=(5, 3), tags="selection")

    def _image_point(self, x, y):
        if self.active_image is None or self.preview_rect is None:
            return None
        px, py, width, height = self.preview_rect
        return (max(0, min(self.active_image.width, (x - px) * self.active_image.width / width)),
                max(0, min(self.active_image.height, (y - py) * self.active_image.height / height)))

    def drag_begin(self, event):
        self.drag_start = self._image_point(event.x, event.y)
        self.crop_box = None
        self.canvas.delete("selection")
        self._update_buttons()

    def drag_move(self, event):
        point = self._image_point(event.x, event.y)
        if self.drag_start is None or point is None:
            return
        ax, ay = self.drag_start
        bx, by = point
        self.crop_box = (math.floor(min(ax, bx)), math.floor(min(ay, by)), math.ceil(max(ax, bx)), math.ceil(max(ay, by)))
        self.draw_preview()

    def drag_end(self, event):
        self.drag_move(event)
        self.drag_start = None
        if self.crop_box:
            x0, y0, x1, y1 = self.crop_box
            if x1 - x0 < 20 or y1 - y0 < 15:
                self.crop_box = None
                self.status.set("선택 영역이 너무 작습니다. 문자 여섯 개가 모두 들어오도록 선택하세요.")
                self.draw_preview()
        self._update_buttons()

    def read_crop(self):
        if self.active_image is not None and self.crop_box:
            self._use_image(self.active_image.crop(self.crop_box))

    def restore_original(self):
        if self.original_image is not None:
            self._use_image(self.original_image)

    def copy_result(self):
        try:
            answer = confirmed_label(self.text.get())
        except ValueError as error:
            self.status.set(str(error))
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(answer)
        self.status.set(f"{answer} 복사 완료 · 원하는 곳에 직접 붙여넣으세요.")

    def save_answer(self):
        try:
            image_path, _ = save_confirmed_sample(self.active_image, self.text.get(), self.data_directory)
        except FileExistsError:
            self.status.set("같은 이름의 저장 파일이 있습니다. 다시 저장해 주세요. 기존 파일은 보존했습니다.")
            return
        except OSError:
            self.status.set("정답 파일을 저장하지 못했습니다. 프로그램 옆 data/confirmed 폴더의 쓰기 권한과 여유 공간을 확인해 주세요.")
            return
        except Exception as error:
            self.status.set(friendly_error(error))
            return
        self.status.set("정답으로 저장했습니다: " + str(image_path))

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.gate.new_image()
        if self._after_id is not None:
            self.root.after_cancel(self._after_id)
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.root.destroy()


def run_self_test(samples, *, model=None, labels=None):
    report = {"passed": False, "scope": "로컬 이미지·숨긴 Tk GUI만 검증. 브라우저·클립보드·자동 입력·저장 없음.", "samples": []}
    root = tk.Tk()
    root.withdraw()
    app = ReaderApp(root, model_path=model, labels_path=labels, self_test=True)
    try:
        root.update_idletasks()
        for sample in samples:
            if not app.load_path(sample):
                raise AssertionError(app.status.get())
            deadline = time.monotonic() + 30
            while app.busy and time.monotonic() < deadline:
                root.update()
                time.sleep(.01)
            if app.busy or app.last_error or app.last_result is None:
                raise AssertionError(app.last_error or "모델 응답 제한 시간을 넘겼습니다.")
            root.update_idletasks()
            assert root.state() == "withdrawn", "자가검증 중 창을 표시하지 않아야 합니다."
            assert app.photo is not None and app.preview_rect is not None, "미리보기를 렌더링하지 못했습니다."
            assert app.text.get() == app.last_result.get("text", ""), "인식 결과 표시가 다릅니다."
            report["samples"].append({"file": Path(sample).name, "text": app.text.get(), "valid": app.last_result["valid"],
                                      "confidence": app.last_result["confidence"], "elapsed_ms": app.last_result["elapsed_ms"],
                                      "image_size": list(app.active_image.size), "preview_rendered": True})
        report["initialization_ms"] = app.predictor.initialization_ms
        report["window_visible"] = False
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
    finally:
        app.close()
    return report


def main():
    parser = argparse.ArgumentParser(description="이미지 파일을 읽고 결과를 직접 확인하는 로컬 프로그램입니다.")
    parser.add_argument("--model")
    parser.add_argument("--labels")
    parser.add_argument("--self-test", nargs="+", metavar="IMAGE")
    parser.add_argument("--report", help="자가검증 결과 JSON 저장 경로")
    args = parser.parse_args()
    if args.self_test:
        report = run_self_test(args.self_test, model=args.model, labels=args.labels)
        payload = json.dumps(report, ensure_ascii=False, indent=2)
        if args.report:
            Path(args.report).write_text(payload, encoding="utf-8")
        if sys.stdout:
            if hasattr(sys.stdout, "reconfigure"):
                sys.stdout.reconfigure(encoding="utf-8")
            print(payload)
        return 0 if report["passed"] else 1
    root = tk.Tk()
    ReaderApp(root, model_path=args.model, labels_path=args.labels)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
