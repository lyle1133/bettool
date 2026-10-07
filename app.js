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
};

const ODDS_ITEMS = [
  ["tema","特码"],["texiao","特肖（非马）"],["texiao_ma","特肖马"],
  ["pingte_xiao","平特一肖（不带马）"],["pingte_xiao_ma","平特一肖（带马/马）"],
  ["pingte_tail","平特尾"],["color","波色/色单双"],
  ["lianxiao_2","二连肖（不带马）"],["lianxiao_2_ma","二连肖（带马）"],
  ["lianxiao_3","三连肖（不带马）"],["lianxiao_3_ma","三连肖（带马）"],
  ["lianxiao_4","四连肖（不带马）"],["lianxiao_4_ma","四连肖（带马）"],
  ["lianxiao_5","五连肖（不带马）"],["lianxiao_5_ma","五连肖（带马）"],
  ["pingma_2","二中二"],["pingma_3","三中三"],
];

const DEFAULT_REBATE = {
  global:0, tema:null, texiao:null, pingte_xiao:null,
  pingte_tail:null, color:null,
  lianxiao_2:null, lianxiao_3:null, lianxiao_4:null, lianxiao_5:null,
  pingma_2:null, pingma_3:null,
};

const REBATE_ITEMS = [
  ["global","统一回水率"],["tema","特码总单"],["texiao","特肖/各肖"],
  ["pingte_xiao","平特一肖"],["pingte_tail","尾数平特"],["color","波色/色单双"],
  ["lianxiao_2","二连肖"],["lianxiao_3","三连肖"],
  ["lianxiao_4","四连肖"],["lianxiao_5","五连肖"],
  ["pingma_2","二中二"],["pingma_3","三中三"],
];

// ==================== Groq AI 直连 ====================
// ⚠️⚠️⚠️ 请把下面换成你自己完整的 Groq 密钥（以 gsk_ 开头）⚠️⚠️⚠️
const GROQ_API_KEY = "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";

const AI_MIN_CONFIDENCE = 0.75;
const AI_AUTO_FALLBACK = true; // 本地解析失败/严重警告时，是否允许自动兜底
let aiBusy = false;
let aiTimer = null;

