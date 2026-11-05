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

    def test_risk_rows_keep_macau_and_hong_kong_in_separate_blocks(self):
        def make(seq, region, text):
            parsed = parse_bet(text)
            return OrderRecord(
                seq=seq,
                raw_text=parsed.raw_text,
                bet_content=parsed.content,
                amount=parsed.total,
                created_at="2026-11-02 00:00:00",
                groups=parsed.groups,
                warnings=parsed.warnings,
                region=region,
            )

        records = [
            make(1, "澳门", "01各5"),
            make(2, "香港", "02各5"),
        ]
        rows = build_risk_rows(records, "马")
        body = rows[1:]
        regions = [row[0] for row in body]
        self.assertEqual(regions.count("[统计] 澳门"), 1, regions[:3])
        self.assertEqual(regions.count("[统计] 香港"), 1, regions[:3])
        macau_index = regions.index("[统计] 澳门")
        hk_index = regions.index("[统计] 香港")
        self.assertLess(macau_index, hk_index)
        # 澳门块里的所有数据行都在香港块之前
        macau_rows = [i for i, name in enumerate(regions) if name == "澳门"]
        hk_rows = [i for i, name in enumerate(regions) if name == "香港"]
        self.assertTrue(macau_rows and hk_rows)
        self.assertLess(max(macau_rows), min(hk_rows))


if __name__ == "__main__":
    unittest.main()
