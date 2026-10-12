import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const token = "a".repeat(64);
const env = {
  BETTOOL_SYNC_TOKEN: token,
  ALLOWED_ORIGIN: "https://lyle1133.github.io,https://bettool-private-learning-test.pages.dev",
  DB: null
};

function makeDb(initial = {
  revision: 0,
  store_json: JSON.stringify({ version: 1, cases: [], unresolved: [], metrics: {
    confirmed: 0, corrected: 0, markedUnresolved: 0, exactHits: 0, retrievals: 0
  }}),
  updated_at: "2026-10-12T00:00:00.000Z"
}) {
  const row = { ...initial };
  return {
    row,
    prepare() {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return row ? { ...row } : null; },
        async run() {
          const [storeJson, updatedAt, expected] = args;
          if (Number(expected) !== Number(row.revision)) return { success: true, meta: { changes: 0 } };
          row.revision += 1;
          row.store_json = storeJson;
          row.updated_at = updatedAt;
          return { success: true, meta: { changes: 1 } };
        }
      };
    }
  };
}

function request(path, options = {}) {
  return new Request("https://sync.example.workers.dev" + path, options);
}

test("health endpoint is public and returns service identity", async () => {
  const response = await worker.fetch(request("/health"), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("learning endpoint rejects missing bearer token", async () => {
  const response = await worker.fetch(request("/api/v1/learning"), { ...env, DB: makeDb() });
  assert.equal(response.status, 401);
});

test("learning endpoint rejects an unapproved browser origin", async () => {
  const response = await worker.fetch(request("/api/v1/learning", {
    headers: { Origin: "https://evil.example", Authorization: "Bearer " + token }
  }), { ...env, DB: makeDb() });
  assert.equal(response.status, 403);
});

test("authorized client can save a validated learning snapshot", async () => {
  const db = makeDb();
  const response = await worker.fetch(request("/api/v1/learning", {
    method: "PUT",
    headers: {
      Origin: "https://lyle1133.github.io",
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      expected_revision: 0,
      store: {
        version: 1,
        cases: [{
          id: "case-1",
          raw_text: "三中三 45-05-22各组10",
          corrected_text: "三中三 45-05-22各组10",
          year_animal: "马",
          source: "confirmed",
          snapshot: { content: "已确认", total: 10, groups: [{
            play_type: "三中三", amount: 10, total: 10, multiplier: 1,
            billing_mode: "fixed", numbers: [45, 5, 22]
          }] }
        }],
        unresolved: [],
        metrics: { confirmed: 1 }
      }
    })
  }), { ...env, DB: db });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.revision, 1);
  assert.equal(body.store.cases.length, 1);
  assert.equal(body.store.cases[0].raw_text, "三中三 45-05-22各组10");
  assert.deepEqual(body.store.deleted, [], "empty deletion list should be preserved");
});

test("stale revision gets 409 and does not overwrite a newer snapshot", async () => {
  const db = makeDb();
  db.row.revision = 2;
  db.row.store_json = JSON.stringify({ version: 1, cases: [], unresolved: [], metrics: {} });
  const response = await worker.fetch(request("/api/v1/learning", {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      expected_revision: 1,
      store: { version: 1, cases: [], unresolved: [], metrics: {} }
    })
  }), { ...env, DB: db });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).revision, 2);
  assert.equal(db.row.revision, 2);
});

test("invalid JSON and excessive case count are rejected", async () => {
  const db = makeDb();
  const badJson = await worker.fetch(request("/api/v1/learning", {
    method: "PUT",
    headers: { Authorization: "Bearer " + token },
    body: "{"
  }), { ...env, DB: db });
  assert.equal(badJson.status, 400);

  const tooMany = await worker.fetch(request("/api/v1/learning", {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ expected_revision: 0, store: {
      version: 1, cases: Array.from({ length: 1001 }, () => ({})), unresolved: [], metrics: {}
    }})
  }), { ...env, DB: db });
  assert.equal(tooMany.status, 400);
});


test("test Pages origin is allowed and preflight includes CORS headers", async () => {
  const origin = "https://bettool-private-learning-test.pages.dev";
  const response = await worker.fetch(request("/api/v1/learning", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "authorization,content-type"
    }
  }), env);

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.match(response.headers.get("Access-Control-Allow-Methods") || "", /GET/);
  assert.match(response.headers.get("Access-Control-Allow-Methods") || "", /PUT/);
  assert.match(response.headers.get("Access-Control-Allow-Headers") || "", /Authorization/i);
  assert.match(response.headers.get("Access-Control-Allow-Headers") || "", /Content-Type/i);
  assert.equal(response.headers.get("Vary"), "Origin");
});

test("production Pages origin is allowed by preflight", async () => {
  const origin = "https://lyle1133.github.io";
  const response = await worker.fetch(request("/api/v1/learning", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "authorization,content-type"
    }
  }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
});

test("unapproved Pages preview origin is blocked", async () => {
  const response = await worker.fetch(request("/api/v1/learning", {
    method: "OPTIONS",
    headers: {
      Origin: "https://random-preview.pages.dev",
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "authorization,content-type"
    }
  }), env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});
