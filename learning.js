"use strict";

// BetTool AI 自我迭代 V1：本地案例库、相似检索、纠错和备份。
// 只保存人工确认的解析快照；未确认样本单独进入待处理队列。
const LEARNING_KEY = "bettool_learning_cases_v1";
const MAX_LEARNING_CASES = 1000;
const MAX_UNRESOLVED_CASES = 500;
const MAX_LEARNING_DELETIONS = 2000;

const LEARNING_SYNC_URL_KEY = "bettool_sync_url_v1";
const LEARNING_SYNC_TOKEN_KEY = "bettool_sync_token_v1";
const LEARNING_SYNC_MAX_BYTES = 850000;
let learningSyncReady = false;
let learningSyncRevision = null;
let learningSyncTimer = null;
let learningSyncBusy = false;
let suppressLearningAutoSync = false;

let learningStore = {
  version: 1,
  cases: [],
  unresolved: [],
  deleted: [],
  metrics: { confirmed: 0, corrected: 0, markedUnresolved: 0, exactHits: 0, retrievals: 0 }
};

function learningMetricDefaults() {
  return { confirmed: 0, corrected: 0, markedUnresolved: 0, exactHits: 0, retrievals: 0 };
}

function learningTextKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[，,。.;；:：、|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function learningShape(value) {
  return learningTextKey(value)
    .replace(/\d+(?:\.\d+)?/g, "#")
    .replace(/[-~_/]+/g, "#")
    .replace(/#+/g, "#")
    .replace(/\s+/g, "");
}

function sanitizeLearningCase(value) {
  if (!value || typeof value !== "object") return null;
  const rawText = String(value.raw_text || "").trim();
  const snapshot = value.snapshot;
  if (!rawText || rawText.length > 10000 || !snapshot || typeof snapshot !== "object") return null;
  if (!Array.isArray(snapshot.groups) || snapshot.groups.length === 0) return null;

  const groups = [];
  for (const group of snapshot.groups) {
    if (!group || typeof group !== "object") continue;
    const amount = Number(group.amount);
    const total = Number(group.total);
    const multiplier = Number(group.multiplier || 1);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(total) ||
        !Number.isFinite(multiplier) || multiplier < 1) continue;
    groups.push({
      play_type: String(group.play_type || "未指定玩法"),
      label: String(group.label || ""),
      amount,
      total,
      billing_mode: String(group.billing_mode || "per_number"),
      selection_text: String(group.selection_text || ""),
      multiplier: Math.floor(multiplier),
      numbers: Array.isArray(group.numbers)
        ? group.numbers.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 49)
        : [],
      source: String(group.source || "")
    });
  }
  if (!groups.length) return null;

  const total = Number(snapshot.total);
  if (!Number.isFinite(total) || total < 0) return null;
  return {
    id: String(value.id || ("case-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8))),
    raw_text: rawText,
    corrected_text: String(value.corrected_text || rawText).slice(0, 10000),
    year_animal: String(value.year_animal || "马"),
    created_at: String(value.created_at || new Date().toISOString()),
    updated_at: String(value.updated_at || value.created_at || new Date().toISOString()),
    source: value.source === "corrected" ? "corrected" : "confirmed",
    snapshot: { content: String(snapshot.content || ""), total, warnings: [], groups }
  };
}


function sanitizeLearningTombstone(value) {
  if (!value || typeof value !== "object" || typeof value.raw_text !== "string") return null;
  const rawText = value.raw_text.trim();
  if (!rawText || rawText.length > 10000) return null;
  return {
    id: String(value.id || "").slice(0, 100),
    raw_text: rawText,
    year_animal: String(value.year_animal || "马").slice(0, 8),
    deleted_at: String(value.deleted_at || new Date().toISOString()).slice(0, 50)
  };
}

function loadLearningStore() {
  try {
    const raw = localStorage.getItem(LEARNING_KEY);
    if (!raw) {
      updateLearningUI();
      const cfg = getLearningSyncConfig();
      if (cfg.url && cfg.token && typeof setTimeout === "function") {
        setTimeout(() => syncLearningNow(true), 900);
      }
      return;
    }
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") throw new Error("学习库格式错误");
    learningStore = {
      version: 1,
      cases: (Array.isArray(data.cases) ? data.cases : [])
        .map(sanitizeLearningCase).filter(Boolean).slice(-MAX_LEARNING_CASES),
      unresolved: Array.isArray(data.unresolved) ? data.unresolved
        .filter(x => x && typeof x.raw_text === "string")
        .map(x => ({
          raw_text: String(x.raw_text).slice(0, 10000),
          created_at: String(x.created_at || new Date().toISOString()),
          note: String(x.note || "").slice(0, 1000)
        })).slice(-MAX_UNRESOLVED_CASES) : [],
      deleted: (Array.isArray(data.deleted) ? data.deleted : [])
        .map(sanitizeLearningTombstone).filter(Boolean).slice(-MAX_LEARNING_DELETIONS),
      metrics: { ...learningMetricDefaults(), ...(data.metrics || {}) }
    };
    for (const k of Object.keys(learningMetricDefaults())) {
      const n = Number(learningStore.metrics[k] || 0);
      learningStore.metrics[k] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    }
  } catch (e) {
    console.warn("学习案例库加载失败：", e);
    learningStore = { version: 1, cases: [], unresolved: [], deleted: [], metrics: learningMetricDefaults() };
    toast("学习案例库无法读取，已使用空学习库；未自动删除原始数据", 3500);
  }
  updateLearningUI();
  const cfg = getLearningSyncConfig();
  if (cfg.url && cfg.token && typeof setTimeout === "function") {
    setTimeout(() => syncLearningNow(true), 900);
  }
}

function saveLearningStore() {
  try {
    learningStore.cases = learningStore.cases.slice(-MAX_LEARNING_CASES);
    learningStore.unresolved = learningStore.unresolved.slice(-MAX_UNRESOLVED_CASES);
    learningStore.deleted = (Array.isArray(learningStore.deleted) ? learningStore.deleted : [])
      .map(sanitizeLearningTombstone).filter(Boolean).slice(-MAX_LEARNING_DELETIONS);
    localStorage.setItem(LEARNING_KEY, JSON.stringify(learningStore));
    updateLearningUI();
    if (!suppressLearningAutoSync && learningSyncReady) scheduleLearningSync();
    return true;
  } catch (e) {
    console.warn("学习案例库保存失败：", e);
    toast("学习库保存失败，可能是浏览器空间不足。请先导出备份", 3500);
    return false;
  }
}


// ==================== 私人云端同步（可选） ====================
function getLearningSyncConfig() {
  try {
    return {
      url: String(localStorage.getItem(LEARNING_SYNC_URL_KEY) || "").trim(),
      token: String(localStorage.getItem(LEARNING_SYNC_TOKEN_KEY) || "").trim()
    };
  } catch (_) {
    return { url: "", token: "" };
  }
}

function learningSyncEndpoint(base) {
  const parsed = new URL(String(base || "").trim());
  if (parsed.protocol !== "https:") throw new Error("云端地址必须以 https:// 开头");
  const path = parsed.pathname.replace(/\/+$/, "");
  return parsed.origin + (path.endsWith("/api/v1/learning")
    ? path : (path ? path : "") + "/api/v1/learning");
}

function setLearningSyncStatus(message, isError) {
  const node = $("#learning-sync-status");
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? "var(--danger, #ff7777)" : "var(--muted)";
}

function saveLearningSyncConfig() {
  const urlInput = $("#learning-sync-url");
  const tokenInput = $("#learning-sync-token");
  if (!urlInput || !tokenInput) return false;
  const url = urlInput.value.trim().replace(/\/+$/, "");
  const token = tokenInput.value.trim();
  try {
    learningSyncEndpoint(url);
  } catch (e) {
    toast("云端地址无效：" + e.message);
    return false;
  }
  if (token.length < 32) {
    toast("同步令牌至少需要 32 个字符，建议使用随机生成的 64 位十六进制令牌");
    return false;
  }
  try {
    localStorage.setItem(LEARNING_SYNC_URL_KEY, url);
    localStorage.setItem(LEARNING_SYNC_TOKEN_KEY, token);
    learningSyncReady = false;
    learningSyncRevision = null;
    updateLearningUI();
    setLearningSyncStatus("配置已保存在此浏览器；请点击“立即同步”验证连接。", false);
    toast("云端配置已保存到当前浏览器");
    return true;
  } catch (e) {
    toast("无法保存云端配置：" + e.message, 3500);
    return false;
  }
}

function mergeLearningStores(localData, remoteData) {
  const local = localData && typeof localData === "object" ? localData : {};
  const remote = remoteData && typeof remoteData === "object" ? remoteData : {};
  const caseKey = item => String(item.year_animal || "马") + "|" + learningTextKey(item.raw_text);
  const byKey = new Map();

  for (const raw of [...(Array.isArray(remote.cases) ? remote.cases : []),
                     ...(Array.isArray(local.cases) ? local.cases : [])]) {
    const item = sanitizeLearningCase(raw);
    if (!item) continue;
    const key = caseKey(item);
    const old = byKey.get(key);
    if (!old || String(item.updated_at || "") >= String(old.updated_at || "")) byKey.set(key, item);
  }

  const deletionMap = new Map();
  for (const raw of [...(Array.isArray(remote.deleted) ? remote.deleted : []),
                     ...(Array.isArray(local.deleted) ? local.deleted : [])]) {
    const item = sanitizeLearningTombstone(raw);
    if (!item) continue;
    const key = caseKey(item);
    const old = deletionMap.get(key);
    if (!old || String(item.deleted_at) >= String(old.deleted_at)) deletionMap.set(key, item);
  }

  const allCases = Array.from(byKey.values());
  const cases = allCases.filter(item => {
    const deletion = deletionMap.get(caseKey(item));
    return !deletion || String(item.updated_at || "") > String(deletion.deleted_at || "");
  });
  const deleted = Array.from(deletionMap.values()).filter(item => {
    const existing = byKey.get(caseKey(item));
    return !existing || String(item.deleted_at || "") >= String(existing.updated_at || "");
  }).sort((a, b) => String(a.deleted_at).localeCompare(String(b.deleted_at)))
    .slice(-MAX_LEARNING_DELETIONS);

  const unresolvedMap = new Map();
  const unresolvedKey = item => learningTextKey(item.raw_text) + "|" +
    String(item.created_at || "") + "|" + String(item.note || "");
  for (const raw of [...(Array.isArray(remote.unresolved) ? remote.unresolved : []),
                     ...(Array.isArray(local.unresolved) ? local.unresolved : [])]) {
    if (!raw || typeof raw.raw_text !== "string" || !raw.raw_text.trim()) continue;
    const item = {
      raw_text: String(raw.raw_text).slice(0, 10000),
      created_at: String(raw.created_at || new Date().toISOString()),
      note: String(raw.note || "").slice(0, 1000)
    };
    unresolvedMap.set(unresolvedKey(item), item);
  }
  const metricKeys = Object.keys(learningMetricDefaults());
  const metrics = {};
  for (const key of metricKeys) {
    const a = Number((local.metrics || {})[key] || 0);
    const b = Number((remote.metrics || {})[key] || 0);
    metrics[key] = Math.max(0, Number.isFinite(a) ? Math.floor(a) : 0,
      Number.isFinite(b) ? Math.floor(b) : 0);
  }
  return {
    version: 1,
    cases: cases.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))
      .slice(-MAX_LEARNING_CASES),
    unresolved: Array.from(unresolvedMap.values()).sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at))).slice(-MAX_UNRESOLVED_CASES),
    deleted,
    metrics
  };
}

