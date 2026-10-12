const MAX_BODY_BYTES = 900000;
const MAX_CASES = 1000;
const MAX_UNRESOLVED = 500;
const MAX_DELETED = 2000;
const EMPTY_STORE = {
  version: 1,
  cases: [],
  unresolved: [],
  deleted: [],
  metrics: { confirmed: 0, corrected: 0, markedUnresolved: 0, exactHits: 0, retrievals: 0 }
};

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || "").split(",").map(v => v.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const headers = new Headers({ "Vary": "Origin", "Cache-Control": "no-store" });
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

function jsonResponse(request, env, body, status = 200) {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function normalizeStore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("store must be a JSON object");
  }
  const cases = Array.isArray(value.cases) ? value.cases : [];
  const unresolved = Array.isArray(value.unresolved) ? value.unresolved : [];
  const deleted = Array.isArray(value.deleted) ? value.deleted : [];
  if (cases.length > MAX_CASES) throw new Error("too_many_cases");
  if (unresolved.length > MAX_UNRESOLVED) throw new Error("too_many_unresolved");
  if (deleted.length > MAX_DELETED) throw new Error("too_many_deletions");

  const cleanCases = [];
  for (const item of cases) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rawText = typeof item.raw_text === "string" ? item.raw_text.trim() : "";
    const snapshot = item.snapshot;
    if (!rawText || rawText.length > 10000 || !snapshot || typeof snapshot !== "object") continue;
    const incomingGroups = Array.isArray(snapshot.groups) ? snapshot.groups : [];
    if (!incomingGroups.length || incomingGroups.length > 200) continue;
    const groups = [];
    for (const group of incomingGroups) {
      if (!group || typeof group !== "object") continue;
      const amount = Number(group.amount);
      const total = Number(group.total);
      const multiplier = Number(group.multiplier || 1);
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(total) ||
          total < 0 || !Number.isFinite(multiplier) || multiplier < 1) continue;
      const numbers = Array.isArray(group.numbers)
        ? group.numbers.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 49).slice(0, 49)
        : [];
      groups.push({
        play_type: String(group.play_type || "未指定玩法").slice(0, 100),
        label: String(group.label || "").slice(0, 100),
        amount,
        total,
        billing_mode: String(group.billing_mode || "per_number").slice(0, 50),
        selection_text: String(group.selection_text || "").slice(0, 10000),
        multiplier: Math.floor(multiplier),
        numbers,
        source: String(group.source || "").slice(0, 10000)
      });
    }
    if (!groups.length) continue;
    const total = Number(snapshot.total);
    if (!Number.isFinite(total) || total < 0) continue;
    const now = new Date().toISOString();
    cleanCases.push({
      id: String(item.id || crypto.randomUUID()).slice(0, 100),
      raw_text: rawText,
      corrected_text: String(item.corrected_text || rawText).slice(0, 10000),
      year_animal: String(item.year_animal || "马").slice(0, 8),
      created_at: String(item.created_at || now).slice(0, 50),
      updated_at: String(item.updated_at || item.created_at || now).slice(0, 50),
      source: item.source === "corrected" ? "corrected" : "confirmed",
      snapshot: {
        content: String(snapshot.content || "").slice(0, 20000),
        total,
        warnings: [],
        groups
      }
    });
  }

  const cleanUnresolved = unresolved
    .filter(item => item && typeof item.raw_text === "string" && item.raw_text.trim())
    .map(item => ({
      raw_text: String(item.raw_text).slice(0, 10000),
      created_at: String(item.created_at || new Date().toISOString()).slice(0, 50),
      note: String(item.note || "").slice(0, 1000)
    }));

  const cleanDeleted = deleted
    .filter(item => item && typeof item.raw_text === "string" && item.raw_text.trim())
    .map(item => ({
      id: String(item.id || "").slice(0, 100),
      raw_text: String(item.raw_text).slice(0, 10000),
      year_animal: String(item.year_animal || "马").slice(0, 8),
      deleted_at: String(item.deleted_at || new Date().toISOString()).slice(0, 50)
    }));

  const sourceMetrics = value.metrics && typeof value.metrics === "object" ? value.metrics : {};
  const metrics = {};
  for (const key of Object.keys(EMPTY_STORE.metrics)) {
    const n = Number(sourceMetrics[key] || 0);
    metrics[key] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  return {
    version: 1,
    cases: cleanCases.slice(-MAX_CASES),
    unresolved: cleanUnresolved.slice(-MAX_UNRESOLVED),
    deleted: cleanDeleted.slice(-MAX_DELETED),
    metrics
  };
}

