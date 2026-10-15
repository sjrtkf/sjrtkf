from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from ocr_ui.state import RequestGate, confirmed_label, save_confirmed_sample


class RequestGateTests(unittest.TestCase):
    def test_previous_image_cannot_replace_newer_result(self):
        gate = RequestGate()
        gate.new_image()
        old = gate.request()
        gate.new_image()
        current = gate.request()
        self.assertFalse(gate.current_request(old))
        self.assertFalse(gate.can_replace_text(old))
        self.assertTrue(gate.can_replace_text(current))

    def test_newer_request_for_same_image_wins_and_manual_correction_survives(self):
        gate = RequestGate()
        gate.new_image()
        old = gate.request()
        current = gate.request()
        self.assertFalse(gate.current_request(old))
        gate.edited()
        self.assertTrue(gate.current_request(current))
        self.assertFalse(gate.can_replace_text(current))
        retry = gate.request()
        self.assertTrue(gate.can_replace_text(retry))


class ConfirmedSampleTests(unittest.TestCase):
    def test_label_is_six_ascii_letters_not_a_path(self):
        self.assertEqual(confirmed_label(" abcdef "), "ABCDEF")
        for bad in ["", "ABCDE", "ABCDEFG", "AB12EF", "../ABC", "A/BDEF", "한글입력예시", "ＡＢＣＤＥＦ"]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                confirmed_label(bad)

    def test_image_and_explicit_answer_are_saved_without_source_metadata(self):
        with tempfile.TemporaryDirectory(prefix="local-ocr-confirmed-") as folder:
            image = Image.new("RGB", (100, 30), "white")
            image.info["comment"] = "source metadata should not persist"
            stamp = datetime(2026, 10, 15, 3, 30, 1, 12345, tzinfo=timezone.utc)
            picture, metadata = save_confirmed_sample(image, "abcdef", folder, now=stamp)
            self.assertRegex(picture.name, r"^ABCDEF_\d{8}_\d{6}_\d{6}\.png$")
            self.assertEqual(picture.parent, Path(folder))
            data = json.loads(metadata.read_text(encoding="utf-8"))
            self.assertTrue(data["confirmed_by_user"])
            self.assertEqual(data["answer"], "ABCDEF")
            self.assertEqual(data["image"], picture.name)
            with Image.open(picture) as reopened:
                self.assertEqual(reopened.size, (100, 30))
                self.assertNotIn("comment", reopened.info)

    def test_collision_does_not_overwrite_previous_sample(self):
        with tempfile.TemporaryDirectory(prefix="local-ocr-confirmed-") as folder:
            image = Image.new("RGB", (100, 30), "white")
            stamp = datetime(2026, 10, 15, tzinfo=timezone.utc)
            picture, metadata = save_confirmed_sample(image, "ABCDEF", folder, now=stamp)
            before = picture.read_bytes(), metadata.read_bytes()
            with self.assertRaises(FileExistsError):
                save_confirmed_sample(Image.new("RGB", (80, 20), "black"), "ABCDEF", folder, now=stamp)
            self.assertEqual((picture.read_bytes(), metadata.read_bytes()), before)

    def test_invalid_answer_creates_no_sample_or_directory(self):
        with tempfile.TemporaryDirectory(prefix="local-ocr-confirmed-") as folder:
            target = Path(folder) / "confirmed"
            with self.assertRaises(ValueError):
                save_confirmed_sample(Image.new("RGB", (100, 30)), "wrong-length", target)
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
