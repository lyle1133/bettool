import unittest

from core import parse_bet


class ZodiacNumberSemanticsTests(unittest.TestCase):
    def test_zodiac_each_number_is_not_each_zodiac_bet(self):
        raw = (
            "蛇羊狗鼠马各号30\n"
            "02-14-26-38-12-24-36-09-21-25-37-07-31-43-19各号30\n"
            "澳门4,7,9,12,13,24,25,26,29,36,37各三十\n"
            "\n"
            "5,16,17,21,27,28,38,39,43.各二十"
        )
        parsed = parse_bet(raw, year_animal="马")

        self.assertEqual(len(parsed.groups), 4, parsed.warnings)
        first = parsed.groups[0]
        self.assertEqual(first.play_type, "特码总单")
        self.assertEqual(first.label, "生肖对应号码")
        self.assertEqual(
            first.numbers,
            [1, 2, 7, 9, 12, 13, 14, 19, 21, 24, 25, 26, 31, 33, 36, 37, 38, 43, 45, 48, 49],
        )
        self.assertEqual(first.amount, 30)
        self.assertEqual(first.total, 630)
        self.assertEqual([group.total for group in parsed.groups], [630, 450, 330, 180])
        self.assertEqual(parsed.total, 1590)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_explicit_each_zodiac_remains_a_zodiac_bet(self):
        parsed = parse_bet("蛇羊狗鼠马各肖30", year_animal="马")
        self.assertEqual(parsed.total, 150)
        self.assertEqual(len(parsed.groups), 5)
        self.assertTrue(all(group.play_type == "各肖" for group in parsed.groups))


if __name__ == "__main__":
    unittest.main()