function replaceLearningStoreFromSync(value) {
  learningStore = mergeLearningStores(value, {});
  suppressLearningAutoSync = true;
  try {
    saveLearningStore();
  } finally {
    suppressLearningAutoSync = false;
  }
}

function scheduleLearningSync() {
  if (!learningSyncReady || learningSyncBusy || suppressLearningAutoSync ||
      typeof setTimeout !== "function") return;
  if (learningSyncTimer) clearTimeout(learningSyncTimer);
  learningSyncTimer = setTimeout(() => {
    learningSyncTimer = null;
    syncLearningNow(true);
  }, 1200);
}

async function syncLearningNow(silent) {
  if (learningSyncBusy) {
    if (!silent) toast("同步正在进行，请稍候");
    return false;
  }
  const config = getLearningSyncConfig();
  if (!config.url || !config.token) {
    setLearningSyncStatus("尚未配置云端地址和同步令牌；当前仍使用本地学习库。", true);
    if (!silent) toast("请先填写云端地址和同步令牌");
    return false;
  }
  let endpoint;
  try {
    endpoint = learningSyncEndpoint(config.url);
  } catch (e) {
    setLearningSyncStatus("云端地址无效：" + e.message, true);
    if (!silent) toast(e.message);
    return false;
  }

  learningSyncBusy = true;
  let finalStatusMessage = "";
  let finalStatusIsError = false;
  setLearningSyncStatus("正在连接云端并合并本地案例…", false);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const getResponse = await fetch(endpoint, {
        method: "GET",
        headers: { "Authorization": "Bearer " + config.token, "Accept": "application/json" },
        cache: "no-store"
      });
      const cloud = await getResponse.json().catch(() => ({}));
      if (!getResponse.ok) {
        throw new Error(cloud.error || ("云端读取失败 HTTP " + getResponse.status));
      }
      let merged = mergeLearningStores(learningStore, cloud.store || {});
      replaceLearningStoreFromSync(merged);

      const payload = { expected_revision: Number(cloud.revision || 0), store: merged };
      const encoded = JSON.stringify(payload);
      if (encoded.length > LEARNING_SYNC_MAX_BYTES) {
        throw new Error("学习库超过云端单次同步大小限制。请先导出备份并清理过大的案例。");
      }
      const putResponse = await fetch(endpoint, {
        method: "PUT",
        headers: {
          "Authorization": "Bearer " + config.token,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: encoded,
        cache: "no-store"
      });
      const saved = await putResponse.json().catch(() => ({}));
      if (putResponse.status === 409) {
        learningSyncRevision = Number(saved.revision || 0);
        if (!saved.store) throw new Error("云端发生版本冲突，但没有返回可合并数据");
        merged = mergeLearningStores(learningStore, saved.store);
        replaceLearningStoreFromSync(merged);
        continue;
      }
      if (!putResponse.ok) {
        throw new Error(saved.error || ("云端保存失败 HTTP " + putResponse.status));
      }
      learningSyncRevision = Number(saved.revision || payload.expected_revision + 1);
      learningSyncReady = true;
      updateLearningUI();
      finalStatusMessage = "✅ 云端同步成功 · 版本 " + learningSyncRevision +
        " · 案例 " + learningStore.cases.length + " 条";
      finalStatusIsError = false;
      setLearningSyncStatus(finalStatusMessage, false);
      if (!silent) toast("云端同步完成");
      return true;
    }
    throw new Error("多设备数据持续冲突。请稍后再次点击“立即同步”。");
  } catch (e) {
    console.warn("云端学习库同步失败：", e);
    finalStatusMessage = "同步失败：" + e.message + "；本地数据未清除。";
    finalStatusIsError = true;
    setLearningSyncStatus(finalStatusMessage, true);
    if (!silent) toast("同步失败：" + e.message, 4500);
    return false;
  } finally {
    learningSyncBusy = false;
    updateLearningUI();
    if (finalStatusMessage) setLearningSyncStatus(finalStatusMessage, finalStatusIsError);
  }
}

