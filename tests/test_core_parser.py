import re
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

    def test_multiline_combo_bets_accept_whitespace_separated_numbers(self):
        parsed = parse_bet(
            "三中三\n"
            "45 05 22\n"
            "23 26 17\n"
            "39 21 38各组十\n"
            "二中二\n"
            "01 02\n"
            "03 04 每组5元"
        )
        self.assertEqual(len(parsed.groups), 2, parsed.warnings)
        three = parsed.groups[0]
        self.assertEqual(three.play_type, "三中三")
        self.assertEqual(three.selection_text, "45-05-22;23-26-17;39-21-38")
        self.assertEqual(three.multiplier, 3)
        self.assertEqual(three.amount, 10)
        self.assertEqual(three.total, 30)
        two = parsed.groups[1]
        self.assertEqual(two.play_type, "二中二")
        self.assertEqual(two.selection_text, "01-02;03-04")
        self.assertEqual(two.multiplier, 2)
        self.assertEqual(two.amount, 5)
        self.assertEqual(two.total, 10)
        self.assertEqual(parsed.total, 40)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_multiline_combo_bets_accept_amount_on_own_line(self):
        parsed = parse_bet(
            "三中三\n"
            "45-05-22\n"
            "23-26-17\n"
            "39-21-38\n"
            "各组十元\n"
            "二中二\n"
            "01 02\n"
            "03 04\n"
            "每组5元"
        )
        self.assertEqual(len(parsed.groups), 2, parsed.warnings)
        three = parsed.groups[0]
        self.assertEqual(three.play_type, "三中三")
        self.assertEqual(three.selection_text, "45-05-22;23-26-17;39-21-38")
        self.assertEqual(three.multiplier, 3)
        self.assertEqual(three.amount, 10)
        self.assertEqual(three.total, 30)
        two = parsed.groups[1]
        self.assertEqual(two.play_type, "二中二")
        self.assertEqual(two.selection_text, "01-02;03-04")
        self.assertEqual(two.multiplier, 2)
        self.assertEqual(two.amount, 5)
        self.assertEqual(two.total, 10)
        self.assertEqual(parsed.total, 40)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_multiline_combo_parser_splits_multiple_groups_on_one_line(self):
        parsed = parse_bet(
            "三中三\n"
            "45-05-22,23-26-17,39-21-38各组10"
        )
        self.assertEqual(len(parsed.groups), 1, parsed.warnings)
        group = parsed.groups[0]
        self.assertEqual(group.play_type, "三中三")
        self.assertEqual(
            group.selection_text,
            "45-05-22;23-26-17;39-21-38",
        )
        self.assertEqual(group.multiplier, 3)
        self.assertEqual(group.amount, 10)
        self.assertEqual(group.total, 30)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_multiline_combo_parser_normalizes_fullwidth_numbers_and_blank_lines(self):
        parsed = parse_bet(
            "３中３\n"
            "\n"
            "４５－０５－２２\n"
            "\n"
            "２３－２６－１７\n"
            "３９－２１－３８\n"
            "各组十元"
        )
        self.assertEqual(len(parsed.groups), 1, parsed.warnings)
        group = parsed.groups[0]
        self.assertEqual(group.play_type, "三中三")
        self.assertEqual(
            group.selection_text,
            "45-05-22;23-26-17;39-21-38",
        )
        self.assertEqual(group.multiplier, 3)
        self.assertEqual(group.amount, 10)
        self.assertEqual(group.total, 30)
        self.assertFalse(parsed.warnings, parsed.warnings)

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
        self.assertEqual(first.play_type, "5连肖")
        self.assertEqual(first.selection_text, "牛,马,猴,猪,虎,蛇")
        self.assertEqual(first.multiplier, 6)
        self.assertEqual(first.amount, 20)
        self.assertEqual(first.total, 120)
        self.assertEqual([g.play_type for g in parsed.groups[1:]],
                         ["3连肖", "4连肖", "5连肖"])
        self.assertEqual([g.total for g in parsed.groups[1:]], [50, 50, 50])
        self.assertEqual(parsed.total, 270)
        self.assertFalse(parsed.warnings, parsed.warnings)

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
        self.assertEqual(first.numbers,
                         [1, 2, 7, 9, 12, 13, 14, 19, 21, 24, 25, 26, 31, 33, 36, 37, 38, 43, 45, 48, 49])
        self.assertEqual(first.amount, 30)
        self.assertEqual(first.total, 630)
        self.assertEqual([g.total for g in parsed.groups], [630, 450, 330, 180])
        self.assertEqual(parsed.total, 1590)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_explicit_each_zodiac_remains_a_zodiac_bet(self):
        parsed = parse_bet("蛇羊狗鼠马各肖30", year_animal="马")
        self.assertEqual(parsed.total, 150)
        self.assertEqual(len(parsed.groups), 5)
        self.assertTrue(all(g.play_type == "各肖" for g in parsed.groups))

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

    def test_mei_ge_is_treated_as_each_number_amount(self):
        for raw in (
            "17 29 41 每个3块",
            "17 29 41每个3",
            "17 29 41 每个 3 块",
            "17 29 41 每位3块",
            "17 29 41 每只3",
        ):
            with self.subTest(raw=raw):
                parsed = parse_bet(raw, year_animal="马")
                self.assertEqual(len(parsed.groups), 1, parsed.warnings)
                group = parsed.groups[0]
                self.assertEqual(group.numbers, [17, 29, 41])
                self.assertEqual(group.amount, 3)
                self.assertEqual(group.total, 9)
                self.assertEqual(parsed.total, 9)
                self.assertFalse(parsed.warnings, parsed.warnings)

    def test_mei_ge_with_chinese_amount(self):
        parsed = parse_bet("17 29 41 每位 十 块", year_animal="马")
        self.assertEqual(len(parsed.groups), 1, parsed.warnings)
        self.assertEqual(parsed.groups[0].numbers, [17, 29, 41])
        self.assertEqual(parsed.groups[0].amount, 10)
        self.assertEqual(parsed.total, 30)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_play_first_wu_liu_qi_bu_zhong(self):
        cases = {
            "五不中 04 06 05 11 12 200": ("五不中", 200),
            "五不中 0406051112 200": ("五不中", 200),
            "五不中 04.06.05.11.12 200": ("五不中", 200),
            "五不中:04,06,05,11,12 200": ("五不中", 200),
            "五不中 04 06 05 11 12=200": ("五不中", 200),
            "五不中 04 06 05 11 12 200块": ("五不中", 200),
            "五不中 04 06 05 11 12 两百": ("五不中", 200),
            "五不中 04 06 05 11 12 二百米": ("五不中", 200),
            "六不中 01 02 03 04 05 06 100": ("六不中", 100),
            "七不中 01 02 03 04 05 06 07 50": ("七不中", 50),
        }
        for raw, (play, amount) in cases.items():
            with self.subTest(raw=raw):
                parsed = parse_bet(raw, year_animal="马")
                self.assertEqual(len(parsed.groups), 1, parsed.warnings)
                group = parsed.groups[0]
                self.assertEqual(group.play_type, play)
                self.assertEqual(group.amount, amount)
                self.assertEqual(group.total, amount)
                self.assertEqual(parsed.total, amount)
                self.assertFalse(parsed.warnings, parsed.warnings)
                self.assertEqual(len(core_split_numbers(group.selection_text)),
                                 {"五不中": 5, "六不中": 6, "七不中": 7}[play])

    def test_play_first_wu_bu_zhong_rejects_wrong_number_count(self):
        parsed = parse_bet("五不中 04 06 05 11 200", year_animal="马")
        self.assertEqual(parsed.groups, [], "号码数量不对时不应降级成特码总单")
        self.assertTrue(
            any("五不中" in warning for warning in parsed.warnings),
            parsed.warnings,
        )
        self.assertEqual(parsed.total, 0)

    def test_wu_bu_zhong_numbers_first_still_works(self):
        parsed = parse_bet("04.06.05.11.12 五不中 200文", year_animal="马")
        self.assertEqual(len(parsed.groups), 1, parsed.warnings)
        self.assertEqual(parsed.groups[0].play_type, "五不中")
        self.assertEqual(parsed.total, 200)

    def test_bo_se_prefix(self):
        for raw in ("波色 红 100", "波色红100", "色波 红波 100"):
            with self.subTest(raw=raw):
                parsed = parse_bet(raw, year_animal="马")
                self.assertEqual(len(parsed.groups), 1, parsed.warnings)
                self.assertEqual(parsed.groups[0].play_type, "波色")
                self.assertEqual(parsed.groups[0].total, 100)

    def test_chat_headers_and_ack_lines_are_ignored(self):
        raw = (
            "温柔不是姐的范\n"
            "2026年11月02日 18:57\n"
            "07.19.43.22.34.46各15\n"
            "31.10.01.13.25.37.49.04.16.20.40各12\n"
            "\n"
            "lyle\n"
            "2026年11月02日 18:58\n"
            "1\n"
            "\n"
            "温柔不是姐的范\n"
            "2026年11月02日 19:30\n"
            "49各25\n"
        )
        parsed = parse_bet(raw, year_animal="马")
        self.assertEqual(len(parsed.groups), 3, parsed.warnings)
        self.assertEqual(parsed.total, 90 + 132 + 25)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_chat_headers_do_not_merge_two_messages(self):
        raw = (
            "温柔不是姐的范\n"
            "2026年11月02日 21:04\n"
            "27.24.22.46.23.21.45.各20\n"
            "lyle\n"
            "2026年11月02日 21:05\n"
            "1\n"
            "温柔不是姐的范\n"
            "2026年11月02日 21:06\n"
            "25各100\n"
        )
        parsed = parse_bet(raw, year_animal="马")
        self.assertEqual([group.total for group in parsed.groups], [140, 100], parsed.warnings)
        self.assertEqual(parsed.total, 240)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_timestamp_only_input_reports_no_bets(self):
        parsed = parse_bet("温柔不是姐的范\n2026年11月02日 18:57\n", year_animal="马")
        self.assertEqual(parsed.groups, [])
        self.assertTrue(any("聊天记录" in warning for warning in parsed.warnings),
                        parsed.warnings)

    def test_prefixed_multiline_pingma_header(self):
        parsed = parse_bet(
            "新奥三中三\n"
            "31-21-14    07-15-47\n"
            "03-38-08    36-10-43\n"
            "16-40-31    21-28-44\n"
            "12-31-26    03-14-16\n"
            "10-34-40    10-29-30\n"
            "07-31-25    19-01-39\n"
            "03-27-40    18-31-44\n"
            "37-41-45    18-37-41各组10",
            year_animal="马",
        )
        self.assertEqual(len(parsed.groups), 1, parsed.warnings)
        group = parsed.groups[0]
        self.assertEqual(group.play_type, "三中三")
        self.assertEqual(group.multiplier, 16)
        self.assertEqual(group.amount, 10)
        self.assertEqual(group.total, 160)
        self.assertFalse(parsed.warnings, parsed.warnings)

    def test_region_prefixed_two_of_two_header(self):
        parsed = parse_bet("澳门二中二\n01-02\n03-04各组5", year_animal="马")
        self.assertEqual(len(parsed.groups), 1, parsed.warnings)
        self.assertEqual(parsed.groups[0].play_type, "二中二")
        self.assertEqual(parsed.groups[0].multiplier, 2)
        self.assertEqual(parsed.total, 10)

    def test_six_zodiac_center_is_not_downgraded(self):
        for raw in ("六肖中 鼠牛虎兔龙蛇 100", "鼠牛虎兔龙蛇六肖中 100"):
            with self.subTest(raw=raw):
                parsed = parse_bet(raw, year_animal="马")
                self.assertEqual(len(parsed.groups), 1, parsed.warnings)
                group = parsed.groups[0]
                self.assertEqual(group.play_type, "六肖中")
                self.assertEqual(group.total, 100)
                self.assertTrue(
                    any("不支持结算" in warning for warning in parsed.warnings),
                    parsed.warnings,
                )

    def test_new_formats_mix_with_existing_lines(self):
        parsed = parse_bet(
            "17 29 41 每个3块\n"
            "五不中 04 06 05 11 12 200\n"
            "波色 红 100",
            year_animal="马",
        )
        self.assertEqual([group.play_type for group in parsed.groups],
                         ["特码总单", "五不中", "波色"], parsed.warnings)
        self.assertEqual([group.total for group in parsed.groups], [9, 200, 100])
        self.assertEqual(parsed.total, 309)
        self.assertFalse(parsed.warnings, parsed.warnings)


    def test_legacy_lianxiao_repeat_records_merge_in_summary(self):
        from core import BetGroup, DrawResult, OrderRecord, settle_orders, summarize_orders

        group = BetGroup([], 50, "3连肖复试", "旧记录", "3连肖复试", "fixed", "龙鸡猪", 1)
        record = OrderRecord(seq=1, raw_text="旧记录", bet_content="3连肖复试", amount=50,
                             created_at="", groups=[group], warnings=[])
        _, _, _, play_rows = summarize_orders([record], "马")
        names = [row[0] for row in play_rows]
        self.assertIn("3连肖", names)
        self.assertNotIn("3连肖复试", names)

        _, summary = settle_orders([record], {"澳门": DrawResult(), "香港": DrawResult()}, {}, {})
        summary_names = [row[0] for row in summary]
        self.assertIn("3连肖", summary_names)
        self.assertNotIn("3连肖复试", summary_names)


def core_split_numbers(selection_text):
    """测试辅助：把 "04,06,05,11,12" 拆回号码，用于检查号码个数。"""
    return [int(token) for token in re.findall(r"\d{1,2}", selection_text or "")]


if __name__ == "__main__":
    unittest.main()
