"use strict";

// ==================== 常量 ====================
const YEAR_MAP = {
  "马年（2026 默认）": "马",
  "蛇年（2025）": "蛇",
  "龙年": "龙", "兔年": "兔", "虎年": "虎", "牛年": "牛",
  "鼠年": "鼠", "猪年": "猪", "狗年": "狗", "鸡年": "鸡",
  "猴年": "猴", "羊年": "羊",
};

const DEFAULT_ODDS = {
  tema:47, texiao:11, texiao_ma:10,
  pingte_xiao:2, pingte_xiao_ma:1.75,
  pingte_tail:null, color:null,
  lianxiao_2:4, lianxiao_2_ma:3.5,
  lianxiao_3:10, lianxiao_3_ma:8.5,
  lianxiao_4:30, lianxiao_4_ma:25,
  lianxiao_5:100, lianxiao_5_ma:85,
  pingma_2:null, pingma_3:null,
  wubuzhong:null,
};

const ODDS_ITEMS = [
  ["tema","特码"],["texiao","特肖（非马）"],["texiao_ma","特肖马"],
  ["pingte_xiao","平特一肖（不带马）"],["pingte_xiao_ma","平特一肖（带马/马）"],
  ["pingte_tail","平特尾"],["color","波色/色单双"],
  ["lianxiao_2","二连肖（不带马）"],["lianxiao_2_ma","二连肖（带马）"],
  ["lianxiao_3","三连肖（不带马）"],["lianxiao_3_ma","三连肖（带马）"],
  ["lianxiao_4","四连肖（不带马）"],["lianxiao_4_ma","四连肖（带马）"],
  ["lianxiao_5","五连肖（不带马）"],["lianxiao_5_ma","五连肖（带马）"],
  ["pingma_2","二中二"],["pingma_3","三中三"],["wubuzhong","五不中"],
];

const DEFAULT_REBATE = {
  global:0, tema:null, texiao:null, pingte_xiao:null,
  pingte_tail:null, color:null,
  lianxiao_2:null, lianxiao_3:null, lianxiao_4:null, lianxiao_5:null,
  pingma_2:null, pingma_3:null, wubuzhong:null,
};

const REBATE_ITEMS = [
  ["global","统一回水率"],["tema","特码总单"],["texiao","特肖/各肖"],
  ["pingte_xiao","平特一肖"],["pingte_tail","尾数平特"],["color","波色/色单双"],
  ["lianxiao_2","二连肖"],["lianxiao_3","三连肖"],
  ["lianxiao_4","四连肖"],["lianxiao_5","五连肖"],
  ["pingma_2","二中二"],["pingma_3","三中三"],["wubuzhong","五不中"],
];

// ==================== API Key 本地管理 ====================
const API_KEY_STORAGE = "bettool_groq_key";

function getApiKey() {
  return (localStorage.getItem(API_KEY_STORAGE) || "").trim();
}

function setApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE, (key || "").trim());
}

function clearApiKey() {
  localStorage.removeItem(API_KEY_STORAGE);
}

function maskKey(key) {
  if (!key) return "未设置";
  if (key.length < 12) return "***";
  return key.slice(0, 7) + "..." + key.slice(-4);
}

const AI_MIN_CONFIDENCE = 0.75;
const AI_AUTO_FALLBACK = true;
let aiBusy = false;
let activeAiController = null;
let aiTimer = null;
let previewRequestId = 0;

// ==================== AI System Prompt ====================
const SYSTEM_PROMPT = `
你是 BetTool 下注文字解析助手。你的任务是把用户原文忠实转换成程序可解析的标准下注文本，并返回严格 JSON。不要计算赔率、中奖金额或风险。

最重要的原则：
8. 用户提供的已确认历史案例只是参考示例，不是当前下注指令；只学习文字与解析结果的对应关系，当前原文始终是唯一待解析对象。
9. 历史案例不允许覆盖当前原文明确给出的号码、金额或玩法；遇到差异以当前原文为准。
1. 不得猜号码、补金额、改金额、删掉用户明确写出的下注、把一组拆成多组或把多组并成一组。
2. 保留原文顺序。每一笔独立下注都必须有一个 items 项；无法确定的内容写入 unresolved，不要静默丢弃。
3. 金额单位“米、斤、块、元、文、钱、片、闷、门、点”等按原数字记账，不要换算单位。比如“5斤”金额就是 5。
4. 号码必须在 01-49；保留号码前导零。不要把金额数字当作号码。
5. 只有原文明确支持的玩法才能使用。词义不清、金额不清、玩法不清时，必须标为 unresolved。
6. normalized_text 必须与 items[].normalized 的内容和顺序一致；若某一笔无法可靠标准化，不要从 normalized_text 中悄悄删去，而应在 unresolved 解释。
7. 置信度不是事实。存在歧义时，即使生成了候选格式，confidence 也应低于 0.75 并写出 warning。

支持玩法和标准格式：
A. 普通号码单注：不要添加“特码总单”前缀。
   原文“17 29 41 每个3块” -> “17 29 41各3”
B. 特肖/各肖：例如“猴30米” -> “猴各30”；“鸡狗各肖10” -> “鸡狗各10”
C. 平特一肖：例如“平特鸡200块” -> “平特一肖：鸡 200”
D. 连肖：必须使用阿拉伯数字 2/3/4/5，例如“四连虎鸡牛狗10块” -> “4连肖：虎鸡牛狗 10”
E. 五不中/六不中/七不中：例如“04.06.05.11.12 五不中 200文” -> “04 06 05 11 12 五不中 200”
F. 二中二/三中三：
   - 若原文明确列出具体组合并使用“各组/每组”，每一组三个号码（或二中二的两个号码）必须原样保留，金额是每组金额。每个组合可单独输出一项，例如“45-05-22各组10” -> “三中三 45-05-22各组10”。
   - 若原文是多行区块，必须保留所有组合行和每组金额；例如“三中三\n45-05-22\n23-26-17各组10”可输出为两个独立项：“三中三 45-05-22各组10”和“三中三 23-26-17各组10”。
   - 若原文明确说复式/复试，并给出一组号码和金额，可按号码选择玩法输出，例如“三中三复式 01 02 03 04 各2” -> “三中三 01 02 03 04各2”。
   - 不要把“列出的具体组合”误判为“从所有号码自动组合”；含义不确定时放入 unresolved。
G. 波色、单双大小、平特尾按原文类别和金额标准化。

返回对象必须包含这些字段：
{
  "success": true,
  "normalized_text": "逐笔标准化文本，以换行分隔",
  "items": [
    {
      "raw": "对应的原始下注片段",
      "normalized": "一笔下注的标准化文本",
      "play_type": "特码/特肖/各肖/平特一肖/二中二/三中三/五不中等",
      "numbers": [1, 2, 3],
      "zodiacs": ["鸡"],
      "amount": 10,
      "confidence": 0.95
    }
  ],
  "unresolved": [],
  "warnings": []
}

要求：
- items 中每一项的 normalized 必须非空，并且 amount 必须是原文中实际写出的正数；无法从原文确定时不要编造。
- 普通号码行里的 numbers 只填号码；生肖玩法的 zodiacs 填生肖。
- 同一笔里重复出现的号码不得自行改写原文；若程序标准化必须去重，应在 warnings 中说明。
- normalized_text 必须按 items 顺序逐行组合；若有未能解析的原文，完整列出 unresolved。
- 只返回合法 JSON，不要 Markdown，不要代码围栏，不要输出额外解释。

`;

// ==================== 状态 ====================
let pyodide = null;
let coreReady = false;
let previewResult = null;
let previewTimer = null;
let currentSubtab = "numbers";
let currentSettingsTab = "odds";

