import unittest

from core import parse_bet


class CoreParserRegressionTests(unittest.TestCase):
    def test_three_of_three_multiline_groups_and_total(self):
        parsed = parse_bet(
            "三中三\n"
            "45-05-22\n"
            "23-26-17\n"
            "39-21-38各组10"
        )
        self.assertEqual(len(parsed.groups), 1, parsed.warnings)
        group = parsed.groups[0]
        self.assertEqual(group.play_type, "三中三")
        self.assertEqual(group.selection_text, "45-05-22;23-26-17;39-21-38")
        self.assertEqual(group.multiplier, 3)
        self.assertEqual(group.amount, 10)
        self.assertEqual(group.total, 30)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_two_of_two_inline_and_multiline_groups(self):
        parsed = parse_bet("二中二 01-02\n03-04各组5")
        self.assertEqual(len(parsed.groups), 1, parsed.warnings)
        group = parsed.groups[0]
        self.assertEqual(group.play_type, "二中二")
        self.assertEqual(group.selection_text, "01-02;03-04")
        self.assertEqual(group.multiplier, 2)
        self.assertEqual(group.total, 10)

    def test_prefixed_three_of_three_format(self):
        parsed = parse_bet("平码复式三中三\n45-05-22\n23-26-17各组10")
        self.assertEqual(len(parsed.groups), 1, parsed.warnings)
        self.assertEqual(parsed.groups[0].play_type, "三中三")
        self.assertEqual(parsed.groups[0].multiplier, 2)
        self.assertEqual(parsed.total, 20)

    def test_missing_group_amount_is_warned_not_invented(self):
        parsed = parse_bet("三中三\n45-05-22\n23-26-17")
        self.assertFalse(parsed.groups)
        self.assertTrue(any("金额" in warning for warning in parsed.warnings), parsed.warnings)

    def test_prefixed_five_zodiac_combination_counts_per_combination_amount(self):
        parsed = parse_bet(
            "复试五连 牛马猴猪虎蛇组合二十\n"
            "三连猪蛇牛五十\n"
            "四连牛马狗猴 五十\n"
            "五连牛马狗蛇虎五十"
        )
        self.assertEqual(len(parsed.groups), 4, parsed.warnings)
        first = parsed.groups[0]
        self.assertEqual(first.play_type, "5连肖复试")
        self.assertEqual(first.selection_text, "牛,马,猴,猪,虎,蛇")
        self.assertEqual(first.multiplier, 6)
        self.assertEqual(first.amount, 20)
        self.assertEqual(first.total, 120)
        self.assertEqual([g.play_type for g in parsed.groups[1:]],
                         ["3连肖", "4连肖", "5连肖"])
        self.assertEqual([g.total for g in parsed.groups[1:]], [50, 50, 50])
        self.assertEqual(parsed.total, 270)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_mixed_input_preserves_original_bet_order(self):
        parsed = parse_bet(
            "17各3\n"
            "三中三\n"
            "45-05-22\n"
            "23-26-17各组10\n"
            "鸡狗各肖5"
        )
        play_types = [group.play_type for group in parsed.groups]
        self.assertEqual(
            play_types,
            ["特码总单", "三中三", "各肖", "各肖"],
            "mixed input must retain the source order rather than moving multiline groups to the front",
        )
        self.assertEqual(parsed.total, 33)


if __name__ == "__main__":
    unittest.main()
