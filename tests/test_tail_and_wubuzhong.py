import unittest

from core import (
    BetGroup,
    DEFAULT_ODDS,
    OrderRecord,
    normalize_odds_config,
    parse_bet,
    parse_draw_result,
    settle_group,
)


class TailAndNoHitSettlementTests(unittest.TestCase):
    def test_settings_include_dedicated_zero_tail_and_no_hit_odds(self):
        self.assertEqual(DEFAULT_ODDS["pingte_tail_0"], 2.1)
        self.assertEqual(DEFAULT_ODDS["pingte_tail"], 1.85)
        self.assertIsNone(DEFAULT_ODDS["wubuzhong"])
        self.assertEqual(normalize_odds_config({"wubuzhong": 3.0})["wubuzhong"], 3.0)

    def test_zero_tail_parser_creates_tail_bet(self):
        parsed = parse_bet("平特0尾10")
        self.assertEqual(len(parsed.groups), 1, parsed.warnings)
        group = parsed.groups[0]
        self.assertEqual(group.play_type, "尾数平特")
        self.assertEqual(group.selection_text, "0尾")
        self.assertEqual(group.amount, 10)
        self.assertEqual(group.total, 10)

    def test_zero_tail_pays_at_its_dedicated_odds_when_zero_tail_is_in_first_six(self):
        parsed = parse_bet("平特0尾10")
        group = parsed.groups[0]
        draw = parse_draw_result("10 01 02 03 04 05 06", "马")
        hit, desc, stake, odds_text, payout, profit = settle_group(
            group, draw, {"pingte_tail_0": 2.1, "pingte_tail": 1.85}
        )
        self.assertTrue(hit, desc)
        self.assertEqual(stake, 10)
        self.assertIn("0尾2.1倍", odds_text)
        self.assertEqual(payout, 21)
        self.assertEqual(profit, 11)

    def test_special_zero_tail_alone_does_not_settle_pingte_tail(self):
        parsed = parse_bet("平特0尾10")
        group = parsed.groups[0]
        draw = parse_draw_result("01 02 03 04 05 06 10", "马")
        hit, desc, stake, odds_text, payout, profit = settle_group(
            group, draw, {"pingte_tail_0": 2.1, "pingte_tail": 1.85}
        )
        self.assertFalse(hit, desc)
        self.assertEqual(draw.special, 10)
        self.assertNotIn(0, draw.tail_set)
        self.assertEqual(payout, 0)

    def test_multiple_tails_use_their_own_odds(self):
        parsed = parse_bet("平特0尾1尾各10")
        self.assertEqual(len(parsed.groups), 1, parsed.warnings)
        group = parsed.groups[0]
        self.assertEqual(group.total, 20)
        draw = parse_draw_result("10 11 02 03 04 05 49", "马")
        hit, desc, stake, odds_text, payout, profit = settle_group(
            group, draw, {"pingte_tail_0": 2.1, "pingte_tail": 1.85}
        )
        self.assertTrue(hit, desc)
        self.assertEqual(stake, 20)
        self.assertIn("0尾2.1倍", odds_text)
        self.assertIn("1尾1.85倍", odds_text)
        self.assertEqual(payout, 39.5)
        self.assertEqual(profit, 19.5)

    def test_five_no_hit_uses_all_seven_numbers_and_paid_odds_include_stake(self):
        group = BetGroup(
            numbers=[],
            amount=10,
            label="五不中",
            source="五不中测试",
            play_type="五不中",
            billing_mode="fixed",
            selection_text="11 12 13 14 15",
            multiplier=1,
        )
        draw = parse_draw_result("01 02 03 04 05 06 07", "马")
        hit, desc, stake, odds_text, payout, profit = settle_group(
            group, draw, {"wubuzhong": 3.0}
        )
        self.assertTrue(hit, desc)
        self.assertEqual(stake, 10)
        self.assertEqual(payout, 30)
        self.assertEqual(profit, 20)

    def test_five_no_hit_loses_if_selected_number_is_the_special_number(self):
        group = BetGroup(
            numbers=[],
            amount=10,
            label="五不中",
            source="五不中测试",
            play_type="五不中",
            billing_mode="fixed",
            selection_text="07 11 12 13 14",
            multiplier=1,
        )
        draw = parse_draw_result("01 02 03 04 05 06 07", "马")
        hit, desc, stake, odds_text, payout, profit = settle_group(
            group, draw, {"wubuzhong": 3.0}
        )
        self.assertFalse(hit, desc)
        self.assertIn("07", desc)
        self.assertEqual(payout, 0)
        self.assertEqual(profit, -10)

    def test_five_no_hit_does_not_fake_a_payout_when_odds_are_blank(self):
        group = BetGroup(
            numbers=[],
            amount=10,
            label="五不中",
            source="五不中测试",
            play_type="五不中",
            billing_mode="fixed",
            selection_text="11 12 13 14 15",
            multiplier=1,
        )
        draw = parse_draw_result("01 02 03 04 05 06 07", "马")
        hit, desc, stake, odds_text, payout, profit = settle_group(group, draw, {})
        self.assertTrue(hit, desc)
        self.assertIsNone(payout)
        self.assertIsNone(profit)
        self.assertEqual(odds_text, "待填赔率")


if __name__ == "__main__":
    unittest.main()