const state = {
  year: "马年（2026 默认）",
  records: [],
  odds: { ...DEFAULT_ODDS },
  rebate: { ...DEFAULT_REBATE },
  currentUser: "A",
  winFilterUser: "全部",
};

// ==================== 工具 ====================
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

function fmtNum(v) {
  if (v === null || v === undefined) return "";
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/\.?0+$/, "");
}
function setStatus(s) { const el = $("#status"); if (el) el.textContent = s; }
function toast(msg, ms=1800) {
  const d = document.createElement("div");
  d.textContent = msg;
  Object.assign(d.style, {
    position:"fixed", left:"50%", bottom:"80px", transform:"translateX(-50%)",
    background:"rgba(20,25,35,0.95)", color:"#eef0f3", padding:"10px 16px",
    borderRadius:"10px", fontSize:"14px", zIndex:9998, pointerEvents:"none",
    maxWidth:"85vw", textAlign:"center", lineHeight:1.4,
  });
  document.body.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

// ==================== localStorage ====================
const LS_KEY = "bettool_state_v1";

function saveLocal() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      year: state.year,
      records: state.records,
      odds: state.odds,
      rebate: state.rebate,
      currentUser: state.currentUser,
      winFilterUser: state.winFilterUser,
      macau: $("#macau-draw")?.value || "",
      hk: $("#hk-draw")?.value || "",
    }));
  } catch(e) { console.warn(e); }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.year) state.year = data.year;
    if (Array.isArray(data.records)) state.records = data.records;
    if (data.odds) state.odds = { ...DEFAULT_ODDS, ...data.odds };
    if (data.rebate) state.rebate = { ...DEFAULT_REBATE, ...data.rebate };
    if (data.currentUser) state.currentUser = data.currentUser;
    if (data.winFilterUser) state.winFilterUser = data.winFilterUser;
    if (data.macau && $("#macau-draw")) $("#macau-draw").value = data.macau;
    if (data.hk && $("#hk-draw")) $("#hk-draw").value = data.hk;
  } catch(e) { console.warn(e); }
}

// ==================== Pyodide 桥接 ====================
const PY_WRAPPER = `
import json
from core import (
    parse_bet, parse_draw_result, settle_orders,
    summarize_orders, export_xlsx, build_risk_rows,
    OrderRecord, BetGroup,
    ai_result_to_preview,
)

def _rebuild(s):
    out = []
    for r in json.loads(s):
        gs = [BetGroup(
            numbers=list(g.get("numbers") or []),
            amount=float(g["amount"]),
            label=g.get("label",""),
            source=g.get("source",""),
            play_type=g.get("play_type","特码总单"),
            billing_mode=g.get("billing_mode","per_number"),
            selection_text=g.get("selection_text",""),
            multiplier=int(g.get("multiplier",1)),
        ) for g in r.get("groups",[])]
        out.append(OrderRecord(
            seq=int(r["seq"]),
            raw_text=r["raw_text"],
            bet_content=r.get("bet_content",""),
            amount=float(r["amount"]),
            created_at=r.get("created_at",""),
            groups=gs,
            warnings=list(r.get("warnings") or []),
            region=r.get("region","澳门"),
        ))
    return out

def js_parse_bet(text, year):
    r = parse_bet(text, year)
    return json.dumps({
        "content": r.content,
        "total": float(r.total),
        "warnings": list(r.warnings),
        "raw_text": r.raw_text,
        "normalized_text": r.normalized_text,
        "groups": [{
            "play_type": g.play_type, "label": g.label,
            "amount": float(g.amount), "total": float(g.total),
            "billing_mode": g.billing_mode,
            "selection_text": g.selection_text,
            "multiplier": int(g.multiplier),
            "numbers": list(g.numbers),
            "source": g.source,
        } for g in r.groups],
    }, ensure_ascii=False)

def js_parse_ai_result(ai_json, year):
    data = json.loads(ai_json)
    result = ai_result_to_preview(data, year)
    return json.dumps(result, ensure_ascii=False)

def js_summarize(records_json, year):
    recs = _rebuild(records_json)
    nr, zr, cr, pr = summarize_orders(recs, year)
    return json.dumps({"numbers":nr,"zodiac":zr,"plays":pr}, ensure_ascii=False)

def js_settle(records_json, macau_str, hk_str, year, odds_json, rebate_json):
    recs = _rebuild(records_json)
    mac = parse_draw_result(macau_str or "", year)
    hk = parse_draw_result(hk_str or "", year)
    odds = json.loads(odds_json)
    rebate = json.loads(rebate_json)
    detail, summary = settle_orders(recs, {"澳门":mac,"香港":hk}, odds, rebate)
    return json.dumps({"summary":summary}, ensure_ascii=False)

def js_export_xlsx(records_json, macau_str, hk_str, year, odds_json, rebate_json):
    import tempfile, os, base64
    recs = _rebuild(records_json)
    mac = parse_draw_result(macau_str or "", year)
    hk = parse_draw_result(hk_str or "", year)
    odds = json.loads(odds_json)
    rebate = json.loads(rebate_json)
    path = os.path.join(tempfile.gettempdir(), "out.xlsx")
    export_xlsx(path, recs, year, {"澳门":mac,"香港":hk}, odds, rebate)
    with open(path,"rb") as f: data = f.read()
    return base64.b64encode(data).decode("ascii")

def js_risk_rows(records_json, year, odds_json, rebate_json):
    recs = _rebuild(records_json)
    odds = json.loads(odds_json)
    rebate = json.loads(rebate_json)
    rows = build_risk_rows(recs, year, odds, rebate)
    return json.dumps(rows, ensure_ascii=False)
`;

async function initPyodide() {
  const lm = $("#loading-msg");
  lm.textContent = "正在加载 Python 运行时（首次约 10–20 秒）…";
  pyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
  });
  lm.textContent = "正在加载解析内核…";
  const coreSrc = await fetch("core.py?v=6", { cache: "no-store" }).then(r => r.text());

  pyodide.FS.writeFile("/home/pyodide/core.py", coreSrc);
  await pyodide.runPythonAsync(`
import sys
if "/home/pyodide" not in sys.path:
    sys.path.insert(0, "/home/pyodide")
import core
`);

  await pyodide.runPythonAsync(PY_WRAPPER);
  coreReady = true;
}

function pyCall(name, ...args) {
  const fn = pyodide.globals.get(name);
  if (!fn) throw new Error("找不到 Python 函数 " + name);
  try { return fn(...args); } finally { fn.destroy(); }
}

const yearAnimal = () => YEAR_MAP[state.year] || "马";

async function pyParseBet(text) {
  return JSON.parse(pyCall("js_parse_bet", text, yearAnimal()));
}

async function pyParseAIResult(aiResult) {
  return JSON.parse(
    pyCall("js_parse_ai_result", JSON.stringify(aiResult), yearAnimal())
  );
}

async function pySummarize() {
  return JSON.parse(pyCall("js_summarize", JSON.stringify(state.records), yearAnimal()));
}
async function pySettle(records) {
  return JSON.parse(pyCall("js_settle",
    JSON.stringify(records || state.records),
    $("#macau-draw").value, $("#hk-draw").value, yearAnimal(),
    JSON.stringify(state.odds), JSON.stringify(state.rebate)));
}
async function pyExportXlsx() {
  return pyCall("js_export_xlsx",
    JSON.stringify(state.records),
    $("#macau-draw").value, $("#hk-draw").value, yearAnimal(),
    JSON.stringify(state.odds), JSON.stringify(state.rebate));
}
async function pyRiskRows() {
  return JSON.parse(pyCall("js_risk_rows",
    JSON.stringify(state.records),
    yearAnimal(),
    JSON.stringify(state.odds),
    JSON.stringify(state.rebate)));
}

