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
  RegExp,
  URL
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


const localSnapshot = {
  content: sample.content,
  total: sample.total,
  groups: sample.groups
};
const localCase = {
  id: "local-old",
  raw_text: sample.raw_text,
  corrected_text: sample.normalized_text,
  year_animal: "马",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  source: "confirmed",
  snapshot: localSnapshot
};
const cloudCase = {
  ...localCase,
  id: "cloud-new",
  updated_at: "2026-10-01T00:00:00.000Z",
  snapshot: { ...localSnapshot, content: "cloud-corrected" }
};
const merged = vm.runInContext(
  "mergeLearningStores(" + JSON.stringify({
    version: 1, cases: [localCase],
    unresolved: [{raw_text:"无法识别 A",created_at:"2026-01-01T00:00:00.000Z",note:"pending"}],
    metrics: {confirmed:1,corrected:0,markedUnresolved:1,exactHits:0,retrievals:0}
  }) + ", " + JSON.stringify({
    version: 1, cases: [cloudCase],
    unresolved: [{raw_text:"无法识别 B",created_at:"2026-02-01T00:00:00.000Z",note:"pending"}],
    metrics: {confirmed:3,corrected:1,markedUnresolved:2,exactHits:1,retrievals:2}
  }) + ")",
  context
);
assert.equal(merged.cases.length, 1, "same text/year should not be duplicated during sync");
assert.equal(merged.cases[0].id, "cloud-new", "newer remote correction should win");
assert.equal(merged.unresolved.length, 2, "local and cloud unresolved samples should merge");
assert.equal(merged.metrics.confirmed, 3, "metrics should retain the higher seen count");

assert.equal(
  vm.runInContext('learningSyncEndpoint("https://example.workers.dev/")', context),
  "https://example.workers.dev/api/v1/learning"
);
assert.throws(
  () => vm.runInContext('learningSyncEndpoint("http://example.workers.dev")', context),
  /https/
);


const deletionRecord = {
  id: "local-old",
  raw_text: sample.raw_text,
  year_animal: "马",
  deleted_at: "2026-02-01T00:00:00.000Z"
};
const deletedMerge = vm.runInContext(
  "mergeLearningStores(" + JSON.stringify({
    version: 1, cases: [localCase], deleted: [],
    unresolved: [], metrics: {}
  }) + ", " + JSON.stringify({
    version: 1, cases: [], deleted: [deletionRecord],
    unresolved: [], metrics: {}
  }) + ")",
  context
);
assert.equal(deletedMerge.cases.length, 0, "a newer deletion marker should remove an older case");
assert.equal(deletedMerge.deleted.length, 1, "deletion marker must survive sync");

const recreatedCase = {
  ...localCase,
  id: "recreated",
  updated_at: "2026-03-01T00:00:00.000Z"
};
const recreatedMerge = vm.runInContext(
  "mergeLearningStores(" + JSON.stringify({
    version: 1, cases: [recreatedCase], deleted: [deletionRecord],
    unresolved: [], metrics: {}
  }) + ", " + JSON.stringify({ version: 1, cases: [], deleted: [], unresolved: [], metrics: {} }) + ")",
  context
);
assert.equal(recreatedMerge.cases.length, 1, "newer explicitly re-confirmed case should beat old deletion");
assert.equal(recreatedMerge.deleted.length, 0, "obsolete deletion marker should be removed");

console.log("Learning module tests passed");
