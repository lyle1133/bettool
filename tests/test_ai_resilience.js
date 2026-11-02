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

// ==================== AI 自检 + 一次自动修正的端到端流程 ====================
const guardApi = require("../ai-guard.js");
const aiSection = section("function aiGuardApi(", "function extractAiPlayContext(");
assert.ok(aiSection.includes("callBetToolAISingle"), "expected to slice out callBetToolAISingle");

const fetchedMessages = [];
const aiReplies = [
  {
    success: true,
    normalized_text: "特肖 猴 30",
    items: [{ raw: "猴30米", normalized: "特肖 猴 30", play_type: "特肖", numbers: [], zodiacs: ["猴"], amount: 30, confidence: 0.99 }],
    unresolved: [],
    warnings: []
  },
  {
    success: true,
    normalized_text: "二连肖 龙鸡 200\n特肖 猴 30",
    items: [
      { raw: "龙鸡二连肖200", normalized: "二连肖 龙鸡 200", play_type: "2连肖", numbers: [], zodiacs: ["龙", "鸡"], amount: 200, confidence: 0.97 },
      { raw: "猴30米", normalized: "特肖 猴 30", play_type: "特肖", numbers: [], zodiacs: ["猴"], amount: 30, confidence: 0.97 }
    ],
    unresolved: [],
    warnings: []
  }
];

const repairContext = {
  window: { BetToolAiGuard: guardApi },
  console,
  JSON, Number, Array, Object, Math, String, RegExp, Set, Promise,
  AbortController,
  setTimeout: () => ({ unref() {} }),
  clearTimeout: () => {},
  fetch: async (_url, options) => {
    const body = JSON.parse(options.body);
    fetchedMessages.push(body.messages);
    const reply = aiReplies[fetchedMessages.length - 1] || aiReplies[aiReplies.length - 1];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] })
    };
  },
  getApiKey: () => "gsk_test_key",
  setStatus: () => {},
  setAiStatus: () => {},
  $: () => null,
  SYSTEM_PROMPT: "system",
  AI_COMPACT_SYSTEM_PROMPT: "compact",
  AI_MIN_CONFIDENCE: 0.75,
  AI_SELF_REPAIR: true,
  AI_SELF_REPAIR_STATUS: "checking",
  activeAiController: null,
  aiBusy: false,
  buildAiUserMessage: text => "请解析：" + text,
  isGroqTpmLimitResponse: () => false,
  groqRetryDelayMs: () => 60000,
  pyParseAIResult: async ai => ({
    groups: (ai.items || []).map(item => ({ play_type: item.play_type, total: item.amount })),
    total: (ai.items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0),
    warnings: [],
    unresolved: [],
    ai_complete: true,
    normalized_text: ai.normalized_text
  })
};
vm.createContext(repairContext);
vm.runInContext(aiSection, repairContext);

const repaired = vm.runInContext(
  "callBetToolAISingle(" + JSON.stringify("龙鸡二连肖200猴30米") + ", [], {})",
  repairContext
);

(async () => {
  const result = await repaired;
  assert.equal(fetchedMessages.length, 2, "自检发现问题后应再请求一次修正");
  assert.ok(fetchedMessages[1][0].content.includes("校验器"), "第二次请求应使用修正提示词");
  assert.ok(fetchedMessages[1][1].content.includes("龙鸡二连肖200猴30米"), "修正请求应带上原文");
  assert.equal(result.groups.length, 2, "修正后应补回漏掉的二连肖");
  assert.equal(result.ai_guard.repair_attempted, true);
  assert.equal(result.ai_guard.repaired, true);
  assert.deepEqual(result.ai_guard.issues, [], "修正后不应再有自检问题");
  assert.ok(!(result.warnings || []).some(item => String(item).startsWith("AI 自检")),
    "修正成功后不应再显示自检警告");
  assert.equal(result.ai_complete, true);

  console.log("AI resilience tests passed");
})().catch(error => {
  console.error(error);
  process.exit(1);
});

