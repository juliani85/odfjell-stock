// ============================================================================
//  Proxy de GitHub para la app de stock de Odfjell Tagsa (odfjell-stock)
//  Se despliega como un Cloudflare Worker (plan gratis).
//
//  POR QUÉ EXISTE: la app es un sitio estático público (GitHub Pages). No puede
//  guardar el token de GitHub en el JS — GitHub lo detecta (secret scanning) y lo
//  revoca solo. Este Worker guarda el token en su entorno (nunca en el repo ni en
//  el navegador) y hace de intermediario para leer/escribir los .json del repo y
//  disparar el workflow del reporte a supervisores.
//
//  SECRETS a configurar (Settings → Variables and Secrets → Add → Secret):
//    GITHUB_TOKEN  → PAT de GitHub. Classic: scope "repo", SIN expiración (recomendado).
//                    Fine-grained: solo repo juliani85/odfjell-stock, "Contents: Read and write"
//                    + "Actions: Read and write" (para el dispatch).
//    APP_SECRET    → string compartido con la app (el que está ofuscado en js/app.js).
//
//  VARIABLES opcionales (Add → Text):
//    REPO          → "juliani85/odfjell-stock"      (default si no se setea)
//    ORIGEN        → "https://juliani85.github.io"  (origen permitido para CORS)
//
//  RUTAS:
//    GET  /                          → "ok" (health check)
//    GET  /gh/<archivo.json>         → { sha, content }   (content = JSON como texto)
//    PUT  /gh/<archivo.json>         → body { content, sha?, message? }   + header X-App-Secret
//    POST /dispatch/<workflow.yml>   → body { ref?, inputs? }            + header X-App-Secret
//
//  CRON TRIGGER: este Worker tiene un handler scheduled() que dispara el workflow
//  track-vessels.yml. El cron de GitHub Actions es poco confiable para intervalos
//  cortos, así que el tracking de barcos lo agenda Cloudflare. Configurar el
//  intervalo en: Worker → Settings → Triggers → Cron Triggers → Add ("*/10 * * * *").
// ============================================================================

const ARCHIVOS_PERMITIDOS = new Set([
  "datos.json",
  "vistas.json",
  "plan.json",
  "sbfa.json",
  "barcos.json",
  "tracking.json",
]);

const WORKFLOWS_PERMITIDOS = new Set([
  "reporte-supervisor.yml",
  "reporte-diferencias.yml",
  "track-vessels.yml",
]);

function corsHeaders(env, origin) {
  const permitido = env.ORIGEN || "https://juliani85.github.io";
  return {
    "Access-Control-Allow-Origin": origin === permitido ? origin : permitido,
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
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

function autorizado(request, env) {
  if (!env.APP_SECRET) return false;
  if (request.headers.get("X-App-Secret") !== env.APP_SECRET) return false;
  // Doble candado: además del secret (que vive en el bundle público y cualquiera con
  // DevTools puede leer), exigimos que el Origin sea el de la app. Eso bloquea PUTs/POSTs
  // hechos desde otro sitio (CORS preflight no alcanza para esto — un script local puede
  // mandar el header X-App-Secret sin pasar por CORS).
  const permitido = env.ORIGEN || "https://juliani85.github.io";
  const origin = request.headers.get("Origin") || "";
  if (origin !== permitido) return false;
  return true;
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

    const repo = env.REPO || "juliani85/odfjell-stock";
    const ghHeaders = {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "odfjell-stock-worker",
    };

    // ---- /gh/<archivo.json> ----
    const mFile = url.pathname.match(/^\/gh\/([A-Za-z0-9._-]+)$/);
    if (mFile) {
      const archivo = mFile[1];
      if (!ARCHIVOS_PERMITIDOS.has(archivo)) {
        return jsonResp({ error: "archivo no permitido" }, 403, cors);
      }
      const ghUrl = `https://api.github.com/repos/${repo}/contents/${archivo}`;

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
        if (!autorizado(request, env)) return jsonResp({ error: "no autorizado" }, 401, cors);
        let body;
        try { body = await request.json(); } catch (e) { return jsonResp({ error: "body invalido" }, 400, cors); }
        if (typeof body.content !== "string") return jsonResp({ error: "falta content (string)" }, 400, cors);
        try { JSON.parse(body.content); } catch (e) { return jsonResp({ error: "content no es JSON valido" }, 400, cors); }

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

      return jsonResp({ error: "metodo no permitido" }, 405, cors);
    }

    // ---- /dispatch/<workflow.yml> ----
    const mWf = url.pathname.match(/^\/dispatch\/([A-Za-z0-9._-]+\.ya?ml)$/);
    if (mWf) {
      if (request.method !== "POST") return jsonResp({ error: "metodo no permitido" }, 405, cors);
      if (!autorizado(request, env)) return jsonResp({ error: "no autorizado" }, 401, cors);
      const wf = mWf[1];
      if (!WORKFLOWS_PERMITIDOS.has(wf)) return jsonResp({ error: "workflow no permitido" }, 403, cors);
      let body;
      try { body = await request.json(); } catch (e) { body = {}; }
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`, {
        method: "POST",
        headers: { ...ghHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: body.ref || "master", inputs: body.inputs || {} }),
      });
      if (r.status === 204) return jsonResp({ ok: true }, 200, cors);
      const t = await r.text().catch(() => "");
      return jsonResp({ error: `GitHub ${r.status}`, detalle: t.slice(0, 300) }, r.status, cors);
    }

    return jsonResp({ error: "ruta invalida" }, 404, cors);
  },

  // Cron Trigger de Cloudflare: dispara el workflow de tracking de barcos.
  // Solo corre si hay un Cron Trigger configurado en el dashboard del Worker.
  async scheduled(event, env, ctx) {
    const repo = env.REPO || "juliani85/odfjell-stock";
    ctx.waitUntil(
      fetch(`https://api.github.com/repos/${repo}/actions/workflows/track-vessels.yml/dispatches`, {
        method: "POST",
        headers: {
          Authorization: `token ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "odfjell-stock-worker",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "master", inputs: {} }),
      }).catch(() => {})
    );
  },
};