// ==================== 预览展示与 AI 调用 ====================
function setAiStatus(message, state) {
  const node = $("#ai-status");
  if (node) {
    node.textContent = String(message || "");
    node.dataset.state = state || "idle";
  }
  const button = $("#btn-ai-parse");
  if (button) button.disabled = state === "busy";
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setPreviewBadge(text, kind) {
  const badge = $("#preview-state");
  if (!badge) return;
  badge.textContent = text;
  badge.className = "badge" + (kind ? " " + kind : "");
}

function renderPreviewEmpty(message) {
  const box = $("#preview-box");
  if (box) {
    box.className = "preview-box";
    box.innerHTML = '<div class="preview-placeholder">' + escapeHtml(message || "等待输入下注内容。解析完成后会在这里逐组显示结果。") + "</div>";
  }
  setPreviewBadge("等待输入", "");
}

function renderPreviewResult(result, sourceLabel) {
  const box = $("#preview-box");
  if (!box) return;
  const groups = Array.isArray(result && result.groups) ? result.groups : [];
  const warnings = Array.isArray(result && result.warnings) ? result.warnings : [];
  const unresolved = Array.isArray(result && result.ai_unresolved) ? result.ai_unresolved : [];
  const needsCheck = warnings.length > 0 || unresolved.length > 0 ||
    result.ai_complete === false || result.ai_low_confidence === true;
  const source = sourceLabel || (result.ai ? "AI 解析结果" : "本地规则结果");
  setPreviewBadge(needsCheck ? "请核对" : "已生成预览", needsCheck ? "warning" : "success");

  const groupHtml = groups.map(function(group, index) {
    const type = group.play_type || group.label || "下注项目";
    const selection = group.selection_text || group.source ||
      (Array.isArray(group.numbers) && group.numbers.length ? group.numbers.join(" · ") : "") ||
      group.label || "未提供号码文本";
    const amount = group.amount === null || group.amount === undefined ? "—" : fmtNum(group.amount);
    const subtotal = group.total === null || group.total === undefined ? "—" : fmtNum(group.total);
    const multiplier = group.multiplier === null || group.multiplier === undefined ? "—" : String(group.multiplier);
    return '<article class="parsed-group-card">' +
      '<div class="group-head"><strong>' + escapeHtml(type) + '</strong><span>第 ' + (index + 1) + ' 组</span></div>' +
      '<div class="group-selection">' + escapeHtml(selection) + '</div>' +
      '<div class="group-meta">' +
        '<div><span>单组金额</span><strong>' + escapeHtml(amount) + '</strong></div>' +
        '<div><span>小计</span><strong>' + escapeHtml(subtotal) + '</strong></div>' +
        '<div><span>组合/倍数</span><strong>' + escapeHtml(multiplier) + '</strong></div>' +
      '</div></article>';
  }).join("");

  const warningItems = warnings.map(function(item) {
    return '<div class="preview-warning">' + escapeHtml(item) + '</div>';
  });
  unresolved.forEach(function(item) {
    warningItems.push('<div class="preview-warning">未能确定：' +
      escapeHtml(typeof item === "string" ? item : JSON.stringify(item)) + "</div>");
  });
  if (result.ai_chunk_count > 1) {
    warningItems.push('<div class="preview-warning">长文本已按原文顺序分段解析，共 ' +
      Number(result.ai_chunk_count) + ' 段。请特别核对分段处的玩法、号码组和金额。</div>');
  }
  const normalized = result.content || result.ai_normalized_text || result.normalized_text || "";
  const stats = '<div class="preview-stats">' +
    '<div class="preview-stat"><span>识别分组</span><strong>' + groups.length + '</strong></div>' +
    '<div class="preview-stat total"><span>预览总金额</span><strong>' + escapeHtml(fmtNum(result.total || 0)) + '</strong></div>' +
    '</div>';
  const cards = groups.length
    ? '<div class="parsed-group-list">' + groupHtml + '</div>'
    : '<div class="preview-placeholder">当前结果没有可展示的有效分组。请检查原文或使用 AI 辅助解析。</div>';
  const warningBlock = warningItems.length
    ? '<div class="preview-warnings">' + warningItems.join("") + '</div>' : "";
  const textBlock = normalized
    ? '<details class="standard-text"><summary>查看完整标准化文本</summary><pre>' + escapeHtml(normalized) + '</pre></details>' : "";

  box.className = "preview-box";
  box.innerHTML = '<div class="field-help">' + escapeHtml(source) + '</div>' + stats + cards + warningBlock + textBlock;
}

function aiErrorPresentation(error) {
  const message = String(error && error.message || error || "");
  const isTpm = !!(error && error.aiTpmLimit) ||
    /tokens per minute|\bTPM\b|rate_limit_exceeded|request too large/i.test(message);
  if (isTpm) {
    return {
      title: "AI 请求超过当前每分钟 Token 限额",
      message: "本地解析结果已保留。系统会先尝试缩短提示内容；如果仍然太长，可以把原文拆成较小批次重试。长文本分段可能需要等待额度恢复。",
      isTpm: true
    };
  }
  if (/401|invalid_api_key|unauthorized/i.test(message)) {
    return {
      title: "Groq API Key 未通过验证",
      message: "请在「设置」中检查 API Key 是否完整、仍然有效；不要把密钥发送给他人。",
      isTpm: false
    };
  }
  if (/429|rate.?limit|too many requests/i.test(message)) {
    return {
      title: "AI 服务暂时繁忙",
      message: "当前请求触发了服务频率限制。保留现有解析结果，稍后再试。",
      isTpm: false
    };
  }
  if (/Failed to fetch|Load failed|NetworkError|网络|fetch/i.test(message)) {
    return {
      title: "网络连接失败",
      message: "浏览器暂时无法连接 AI 服务。请检查网络或代理；本地解析结果没有清除。",
      isTpm: false
    };
  }
  return {
    title: "AI 解析没有完成",
    message: "本地结果仍保留。你可以查看技术详情，确认后重试或手动拆分输入。",
    isTpm: false
  };
}

function renderAiFailure(error, localResult) {
  if (localResult && Array.isArray(localResult.groups) && localResult.groups.length) {
    renderPreviewResult(localResult, "本地规则解析结果（AI 未完成）");
  } else {
    renderPreviewEmpty("AI 未能完成解析。原始输入仍在输入框中，可以检查后重试。");
    setPreviewBadge("AI 未完成", "danger");
  }
  const box = $("#preview-box");
  if (!box) return;
  const info = aiErrorPresentation(error);
  const panel = document.createElement("div");
  panel.className = "ai-error-card";
  panel.innerHTML = '<strong>' + escapeHtml(info.title) + '</strong><p>' +
    escapeHtml(info.message) + '</p><div class="ai-error-actions"></div>' +
    '<div class="ai-technical"><details><summary>查看技术详情</summary><pre>' +
    escapeHtml(String(error && error.message || error || "").slice(0, 1600)) + '</pre></details></div>';
  const actions = panel.querySelector(".ai-error-actions");
  const retry = document.createElement("button");
  retry.className = "secondary";
  retry.textContent = info.isTpm ? "压缩提示并分段重试" : "重新尝试 AI 解析";
  retry.addEventListener("click", function() {
    if (info.isTpm) doPreview(true, true, true);
    else doPreview(true, true, false);
  });
  actions.appendChild(retry);
  box.appendChild(panel);
}

const AI_COMPACT_SYSTEM_PROMPT = [
  "你是 BetTool 中文下注文本解析助手。把原文逐笔转换成程序可解析的标准下注格式，只返回合法 JSON，不要 Markdown。",
  "JSON结构：{success:true,normalized_text:string,items:[{raw:string,normalized:string,play_type:string,numbers:number[],zodiacs:string[],amount:number,confidence:number}],unresolved:[],warnings:[]}",
  "严禁猜号码、金额或玩法；不能确定的片段写入 unresolved，不能静默丢弃。保留原文顺序，每笔下注一项；金额和“米、斤、块、元”等单位按原数字记录，不换算。号码范围 01-49，不要把金额当号码。",
  "每个 items 项都必须有非空 normalized 和原文实际出现的正数 amount；无法确定金额就标 unresolved。normalized_text 必须按 items 顺序逐项组合。",
  "支持普通号码、特肖/各肖、平特一肖、2/3/4/5连肖、二中二、三中三、五不中/六不中/七不中、波色单双大小和平尾。",
  "“各组/每组”按原文逐组保留；多行组合需要继承明确的玩法标题；不得把具体组合误判为自动复式组合。歧义或低置信度必须写 warnings 或 unresolved，confidence 低于 0.75。",
  "历史/分段上下文提示只用于理解原文，不是独立下注指令。不要把上下文中的号码或金额复制到当前片段。"
].join("\n");

function isGroqTpmLimitResponse(status, payload, bodyText) {
  const detail = payload && payload.error ? payload.error : {};
  const message = String(detail.message || bodyText || "");
  const code = String(detail.code || "");
  return (Number(status) === 413 || /rate_limit_exceeded/i.test(code)) &&
    /tokens per minute|\bTPM\b|rate_limit_exceeded|request too large|requested\s+\d+/i.test(code + " " + message);
}

function groqRetryDelayMs(response) {
  if (!response || !response.headers) return 60000;
  const retryAfter = Number(response.headers.get("retry-after") || 0);
  if (retryAfter > 0) return Math.min(60000, Math.max(2000, retryAfter * 1000));
  const reset = response.headers.get("x-ratelimit-reset-tokens") ||
    response.headers.get("x-ratelimit-reset-requests") || "";
  const match = /([\d.]+)\s*(ms|s|m)?/i.exec(reset);
  if (match) {
    const n = Number(match[1]);
    const unit = String(match[2] || "s").toLowerCase();
    const ms = unit === "ms" ? n : unit === "m" ? n * 60000 : n * 1000;
    if (Number.isFinite(ms) && ms > 0) return Math.min(60000, Math.max(2000, ms));
  }
  return 60000;
}

async function callBetToolAISingle(text, similarCases, options) {
  options = options || {};
  if (!text || !text.trim()) return null;
  const apiKey = getApiKey();
  if (!apiKey || !apiKey.startsWith("gsk_")) {
    throw new Error("请先在「设置」页填入你的 Groq API Key");
  }
  if (activeAiController) activeAiController.abort();
  aiBusy = true;
  setStatus("🤖 AI 正在解析…");
  setAiStatus(options.partNumber
    ? "AI 分段解析中（" + options.partNumber + "/" + options.totalParts + "）…"
    : "AI 正在解析；已保留本地结果。", "busy");
  const controller = new AbortController();
  activeAiController = controller;
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const userMessage = typeof buildAiUserMessage === "function"
      ? buildAiUserMessage(text, options.compact ? [] : (similarCases || []), options)
      : "请逐笔解析以下下注原文，只返回 JSON：\n" + text;
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: options.compact ? AI_COMPACT_SYSTEM_PROMPT : SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        temperature: 0,
        response_format: { type: "json_object" }
      })
    });

    const responseText = await response.text();
    if (!response.ok) {
      let errorPayload = {};
      try { errorPayload = JSON.parse(responseText); } catch (_) {}
      const detail = errorPayload && errorPayload.error ? errorPayload.error : {};
      const message = String(detail.message || responseText || "未知错误");
      const limited = isGroqTpmLimitResponse(response.status, errorPayload, responseText);
      const apiError = new Error(limited
        ? "Groq 当前每分钟 Token 限额不足：" + message.slice(0, 550)
        : "Groq API " + response.status + "：" + message.slice(0, 800));
      apiError.aiTpmLimit = limited;
      apiError.httpStatus = response.status;
      apiError.retryAfterMs = groqRetryDelayMs(response);
      throw apiError;
    }

    let data;
    try { data = JSON.parse(responseText); }
    catch (_) { throw new Error("Groq API 响应不是有效 JSON"); }

    const textOutput = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content
      ? data.choices[0].message.content.trim() : "";
    if (!textOutput) throw new Error("Groq 没有返回有效解析结果");

    let ai;
    try { ai = JSON.parse(textOutput); }
    catch (_) {
      const first = textOutput.indexOf("{");
      const last = textOutput.lastIndexOf("}");
      if (first < 0 || last <= first) {
        throw new Error("Groq 返回内容无法解析为 JSON：" + textOutput.slice(0, 500));
      }
      try { ai = JSON.parse(textOutput.slice(first, last + 1)); }
      catch (_) { throw new Error("Groq 返回的 JSON 格式不完整：" + textOutput.slice(0, 500)); }
    }
    if (!ai || typeof ai !== "object" || Array.isArray(ai)) {
      throw new Error("AI 结果格式错误：最外层必须是 JSON 对象");
    }

    const items = Array.isArray(ai.items) ? ai.items : [];
    const lowConfidence = items.length === 0 || items.some(
      item => !item || Number(item.confidence || 0) < AI_MIN_CONFIDENCE
    );
    const parsed = await pyParseAIResult(ai);
    parsed.ai = true;
    parsed.ai_raw = ai;
    parsed.ai_low_confidence = lowConfidence;
    parsed.ai_normalized_text = String(ai.normalized_text || "");
    parsed.ai_unresolved = Array.isArray(parsed.unresolved)
      ? parsed.unresolved
      : (Array.isArray(ai.unresolved) ? ai.unresolved : []);
    parsed.ai_complete = parsed.ai_complete === true &&
      !lowConfidence && parsed.ai_unresolved.length === 0;
    parsed.raw_text = text;
    parsed.ai_prompt_compacted = !!options.compact;
    return parsed;
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("AI 请求超时（45 秒），请稍后重试");
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (activeAiController === controller) {
      activeAiController = null;
      aiBusy = false;
      setStatus("就绪");
      if (!$("#ai-status") || $("#ai-status").dataset.state === "busy") {
        setAiStatus("AI 请求阶段结束。", "idle");
      }
    }
  }
}

