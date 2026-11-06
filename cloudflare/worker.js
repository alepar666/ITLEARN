const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CODE_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

function responseHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders() });
}

function readSyncCode(request) {
  const match = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,64})$/);
  return match && CODE_PATTERN.test(match[1]) ? match[1] : null;
}

async function hashCode(code) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function validProgress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!value.cards || typeof value.cards !== "object" || Array.isArray(value.cards)) return false;
  if (!value.stats || typeof value.stats !== "object" || Array.isArray(value.stats)) return false;
  if (Object.keys(value.cards).length > 5000) return false;
  return true;
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) return { error: "Richiesta troppo grande.", status: 413 };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { error: "Richiesta troppo grande.", status: 413 };
  try { return { value: JSON.parse(text) }; }
  catch (_) { return { error: "JSON non valido.", status: 400 }; }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders() });

    const url = new URL(request.url);
    if (url.pathname !== "/v1/progress") return jsonResponse({ error: "Percorso non trovato." }, 404);

    if (!["GET", "POST", "PUT"].includes(request.method)) {
      return jsonResponse({ error: "Metodo non supportato." }, 405);
    }

    const code = readSyncCode(request);
    if (!code) return jsonResponse({ error: "Codice di sincronizzazione non valido." }, 401);
    const codeHash = await hashCode(code);

    if (request.method === "GET") {
      const row = await env.DB.prepare(
        "SELECT progress_json, revision, updated_at FROM sync_profiles WHERE code_hash = ?"
      ).bind(codeHash).first();
      if (!row) return jsonResponse({ error: "Profilo non trovato." }, 404);
      return jsonResponse({ progress: JSON.parse(row.progress_json), revision: row.revision, updatedAt: row.updated_at });
    }

    const parsed = await readJson(request);
    if (parsed.error) return jsonResponse({ error: parsed.error }, parsed.status);
    const body = parsed.value;
    if (!validProgress(body?.progress)) return jsonResponse({ error: "Formato dei progressi non valido." }, 400);
    const progressJson = JSON.stringify(body.progress);
    const now = Date.now();

    if (request.method === "POST") {
      const created = await env.DB.prepare(
        "INSERT INTO sync_profiles (code_hash, progress_json, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT(code_hash) DO NOTHING"
      ).bind(codeHash, progressJson, now, now).run();
      if (created.meta.changes !== 1) return jsonResponse({ error: "Il codice esiste già." }, 409);
      return jsonResponse({ revision: 1, updatedAt: now }, 201);
    }

    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return jsonResponse({ error: "Revisione non valida." }, 400);
    }
    const updated = await env.DB.prepare(
      "UPDATE sync_profiles SET progress_json = ?, revision = revision + 1, updated_at = ? WHERE code_hash = ? AND revision = ?"
    ).bind(progressJson, now, codeHash, expectedRevision).run();
    if (updated.meta.changes !== 1) {
      const current = await env.DB.prepare(
        "SELECT revision FROM sync_profiles WHERE code_hash = ?"
      ).bind(codeHash).first();
      if (!current) return jsonResponse({ error: "Profilo non trovato." }, 404);
      return jsonResponse({ error: "Conflitto di sincronizzazione.", revision: current.revision }, 409);
    }
    return jsonResponse({ revision: expectedRevision + 1, updatedAt: now });
  }
};
