const assert = require("node:assert/strict");
const backup = require("../backup.js");

const sampleState = {
  year: "马年（2026 默认）",
  records: [
    {
      seq: 1,
      raw_text: "17 29 41 每个3块",
      bet_content: "特码总单： 17,29,41各3",
      amount: 9,
      created_at: "2026-11-02 18:57:00",
      groups: [{ play_type: "特码总单", amount: 3, total: 9 }],
      warnings: [],
      region: "澳门",
      user: "C"
    }
  ],
  odds: { tema: 47 },
  rebate: { global: 0 },
  riskDeductions: [{ id: 1, numbers: "17" }],
  currentUser: "C",
  winFilterUser: "全部",
  macau: "01 02 03 04 05 06 07",
  hk: ""
};

// 1. 导出再导入，内容不丢
(() => {
  const payload = backup.build(sampleState, Date.UTC(2026, 10, 2, 12, 0, 0));
  assert.equal(payload.format, backup.FORMAT);
  assert.equal(payload.version, backup.VERSION);
  assert.equal(payload.exported_at, "2026-11-02T12:00:00.000Z");
  const parsed = backup.parse(JSON.stringify(payload));
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.state.records[0].raw_text, "17 29 41 每个3块");
  assert.equal(parsed.state.records[0].user, "C");
  assert.equal(parsed.state.odds.tema, 47);
  assert.equal(parsed.state.macau, "01 02 03 04 05 06 07");
  assert.equal(parsed.state.year, "马年（2026 默认）");
})();

// 2. 空记录也能导出导入
(() => {
  const parsed = backup.parse(JSON.stringify(backup.build({ records: [] })));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.count, 0);
})();

// 3. 非法 JSON
assert.equal(backup.parse("{not json").ok, false);
assert.match(backup.parse("{not json").error, /JSON/);

// 4. 缺 records
assert.equal(backup.parse('{"foo":1}').ok, false);
assert.match(backup.parse('{"foo":1}').error, /records/);

// 5. 记录字段缺失时补默认值，脏数据被丢弃
(() => {
  const parsed = backup.parse(JSON.stringify({
    state: {
      records: [
        { raw_text: "38各20", amount: "20", groups: [] },
        null,
        "bad",
        { groups: "not-array" }
      ]
    }
  }));
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.state.records[0].amount, 20);
  assert.equal(parsed.state.records[0].region, "澳门");
  assert.equal(parsed.state.records[0].user, "A");
  assert.deepEqual(parsed.state.records[1].groups, []);
})();

// 6. 兼容直接存 state 的旧文件
(() => {
  const parsed = backup.parse(JSON.stringify({ year: "蛇年（2025）", records: [{ seq: 1 }] }));
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.state.year, "蛇年（2025）");
  assert.equal(parsed.count, 1);
})();

// 7. 记录里的 groups 原样保留（结算要用）
(() => {
  const group = { play_type: "五不中", selection_text: "04,06,05,11,12", amount: 200, total: 200 };
  const parsed = backup.parse(JSON.stringify(
    backup.build({ records: [{ seq: 1, groups: [group], amount: 200 }] })
  ));
  assert.deepEqual(parsed.state.records[0].groups, [group]);
})();

console.log("备份模块测试通过");