// ==================== AI System Prompt ====================
const SYSTEM_PROMPT = `
你是 BetTool 下注文字解析助手。

你的唯一任务：
把用户输入的中文下注文字，准确转换成 BetTool 可以继续解析的“标准下注文本”。

不要计算中奖金额。
不要计算赔率。
不要修改下注金额。
不要自行增加号码。
不要猜测用户没有明确说出的号码。

支持的常见玩法包括：
1. 特码总单
2. 特肖
3. 各肖
4. 一平特
5. 平特尾
6. 波色
7. 二连肖
8. 三连肖
9. 四连肖
10. 五连肖
11. 二中二
12. 三中三

号码范围只能是 01-49。

常见表达转换：
“01各20” → “01各20”
“01、13、25各10米” → “01 13 25各10”
“01.13.25各50” → “01 13 25各50”
“猴鸡狗三连肖100” → “三连肖：猴鸡狗各100”
“三中三 01 13 25 50” → “三中三：01-13-25 50”
“01 13 25 三中三50” → “三中三：01-13-25 50”
“二中二 01-13 20” → “二中二：01-13 20”

如果用户输入包含多个下注，请逐条输出。
如果一条下注无法确定：不要猜，把它放到 unresolved 中。

必须返回严格 JSON：
{
  "success": true,
  "normalized_text": "标准化后的下注文本",
  "items": [
    {
      "raw": "原始片段",
      "normalized": "标准化结果",
      "play_type": "玩法名称",
      "numbers": [1, 13, 25],
      "zodiacs": [],
      "amount": 50,
      "confidence": 0.98
    }
  ],
  "unresolved": [],
  "warnings": []
}

confidence 范围 0 到 1。
不要输出 Markdown。不要输出解释。只输出 JSON。
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
  const coreSrc = await fetch("core.py").then(r => r.text());

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

// ==================== AI 调用 (直连 Groq) ====================
async function callBetToolAI(text) {
  if (!text || !text.trim()) return null;

  // 检查密钥是否配置
  if (!GROQ_API_KEY || !GROQ_API_KEY.startsWith("gsk_")) {
    throw new Error("请先在 app.js 中配置有效的 GROQ_API_KEY");
  }

  if (aiBusy) return null;

  aiBusy = true;
  setStatus("🤖 AI正在解析…");

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b", // 如果不可用，可换成 "openai/gpt-oss-120b"
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "请解析下面的下注文字：\n\n" + text }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Groq API ${response.status}: ${responseText.slice(0, 1000)}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error("Groq 返回的数据不是有效 JSON");
    }

    const textOutput = data?.choices?.[0]?.message?.content?.trim();
    if (!textOutput) {
      throw new Error("Groq 没有返回有效解析结果");
    }

    let ai;
    try {
      ai = JSON.parse(textOutput);
    } catch (e) {
      throw new Error("Groq 返回内容无法解析为 JSON：" + textOutput.slice(0, 1000));
    }

    const items = Array.isArray(ai.items) ? ai.items : [];
    const lowConfidence = items.some(
      item => Number(item.confidence || 0) < AI_MIN_CONFIDENCE
    );

    // 把 AI 结果交给 Pyodide 里的 core.py 处理
    const parsed = await pyParseAIResult(ai);
    parsed.ai = true;
    parsed.ai_raw = ai;
    parsed.ai_low_confidence = lowConfidence;
    parsed.ai_normalized_text = ai.normalized_text || "";
    parsed.raw_text = text;

    return parsed;

  } finally {
    aiBusy = false;
    setStatus("🟢 本地解析 + AI");
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

async function doPreview(allowAI = false) {
  if (!coreReady) return;

  const text = $("#raw-input").value.trim();
  if (!text) {
    previewResult = null;
    $("#preview-box").textContent = "（等待输入）";
    updateTotals();
    return;
  }

  try {
    const localResult = await pyParseBet(text);
    previewResult = localResult;

    const groups = Array.isArray(localResult.groups) ? localResult.groups : [];
    const warnings = Array.isArray(localResult.warnings) ? localResult.warnings : [];
    const localEmpty = groups.length === 0;
    const severe = warnings.some(isSevereWarning);

    const needAI = allowAI && AI_AUTO_FALLBACK && (localEmpty || severe);

    if (!needAI) {
      $("#preview-box").textContent = localResult.content || "（无有效内容）";
      updateTotals();
      return;
    }

    $("#preview-box").textContent = "🤖 本地规则无法完全确定，正在调用 Groq AI…";

    try {
      const aiResult = await callBetToolAI(text);

      if (aiResult && aiResult.groups && aiResult.groups.length > 0) {
        previewResult = aiResult;

        let display = "🤖 AI解析结果\n\n" +
          (aiResult.content || "（AI没有生成有效内容）");

        if (aiResult.ai_low_confidence) {
          display += "\n\n⚠️ AI置信度较低，请人工确认";
        }

        if (aiResult.warnings && aiResult.warnings.length) {
          display += "\n\n⚠️ 提示：\n" + aiResult.warnings.join("\n");
        }

        $("#preview-box").textContent = display;
      } else {
        previewResult = localResult;
        $("#preview-box").textContent =
          (localResult.content || "（AI也无法确定）") + "\n\n⚠️ 建议人工检查";
      }
    } catch (aiError) {
      previewResult = localResult;
      $("#preview-box").textContent =
        (localResult.content || "（本地解析无有效结果）") +
        "\n\n⚠️ AI解析失败：" + aiError.message;
    }

  } catch (error) {
    previewResult = null;
    $("#preview-box").textContent = "解析错误：" + error.message;
  }

  updateTotals();
}

function updateTotals() {
  const p = previewResult?.total || 0;
  const r = state.records.reduce((s, x) => s + Number(x.amount || 0), 0);
  $("#totals").textContent = `预览金额：${fmtNum(p)}　|　记录合计：${fmtNum(r)}`;
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
  if (!previewResult?.groups?.length) { toast("没有识别到有效内容"); return; }
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const region = /香港|港彩|港/.test(previewResult.raw_text) ? "香港" : "澳门";
  const rec = {
    seq: state.records.length + 1,
    raw_text: previewResult.raw_text,
    bet_content: previewResult.content,
    amount: previewResult.total,
    created_at: ts,
    groups: previewResult.groups,
    warnings: previewResult.warnings,
    region,
    user: state.currentUser,
  };
  state.records.push(rec);
  $("#raw-input").value = "";
  $("#preview-box").textContent = "（等待输入）";
  previewResult = null;
  updateTotals();
  renderRecords();
  saveLocal();
  toast(`[${rec.user}] 已添加 #${rec.seq}: ${fmtNum(rec.amount)}`);
}

