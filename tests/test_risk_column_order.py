import unittest

from core import NUMBER_TO_COLOR, OrderRecord, build_risk_rows, parse_bet


class RiskColumnOrderTests(unittest.TestCase):
    def setUp(self):
        parsed = parse_bet("01各5")
        self.record = OrderRecord(
            seq=1,
            raw_text=parsed.raw_text,
            bet_content=parsed.content,
            amount=parsed.total,
            created_at="2026-10-12 00:00:00",
            groups=parsed.groups,
            warnings=parsed.warnings,
            region="澳门",
        )

    def test_outcome_columns_appear_before_color_and_tail(self):
        rows = build_risk_rows([self.record], "马")
        header = rows[0]
        self.assertEqual(
            header,
            [
                "地区", "假设特码", "生肖", "预计盈亏", "预计赔付", "统计下注额",
                "中奖本金", "回水", "波色", "尾数", "命中玩法", "风险等级",
            ],
        )

    def test_values_stay_under_their_reordered_headers(self):
        rows = build_risk_rows([self.record], "马")
        header = rows[0]
        columns = {name: header.index(name) for name in header}
        row = next(item for item in rows[1:] if item[columns["假设特码"]] == "01")

        self.assertEqual(row[columns["波色"]], NUMBER_TO_COLOR[1])
        self.assertEqual(row[columns["尾数"]], "1尾")
        self.assertIsInstance(row[columns["预计赔付"]], (int, float, str))
        self.assertIsInstance(row[columns["预计盈亏"]], (int, float, str))
        self.assertEqual(row[columns["统计下注额"]], 5)
        self.assertEqual(len(row), len(header))

    def test_empty_risk_table_keeps_column_count(self):
        rows = build_risk_rows([], "马")
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(rows[1]), len(rows[0]))


if __name__ == "__main__":
    unittest.main()