function snapshotFromResult(result) {
  const groups = Array.isArray(result && result.groups) ? result.groups : [];
  return {
    content: String(result && result.content || ""),
    total: Number(result && result.total || 0),
    warnings: [],
    groups: groups.map(g => ({
      play_type: String(g.play_type || "未指定玩法"),
      label: String(g.label || ""),
      amount: Number(g.amount || 0),
      total: Number(g.total || 0),
      billing_mode: String(g.billing_mode || "per_number"),
      selection_text: String(g.selection_text || ""),
      multiplier: Number(g.multiplier || 1),
      numbers: Array.isArray(g.numbers) ? g.numbers.slice() : [],
      source: String(g.source || "")
    }))
  };
}

function recordVerifiedLearningCase(rawText, result, correctedText, source) {
  const snapshot = snapshotFromResult(result);
  if (!String(rawText || "").trim() || !snapshot.groups.length) {
    toast("没有完整解析结果，不能保存为学习案例");
    return false;
  }
  const now = new Date().toISOString();
  const key = learningTextKey(rawText);
  const year = yearAnimal();
  const idx = learningStore.cases.findIndex(c =>
    c.year_animal === year && learningTextKey(c.raw_text) === key
  );
  const old = idx >= 0 ? learningStore.cases[idx] : null;
  const item = sanitizeLearningCase({
    id: old ? old.id : undefined,
    raw_text: rawText,
    corrected_text: String(correctedText || rawText).trim(),
    year_animal: year,
    created_at: old ? old.created_at : now,
    updated_at: now,
    source: source === "corrected" ? "corrected" : "confirmed",
    snapshot
  });
  if (!item) {
    toast("结果结构校验失败，未保存学习案例");
    return false;
  }
  if (idx >= 0) learningStore.cases.splice(idx, 1);
  learningStore.cases.push(item);
  learningStore.deleted = (Array.isArray(learningStore.deleted) ? learningStore.deleted : [])
    .filter(d => !(d.year_animal === year && learningTextKey(d.raw_text) === key));
  learningStore.metrics.confirmed += 1;
  if (source === "corrected") learningStore.metrics.corrected += 1;
  return saveLearningStore();
}