function onCopy() {
  if (!previewResult?.content) { toast("没有可复制内容"); return; }
  navigator.clipboard.writeText(previewResult.content)
    .then(() => toast("已复制"))
    .catch(() => toast("复制失败，请长按输入框手动复制"));
}

function onClearInput() {
  $("#raw-input").value = "";
  $("#preview-box").textContent = "（等待输入）";
  previewResult = null;
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

  if (cnt) cnt.textContent = state.records.length;

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
  const head = {
    numbers: ["号码","生肖","波色","尾","次数","金额"],
    zodiac:  ["生肖","对应号码","金额"],
    plays:   ["玩法","笔/组","金额"],
  }[currentSubtab];
  const th = head.map(h => `<th>${h}</th>`).join("");
  const tr = data.map(row => "<tr>" + row.map(v =>
    `<td>${typeof v === "number" && !Number.isInteger(v) ? fmtNum(v) : (v ?? "")}</td>`
  ).join("") + "</tr>").join("");
  box.innerHTML = `<table class="data-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
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
      `<table class="data-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
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
  const summaryRow = rows.slice(1).find(r => String(r[0] || "").includes("统计"));
  const bodyRows = rows.slice(1).filter(r => !String(r[0] || "").includes("统计"));

  let summaryHtml = "";
  if (summaryRow) {
    summaryHtml = `<div class="risk-summary">
      <span class="max">📈 最大盈亏：${summaryRow[1] || "-"}</span>
      <span class="min">📉 最小盈亏：${summaryRow[2] || "-"}</span>
      <span class="avg">📊 平均：${summaryRow[9] || "-"}</span>
    </div>`;
  }

  const th = head.map(h => `<th>${h}</th>`).join("");

  const tr = bodyRows.map(row => {
    const profit = row[9];
    const level = String(row[11] || "");
    let rowCls = "risk-unknown";
    if (level.includes("🔴") || level.includes("[高]")) rowCls = "risk-high";
    else if (level.includes("🟡") || level.includes("[中]")) rowCls = "risk-mid";
    else if (level.includes("🟢") || level.includes("[低]")) rowCls = "risk-low";

    const profitNum = typeof profit === "number" ? profit : null;
    const profitCls = profitNum === null ? "" : (profitNum > 0 ? "profit-pos" : "profit-neg");
    const profitText = profitNum === null ? (profit ?? "-")
      : (profitNum > 0 ? "+" : "") + fmtNum(profitNum);

    const tds = row.map((v, i) => {
      if (i === 9) return `<td class="${profitCls}">${profitText}</td>`;
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
  const html = [`<div style="padding:8px;color:var(--muted);font-size:12px">${hint}</div>`];
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
  $("header").appendChild(yearSel);

  $("#raw-input").addEventListener("input", schedulePreview);
  $("#macau-draw").addEventListener("input", saveLocal);
  $("#hk-draw").addEventListener("input", saveLocal);

  loadLocal();
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
