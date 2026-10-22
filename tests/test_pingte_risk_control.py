import unittest

from core import (
    BetGroup,
    OrderRecord,
    build_risk_control,
    parse_draw_result,
    settle_group,
)


class PingteXiaoAndTemaRiskTests(unittest.TestCase):
    def make_record(self, groups):
        return OrderRecord(
            seq=1,
            raw_text="测试风险记录",
            bet_content="",
            amount=sum(group.total for group in groups),
            created_at="2026-10-22 00:00:00",
            groups=groups,
            warnings=[],
            region="澳门",
        )

    def test_seventh_special_zodiac_does_not_hit_pingte_xiao_by_itself(self):
        # 2026 马年：第七个号码 04 属兔；前六个号码没有兔。
        draw = parse_draw_result("01 02 05 06 07 08 04", "马")
        group = BetGroup(
            numbers=[],
            amount=10,
            play_type="平特一肖",
            billing_mode="fixed",
            selection_text="兔",
            multiplier=1,
        )
        hit, description, *_ = settle_group(group, draw)
        self.assertFalse(hit, description)
        self.assertNotIn("兔", draw.zodiac_set)
        self.assertEqual(draw.special, 4)

    def test_zodiac_hit_in_first_six_still_counts_even_if_special_has_same_zodiac(self):
        # 第一个平码 04 属兔；第七个号码 16 也属兔。命中必须来自前六个平码。
        draw = parse_draw_result("04 01 02 05 06 07 16", "马")
        group = BetGroup(
            numbers=[],
            amount=10,
            play_type="平特一肖",
            billing_mode="fixed",
            selection_text="兔",
            multiplier=1,
        )
        hit, description, *_ = settle_group(group, draw)
        self.assertTrue(hit, description)
        self.assertIn("兔", draw.zodiac_set)

    def test_seventh_number_is_special_and_extra_numbers_are_ignored(self):
        draw = parse_draw_result("01 02 05 06 07 08 04 16", "马")
        self.assertEqual(draw.pingma_numbers, [1, 2, 5, 6, 7, 8])
        self.assertEqual(draw.special, 4)
        self.assertEqual(draw.numbers, [1, 2, 5, 6, 7, 8, 4])
        self.assertTrue(any("第 7 个为特码" in warning for warning in draw.warnings))

    def test_risk_control_separates_pingte_xiao_and_tema_and_includes_rebate(self):
        pingte = BetGroup(
            numbers=[],
            amount=10,
            play_type="平特一肖",
            billing_mode="fixed",
            selection_text="兔",
            multiplier=1,
        )
        tema = BetGroup(
            numbers=[4],
            amount=2,
            play_type="特码总单",
            billing_mode="per_number",
            selection_text="04",
            multiplier=1,
        )
        result = build_risk_control(
            [self.make_record([pingte, tema])],
            "马",
            odds_config={"pingte_xiao": 2, "tema": 47},
            rebate_config={"global": 0, "pingte_xiao": 10, "tema": 5},
        )

        self.assertEqual(result["total_stake"], 12)
        self.assertEqual(result["pingte_xiao"]["stake"], 10)
        self.assertEqual(result["pingte_xiao"]["max_payout"], 20)
        self.assertAlmostEqual(result["pingte_xiao"]["worst_net"], 11)
        self.assertIn("兔", result["pingte_xiao"]["scenario"])
        self.assertEqual(result["tema"]["stake"], 2)
        self.assertEqual(result["tema"]["max_payout"], 94)
        self.assertAlmostEqual(result["tema"]["worst_net"], 92.1)

    def test_missing_pingte_odds_is_not_reported_as_zero_risk(self):
        pingte = BetGroup(
            numbers=[],
            amount=10,
            play_type="平特一肖",
            billing_mode="fixed",
            selection_text="兔",
            multiplier=1,
        )
        result = build_risk_control(
            [self.make_record([pingte])],
            "马",
            odds_config={"pingte_xiao": None},
            rebate_config={"global": 0},
        )
        self.assertEqual(result["pingte_xiao"]["max_payout"], "待填赔率")
        self.assertEqual(result["pingte_xiao"]["worst_net"], "待填赔率")


if __name__ == "__main__":
    unittest.main()
