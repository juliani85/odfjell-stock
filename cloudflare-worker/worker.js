// ============================================================================
//  Proxy de GitHub para la app de stock de Odfjell Tagsa (odfjell-stock)
//  Se despliega como un Cloudflare Worker (plan gratis).
//
//  POR QUÉ EXISTE: la app es un sitio estático público (GitHub Pages). No puede
//  guardar el token de GitHub en el JS — GitHub lo detecta (secret scanning) y lo
//  revoca solo. Este Worker guarda el token en su entorno (nunca en el repo ni en
//  el navegador) y hace de intermediario para leer/escribir los .json del repo.
//
//  SECRETS a configurar en el Worker (Settings → Variables and Secrets → Add → Secret):
//    GITHUB_TOKEN  → Personal Access Token de GitHub.
//                    Classic: scope "repo", SIN expiración. (Recomendado: set-and-forget.)
//                    Fine-grained: solo repo juliani85/odfjell-stock, permiso "Contents: Read and write".
//    APP_SECRET    → string compartido con la app (el que está en js/app.js, codificado).
//                    Si lo rotás, cambialo acá Y en la app.
//
//  VARIABLE opcional (Settings → Variables and Secrets → Add → Text):
//    REPO          → "juliani85/odfjell-stock"  (si no se setea, usa ese por default).
//    ORIGEN        → "https://juliani85.github.io"  (origen permitido para CORS; default ese).
//
//  RUTAS:
//    GET  /gh/<archivo.json>     → devuelve { sha, content }  (content = JSON como texto)
//    PUT  /gh/<archivo.json>     → body { content, sha?, message? }  (content = JSON como texto)
//                                  requiere header  X-App-Secret: <APP_SECRET>
//    GET  /                      → "ok" (health check)
// ============================================================================

const ARCHIVOS_PERMITIDOS = new Set([
  "datos.json",
  "vistas.json",
  "plan.json",
  "sbfa.json",
  "barcos.json",
  "tracking.json",
]);

function corsHeaders(env, origin) {
  const permitido = env.ORIGEN || "https://juliani85.github.io";
  return {
    "Access-Control-Allow-Origin": origin === permitido ? origin : permitido,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Secret",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResp(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function b64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(env, origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return new Response("ok", { status: 200, headers: cors });
    }

    const m = url.pathname.match(/^\/gh\/([A-Za-z0-9._-]+)$/);
    if (!m) return jsonResp({ error: "ruta inválida" }, 404, cors);
    const archivo = m[1];
    if (!ARCHIVOS_PERMITIDOS.has(archivo)) {
      return jsonResp({ error: "archivo no permitido" }, 403, cors);
    }

    const repo = env.REPO || "juliani85/odfjell-stock";
    const ghUrl = `https://api.github.com/repos/${repo}/contents/${archivo}`;
    const ghHeaders = {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "odfjell-stock-worker",
    };

    if (request.method === "GET") {
      const r = await fetch(ghUrl + "?t=" + Date.now(), { headers: ghHeaders });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return jsonResp({ error: `GitHub ${r.status}`, detalle: t.slice(0, 300) }, r.status, cors);
      }
      const data = await r.json();
      let contentTexto = "";
      try { contentTexto = b64ToUtf8(data.content); } catch (e) { contentTexto = ""; }
      return jsonResp({ sha: data.sha, content: contentTexto }, 200, cors);
    }

    if (request.method === "PUT") {
      if (!env.APP_SECRET || request.headers.get("X-App-Secret") !== env.APP_SECRET) {
        return jsonResp({ error: "no autorizado" }, 401, cors);
      }
      let body;
      try { body = await request.json(); } catch (e) { return jsonResp({ error: "body inválido" }, 400, cors); }
      if (typeof body.content !== "string") return jsonResp({ error: "falta 'content' (string)" }, 400, cors);
      // Validar que el content sea JSON parseable (defensa básica contra basura).
      try { JSON.parse(body.content); } catch (e) { return jsonResp({ error: "'content' no es JSON válido" }, 400, cors); }

      const ghBody = {
        message: (typeof body.message === "string" && body.message) ? body.message.slice(0, 200) : `chore: actualizar ${archivo}`,
        content: utf8ToB64(body.content),
      };
      if (body.sha) ghBody.sha = body.sha;

      const r = await fetch(ghUrl, {
        method: "PUT",
        headers: { ...ghHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(ghBody),
      });
      const txt = await r.text();
      return new Response(txt, {
        status: r.status,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    return jsonResp({ error: "método no permitido" }, 405, cors);
  },
};
