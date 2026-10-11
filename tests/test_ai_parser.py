import unittest

from core import ai_result_to_preview, normalize_ai_numbers, validate_ai_result


class AiParserRegressionTests(unittest.TestCase):
    def test_number_normalization_rejects_out_of_range_and_fractional_values(self):
        self.assertEqual(
            normalize_ai_numbers([1, "02", 49, 0, 50, 1.5, True, None]),
            [1, 2, 49],
        )

    def test_three_of_three_multiple_lines_are_all_counted(self):
        ai = {
            "success": True,
            "normalized_text": (
                "三中三 45-05-22各组10\n"
                "三中三 23-26-17各组10"
            ),
            "items": [
                {
                    "raw": "45-05-22各组10",
                    "normalized": "三中三 45-05-22各组10",
                    "play_type": "三中三",
                    "numbers": [45, 5, 22],
                    "zodiacs": [],
                    "amount": 10,
                    "confidence": 0.99,
                },
                {
                    "raw": "23-26-17各组10",
                    "normalized": "三中三 23-26-17各组10",
                    "play_type": "三中三",
                    "numbers": [23, 26, 17],
                    "zodiacs": [],
                    "amount": 10,
                    "confidence": 0.99,
                },
            ],
            "unresolved": [],
            "warnings": [],
        }

        result = ai_result_to_preview(ai, "马")
        self.assertTrue(result["success"], result["warnings"])
        self.assertEqual(len(result["groups"]), 2, result["content"])
        self.assertAlmostEqual(result["total"], 20.0)
        self.assertTrue(result["ai_complete"], result["warnings"])

    def test_missing_normalized_item_is_flagged_as_incomplete(self):
        ai = {
            "success": True,
            "normalized_text": "17 29 41各3",
            "items": [
                {
                    "raw": "17 29 41每个3块",
                    "normalized": "17 29 41各3",
                    "play_type": "特码",
                    "numbers": [17, 29, 41],
                    "zodiacs": [],
                    "amount": 3,
                    "confidence": 0.99,
                },
                {
                    "raw": "鸡狗各肖10",
                    "normalized": "",
                    "play_type": "各肖",
                    "numbers": [],
                    "zodiacs": ["鸡", "狗"],
                    "amount": 10,
                    "confidence": 0.9,
                },
            ],
            "unresolved": ["鸡狗各肖10"],
            "warnings": [],
        }

        result = ai_result_to_preview(ai, "马")
        self.assertTrue(result["success"])
        self.assertFalse(result["ai_complete"])
        self.assertTrue(result["warnings"])
        self.assertTrue(result["unresolved"])

    def test_invalid_amount_does_not_silently_pass(self):
        checked = validate_ai_result({
            "items": [{
                "raw": "17号",
                "normalized": "17各0",
                "play_type": "特码",
                "numbers": [17],
                "amount": 0,
                "confidence": 0.99,
            }],
            "warnings": [],
            "unresolved": [],
        })
        self.assertFalse(checked["success"])
        self.assertTrue(any("金额" in warning for warning in checked["warnings"]))


if __name__ == "__main__":
    unittest.main()