async function constantTimeSecretMatch(given, expected) {
  if (!given || !expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function isAuthorized(request, env) {
  const expected = String(env.BETTOOL_SYNC_TOKEN || "");
  if (expected.length < 32) return false;
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  if (!match) return false;
  return constantTimeSecretMatch(match[1].trim(), expected);
}

async function readSnapshot(env) {
  const row = await env.DB.prepare(
    "SELECT revision, store_json, updated_at FROM learning_store WHERE id = 1"
  ).first();
  if (!row) throw new Error("database_not_initialized");
  let store;
  try {
    store = JSON.parse(row.store_json);
  } catch (_) {
    throw new Error("database_store_invalid");
  }
  return { revision: Number(row.revision), updated_at: row.updated_at, store: normalizeStore(store) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins(env).includes(origin)) {
      return jsonResponse(request, env, { error: "origin_not_allowed" }, 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse(request, env, { ok: true, service: "bettool-private-learning-sync" });
    }
    if (url.pathname !== "/api/v1/learning") {
      return jsonResponse(request, env, { error: "not_found" }, 404);
    }
    if (request.method !== "GET" && request.method !== "PUT") {
      return jsonResponse(request, env, { error: "method_not_allowed" }, 405);
    }
    if (!await isAuthorized(request, env)) {
      return jsonResponse(request, env, { error: "unauthorized" }, 401);
    }
    if (!env.DB) {
      return jsonResponse(request, env, { error: "database_binding_missing" }, 503);
    }

    try {
      if (request.method === "GET") {
        return jsonResponse(request, env, { ok: true, ...(await readSnapshot(env)) });
      }
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > MAX_BODY_BYTES) {
        return jsonResponse(request, env, { error: "payload_too_large" }, 413);
      }
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) {
        return jsonResponse(request, env, { error: "payload_too_large" }, 413);
      }
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (_) {
        return jsonResponse(request, env, { error: "invalid_json" }, 400);
      }
      const expectedRevision = Number(payload && payload.expected_revision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        return jsonResponse(request, env, { error: "invalid_expected_revision" }, 400);
      }
      let store;
      try {
        store = normalizeStore(payload.store);
      } catch (e) {
        return jsonResponse(request, env, { error: String(e.message || "invalid_store") }, 400);
      }
      const storeJson = JSON.stringify(store);
      if (storeJson.length > MAX_BODY_BYTES - 1000) {
        return jsonResponse(request, env, { error: "store_too_large" }, 413);
      }
      const updatedAt = new Date().toISOString();
      const result = await env.DB.prepare(
        "UPDATE learning_store SET revision = revision + 1, store_json = ?, updated_at = ? WHERE id = 1 AND revision = ?"
      ).bind(storeJson, updatedAt, expectedRevision).run();
      if (!result || !result.success) throw new Error("database_write_failed");
      if (!result.meta || Number(result.meta.changes || 0) !== 1) {
        const current = await readSnapshot(env);
        return jsonResponse(request, env, {
          error: "revision_conflict",
          revision: current.revision,
          updated_at: current.updated_at,
          store: current.store
        }, 409);
      }
      return jsonResponse(request, env, { ok: true, ...(await readSnapshot(env)) });
    } catch (e) {
      const message = String(e && e.message || "internal_error");
      const status = message === "database_not_initialized" ? 503 : 500;
      return jsonResponse(request, env, {
        error: status === 503 ? "database_not_initialized" : "internal_error"
      }, status);
    }
  }
};

export { normalizeStore };
