const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");
const context = { String, Number, Array, Set, Math, RegExp, Object, JSON };
vm.createContext(context);

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, "expected source section: " + startMarker);
  return source.slice(start, end);
}

vm.runInContext(
  section("function extractAiPlayContext(", "function mergeAiChunkResults(") +
  section("function isGroqTpmLimitResponse(", "function groqRetryDelayMs("),
  context
);

const multiLine = [
  "普通号码各3",
  "三中三",
  ...Array.from({ length: 45 }, (_, i) =>
    String(i + 1).padStart(2, "0") + "-05-22各组10"),
  "鸡狗各肖20"
].join("\n");
const chunks = vm.runInContext("splitAiTextIntoChunks(" + JSON.stringify(multiLine) + ", 300)", context);

assert.ok(chunks.length > 1, "long input should be split into multiple chunks");
assert.ok(chunks.every(chunk => chunk.text.length <= 300), "each chunk should fit the requested character limit");
assert.equal(chunks.map(chunk => chunk.text).join("\n"), multiLine,
  "line-based splitting should preserve all source text and order");
assert.equal(chunks[1].context, "三中三",
  "later chunks within a multiline play should retain the active play heading as context");

const longLine = "A".repeat(740);
const splitLineChunks = vm.runInContext("splitAiTextIntoChunks(" + JSON.stringify(longLine) + ", 300)", context);
assert.ok(splitLineChunks.length > 1, "oversized single line should also split");
assert.equal(splitLineChunks.reduce((sum, chunk) => sum + chunk.text.length, 0), longLine.length,
  "splitting a long single line must not lose characters");

const tpmPayload = {
  error: {
    message: "Request too large for model on tokens per minute (TPM): Limit 8000, Requested 8100",
    code: "rate_limit_exceeded"
  }
};
assert.equal(
  vm.runInContext("isGroqTpmLimitResponse(413, " + JSON.stringify(tpmPayload) + ", " +
    JSON.stringify(JSON.stringify(tpmPayload)) + ")", context),
  true,
  "Groq 413 TPM response should trigger quota recovery"
);
assert.equal(
  vm.runInContext('isGroqTpmLimitResponse(401, {error:{message:"Unauthorized",code:"invalid_api_key"}}, "Unauthorized")', context),
  false,
  "invalid API keys must not be misclassified as TPM quota issues"
);

console.log("AI resilience tests passed");