function extractAiPlayContext(line) {
  const text = String(line || "").trim().replace(/[：:]+$/g, "");
  if (!text || text.length > 22) return "";
  const heading = /^(?:(?:平码)?复式\s*)?(?:二中二|三中三|五不中|六不中|七不中|六肖中|二连肖|三连肖|四连肖|五连肖|[2-5]连肖|平特一肖|平特尾|各肖|特肖|波色|特码)(?:复式)?$/;
  return heading.test(text) ? text : "";
}

function splitLongAiLine(line, maxChars) {
  const parts = [];
  let rest = String(line);
  while (rest.length > maxChars) {
    const floor = Math.floor(maxChars * 0.58);
    const delimiters = ["，", ",", "；", ";", "、", "/", " "];
    let cut = -1;
    for (const delimiter of delimiters) {
      const index = rest.lastIndexOf(delimiter, maxChars - 1);
      if (index >= floor && index > cut) cut = index;
    }
    if (cut < 0) cut = maxChars - 1;
    const end = cut + 1;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  parts.push(rest);
  return parts;
}

function splitAiTextIntoChunks(text, maxChars) {
  const limit = Math.max(300, Number(maxChars) || 2600);
  const sourceLines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const lines = [];
  for (const line of sourceLines) {
    if (line.length > limit) lines.push.apply(lines, splitLongAiLine(line, limit));
    else lines.push(line);
  }
  const chunks = [];
  let buffer = [];
  let bufferLength = 0;
  let activeContext = "";
  let bufferContext = "";
  for (const line of lines) {
    const lineLength = line.length + (buffer.length ? 1 : 0);
    if (buffer.length && bufferLength + lineLength > limit) {
      chunks.push({ text: buffer.join("\n"), context: bufferContext });
      buffer = [];
      bufferLength = 0;
      bufferContext = activeContext;
    }
    buffer.push(line);
    bufferLength += line.length + (buffer.length > 1 ? 1 : 0);
    const detected = extractAiPlayContext(line);
    if (detected) activeContext = detected;
  }
  if (buffer.length || !chunks.length) chunks.push({ text: buffer.join("\n"), context: bufferContext });
  return chunks;
}

function mergeAiChunkResults(fullText, results) {
  const groups = [];
  const warnings = [];
  const unresolved = [];
  const items = [];
  for (const result of results) {
    if (Array.isArray(result.groups)) groups.push.apply(groups, result.groups);
    if (Array.isArray(result.warnings)) warnings.push.apply(warnings, result.warnings);
    if (Array.isArray(result.ai_unresolved)) unresolved.push.apply(unresolved, result.ai_unresolved);
    else if (Array.isArray(result.unresolved)) unresolved.push.apply(unresolved, result.unresolved);
    if (result.ai_raw && Array.isArray(result.ai_raw.items)) items.push.apply(items, result.ai_raw.items);
  }
  const content = results.map(result => String(result.content || "")).filter(Boolean).join("\n");
  const normalized = results.map(result => String(result.ai_normalized_text || result.normalized_text || ""))
    .filter(Boolean).join("\n");
  warnings.push("原文已按顺序分成 " + results.length + " 段解析。请特别核对分段处的玩法标题、金额和组合是否完整。");
  const uniqueWarnings = Array.from(new Set(warnings.map(String)));
  const total = groups.reduce((sum, group) => sum + (Number(group.total) || 0), 0);
  return {
    ...results[0],
    raw_text: fullText,
    content: content,
    total: total,
    groups: groups,
    warnings: uniqueWarnings,
    unresolved: unresolved,
    ai: true,
    ai_raw: { success: results.every(result => result.ai_raw && result.ai_raw.success !== false),
      normalized_text: normalized, items: items, unresolved: unresolved, warnings: uniqueWarnings },
    ai_normalized_text: normalized,
    normalized_text: normalized,
    ai_unresolved: unresolved,
    ai_low_confidence: results.some(result => result.ai_low_confidence === true),
    ai_complete: results.every(result => result.ai_complete === true) && unresolved.length === 0,
    ai_chunk_count: results.length
  };
}

async function callBetToolAIChunked(text, options) {
  options = options || {};
  const chunks = splitAiTextIntoChunks(text, options.small ? 1200 : 2600);
  if (chunks.length === 1) {
    try {
      const single = await callBetToolAISingle(chunks[0].text, [], {
        compact: true, chunkContext: chunks[0].context
      });
      single.ai_prompt_compacted = true;
      return single;
    } catch (error) {
      if (!error || !error.aiTpmLimit) throw error;
      const waitMs = Math.max(5000, Math.min(60000, Number(error.retryAfterMs) || 60000));
      setAiStatus("AI 每分钟额度暂时不足，约等待 " + Math.ceil(waitMs / 1000) +
        " 秒后自动重试。请保持页面打开。", "busy");
      await new Promise(resolve => setTimeout(resolve, waitMs));
      const single = await callBetToolAISingle(chunks[0].text, [], {
        compact: true, chunkContext: chunks[0].context
      });
      single.ai_prompt_compacted = true;
      return single;
    }
  }
  if (chunks.length > 18) {
    throw new Error("这段内容太长，需要拆成更多批次。请按玩法区块分成几次输入，以免超过 AI 每分钟额度。");
  }

  const results = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    setAiStatus("长文本分段解析中（" + (index + 1) + "/" + chunks.length + "），正在保留原文顺序…", "busy");
    const requestOptions = {
      compact: true,
      chunkContext: chunk.context,
      partNumber: index + 1,
      totalParts: chunks.length
    };
    let result;
    try {
      result = await callBetToolAISingle(chunk.text, [], requestOptions);
    } catch (error) {
      if (!error || !error.aiTpmLimit) throw error;
      const waitMs = Math.max(5000, Math.min(60000, Number(error.retryAfterMs) || 60000));
      setAiStatus("AI 每分钟额度暂时不足，约等待 " + Math.ceil(waitMs / 1000) +
        " 秒后继续第 " + (index + 1) + "/" + chunks.length + " 段。请保持页面打开。", "busy");
      await new Promise(resolve => setTimeout(resolve, waitMs));
      result = await callBetToolAISingle(chunk.text, [], requestOptions);
    }
    results.push(result);
  }
  return mergeAiChunkResults(text, results);
}

