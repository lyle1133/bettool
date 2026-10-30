import unittest

from core import BetGroup, parse_draw_result, settle_group


class SevenNumberZodiacSettlementTests(unittest.TestCase):
    def test_lianxiao_can_be_completed_by_seventh_special_zodiac(self):
        # 2026 马年：04 属兔。前六个号码有龙、牛，但没有兔。
        draw = parse_draw_result("01 02 03 05 06 07 04", "马")
        group = BetGroup(
            numbers=[],
            amount=10,
            play_type="3连肖",
            billing_mode="fixed",
            selection_text="龙兔牛",
            multiplier=1,
        )
        hit, description, stake, odds_text, payout, profit = settle_group(
            group, draw, {"lianxiao_3": 10}
        )
        self.assertTrue(hit, description)
        self.assertNotIn("兔", draw.zodiac_set)
        self.assertIn("兔", draw.zodiac_set_7)
        self.assertEqual(stake, 10)
        self.assertEqual(payout, 100)
        self.assertEqual(profit, 90)

    def test_two_of_two_still_ignores_seventh_special_number(self):
        draw = parse_draw_result("01 02 03 04 05 06 07", "马")
        group = BetGroup(
            numbers=[],
            amount=10,
            play_type="二中二",
            billing_mode="fixed",
            selection_text="01-07",
            multiplier=1,
        )
        hit, description, stake, odds_text, payout, profit = settle_group(
            group, draw, {"pingma_2": 5}
        )
        self.assertFalse(hit, description)
        self.assertIn("只按平码判断", description)
        self.assertEqual(payout, 0)

    def test_three_of_three_still_ignores_seventh_special_number(self):
        draw = parse_draw_result("01 02 03 04 05 06 07", "马")
        group = BetGroup(
            numbers=[],
            amount=10,
            play_type="三中三",
            billing_mode="fixed",
            selection_text="01-02-07",
            multiplier=1,
        )
        hit, description, stake, odds_text, payout, profit = settle_group(
            group, draw, {"pingma_3": 10}
        )
        self.assertFalse(hit, description)
        self.assertIn("只按平码判断", description)
        self.assertEqual(payout, 0)


if __name__ == "__main__":
    unittest.main()