function findExactLearningCase(rawText) {
  const key = learningTextKey(rawText);
  const year = yearAnimal();
  for (let i = learningStore.cases.length - 1; i >= 0; i--) {
    const item = learningStore.cases[i];
    if (item.year_animal === year && learningTextKey(item.raw_text) === key) return item;
  }
  return null;
}

function learningSimilarity(a, b) {
  const x = learningShape(a);
  const y = learningShape(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = value => {
    const out = new Set();
    if (value.length === 1) out.add(value);
    else for (let i = 0; i < value.length - 1; i++) out.add(value.slice(i, i + 2));
    return out;
  };
  const gx = grams(x), gy = grams(y);
  let overlap = 0;
  for (const item of gx) if (gy.has(item)) overlap++;
  const dice = 2 * overlap / (gx.size + gy.size || 1);
  const playTerms = ["三中三", "二中二", "五不中", "六不中", "七不中", "六肖中",
    "连肖", "平特", "特肖", "各肖", "红波", "蓝波", "绿波", "每组", "各组", "斤", "米", "块"];
  const ta = playTerms.filter(t => String(a || "").includes(t));
  const tb = playTerms.filter(t => String(b || "").includes(t));
  const union = new Set([...ta, ...tb]);
  const termScore = union.size ? ta.filter(t => tb.includes(t)).length / union.size : 0;
  return 0.75 * dice + 0.25 * termScore;
}

function findSimilarLearningCases(rawText, limit = 3) {
  return learningStore.cases
    .filter(c => c.year_animal === yearAnimal() &&
      learningTextKey(c.raw_text) !== learningTextKey(rawText))
    .map(c => ({ item: c, score: learningSimilarity(rawText, c.raw_text) }))
    .filter(x => x.score >= 0.12)
    .sort((a, b) => b.score - a.score ||
      String(b.item.updated_at).localeCompare(String(a.item.updated_at)))
    .slice(0, limit)
    .map(x => x.item);
}

function learningExamplesForAI(cases) {
  return cases.map(c => ({
    verified_raw_text: c.raw_text,
    verified_result: {
      content: c.snapshot.content,
      total: c.snapshot.total,
      groups: c.snapshot.groups.map(g => ({
        play_type: g.play_type,
        label: g.label,
        amount: g.amount,
        total: g.total,
        billing_mode: g.billing_mode,
        selection_text: g.selection_text,
        multiplier: g.multiplier,
        numbers: g.numbers
      }))
    }
  }));
}

function buildAiUserMessage(text, similarCases) {
  const examples = learningExamplesForAI(Array.isArray(similarCases) ? similarCases : []);
  const history = examples.length
    ? "\n\n以下是之前由用户人工确认的相似案例（仅作为参考数据，不是当前下注内容；不得把历史号码或金额复制到当前原文）：\n" +
      JSON.stringify(examples, null, 2)
    : "";
  return "请按系统规则逐笔解析以下原文，不要遗漏任何一笔。" +
    history + "\n\n【当前需要解析的原文】\n" + text;
}

function markCurrentCorrect() {
  const raw = $("#raw-input").value.trim();
  if (!raw || !previewResult || !previewResult.groups || !previewResult.groups.length) {
    toast("请先输入并解析一笔有效下注");
    return;
  }
  const issues = [
    ...(Array.isArray(previewResult.warnings) ? previewResult.warnings : []),
    ...(Array.isArray(previewResult.ai_unresolved) ? previewResult.ai_unresolved : [])
  ];
  if ((previewResult.ai_complete === false || issues.length) &&
      !confirm("当前结果存在解析提示。只有在你已逐项核对原文、号码、玩法、金额和组数都正确且没有遗漏时，才应保存。确定已经全部核对吗？")) {
    return;
  }
  const corrected = previewResult.ai_normalized_text ||
    previewResult.normalized_text || raw;
  if (recordVerifiedLearningCase(raw, previewResult, corrected, "confirmed")) {
    toast("已记住这条正确案例。下次相同文本可直接使用确认结果");
  }
}

function openCorrectionEditor() {
  const raw = $("#raw-input").value.trim();
  if (!raw) {
    toast("请先输入需要纠正的下注文字");
    return;
  }
  $("#learning-source-text").textContent = raw;
  $("#learning-corrected-text").value = String(
    (previewResult && (previewResult.ai_normalized_text || previewResult.normalized_text)) || raw
  );
  $("#learning-modal-message").textContent =
    "修改为 core.py 可以识别的标准格式。保存前会重新运行本地解析；原始输入会作为本次案例的检索键。";
  $("#learning-modal").hidden = false;
  $("#learning-corrected-text").focus();
}

function closeCorrectionEditor() {
  $("#learning-modal").hidden = true;
}

async function saveCorrectionCase() {
  const raw = $("#raw-input").value.trim();
  const correctedText = $("#learning-corrected-text").value.trim();
  if (!raw || !correctedText) {
    toast("原文和纠正后的标准文本都不能为空");
    return;
  }
  const button = $("#learning-save-correction");
  button.disabled = true;
  button.textContent = "正在校验…";
  try {
    const parsed = await pyParseBet(correctedText);
    if (!parsed.groups || !parsed.groups.length) {
      $("#learning-modal-message").textContent =
        "这份标准文本仍无法解析：" + (parsed.warnings || []).join("；");
      toast("纠正文本未能解析，请继续修改");
      return;
    }
    if (parsed.warnings && parsed.warnings.length &&
        !confirm("纠正文本仍有提示：\n" + parsed.warnings.join("\n") + "\n\n确认结果没有遗漏后仍要保存吗？")) {
      return;
    }
    parsed.raw_text = raw;
    parsed.normalized_text = correctedText;
    parsed.ai_normalized_text = correctedText;
    parsed.ai_complete = true;
    parsed.ai_low_confidence = false;
    parsed.ai_unresolved = [];
    parsed.manually_corrected = true;
    previewResult = parsed;

    if (!recordVerifiedLearningCase(raw, parsed, correctedText, "corrected")) return;
    $("#preview-box").textContent =
      "✅ 已纠正并保存为学习案例\n\n" + parsed.content +
      (parsed.warnings && parsed.warnings.length ? "\n\n提示：\n" + parsed.warnings.join("\n") : "");
    closeCorrectionEditor();
    toast("纠错已保存。此案例会参与后续相似案例参考");
    updateTotals();
  } catch (e) {
    toast("纠错校验失败：" + e.message, 3500);
  } finally {
    button.disabled = false;
    button.textContent = "校验并保存案例";
  }
}

function markCurrentUnresolved() {
  const raw = $("#raw-input").value.trim();
  if (!raw) {
    toast("请先输入无法识别的原文");
    return;
  }
  learningStore.unresolved.push({
    raw_text: raw,
    created_at: new Date().toISOString(),
    note: String($("#preview-box").textContent || "").slice(0, 1000)
  });
  learningStore.metrics.markedUnresolved += 1;
  if (saveLearningStore()) toast("已记录为待处理样本；它不会被当成正确案例");
}

function updateLearningUI() {
  const syncConfig = getLearningSyncConfig();
  const urlInput = $("#learning-sync-url");
  const tokenInput = $("#learning-sync-token");
  if (urlInput && (!document.activeElement || document.activeElement !== urlInput)) urlInput.value = syncConfig.url;
  if (tokenInput && (!document.activeElement || document.activeElement !== tokenInput)) tokenInput.value = syncConfig.token;
  const syncStatus = $("#learning-sync-status");
  if (syncStatus && !learningSyncBusy) {
    if (learningSyncReady) syncStatus.textContent = "云端同步已连接 · 版本 " + (learningSyncRevision === null ? "已验证" : learningSyncRevision);
    else if (syncConfig.url && syncConfig.token) syncStatus.textContent = "云端配置已保存；等待同步验证。";
    else syncStatus.textContent = "云端同步未配置，当前只保存在本地浏览器。";
  }
  const stats = $("#learning-stats");
  if (stats) {
    stats.textContent =
      "已确认案例 " + learningStore.cases.length +
      " 条 · 确认 " + learningStore.metrics.confirmed +
      " 次 · 纠错 " + learningStore.metrics.corrected +
      " 次 · 待处理 " + learningStore.unresolved.length +
      " 条 · 相似案例参考 " + learningStore.metrics.retrievals + " 次";
  }
  const list = $("#learning-recent");
  if (!list) return;
  list.replaceChildren();
  const recent = learningStore.cases.slice(-5).reverse();
  if (!recent.length) {
    const empty = document.createElement("div");
    empty.className = "learning-case";
    empty.textContent = "还没有已确认案例。解析后点击“识别正确”或“纠错并记住”开始积累。";
    list.appendChild(empty);
    return;
  }
  for (const item of recent) {
    const row = document.createElement("div");
    row.className = "learning-case";
    const main = document.createElement("div");
    main.className = "learning-case-main";
    const title = document.createElement("div");
    title.className = "learning-case-title";
    title.textContent = item.raw_text;
    const summary = document.createElement("div");
    summary.className = "learning-case-summary";
    summary.textContent = item.snapshot.content + " · 合计 " + fmtNum(item.snapshot.total);
    main.append(title, summary);
    const remove = document.createElement("button");
    remove.className = "learning-delete";
    remove.textContent = "删除";
    remove.addEventListener("click", () => deleteLearningCase(item.id));
    row.append(main, remove);
    list.appendChild(row);
  }
}

function toggleLearningRecent() {
  const list = $("#learning-recent");
  if (list) {
    list.hidden = !list.hidden;
    if (!list.hidden) updateLearningUI();
  }
}

function deleteLearningCase(id) {
  if (!confirm("确定删除这条已确认学习案例？")) return;
  const item = learningStore.cases.find(c => c.id === id);
  if (item) {
    if (!Array.isArray(learningStore.deleted)) learningStore.deleted = [];
    learningStore.deleted.push({
      id: item.id,
      raw_text: item.raw_text,
      year_animal: item.year_animal,
      deleted_at: new Date().toISOString()
    });
  }
  learningStore.cases = learningStore.cases.filter(c => c.id !== id);
  saveLearningStore();
  toast("已删除学习案例；同步启用后会同步删除到其他设备");
}

function exportLearningData() {
  const payload = {
    app: "BetTool",
    learning_version: 1,
    exported_at: new Date().toISOString(),
    cases: learningStore.cases,
    unresolved: learningStore.unresolved,
    deleted: learningStore.deleted || [],
    metrics: learningStore.metrics
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bettool_learning_backup_" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  toast("学习案例备份已导出");
}

async function importLearningFile(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const incoming = Array.isArray(payload) ? payload : payload.cases;
    if (!Array.isArray(incoming)) throw new Error("文件中没有 cases 案例列表");
    if (!confirm("准备导入 " + incoming.length + " 条案例。相同原文和年份的案例将被更新，是否继续？")) return;

    let imported = 0;
    for (const rawCase of incoming) {
      const item = sanitizeLearningCase(rawCase);
      if (!item) continue;
      const idx = learningStore.cases.findIndex(c =>
        c.year_animal === item.year_animal &&
        learningTextKey(c.raw_text) === learningTextKey(item.raw_text)
      );
      if (idx >= 0) learningStore.cases.splice(idx, 1);
      learningStore.cases.push(item);
      imported++;
    }
    if (!Array.isArray(payload) && Array.isArray(payload.unresolved)) {
      const extra = payload.unresolved.filter(x => x && typeof x.raw_text === "string")
        .map(x => ({
          raw_text: String(x.raw_text).slice(0, 10000),
          created_at: String(x.created_at || new Date().toISOString()),
          note: String(x.note || "").slice(0, 1000)
        }));
      learningStore.unresolved.push(...extra);
    }
    saveLearningStore();
    toast("导入完成：有效案例 " + imported + " 条");
  } catch (e) {
    toast("导入失败：" + e.message, 3500);
  } finally {
    input.value = "";
  }
}
