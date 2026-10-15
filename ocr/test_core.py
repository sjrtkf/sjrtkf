"""Fast deterministic safeguards for threshold fallback; no corpus/model files."""
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

from ocr.core import Predictor


LABELS = list("ABCDEKLMNPQRSTUWXZ")


def probabilities(text, confidence):
    result = np.full((6, len(LABELS)), (1.0 - confidence) / (len(LABELS) - 1), dtype=np.float32)
    for index, character in enumerate(text):
        result[index, LABELS.index(character)] = confidence
    return result


def mask(count=6, shift=0):
    result = np.zeros((70, 210), dtype=np.uint8)
    for index in range(count):
        result[20:38, 10 + index * 28 + shift:18 + index * 28 + shift] = 255
    return result


class FakeSession:
    def __init__(self, values):
        self.values = list(values)
        self.calls = []

    def run(self, unused, inputs):
        self.calls.append(inputs['input'].copy())
        if not self.values:
            raise AssertionError('Unexpected extra inference')
        return [self.values.pop(0)]


def predictor(values, *, adaptive=True, method='filtered'):
    result = Predictor.__new__(Predictor)
    result.labels = LABELS
    result.input = SimpleNamespace(name='input')
    result.session = FakeSession(values)
    result.adaptive = adaptive
    result.method = method
    return result


class AdaptiveCoreTests(unittest.TestCase):
    def setUp(self):
        self.image = Image.new('RGB', (210, 70))

    def run_with_masks(self, model, base_count=6, otsu=105):
        masks = {140: (140, mask(base_count)), 120: (120, mask(shift=1)),
                 160: (160, mask(shift=2)), 'otsu': (otsu, mask(shift=3))}
        with patch.object(Predictor, '_threshold_mask', side_effect=lambda image, method, threshold=140: masks[threshold]) as operation:
            result = model.predict(self.image)
        return result, operation

    def test_confident_fast_path_has_one_inference_and_no_extra_thresholds(self):
        model = predictor([probabilities('ABCDEK', .75)])
        result, operation = self.run_with_masks(model)
        self.assertEqual(result['text'], 'ABCDEK')
        self.assertEqual(result['method'], 'filtered')
        self.assertEqual(operation.call_count, 1)
        self.assertEqual(len(model.session.calls), 1)

    def test_disabled_adaptive_and_other_methods_keep_single_pass(self):
        for adaptive, method in ((False, 'filtered'), (True, 'legacy'), (True, 'median')):
            with self.subTest(adaptive=adaptive, method=method):
                model = predictor([probabilities('ABCDEK', .60)], adaptive=adaptive, method=method)
                result, operation = self.run_with_masks(model)
                self.assertEqual(result['method'], method)
                self.assertAlmostEqual(result['confidence'], .60, places=5)
                self.assertEqual(operation.call_count, 1)
                self.assertEqual(len(model.session.calls), 1)

    def test_one_confident_alternative_is_rejected(self):
        model = predictor([probabilities('ABCDEK', .60), probabilities('WNNWNE', .99),
                           probabilities('WNNWNE', .89), probabilities('WNNWNE', .89)])
        result, operation = self.run_with_masks(model)
        self.assertEqual(result['text'], 'ABCDEK')
        self.assertEqual(result['method'], 'filtered')
        self.assertEqual(operation.call_count, 4)
        self.assertEqual(len(model.session.calls), 4)

    def test_disagreeing_alternatives_do_not_replace_base(self):
        model = predictor([probabilities('ABCDEK', .60), probabilities('WNNWNE', .99),
                           probabilities('WNNWNA', .99), probabilities('WNNWNB', .99)])
        result, _ = self.run_with_masks(model)
        self.assertEqual(result['text'], 'ABCDEK')
        self.assertEqual(result['method'], 'filtered')

    def test_two_threshold_consensus_uses_one_complete_conservative_result(self):
        model = predictor([probabilities('ABCDEK', .60), probabilities('WNNWNE', .99),
                           probabilities('WNNWNE', .95), probabilities('WNNWNB', .99)])
        with patch('ocr.core.perf_counter', side_effect=[10.0, 10.025]):
            result, _ = self.run_with_masks(model)
        self.assertEqual(result['text'], 'WNNWNE')
        self.assertTrue(result['valid'])
        self.assertEqual(result['method'], 'filtered+threshold-consensus')
        self.assertEqual(result['image_size'], [210, 70])
        self.assertEqual(len(result['characters']), 6)
        self.assertAlmostEqual(result['confidence'], .95, places=5)
        self.assertEqual(result['confidence'], min(c['confidence'] for c in result['characters']))
        self.assertEqual(result['characters'][0]['box'], [12, 20, 8, 18])
        self.assertEqual(''.join(c['char'] for c in result['characters']), result['text'])
        self.assertTrue(any('120, 160' in warning for warning in result['warnings']))
        self.assertAlmostEqual(result['elapsed_ms'], 25.0)

    def test_invalid_base_can_be_recovered_without_inference_on_bad_segments(self):
        model = predictor([probabilities('WNNWNE', .99), probabilities('WNNWNE', .95),
                           probabilities('WNNWNB', .99)])
        result, _ = self.run_with_masks(model, base_count=5)
        self.assertEqual(result['text'], 'WNNWNE')
        self.assertEqual(len(model.session.calls), 3)
        self.assertFalse(any('분리하지 못했습니다' in warning for warning in result['warnings']))

    def test_invalid_base_stays_invalid_without_confident_consensus(self):
        model = predictor([probabilities('WNNWNE', .89), probabilities('WNNWNE', .89),
                           probabilities('WNNWNE', .89)])
        result, _ = self.run_with_masks(model, base_count=5)
        self.assertFalse(result['valid'])
        self.assertEqual(result['text'], '')
        self.assertEqual(result['characters'], [])
        self.assertEqual(result['confidence'], 0.)
        self.assertTrue(any('분리하지 못했습니다' in warning for warning in result['warnings']))

    def test_repeated_otsu_threshold_does_not_supply_second_vote(self):
        for otsu in (120, 140, 160):
            with self.subTest(otsu=otsu):
                model = predictor([probabilities('ABCDEK', .60), probabilities('WNNWNE', .99),
                                   probabilities('WNNWNB', .99)])
                result, operation = self.run_with_masks(model, otsu=otsu)
                self.assertEqual(result['text'], 'ABCDEK')
                self.assertEqual(len(model.session.calls), 3)
                self.assertEqual(operation.call_count, 4)

    def test_default_segmentation_preserves_threshold_140_pixels(self):
        rng = np.random.default_rng(18)
        image = Image.fromarray(rng.integers(0, 256, size=(70, 210, 3), dtype=np.uint8))
        for method in ('legacy', 'median', 'filtered'):
            with self.subTest(method=method):
                gray = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
                if method in ('median', 'filtered'):
                    gray = cv2.medianBlur(gray, 3)
                _, expected = cv2.threshold(gray, 140, 255, cv2.THRESH_BINARY)
                actual, boxes = Predictor._segments(image, method)
                np.testing.assert_array_equal(actual, expected)
                self.assertEqual(boxes, Predictor._boxes_from_mask(expected, image.width, method))


if __name__ == '__main__':
    unittest.main()
