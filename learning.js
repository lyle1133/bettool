"use strict";

// BetTool AI 自我迭代 V1：本地案例库、相似检索、纠错和备份。
// 只保存人工确认的解析快照；未确认样本单独进入待处理队列。
const LEARNING_KEY = "bettool_learning_cases_v1";
const MAX_LEARNING_CASES = 1000;
const MAX_UNRESOLVED_CASES = 500;

let learningStore = {
  version: 1,
  cases: [],
  unresolved: [],
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

function loadLearningStore() {
  try {
    const raw = localStorage.getItem(LEARNING_KEY);
    if (!raw) {
      updateLearningUI();
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
      metrics: { ...learningMetricDefaults(), ...(data.metrics || {}) }
    };
    for (const k of Object.keys(learningMetricDefaults())) {
      const n = Number(learningStore.metrics[k] || 0);
      learningStore.metrics[k] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    }
  } catch (e) {
    console.warn("学习案例库加载失败：", e);
    learningStore = { version: 1, cases: [], unresolved: [], metrics: learningMetricDefaults() };
    toast("学习案例库无法读取，已使用空学习库；未自动删除原始数据", 3500);
  }
  updateLearningUI();
}

function saveLearningStore() {
  try {
    learningStore.cases = learningStore.cases.slice(-MAX_LEARNING_CASES);
    learningStore.unresolved = learningStore.unresolved.slice(-MAX_UNRESOLVED_CASES);
    localStorage.setItem(LEARNING_KEY, JSON.stringify(learningStore));
    updateLearningUI();
    return true;
  } catch (e) {
    console.warn("学习案例库保存失败：", e);
    toast("学习库保存失败，可能是浏览器空间不足。请先导出备份", 3500);
    return false;
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
  learningStore.cases = learningStore.cases.filter(c => c.id !== id);
  saveLearningStore();
  toast("已删除学习案例");
}

function exportLearningData() {
  const payload = {
    app: "BetTool",
    learning_version: 1,
    exported_at: new Date().toISOString(),
    cases: learningStore.cases,
    unresolved: learningStore.unresolved,
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