async function callBetToolAI(text, similarCases, options) {
  options = options || {};
  if (!text || !text.trim()) return null;
  const apiKey = getApiKey();
  if (!apiKey || !apiKey.startsWith("gsk_")) {
    throw new Error("请先在「设置」页填入你的 Groq API Key");
  }
  if (options.forceChunking) {
    setAiStatus("正在使用精简提示词分段处理长文本…", "busy");
    return callBetToolAIChunked(text, { small: true });
  }
  try {
    return await callBetToolAISingle(text, similarCases || [], { compact: false });
  } catch (firstError) {
    if (!firstError || !firstError.aiTpmLimit) throw firstError;
    setAiStatus("请求接近 AI 每分钟 Token 限额，正在移除历史示例并缩短提示词后重试…", "busy");
    try {
      const compactResult = await callBetToolAISingle(text, [], { compact: true });
      compactResult.warnings = (Array.isArray(compactResult.warnings) ? compactResult.warnings : [])
        .concat("为适应当前 AI 服务额度，系统使用精简提示词重试。请逐项核对玩法、号码、金额和组数。");
      compactResult.ai_prompt_compacted = true;
      return compactResult;
    } catch (compactError) {
      if (!compactError || !compactError.aiTpmLimit) throw compactError;
      setAiStatus("精简请求仍超出限额，准备按原文分段处理…", "busy");
      return callBetToolAIChunked(text, { small: false });
    }
  }
}

// ==================== 用户 & 筛选 ====================
function switchUser(u) {
  state.currentUser = u;
  $$(".user-bar button[data-user]").forEach(b =>
    b.classList.toggle("active", b.dataset.user === u));
  saveLocal();
  toast(`当前用户：${u}`);
}

function switchWinFilter(f) {
  state.winFilterUser = f;
  $$(".user-bar button[data-winfilter]").forEach(b =>
    b.classList.toggle("active", b.dataset.winfilter === f));
  saveLocal();
  refreshWin();
}

// ==================== 输入页 ====================
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  if (aiTimer) clearTimeout(aiTimer);

  previewTimer = setTimeout(() => doPreview(false), 350);

  if (AI_AUTO_FALLBACK) {
    aiTimer = setTimeout(() => doPreview(true), 1500);
  }
}

function isSevereWarning(w) {
  return /无法|未识别|没有|错误|失败|不足|跳过|超出|不合法|没有生成|没有找到金额/.test(String(w || ""));
}

