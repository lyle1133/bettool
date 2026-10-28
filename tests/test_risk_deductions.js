const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = {
  console,
  window: { addEventListener() {} },
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  },
  navigator: { platform: "Win32" },
  confirm: () => true,
  setTimeout: () => 0,
  clearTimeout() {},
  Date,
  Math,
  JSON,
  String,
  Number,
  Array,
  Set,
  Map,
  Object,
  RegExp,
  Promise,
  Error,
  URL
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("app.js", "utf8"), context);

function runScenario(records, riskDeductions) {
  context.__scenario = { records, riskDeductions };
  vm.runInContext(
    "state.records = __scenario.records; state.riskDeductions = __scenario.riskDeductions;",
    context
  );
  return JSON.parse(vm.runInContext("JSON.stringify(calculateRiskDeductions())", context));
}

function numberGroup(numbers, amount) {
  return {
    numbers,
    amount,
    label: "号码",
    source: "测试下注",
    play_type: "特码总单",
    billing_mode: "per_number",
    selection_text: numbers.map(n => String(n).padStart(2, "0")).join(","),
    multiplier: 1
  };
}

function record(groups, region = "澳门") {
  const amount = groups.reduce((sum, group) =>
    sum + (group.billing_mode === "per_number"
      ? group.numbers.length * group.amount
      : (group.multiplier || 1) * group.amount), 0);
  return {
    seq: 1,
    raw_text: "风险扣减测试",
    bet_content: "",
    amount,
    created_at: "2026-10-28 00:00:00",
    groups,
    warnings: [],
    region
  };
}

// User's exact example: 01 has 100; throw off 90; risk must only count 10.
{
  const result = runScenario(
    [record([numberGroup([1], 100)])],
    [{ id: 1, numbers: [1], amount: 90, region: "澳门" }]
  );
  assert.equal(result.records[0].groups.length, 1);
  assert.deepEqual(Array.from(result.records[0].groups[0].numbers), [1]);
  assert.equal(result.records[0].groups[0].amount, 10);
  assert.equal(result.records[0].amount, 10);
  assert.equal(result.numberState["澳门|1"].original, 100);
  assert.equal(result.numberState["澳门|1"].applied, 90);
  assert.equal(result.numberState["澳门|1"].remaining, 10);
  assert.equal(result.totalRequested, 90);
  assert.equal(result.totalApplied, 90);
  assert.equal(result.totalUnapplied, 0);
}

// A deduction on 01 leaves other numbers in the same multi-number group unchanged.
{
  const result = runScenario(
    [record([numberGroup([1, 2], 100)])],
    [{ id: 2, numbers: [1], amount: 90, region: "澳门" }]
  );
  const groups = result.records[0].groups;
  assert.equal(groups.length, 2);
  assert.deepEqual(Array.from(groups[0].numbers), [1]);
  assert.equal(groups[0].amount, 10);
  assert.deepEqual(Array.from(groups[1].numbers), [2]);
  assert.equal(groups[1].amount, 100);
  assert.equal(result.records[0].amount, 110);
}

// Amount thrown off cannot reduce a number below zero; unmatched amount is reported.
{
  const result = runScenario(
    [record([numberGroup([1], 100)])],
    [{ id: 3, numbers: [1], amount: 150, region: "澳门" }]
  );
  assert.equal(result.records[0].groups.length, 0);
  assert.equal(result.records[0].amount, 0);
  assert.equal(result.numberState["澳门|1"].remaining, 0);
  assert.equal(result.totalApplied, 100);
  assert.equal(result.totalUnapplied, 50);
}

// Regions are isolated: a Hong Kong deduction must not alter Macau risk.
{
  const result = runScenario(
    [record([numberGroup([1], 100)], "澳门")],
    [{ id: 4, numbers: [1], amount: 90, region: "香港" }]
  );
  assert.equal(result.records[0].groups[0].amount, 100);
  assert.equal(result.totalApplied, 0);
  assert.equal(result.totalUnapplied, 90);
}

// The adjustment only changes per-number 特码总单 groups, not combo/tail play records.
{
  const fixedGroups = [
    numberGroup([1], 100),
    {
      numbers: [],
      amount: 30,
      label: "三中三",
      source: "测试三中三",
      play_type: "三中三",
      billing_mode: "fixed",
      selection_text: "01-02-03;04-05-06",
      multiplier: 2
    },
    {
      numbers: [],
      amount: 10,
      label: "尾数平特",
      source: "测试平特尾",
      play_type: "尾数平特",
      billing_mode: "fixed",
      selection_text: "0尾",
      multiplier: 1
    }
  ];
  const result = runScenario(
    [record(fixedGroups)],
    [{ id: 5, numbers: [1], amount: 90, region: "澳门" }]
  );
  assert.equal(result.records[0].groups.length, 3);
  assert.equal(result.records[0].groups[0].amount, 10);
  assert.equal(result.records[0].groups[1].amount, 30);
  assert.equal(result.records[0].groups[2].amount, 10);
  assert.equal(result.records[0].amount, 80);
}

// Full-width input and repeated numbers are normalized; invalid numbers are rejected.
assert.deepEqual(
  Array.from(vm.runInContext('parseRiskDeductionNumbers("０１，08 19 08")', context)),
  [1, 8, 19]
);
assert.throws(
  () => vm.runInContext('parseRiskDeductionNumbers("01 50")', context),
  /号码必须在 01–49/
);

console.log("Risk throw-off deduction tests passed");
