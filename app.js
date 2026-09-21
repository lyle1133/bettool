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
    if (data.macau && $("#macau-draw")) $("#macau-draw").value = data.macau;
    if (data.hk && $("#hk-draw")) $("#hk-draw").value = data.hk;
  } catch(e) { console.warn(e); }
}

// ==================== Pyodide 桥接 ====================
const PY_WRAPPER = `
import json
from core import (
    parse_bet, parse_draw_result, settle_orders,
    summarize_orders, export_xlsx,
    OrderRecord, BetGroup,
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
`;

async function initPyodide() {
  const lm = $("#loading-msg");
  lm.textContent = "正在加载 Python 运行时（首次约 10–20 秒）…";
  pyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
  });
  lm.textContent = "正在加载解析内核…";
  const coreSrc = await fetch("core.py").then(r => r.text());

  // 关键：把 core.py 写入 Pyodide 虚拟文件系统，让它成为可 import 的模块
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
async function pySummarize() {
  return JSON.parse(pyCall("js_summarize", JSON.stringify(state.records), yearAnimal()));
}
async function pySettle() {
  return JSON.parse(pyCall("js_settle",
    JSON.stringify(state.records),
    $("#macau-draw").value, $("#hk-draw").value, yearAnimal(),
    JSON.stringify(state.odds), JSON.stringify(state.rebate)));
}
async function pyExportXlsx() {
  return pyCall("js_export_xlsx",
    JSON.stringify(state.records),
    $("#macau-draw").value, $("#hk-draw").value, yearAnimal(),
    JSON.stringify(state.odds), JSON.stringify(state.rebate));
}

// ==================== 输入页 ====================
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(doPreview, 350);
}

async function doPreview() {
  if (!coreReady) return;
  const text = $("#raw-input").value.trim();
  if (!text) {
    previewResult = null;
    $("#preview-box").textContent = "（等待输入）";
    updateTotals(); return;
  }
  try {
    previewResult = await pyParseBet(text);
    $("#preview-box").textContent = previewResult.content || "（无有效内容）";
  } catch(e) {
    $("#preview-box").textContent = "解析错误：" + e.message;
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
    doPreview();
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
  };
  state.records.push(rec);
  $("#raw-input").value = "";
  $("#preview-box").textContent = "（等待输入）";
  previewResult = null;
  updateTotals();
  saveLocal();
  toast(`已添加 #${rec.seq}: ${fmtNum(rec.amount)}`);
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
  refreshSummary();
  toast("已清空");
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
  if (currentSubtab === "orders") {
    const rows = state.records.map(r => `<tr>
      <td>${r.seq}</td><td>${r.region || "澳门"}</td>
      <td>${(r.created_at||"").slice(5,16)}</td>
      <td>${fmtNum(r.amount)}</td><td>${(r.warnings||[]).length}</td>
    </tr>`).join("");
    box.innerHTML = `<table class="data-table">
      <thead><tr><th>序</th><th>地区</th><th>时间</th><th>金额</th><th>提示</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
    return;
  }
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
  try {
    const { summary } = await pySettle();
    if (!summary || summary.length <= 1) {
      $("#win-content").innerHTML = '<div class="empty">无中奖数据</div>'; return;
    }
    const head = summary[0];
    const rows = summary.slice(1);
    const th = head.map(h => `<th>${h}</th>`).join("");
    const tr = rows.map(row => "<tr>" + row.map(v =>
      `<td>${typeof v === "number" && !Number.isInteger(v) ? fmtNum(v) : (v ?? "")}</td>`
    ).join("") + "</tr>").join("");
    $("#win-content").innerHTML = `<table class="data-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  } catch(e) {
    $("#win-content").innerHTML = '<div class="empty">计算失败：' + e.message + '</div>';
  }
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
  if (name === "summary") refreshSummary();
  if (name === "win") refreshWin();
  if (name === "settings") renderSettings();
}

// ==================== 启动 ====================
window.addEventListener("DOMContentLoaded", async () => {
  // 年份选择器
  const yearSel = document.createElement("select");
  yearSel.id = "year-select";
  Object.keys(YEAR_MAP).forEach(k => {
    const o = document.createElement("option");
    o.value = k; o.textContent = k;
    yearSel.appendChild(o);
  });
  yearSel.value = state.year;
  yearSel.addEventListener("change", () => {
    state.year = yearSel.value; saveLocal(); doPreview();
  });
  $("header").appendChild(yearSel);

  // 输入监听
  $("#raw-input").addEventListener("input", schedulePreview);
  $("#macau-draw").addEventListener("input", saveLocal);
  $("#hk-draw").addEventListener("input", saveLocal);

  loadLocal();
  yearSel.value = state.year;

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
