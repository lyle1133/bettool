import unittest

from core import parse_bet


class ZodiacNumberSemanticsTests(unittest.TestCase):
    def test_zodiac_each_number_counts_mapped_numbers_not_zodiac_picks(self):
        raw = (
            "蛇羊狗鼠马各号30\n"
            "02-14-26-38-12-24-36-09-21-25-37-07-31-43-19各号30\n"
            "澳门4,7,9,12,13,24,25,26,29,36,37各三十\n"
            "\n"
            "5,16,17,21,27,28,38,39,43.各二十"
        )
        parsed = parse_bet(raw, year_animal="马")

        # 生肖各号：蛇、羊、狗、鼠各 4 个号码，马有 5 个号码。
        self.assertEqual(len(parsed.groups), 8, parsed.warnings)
        self.assertEqual(
            [group.label for group in parsed.groups[:5]],
            ["生肖：蛇", "生肖：羊", "生肖：狗", "生肖：鼠", "生肖：马"],
        )
        self.assertEqual([group.total for group in parsed.groups[:5]], [120, 120, 120, 120, 150])
        self.assertEqual(parsed.groups[0].numbers, [2, 14, 26, 38])
        self.assertEqual(parsed.groups[4].numbers, [1, 13, 25, 37, 49])
        self.assertEqual([group.total for group in parsed.groups[5:]], [450, 330, 180])
        self.assertEqual(parsed.total, 1590)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_explicit_each_zodiac_is_still_five_zodiac_picks(self):
        parsed = parse_bet("蛇羊狗鼠马各肖30", year_animal="马")
        self.assertEqual(parsed.total, 150)
        self.assertEqual(len(parsed.groups), 5)
        self.assertTrue(all(group.play_type == "各肖" for group in parsed.groups))


if __name__ == "__main__":
    unittest.main()