async function doPreview(allowAI = false, forceAI = false, forceChunks = false) {
  const requestId = ++previewRequestId;
  if (!coreReady) return;

  const text = $("#raw-input").value.trim();
  if (!text) {
    previewResult = null;
    renderPreviewEmpty("等待输入下注内容。解析完成后会在这里逐组显示结果。");
    setAiStatus("输入内容后会先进行本地预览；需要 AI 辅助时点击“智能解析”。", "idle");
    updateTotals();
    return;
  }

  const isCurrentRequest = () =>
    requestId === previewRequestId && $("#raw-input").value.trim() === text;

  if (allowAI) setAiStatus("正在检查输入并准备 AI 解析…", "busy");

  // 命中人工确认过的完全相同原文时，直接复用结构化结果，不让模型重新猜。
  const exactCase = findExactLearningCase(text);
  if (exactCase && !forceAI && !forceChunks) {
    const result = JSON.parse(JSON.stringify(exactCase.snapshot));
    result.raw_text = text;
    result.normalized_text = exactCase.corrected_text;
    result.ai_normalized_text = exactCase.corrected_text;
    result.warnings = [];
    result.ai_unresolved = [];
    result.ai_complete = true;
    result.ai_low_confidence = false;
    result.learning_case_hit = true;
    result.learning_case_id = exactCase.id;
    if (!previewResult || previewResult.learning_case_id !== exactCase.id) {
      learningStore.metrics.exactHits += 1;
      saveLearningStore();
    }
    previewResult = result;
    renderPreviewResult(result, "命中人工确认的学习案例");
    setAiStatus("已命中已确认案例，无需重新调用 AI。添加前仍建议核对结果。", "success");
    updateTotals();
    return;
  }

  try {
    const localResult = await pyParseBet(text);
    if (!isCurrentRequest()) return;

    previewResult = localResult;
    const groups = Array.isArray(localResult.groups) ? localResult.groups : [];
    const warnings = Array.isArray(localResult.warnings) ? localResult.warnings : [];
    const localEmpty = groups.length === 0;
    const severe = warnings.some(isSevereWarning);
    const needAI = allowAI && AI_AUTO_FALLBACK && (forceAI || forceChunks || localEmpty || severe);

    if (!needAI) {
      renderPreviewResult(localResult, "本地规则解析结果");
      setAiStatus(localEmpty || severe
        ? "本地规则发现未识别内容；可以点击“智能解析”尝试 AI 辅助。"
        : "本地规则预览已完成。添加前请核对所有号码与金额。", localEmpty || severe ? "idle" : "success");
      updateTotals();
      return;
    }

    const similarCases = forceChunks ? [] : findSimilarLearningCases(text, 3);
    renderPreviewEmpty("本地规则需要进一步确认，正在调用 AI…" +
      (similarCases.length ? " 已找到 " + similarCases.length + " 条相似学习案例。" : ""));
    setAiStatus(forceChunks
      ? "正在用较短提示词分段重试；较长内容可能需要等待服务额度恢复。"
      : "正在调用 Groq AI，并保留本地解析结果…", "busy");

    try {
      const aiResult = await callBetToolAI(text, similarCases, { forceChunking: forceChunks });
      if (!isCurrentRequest()) return;

      if (similarCases.length && aiResult) {
        learningStore.metrics.retrievals += 1;
        saveLearningStore();
        aiResult.ai_learning_examples_count = similarCases.length;
      }

      if (aiResult && Array.isArray(aiResult.groups) && aiResult.groups.length > 0) {
        previewResult = aiResult;
        renderPreviewResult(aiResult, aiResult.ai_chunk_count
          ? "AI 分段解析结果"
          : (aiResult.ai_prompt_compacted ? "AI 精简提示词解析结果" : "AI 解析结果"));
        if (aiResult.ai_chunk_count > 1) {
          setAiStatus("长文本分段解析完成。请重点核对分段处的玩法标题、号码组与金额。", "success");
        } else if (aiResult.ai_low_confidence || aiResult.ai_complete === false ||
                   (Array.isArray(aiResult.warnings) && aiResult.warnings.length)) {
          setAiStatus("AI 已返回结果，但存在需要核对的内容；请逐项确认后再添加。", "success");
        } else {
          setAiStatus("AI 解析完成。请核对结果后再添加到记录。", "success");
        }
      } else {
        previewResult = localResult;
        renderAiFailure(new Error("AI 未能生成有效分组。请检查原文或手动拆分。"), localResult);
        setAiStatus("AI 未返回可用分组；本地解析结果已保留。", "error");
      }
    } catch (aiError) {
      if (!isCurrentRequest()) return;
      previewResult = localResult;
      renderAiFailure(aiError, localResult);
      setAiStatus("AI 本次未完成；输入内容和本地解析结果已保留。", "error");
    }
  } catch (error) {
    if (!isCurrentRequest()) return;
    previewResult = null;
    renderPreviewEmpty("解析引擎出现错误：" + error.message);
    setPreviewBadge("解析失败", "danger");
    setAiStatus("本地解析引擎出错，请刷新页面重试。", "error");
  }

  if (isCurrentRequest()) updateTotals();
}
function updateTotals() {
  const previewTotal = previewResult ? fmtNum(previewResult.total || 0) : "—";
  const recordsTotal = state.records.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const totals = $("#totals");
  if (totals) {
    totals.innerHTML =
      '<span class="preview-total"><span>预览金额</span><strong>' + escapeHtml(previewTotal) + '</strong></span>' +
      '<span><span>记录合计</span><strong>' + escapeHtml(fmtNum(recordsTotal)) + '</strong></span>';
  }
  const addButton = $("#btn-add");
  if (addButton) addButton.disabled = !previewResult || !Array.isArray(previewResult.groups) || !previewResult.groups.length;
  const copyButton = $("#btn-copy");
  if (copyButton) copyButton.disabled = !previewResult || !(previewResult.content || previewResult.ai_normalized_text || previewResult.normalized_text);
}
async function onPaste() {
  try {
    const t = await navigator.clipboard.readText();
    if (!t) { toast("剪贴板为空"); return; }
    $("#raw-input").value = t;
    doPreview(false);
  } catch(e) {
    toast("无法读取剪贴板，请长按输入框手动粘贴", 2500);
  }
}

async function onAdd() {
  if (!previewResult || !previewResult.groups || !previewResult.groups.length) {
    toast("没有识别到有效内容");
    return;
  }

  const currentText = $("#raw-input").value.trim();
  const parsedText = String(previewResult.raw_text || "").trim();
  if (!currentText || parsedText !== currentText) {
    toast("当前输入内容还未完成解析，请等待预览更新后再添加", 2800);
    doPreview(false);
    return;
  }

  const warnings = Array.isArray(previewResult.warnings) ? previewResult.warnings : [];
  const unresolved = Array.isArray(previewResult.ai_unresolved) ? previewResult.ai_unresolved : [];
  const incomplete = previewResult.ai_complete === false;
  const lowConfidence = previewResult.ai_low_confidence === true;
  if (warnings.length || unresolved.length || incomplete || lowConfidence) {
    const details = warnings.slice(0, 4).concat(
      unresolved.slice(0, 3).map(x => typeof x === "string" ? x : JSON.stringify(x))
    );
    const reason = details.length ? "\n\n提示：\n" + details.join("\n") : "";
    if (!confirm("解析结果带有提示或未完全确认内容。请先核对每一笔的玩法、号码和金额。\n\n仍然添加当前预览吗？" + reason)) {
      return;
    }
  }

  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const ts = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" +
    pad(now.getDate()) + " " + pad(now.getHours()) + ":" +
    pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  const region = /香港|港彩|港/.test(previewResult.raw_text) ? "香港" : "澳门";
  const rec = {
    seq: state.records.length + 1,
    raw_text: previewResult.raw_text,
    bet_content: String(previewResult.content || previewResult.ai_normalized_text || previewResult.normalized_text || ""),
    amount: previewResult.total,
    created_at: ts,
    groups: previewResult.groups,
    warnings: warnings,
    region: region,
    user: state.currentUser
  };
  state.records.push(rec);
  $("#raw-input").value = "";
  renderPreviewEmpty("等待输入下注内容。解析完成后会在这里逐组显示结果。");
  previewResult = null;
  previewRequestId += 1;
  updateTotals();
  renderRecords();
  saveLocal();
  toast("[" + rec.user + "] 已添加 #" + rec.seq + ": " + fmtNum(rec.amount));
}
function onCopy() {
  const text = previewResult && (
    previewResult.content || previewResult.ai_normalized_text || previewResult.normalized_text
  );
  if (!text) { toast("没有可复制内容"); return; }
  navigator.clipboard.writeText(text)
    .then(() => toast("已复制"))
    .catch(() => toast("复制失败，请长按输入框手动复制"));
}

