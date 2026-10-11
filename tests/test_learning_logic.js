const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const memory = new Map();
const context = {
  console,
  localStorage: {
    getItem: key => memory.has(key) ? memory.get(key) : null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key)
  },
  $: () => null,
  toast: () => {},
  yearAnimal: () => "马",
  fmtNum: value => String(value),
  confirm: () => true,
  Date,
  Math,
  JSON,
  String,
  Number,
  Array,
  Set,
  Object,
  RegExp
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("learning.js", "utf8"), context);

assert.equal(
  vm.runInContext('learningTextKey(" 三中三，45-05-22各组10 ")', context),
  "三中三 45-05-22各组10"
);

const similarScore = vm.runInContext(
  'learningSimilarity("三中三\\n45-05-22各组10", "三中三\\n23-26-17各组20")',
  context
);
assert.ok(similarScore > 0.8, "same style of triple-pick inputs should be similar");

const differentScore = vm.runInContext(
  'learningSimilarity("三中三 45-05-22各组10", "鸡狗各肖10")',
  context
);
assert.ok(differentScore < similarScore, "different play types should score lower");

const sample = {
  raw_text: "三中三\n45-05-22各组10",
  normalized_text: "三中三 45-05-22各组10",
  content: "三中三：45-05-22各组10",
  total: 10,
  groups: [{
    play_type: "三中三",
    label: "三中三",
    amount: 10,
    total: 10,
    billing_mode: "fixed",
    selection_text: "45-05-22",
    multiplier: 1,
    numbers: [],
    source: "45-05-22各组10"
  }]
};

const saved = vm.runInContext(
  'recordVerifiedLearningCase(' + JSON.stringify(sample.raw_text) + ', ' +
  JSON.stringify(sample) + ', ' + JSON.stringify(sample.normalized_text) + ', "confirmed")',
  context
);
assert.equal(saved, true);
assert.ok(memory.has("bettool_learning_cases_v1"), "confirmed case should persist locally");

const exact = vm.runInContext(
  'findExactLearningCase(' + JSON.stringify(sample.raw_text) + ')',
  context
);
assert.ok(exact && exact.snapshot.groups.length === 1, "exact verified case should be reusable");

const similar = vm.runInContext(
  'findSimilarLearningCases("三中三\\n23-26-17各组20", 3)',
  context
);
assert.equal(similar.length, 1, "similar confirmed case should be retrieved");

console.log("Learning module tests passed");
