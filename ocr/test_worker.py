import base64
from io import BytesIO, StringIO
import json
import unittest

from PIL import Image

from ocr.worker import decode_image, handle_request, serve, MAX_REQUEST_BYTES, WorkerError


def image_url(size=(100, 40), fmt="PNG"):
    image = Image.new("RGB", size, "black")
    stream = BytesIO()
    image.save(stream, format=fmt)
    mime = {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp"}[fmt]
    return "data:image/" + mime + ";base64," + base64.b64encode(stream.getvalue()).decode("ascii")


class FakePredictor:
    def __init__(self):
        self.images = []

    def predict(self, image):
        self.images.append(image)
        return {"text": "ABCDEF", "valid": True, "confidence": 0.9}


class WorkerTests(unittest.TestCase):
    def test_three_supported_images_decode_in_memory(self):
        for fmt in ("PNG", "JPEG", "WEBP"):
            with self.subTest(fmt=fmt):
                image = decode_image(image_url(fmt=fmt))
                self.assertEqual(image.size, (100, 40))
                self.assertEqual(image.mode, "RGB")

    def test_rejects_remote_files_and_bad_base64(self):
        for value in (None, "https://example/image.png", "file:///image.png", "data:image/png;base64,!!!",
                      "data:image/png;base64,YQ=="):
            with self.subTest(value=str(value)[:40]), self.assertRaises(ValueError):
                decode_image(value)

    def test_supported_actual_formats_decode_despite_incorrect_declared_mime(self):
        for actual in ("PNG", "JPEG", "WEBP"):
            picture = image_url(fmt=actual)
            payload = picture.split(";base64,", 1)[1]
            for declared in ("png", "jpeg", "webp"):
                with self.subTest(actual=actual, declared=declared):
                    image = decode_image("data:image/" + declared + ";base64," + payload)
                    self.assertEqual(image.size, (100, 40))
                    self.assertEqual(image.mode, "RGB")

    def test_allowed_mime_does_not_bypass_actual_format_allowlist(self):
        stream = BytesIO()
        Image.new("RGB", (100, 40), "black").save(stream, format="GIF")
        value = "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode("ascii")
        with self.assertRaises(WorkerError) as caught:
            decode_image(value)
        self.assertEqual(caught.exception.code, "IMAGE_TYPE_UNSUPPORTED")

    def test_animated_png_is_rejected_even_with_allowed_mime(self):
        stream = BytesIO()
        Image.new("RGB", (100, 40), "black").save(
            stream, format="PNG", save_all=True,
            append_images=[Image.new("RGB", (100, 40), "white")], duration=100, loop=0)
        value = "data:image/jpeg;base64," + base64.b64encode(stream.getvalue()).decode("ascii")
        with self.assertRaises(WorkerError) as caught:
            decode_image(value)
        self.assertEqual(caught.exception.code, "IMAGE_ANIMATED")

    def test_size_limits_checked_before_pixel_decode(self):
        for size in ((19, 40), (100, 14), (4097, 20), (2001, 2000)):
            with self.subTest(size=size), self.assertRaises(WorkerError) as caught:
                decode_image(image_url(size=size))
            self.assertEqual(caught.exception.code, "IMAGE_SIZE_INVALID")

    def test_image_errors_have_specific_safe_protocol_codes(self):
        cases = [(None, "IMAGE_DATA_INVALID"),
                 ("data:image/png;base64,YQ", "IMAGE_BASE64_INVALID"),
                 ("data:image/png;base64,YQ==", "IMAGE_DECODE_FAILED"),
                 (image_url(size=(19, 40)), "IMAGE_SIZE_INVALID")]
        source = StringIO("".join(json.dumps({"id": f"case{index}", "op": "recognize", "image": value}) + "\n"
                                 for index, (value, _) in enumerate(cases)))
        target = StringIO()
        predictor = FakePredictor()
        serve(predictor, source, target)
        messages = [json.loads(line) for line in target.getvalue().splitlines()][1:]
        self.assertEqual([message["code"] for message in messages], [code for _, code in cases])
        self.assertEqual(predictor.images, [])

    def test_model_exception_is_distinguished_without_leaking_its_message(self):
        class BrokenPredictor:
            def predict(self, image):
                raise ValueError("private path or image contents")

        source = StringIO(json.dumps({"id": "model", "op": "recognize", "image": image_url()}) + "\n")
        target = StringIO()
        serve(BrokenPredictor(), source, target)
        result = json.loads(target.getvalue().splitlines()[-1])
        self.assertEqual(result["code"], "MODEL_INFERENCE_FAILED")
        self.assertEqual(result["id"], "model")
        self.assertNotIn("private", target.getvalue())

    def test_id_and_operation_are_validated_without_inference(self):
        predictor = FakePredictor()
        for request in ([], {}, {"id": "a/../b", "op": "recognize"}, {"id": "ok", "op": "open"}):
            with self.subTest(request=request), self.assertRaises(ValueError):
                handle_request(request, predictor)
        self.assertEqual(predictor.images, [])
        self.assertEqual(handle_request({"id": "ok", "op": "cancel"}, predictor), {"type": "cancelled", "id": "ok"})

    def test_ready_and_requests_are_jsonl_with_correlated_errors_and_no_image_echo(self):
        picture = image_url()
        source = StringIO("\n".join((json.dumps({"id": "one", "op": "recognize", "image": picture}),
                                    json.dumps({"id": "two", "op": "recognize", "image": "bad"}), "{}")) + "\n")
        target = StringIO()
        predictor = FakePredictor()
        serve(predictor, source, target, 10.5)
        messages = [json.loads(line) for line in target.getvalue().splitlines()]
        self.assertEqual([message["type"] for message in messages], ["ready", "result", "error", "error"])
        self.assertEqual(messages[0]["protocol"], 1)
        self.assertEqual(messages[1]["id"], "one")
        self.assertEqual(messages[1]["result"]["text"], "ABCDEF")
        self.assertEqual(messages[2]["id"], "two")
        self.assertNotIn(picture, target.getvalue())
        self.assertEqual(len(predictor.images), 1)

    def test_oversized_line_stops_without_model_call(self):
        predictor = FakePredictor()
        target = StringIO()
        serve(predictor, StringIO("x" * (MAX_REQUEST_BYTES + 2) + "\n"), target)
        messages = [json.loads(line) for line in target.getvalue().splitlines()]
        self.assertEqual(messages[-1]["code"], "REQUEST_TOO_LARGE")
        self.assertEqual(predictor.images, [])


if __name__ == "__main__":
    unittest.main()