function onClearInput() {
  if (activeAiController) activeAiController.abort();
  previewRequestId += 1;
  $("#raw-input").value = "";
  renderPreviewEmpty("等待输入下注内容。解析完成后会在这里逐组显示结果。");
  previewResult = null;
  setAiStatus("已清空输入框。", "idle");
  updateTotals();
}
async function onClearAll() {
  if (!state.records.length) return;
  if (!confirm("确定清空全部记录？")) return;
  state.records = [];
  saveLocal();
  updateTotals();
  renderRecords();
  refreshSummary();
  toast("已清空");
}

function deleteRecord(seq) {
  if (!confirm(`确定删除 #${seq}？`)) return;
  state.records = state.records.filter(r => r.seq !== seq);
  state.records.forEach((r, i) => { r.seq = i + 1; });
  saveLocal();
  updateTotals();
  renderRecords();
  toast(`已删除 #${seq}`);
}

function renderRecords() {
  const box = $("#records-list");
  const cnt = $("#records-count");
  if (!box) return;

  if (cnt) cnt.textContent = state.records.length + " 条";

  if (!state.records.length) {
    box.innerHTML = '<div class="empty">还没有记录</div>';
    return;
  }

  const sorted = [...state.records].sort((a, b) => b.seq - a.seq);

  box.innerHTML = sorted.map(r => {
    const timeShort = (r.created_at || "").slice(5, 16);
    const user = r.user || "";
    const userTag = user ? `<span class="user" data-u="${user}">${user}</span>` : "";
    return `<div class="rec-row">
      ${userTag}
      <span class="seq">#${r.seq}</span>
      <span class="region">${r.region || "澳门"}</span>
      <span class="time">${timeShort}</span>
      <span class="amount">${fmtNum(r.amount)}</span>
      <span class="del" onclick="deleteRecord(${r.seq})">删</span>
    </div>`;
  }).join("");
}

// ==================== 汇总页 ====================
function switchSubtab(name) {
  currentSubtab = name;
  $$("[data-subtab]").forEach(b => b.classList.toggle("active", b.dataset.subtab === name));
  refreshSummary();
}

async function refreshSummary() {
  if (!coreReady) return;
  if (!state.records.length) {
    $("#summary-content").innerHTML = '<div class="empty">还没有记录</div>';
    return;
  }
  try {
    const sum = await pySummarize();
    renderSubtab(sum);
  } catch(e) {
    $("#summary-content").innerHTML = '<div class="empty">计算失败：' + e.message + '</div>';
  }
}

function renderSubtab(sum) {
  const box = $("#summary-content");
  const data = sum[currentSubtab] || [];
  if (!data.length) { box.innerHTML = '<div class="empty">无数据</div>'; return; }
  const totalAmount = state.records.reduce((total, record) => total + Number(record.amount || 0), 0);
  const groupCount = state.records.reduce((total, record) =>
    total + (Array.isArray(record.groups) ? record.groups.length : 0), 0);
  const stats = '<div class="summary-stats">' +
    '<div><span>记录笔数</span><strong>' + state.records.length + '</strong></div>' +
    '<div><span>记录总额</span><strong>' + escapeHtml(fmtNum(totalAmount)) + '</strong></div>' +
    '<div><span>分组数量</span><strong>' + groupCount + '</strong></div>' +
    '</div>';
  const head = {
    numbers: ["号码","生肖","波色","尾","次数","金额"],
    zodiac: ["生肖","对应号码","金额"],
    plays: ["玩法","笔/组","金额"]
  }[currentSubtab];
  const th = head.map(h => "<th>" + escapeHtml(h) + "</th>").join("");
  const tr = data.map(row => "<tr>" + row.map(v =>
    "<td>" + escapeHtml(typeof v === "number" && !Number.isInteger(v) ? fmtNum(v) : (v ?? "")) + "</td>"
  ).join("") + "</tr>").join("");
  box.innerHTML = stats + '<div class="table-wrap"><table class="data-table"><thead><tr>' +
    th + '</tr></thead><tbody>' + tr + '</tbody></table></div>';
}
// ==================== 中奖页 ====================
function onRefreshWin() { saveLocal(); refreshWin(); }

