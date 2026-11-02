/*
 * BetTool 记录备份（无依赖，可在浏览器与 Node 测试中复用）
 *
 * 备份内容：下注记录、赔率、回水、风险扣数、当前用户、开奖号码。
 * 只在本机导出/导入，不上传任何服务器。
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BetToolBackup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var FORMAT = "bettool-state-backup";
  var VERSION = 1;

  function text(value, fallback) {
    return String(value == null ? (fallback == null ? "" : fallback) : value);
  }

  function number(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function sanitizeRecords(records) {
    var out = [];
    (Array.isArray(records) ? records : []).forEach(function (record, index) {
      if (!record || typeof record !== "object" || Array.isArray(record)) return;
      out.push({
        seq: number(record.seq, index + 1),
        raw_text: text(record.raw_text),
        bet_content: text(record.bet_content),
        amount: number(record.amount, 0),
        created_at: text(record.created_at),
        groups: Array.isArray(record.groups) ? record.groups : [],
        warnings: Array.isArray(record.warnings) ? record.warnings.map(String) : [],
        region: text(record.region, "澳门") || "澳门",
        user: text(record.user, "A") || "A"
      });
    });
    return out;
  }

  function build(state, now) {
    var source = state || {};
    return {
      format: FORMAT,
      version: VERSION,
      exported_at: new Date(now == null ? Date.now() : now).toISOString(),
      state: {
        year: text(source.year),
        records: Array.isArray(source.records) ? source.records : [],
        odds: source.odds && typeof source.odds === "object" ? source.odds : {},
        rebate: source.rebate && typeof source.rebate === "object" ? source.rebate : {},
        riskDeductions: Array.isArray(source.riskDeductions) ? source.riskDeductions : [],
        currentUser: text(source.currentUser, "A") || "A",
        winFilterUser: text(source.winFilterUser, "全部") || "全部",
        macau: text(source.macau),
        hk: text(source.hk)
      }
    };
  }

  function parse(rawText) {
    var data;
    try {
      data = JSON.parse(String(rawText == null ? "" : rawText));
    } catch (error) {
      return { ok: false, error: "不是有效的 JSON 文件" };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "备份格式不正确" };
    }
    // 兼容直接保存 state 的旧文件
    var state = data.state && typeof data.state === "object" ? data.state : data;
    if (!Array.isArray(state.records)) {
      return { ok: false, error: "备份里没有下注记录（records）" };
    }
    var records = sanitizeRecords(state.records);
    if (state.records.length && !records.length) {
      return { ok: false, error: "备份里的记录都无法识别" };
    }
    return {
      ok: true,
      exported_at: text(data.exported_at),
      count: records.length,
      state: {
        year: text(state.year),
        records: records,
        odds: state.odds && typeof state.odds === "object" ? state.odds : {},
        rebate: state.rebate && typeof state.rebate === "object" ? state.rebate : {},
        riskDeductions: Array.isArray(state.riskDeductions) ? state.riskDeductions : [],
        currentUser: text(state.currentUser, "A") || "A",
        winFilterUser: text(state.winFilterUser, "全部") || "全部",
        macau: text(state.macau),
        hk: text(state.hk)
      }
    };
  }

  return { build: build, parse: parse, FORMAT: FORMAT, VERSION: VERSION };
});
