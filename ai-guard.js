/*
 * BetTool AI 结果自检（无依赖，可在浏览器与 Node 测试中复用）
 *
 * 目的：AI 只负责“读懂原文”，但模型会漏行、编造片段或把金额读错。
 * 这里用确定性的规则，把 AI 返回的 items 与原文做对账：
 *   1. 每一笔的 raw 必须能在原文里逐字找到；
 *   2. 原文里出现的每个数字，都必须有条目承接（防漏笔）；
 *   3. AI 给出的金额必须在原文里出现过（防编造）；
 *   4. 原文提到的玩法，结果里必须有对应玩法（防改玩法）。
 *
 * 检查结果分 high / low 两档：只有 high 会触发一次自动修正请求。
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BetToolAiGuard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var HIGH = "high";
  var LOW = "low";
  var MAX_ISSUES = 10;
  var MAX_CLIP = 28;

  // 聊天记录里的时间：2026年11月02日 18:57 / 11月2日 18:57 / 2026-11-02 18:57
  var CHAT_TIME_RE = /(?:\d{4}\s*[年\-\/]\s*)?\d{1,2}\s*[月\-\/]\s*\d{1,2}\s*日?\s*(?:上午|下午|中午|晚上|凌晨|早上)?\s*\d{1,2}\s*[:：]\s*\d{1,2}/g;

  // 只看这些玩法词；命中词不代表一定错，只在“结果里完全没有对应玩法”时才报。
  var PLAY_KEYWORDS = [
    "连肖", "五不中", "六不中", "七不中", "二中二", "三中三",
    "平特", "特肖", "各肖", "波色"
  ];

  function squeeze(value) {
    return String(value == null ? "" : value)
      .replace(/[\s\u3000]+/g, "")
      .replace(/[，,。.、;；:：!！?？"'“”‘’`()（）\[\]【】{}<>《》]/g, "");
  }

  function clip(text, limit) {
    var value = String(text == null ? "" : text);
    var max = limit || MAX_CLIP;
    return value.length > max ? value.slice(0, max) + "…" : value;
  }

  function itemList(ai) {
    var items = ai && Array.isArray(ai.items) ? ai.items : [];
    var out = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && typeof items[i] === "object") out.push({ index: i + 1, item: items[i] });
    }
    return out;
  }

  function numberTokens(text) {
    var tokens = [];
    var re = /\d+(?:\.\d+)?/g;
    var match;
    while ((match = re.exec(text)) !== null) {
      tokens.push({ value: match[0], index: match.index, end: match.index + match[0].length });
    }
    return tokens;
  }

  function isNoiseToken(token, squeezed, tokenInfo) {
    if (token.length > 4) return true;                     // 期号、电话等
    if (/^(19|20)\d{2}$/.test(token)) return true;          // 年份
    if (/[年月日时分秒]/.test(squeezed.charAt(tokenInfo.end))) return true; // 日期
    if (token === "0") return true;
    return false;
  }

  function toNumber(value) {
    var n = Number(value);
    return isFinite(n) ? n : NaN;
  }

  function sameNumber(a, b) {
    return isFinite(a) && isFinite(b) && Math.abs(a - b) < 0.0001;
  }

  function checkFaithfulness(rawText, ai, options) {
    options = options || {};
    var result = { issues: [], highCount: 0, lowCount: 0, itemCount: 0, tokenCount: 0 };
    var squeezed = squeeze(rawText);
    if (!squeezed) return result;

    var entries = itemList(ai);
    result.itemCount = entries.length;
    if (!entries.length) return result;

    var raws = entries.map(function (entry) { return squeeze(entry.item.raw); });

    // 1) raw 必须来自原文
    entries.forEach(function (entry, position) {
      var raw = raws[position];
      if (!raw) {
        result.issues.push({
          code: "raw_missing", severity: HIGH,
          message: "第 " + entry.index + " 项没有给出对应的原文片段"
        });
      } else if (squeezed.indexOf(raw) < 0) {
        result.issues.push({
          code: "raw_unverified", severity: HIGH,
          message: "第 " + entry.index + " 项的原文片段在输入里找不到：" + clip(entry.item.raw)
        });
      }
    });

    var amounts = entries.map(function (entry) { return toNumber(entry.item.amount); });
    var positiveAmounts = amounts.filter(function (n) { return isFinite(n) && n > 0; });

    // 2) 原文数字必须都有归属
    // 注意：按原文取数字（保留空格/点的分隔），否则 "04 06 05" 会被拼成一个假数字。
    // 聊天记录头（2026年11月02日 18:57 / 18:57）里的数字不是下注，先剔掉再取数字。
    var sourceText = String(rawText == null ? "" : rawText);
    var tokenSource = sourceText
      .replace(CHAT_TIME_RE, " ")
      .replace(/^\s*\d{1,2}\s*[:：]\s*\d{1,2}\s*$/gm, " ");
    var tokens = numberTokens(tokenSource);
    result.tokenCount = tokens.length;
    var unclaimed = [];
    var coveredByRaw = function (token) {
      return raws.some(function (raw) { return raw.indexOf(token) >= 0; });
    };
    var coveredByAmount = function (token) {
      var n = toNumber(token);
      return positiveAmounts.some(function (amount) { return sameNumber(amount, n); });
    };
    tokens.forEach(function (tokenInfo) {
      var token = tokenInfo.value;
      if (isNoiseToken(token, tokenSource, tokenInfo)) return;
      if (coveredByRaw(token) || coveredByAmount(token)) return;
      if (unclaimed.indexOf(token) < 0) unclaimed.push(token);
    });
    unclaimed.slice(0, 3).forEach(function (token) {
      result.issues.push({
        code: "amount_unclaimed", severity: HIGH,
        message: "原文里的数字 " + token + " 没有任何条目承接，可能漏掉了一笔下注"
      });
    });

    // 3) 金额必须出现在原文；原文用中文数字写金额时跳过，避免误报
    //    分段解析时金额可能落在相邻分段，这里不做判断。
    var hasChineseAmount = /[零〇一二两三四五六七八九十百千万]+\s*(?:米|块|元|文|斤|片|闷|门)/.test(String(rawText == null ? "" : rawText));
    if (tokens.length && !hasChineseAmount && !options.partial) {
      entries.forEach(function (entry, position) {
        var amount = amounts[position];
        if (!isFinite(amount) || amount <= 0) return;
        if (raws[position].indexOf(String(amount)) >= 0) return;
        var found = tokens.some(function (tokenInfo) { return sameNumber(toNumber(tokenInfo.value), amount); });
        if (!found) {
          result.issues.push({
            code: "amount_not_in_text", severity: LOW,
            message: "第 " + entry.index + " 项金额 " + amount + " 在原文里找不到对应数字"
          });
        }
      });
    }

    // 3b) raw 里大于 49 的数字只可能是金额；和这一项的 amount 对不上，就是金额读错
    entries.forEach(function (entry, position) {
      var rawSqueezed = raws[position];
      if (!rawSqueezed) return;
      var rawOriginal = String(entry.item.raw == null ? "" : entry.item.raw);
      var amount = amounts[position];
      var numbers = Array.isArray(entry.item.numbers) ? entry.item.numbers.map(Number) : [];
      var seen = [];
      numberTokens(rawOriginal).forEach(function (tokenInfo) {
        var token = tokenInfo.value;
        var n = toNumber(token);
        if (!isFinite(n) || n <= 49) return;
        if (isNoiseToken(token, rawOriginal, tokenInfo)) return;
        if (isFinite(amount) && sameNumber(amount, n)) return;
        if (numbers.some(function (value) { return sameNumber(value, n); })) return;
        if (seen.indexOf(token) >= 0) return;
        seen.push(token);
        result.issues.push({
          code: "raw_number_unclaimed", severity: HIGH,
          message: "第 " + entry.index + " 项的原文片段里写着金额 " + token + "，但这一项的 amount 是 " +
            (isFinite(amount) ? amount : "空")
        });
      });
    });

    // 4) 原文玩法不能凭空消失
    var itemPlayText = entries.map(function (entry) {
      var item = entry.item;
      return squeeze([item.play_type, item.normalized].join(" "));
    }).join("|");
    var unresolvedText = squeeze((Array.isArray(ai.unresolved) ? ai.unresolved : []).map(function (value) {
      return typeof value === "string" ? value : JSON.stringify(value);
    }).join("|"));
    PLAY_KEYWORDS.forEach(function (keyword) {
      if (squeezed.indexOf(keyword) < 0) return;
      if (itemPlayText.indexOf(keyword) >= 0) return;
      if (unresolvedText.indexOf(keyword) >= 0) return;
      result.issues.push({
        code: "play_missing", severity: HIGH,
        message: "原文提到“" + keyword + "”，但结果里没有对应玩法"
      });
    });

    if (result.issues.length > MAX_ISSUES) result.issues = result.issues.slice(0, MAX_ISSUES);
    result.highCount = result.issues.filter(function (issue) { return issue.severity === HIGH; }).length;
    result.lowCount = result.issues.length - result.highCount;
    return result;
  }

  function buildRepairMessages(rawText, ai, issues) {
    var list = (issues || []).map(function (issue, index) {
      return (index + 1) + ". " + issue.message;
    }).join("\n");
    var previous = "";
    try {
      previous = JSON.stringify(ai);
    } catch (_) {
      previous = "";
    }
    if (previous.length > 6000) previous = previous.slice(0, 6000) + "…（已截断）";
    var text = String(rawText == null ? "" : rawText);
    if (text.length > 8000) text = text.slice(0, 8000) + "…（已截断）";

    return [
      {
        role: "system",
        content: "你是 BetTool 的解析结果校验器。你会拿到下注原文、上一次的解析 JSON，以及一组“与原文对不上”的问题。" +
          "请逐条修正，只输出修正后的完整 JSON，字段与上一次完全相同，不要 Markdown，不要解释。"
      },
      {
        role: "user",
        content: "原文：\n\"\"\"\n" + text + "\n\"\"\"\n\n" +
          "上一次的解析结果：\n" + previous + "\n\n" +
          "需要修正的问题：\n" + list + "\n\n" +
          "要求：\n" +
          "1. 只修正这些问题，原文里本来正确的条目不重排、不改写。\n" +
          "2. 每个 items[].raw 必须是原文里逐字出现的片段，amount 必须是原文写出的数字。\n" +
          "3. 原文里确实无法确定的部分写进 unresolved，不要猜。\n" +
          "4. normalized_text 按 items 顺序逐行组合，仍返回 {success, normalized_text, items, unresolved, warnings}。"
      }
    ];
  }

  function summarizeIssues(issues) {
    return (issues || []).map(function (issue) { return issue.message; });
  }

  return {
    squeeze: squeeze,
    checkFaithfulness: checkFaithfulness,
    buildRepairMessages: buildRepairMessages,
    summarizeIssues: summarizeIssues,
    PLAY_KEYWORDS: PLAY_KEYWORDS
  };
});