async function refreshWin() {
  if (!coreReady) return;
  if (!state.records.length) {
    $("#win-content").innerHTML = '<div class="empty">还没有记录</div>'; return;
  }
  const m = $("#macau-draw").value.trim();
  const h = $("#hk-draw").value.trim();
  if (!m && !h) {
    $("#win-content").innerHTML = '<div class="empty">请输入澳门或香港开奖号码</div>'; return;
  }

  const filtered = state.winFilterUser === "全部"
    ? state.records
    : state.records.filter(r => (r.user || "") === state.winFilterUser);

  if (!filtered.length) {
    $("#win-content").innerHTML = `<div class="empty">用户 ${state.winFilterUser} 暂无记录</div>`;
    return;
  }

  try {
    const { summary } = await pySettle(filtered);
    if (!summary || summary.length <= 1) {
      $("#win-content").innerHTML = '<div class="empty">无中奖数据</div>'; return;
    }
    const head = summary[0];
    const rows = summary.slice(1);
    const th = head.map(h => `<th>${h}</th>`).join("");
    const tr = rows.map(row => "<tr>" + row.map(v =>
      `<td>${typeof v === "number" && !Number.isInteger(v) ? fmtNum(v) : (v ?? "")}</td>`
    ).join("") + "</tr>").join("");
    const title = state.winFilterUser === "全部" ? "" :
      `<div style="padding:8px;color:var(--accent);font-size:13px;font-weight:600">当前筛选：用户 ${state.winFilterUser}</div>`;
    $("#win-content").innerHTML = title +
      `<div class="table-wrap"><table class="data-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
  } catch(e) {
    $("#win-content").innerHTML = '<div class="empty">计算失败：' + e.message + '</div>';
  }
}

// ==================== 风险页 ====================
async function refreshRisk() {
  if (!coreReady) return;
  const box = $("#risk-content");
  if (!box) return;
  if (!state.records.length) {
    box.innerHTML = '<div class="empty">还没有记录</div>';
    return;
  }
  box.innerHTML = '<div class="empty">正在计算…</div>';
  try {
    const rows = await pyRiskRows();
    renderRisk(rows);
  } catch(e) {
    box.innerHTML = '<div class="empty">计算失败：' + e.message + '</div>';
  }
}

function renderRisk(rows) {
  const box = $("#risk-content");
  if (!rows || rows.length <= 1) {
    box.innerHTML = '<div class="empty">暂无可分析的特码相关玩法</div>';
    return;
  }

  const head = rows[0];
  const profitIndex = head.indexOf("预计盈亏");
  const riskIndex = head.indexOf("风险等级");
  const summaryRow = rows.slice(1).find(r => String(r[0] || "").includes("统计"));
  const bodyRows = rows.slice(1).filter(r => !String(r[0] || "").includes("统计"));

  let summaryHtml = "";
  if (summaryRow) {
    summaryHtml = `<div class="risk-summary">
      <span class="max">📈 最大盈亏：${summaryRow[1] || "-"}</span>
      <span class="min">📉 最小盈亏：${summaryRow[2] || "-"}</span>
      <span class="avg">📊 平均：${summaryRow[profitIndex >= 0 ? profitIndex : 3] || "-"}</span>
    </div>`;
  }

  const th = head.map(h => `<th>${h}</th>`).join("");

  const tr = bodyRows.map(row => {
    const profit = row[profitIndex >= 0 ? profitIndex : 3];
    const level = String(row[riskIndex >= 0 ? riskIndex : row.length - 1] || "");
    let rowCls = "risk-unknown";
    if (level.includes("🔴") || level.includes("[高]")) rowCls = "risk-high";
    else if (level.includes("🟡") || level.includes("[中]")) rowCls = "risk-mid";
    else if (level.includes("🟢") || level.includes("[低]")) rowCls = "risk-low";

    const profitNum = typeof profit === "number" ? profit : null;
    const profitCls = profitNum === null ? "" : (profitNum > 0 ? "profit-pos" : "profit-neg");
    const profitText = profitNum === null ? (profit ?? "-")
      : (profitNum > 0 ? "+" : "") + fmtNum(profitNum);

    const tds = row.map((v, i) => {
      if (i === profitIndex) return `<td class="${profitCls}">${profitText}</td>`;
      return `<td>${typeof v === "number" && !Number.isInteger(v) ? fmtNum(v) : (v ?? "")}</td>`;
    }).join("");

    return `<tr class="${rowCls}">${tds}</tr>`;
  }).join("");

  box.innerHTML = summaryHtml
    + `<div class="table-wrap"><table class="data-table">`
    + `<thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

async function onExport() {
  if (!state.records.length) { toast("没有记录"); return; }
  try {
    toast("正在生成 Excel…", 1200);
    const b64 = await pyExportXlsx();
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    const name = `押注汇总_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
    toast("已导出 " + name, 2500);
  } catch(e) {
    toast("导出失败：" + e.message, 3000);
  }
}

// ==================== 设置页 ====================
function switchSettingsTab(name) {
  currentSettingsTab = name;
  $$("[data-settings-tab]").forEach(b =>
    b.classList.toggle("active", b.dataset.settingsTab === name));
  renderSettings();
}

function renderSettings() {
  const items = currentSettingsTab === "odds" ? ODDS_ITEMS : REBATE_ITEMS;
  const cfg = currentSettingsTab === "odds" ? state.odds : state.rebate;
  const unit = currentSettingsTab === "odds" ? "倍" : "%";
  const hint = currentSettingsTab === "odds"
    ? "空白 = 待填赔率，不计算赔付"
    : "空白 = 跟随统一回水率";

  const currentKey = getApiKey();

  const apiKeyHtml = `
    <div style="padding:12px;background:var(--card2);border-radius:10px;margin-bottom:12px">
      <div style="font-size:13px;color:var(--muted);margin-bottom:8px">
        🤖 Groq API Key（仅保存在此浏览器本地，不会上传）
      </div>
      <input type="password" id="api-key-input"
             placeholder="gsk_..."
             value="${currentKey.replace(/"/g, '&quot;')}"
             style="width:100%;font-size:14px;min-height:44px">
      <div style="display:flex;gap:8px;margin-top:8px">
        <button onclick="onSaveApiKey()" style="flex:1;font-size:14px;padding:10px">保存密钥</button>
        <button onclick="onClearApiKey()" class="danger" style="flex:1;font-size:14px;padding:10px">清除密钥</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:8px">
        当前状态：${maskKey(currentKey)}
      </div>
    </div>
  `;

  const html = [apiKeyHtml, `<div style="padding:8px;color:var(--muted);font-size:12px">${hint}</div>`];
  for (const [key, label] of items) {
    const v = cfg[key];
    const text = v === null || v === undefined ? "" : fmtNum(v);
    html.push(`<div class="setting-row">
      <label>${label}</label>
      <input type="number" step="0.01" data-key="${key}" value="${text}" inputmode="decimal">
      <span class="unit">${unit}</span>
    </div>`);
  }
  $("#settings-content").innerHTML = html.join("");
}

function onResetSettings() {
  if (currentSettingsTab === "odds") state.odds = { ...DEFAULT_ODDS };
  else state.rebate = { ...DEFAULT_REBATE };
  renderSettings();
  toast("已恢复默认（记得点保存）");
}

function onSaveSettings() {
  const inputs = $$("#settings-content input[data-key]");
  const target = currentSettingsTab === "odds"
    ? { ...state.odds } : { ...state.rebate };
  for (const inp of inputs) {
    const raw = inp.value.trim();
    if (raw === "") { target[inp.dataset.key] = null; continue; }
    const n = Number(raw);
    if (!isFinite(n) || n < 0) { toast(`「${raw}」不是有效数字`); return; }
    target[inp.dataset.key] = n;
  }
  if (currentSettingsTab === "odds") state.odds = target;
  else state.rebate = target;
  saveLocal();
  toast("已保存");
}

function onSaveApiKey() {
  const inp = $("#api-key-input");
  if (!inp) return;
  const val = inp.value.trim();
  if (!val) { toast("请输入 API Key"); return; }
  if (!val.startsWith("gsk_")) {
    toast("格式错误：密钥应以 gsk_ 开头");
    return;
  }
  setApiKey(val);
  renderSettings();
  toast("已保存到本地浏览器");
}

function onClearApiKey() {
  if (!confirm("确定清除本地保存的 API Key？")) return;
  clearApiKey();
  renderSettings();
  toast("已清除");
}

// ==================== Tab 切换 ====================
function switchTab(name) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-" + name));
  $$("nav.tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "input") renderRecords();
  if (name === "summary") refreshSummary();
  if (name === "win") refreshWin();
  if (name === "risk") refreshRisk();
  if (name === "settings") renderSettings();
}

// ==================== 启动 ====================
window.addEventListener("DOMContentLoaded", async () => {
  const yearSel = document.createElement("select");
  yearSel.id = "year-select";
  Object.keys(YEAR_MAP).forEach(k => {
    const o = document.createElement("option");
    o.value = k; o.textContent = k;
    yearSel.appendChild(o);
  });
  yearSel.value = state.year;
  yearSel.addEventListener("change", () => {
    state.year = yearSel.value; saveLocal(); doPreview(false);
  });
  const headerRight = $(".header-right");
  (headerRight || $("header")).appendChild(yearSel);

  $("#raw-input").addEventListener("input", schedulePreview);
  $("#macau-draw").addEventListener("input", saveLocal);
  $("#hk-draw").addEventListener("input", saveLocal);

  loadLocal();
  loadLearningStore();
  yearSel.value = state.year;

  $$(".user-bar button[data-user]").forEach(b =>
    b.classList.toggle("active", b.dataset.user === state.currentUser));
  $$(".user-bar button[data-winfilter]").forEach(b =>
    b.classList.toggle("active", b.dataset.winfilter === state.winFilterUser));

  renderRecords();

  try {
    await initPyodide();
    updateTotals();
    setStatus("就绪");
    $("#loading").style.display = "none";
  } catch(e) {
    $("#loading-msg").textContent = "加载失败：" + e.message;
    console.error(e);
  }
});
