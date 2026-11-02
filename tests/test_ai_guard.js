const assert = require("node:assert/strict");
const guard = require("../ai-guard.js");

function issuesOf(text, items) {
  return guard.checkFaithfulness(text, { items: items, normalized_text: "", unresolved: [], warnings: [] });
}

const codes = result => result.issues.map(issue => issue.code);

// 1. 干净结果：原文里的数字都有归属，raw 逐字对得上
(() => {
  const clean = issuesOf("17 29 41 每个3块", [{
    raw: "17 29 41 每个3块",
    normalized: "17 29 41各3",
    play_type: "特码总单",
    amount: 3,
    confidence: 0.9
  }]);
  assert.deepEqual(clean.issues, [], "干净结果不应该有意见");
  assert.equal(clean.highCount, 0);
})();

// 2. 空白/标点差异不算编造
(() => {
  const spaced = issuesOf("17 29 41 每个 3 块", [{
    raw: "17 29 41每个3块",
    normalized: "17 29 41各3",
    play_type: "特码总单",
    amount: 3
  }]);
  assert.deepEqual(spaced.issues, [], "仅空白差异不应报错");
})();

// 3. 编造原文片段
(() => {
  const fabricated = issuesOf("17 29 41 每个3块", [{
    raw: "18 30 42各5",
    normalized: "18 30 42各5",
    play_type: "特码总单",
    amount: 5
  }]);
  assert.ok(codes(fabricated).includes("raw_unverified"), "应识别出 raw 不在原文");
  assert.ok(fabricated.highCount >= 1);
})();

// 4. 漏笔：二连肖那 200 没有条目承接，且连肖玩法消失
(() => {
  const dropped = issuesOf("龙鸡二连肖200猴30米", [{
    raw: "猴30米",
    normalized: "特肖 猴 30",
    play_type: "特肖",
    amount: 30
  }]);
  const found = codes(dropped);
  assert.ok(found.includes("amount_unclaimed"), "应发现 200 没有归属");
  assert.ok(found.includes("play_missing"), "应发现连肖玩法丢失");
  assert.ok(dropped.highCount >= 2);

  const messages = guard.summarizeIssues(dropped.issues).join("|");
  assert.ok(messages.includes("200"), "提示里要带上具体数字");
  assert.ok(messages.includes("连肖"), "提示里要带上玩法");
})();

// 5. 玩法前置的五不中被降级成特码总单
(() => {
  const downgraded = issuesOf("五不中 04 06 05 11 12 200", [
    { raw: "04", normalized: "04各200", play_type: "特码总单", amount: 200 },
    { raw: "06", normalized: "06各200", play_type: "特码总单", amount: 200 },
    { raw: "05", normalized: "05各200", play_type: "特码总单", amount: 200 },
    { raw: "11", normalized: "11各200", play_type: "特码总单", amount: 200 },
    { raw: "12", normalized: "12各200", play_type: "特码总单", amount: 200 }
  ]);
  assert.ok(codes(downgraded).includes("play_missing"), "应发现五不中玩法丢失");
})();

// 6. 编造金额：原文只有 200，模型给了 1000
(() => {
  const invented = issuesOf("五不中 04 06 05 11 12 200", [{
    raw: "04 06 05 11 12 200",
    normalized: "04 06 05 11 12 五不中 1000",
    play_type: "五不中",
    amount: 1000
  }]);
  assert.ok(codes(invented).includes("amount_not_in_text"), "应发现 1000 不在原文");
  assert.ok(codes(invented).includes("raw_number_unclaimed"), "应发现 raw 里的 200 和 amount 对不上");
})();

// 7. 年份、日期这类数字不当金额
(() => {
  const noisy = issuesOf("2026年10月12日 17 29 41各3", [{
    raw: "17 29 41各3",
    normalized: "17 29 41各3",
    play_type: "特码总单",
    amount: 3
  }]);
  assert.deepEqual(noisy.issues, [], "年份和日期不应误报");
})();

// 8. 中文数字金额：没有阿拉伯数字时不做金额归属检查
(() => {
  const chinese = issuesOf("五不中 五十米", [{
    raw: "五不中 五十米",
    normalized: "五不中 50",
    play_type: "五不中",
    amount: 50
  }]);
  assert.deepEqual(chinese.issues, [], "中文金额不应触发误报");
})();

// 9. 空 items 不抛错
(() => {
  const empty = guard.checkFaithfulness("17 29 41各3", { items: [] });
  assert.deepEqual(empty.issues, []);
  assert.equal(empty.itemCount, 0);
})();

// 9b. 多行三中三：金额只写在最后一行，也不能误报
(() => {
  const multiline = issuesOf("三中三\n45-05-22\n23-26-17各组10", [
    { raw: "45-05-22", normalized: "三中三 45-05-22各组10", play_type: "三中三", numbers: [45, 5, 22], amount: 10 },
    { raw: "23-26-17各组10", normalized: "三中三 23-26-17各组10", play_type: "三中三", numbers: [23, 26, 17], amount: 10 }
  ]);
  assert.deepEqual(multiline.issues, [], "多行区块不应误报");
})();

// 9c. “生肖+各号”按号码计价，normalized 写“各30”也不能误报
(() => {
  const eachNumber = issuesOf("蛇羊狗鼠马各号30", [{
    raw: "蛇羊狗鼠马各号30",
    normalized: "01,02,07,09,12,13,14,19,21,24,25,26,31,33,36,37,38,43,45,48,49各30",
    play_type: "特码总单",
    numbers: [1, 2, 7, 9, 12, 13, 14, 19, 21, 24, 25, 26, 31, 33, 36, 37, 38, 43, 45, 48, 49],
    amount: 30
  }]);
  assert.deepEqual(eachNumber.issues, [], "各号按号码计价不应误报");
})();

// 10. 修正提示要带原文、上一次结果和问题清单
(() => {
  const previous = { items: [{ raw: "猴30米", amount: 30 }] };
  const messages = guard.buildRepairMessages("龙鸡二连肖200猴30米", previous, [
    { code: "amount_unclaimed", severity: "high", message: "原文里的数字 200 没有任何条目承接" }
  ]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.ok(messages[1].content.includes("龙鸡二连肖200猴30米"));
  assert.ok(messages[1].content.includes("200"));
  assert.ok(messages[1].content.includes("猴30米"));
})();

// 11. 一段真实的多玩法输入，正确结果不应被误报
(() => {
  const multi = issuesOf("龙鸡二连肖200\n猴30米\n三中三\n45-05-22\n23-26-17各组10", [
    { raw: "龙鸡二连肖200", normalized: "二连肖 龙鸡 200", play_type: "2连肖", amount: 200, numbers: [] },
    { raw: "猴30米", normalized: "特肖 猴 30", play_type: "特肖", amount: 30, numbers: [] },
    { raw: "45-05-22", normalized: "三中三 45-05-22各组10", play_type: "三中三", amount: 10, numbers: [45, 5, 22] },
    { raw: "23-26-17各组10", normalized: "三中三 23-26-17各组10", play_type: "三中三", amount: 10, numbers: [23, 26, 17] }
  ]);
  assert.deepEqual(multi.issues, [], "正确的多玩法结果不应误报");
})();

// 12. 粘贴聊天记录时，昵称/时间行里的数字不应被当成“没有归属”
(() => {
  const chat = issuesOf(
    "温柔不是姐的范\n2026年11月02日 18:57\n07.19.43.22.34.46各15\nlyle\n2026年11月02日 18:58\n1\n",
    [{ raw: "07.19.43.22.34.46各15", normalized: "07,19,43,22,34,46各15", play_type: "特码总单", amount: 15, numbers: [7, 19, 43, 22, 34, 46] }]
  );
  assert.deepEqual(chat.issues, [], "聊天记录头不应触发自检问题");
})();

console.log("AI 自检（ai-guard.js）测试通过");
