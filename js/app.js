// Usuarios válidos
const USUARIOS = {
    cesar: "admin",
    julian: "memorando",
    claudia: "admin",
    uma: "user"
};

// Rol: admin (operadores) o viewer (solo ve salidas)
const ROLES = {
    cesar: "admin",
    julian: "admin",
    claudia: "admin",
    uma: "viewer"
};

let usuarioActual = null;

// --- GMAIL OAUTH ---
// Default hardcoded del project actual de Google Cloud (cuenta tagsaaduana@gmail.com).
// Se puede sobreescribir guardando `localStorage.gmailClientIdOverride` ó setteando
// `datos.json.config.gmailClientId` (lo lee al cargar). Esto permite cambiar a otro
// project de Google Cloud sin tocar código (útil si la cuenta de Google cambia tras un
// baneo, ver project_gmail_baneo.md).
const GMAIL_CLIENT_ID_DEFAULT = "933883889395-ofaj2ikjfgk227so46qm06o65htra0hm.apps.googleusercontent.com";
function getGmailClientId() {
    try {
        const fromStorage = localStorage.getItem("gmailClientIdOverride");
        if (fromStorage) return fromStorage;
    } catch (_) {}
    return (window.__gmailClientIdFromDatos) || GMAIL_CLIENT_ID_DEFAULT;
}
let gmailTokenClient = null;
// Cache del access_token: los tokens de Google duran 1h. Cacheamos por 55 min para no
// pedir un token nuevo cada sync (eso disparaba demasiadas llamadas al OAuth de Google
// con la cuenta tagsaaduana, contribuyendo al baneo del 15/05/2026).
let _gmailTokenCache = { token: null, expiresAt: 0 };

function requestGmailToken(opts = {}) {
    // Si hay un token vigente (con al menos 60s de margen) y no se está forzando un
    // prompt explícito, reusar el cacheado.
    const forzar = opts && opts.prompt && opts.prompt !== "none";
    if (!forzar && _gmailTokenCache.token && _gmailTokenCache.expiresAt > Date.now() + 60000) {
        return Promise.resolve(_gmailTokenCache.token);
    }
    return new Promise((resolve, reject) => {
        if (!gmailTokenClient) {
            try {
                if (typeof google === "undefined" || !google.accounts || !google.accounts.oauth2) {
                    return reject(new Error("Google Identity Services no cargó todavía. Refrescá la página (Ctrl+Shift+R) y probá de nuevo."));
                }
                gmailTokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: getGmailClientId(),
                    scope: "https://www.googleapis.com/auth/gmail.readonly",
                    callback: () => {},
                });
            } catch (e) {
                return reject(e);
            }
        }
        gmailTokenClient.callback = (resp) => {
            if (resp.error) { _gmailTokenCache = { token: null, expiresAt: 0 }; reject(new Error(resp.error_description || resp.error)); }
            else {
                _gmailTokenCache = { token: resp.access_token, expiresAt: Date.now() + 55 * 60 * 1000 };
                resolve(resp.access_token);
            }
        };
        try {
            gmailTokenClient.requestAccessToken(opts);
        } catch (e) {
            reject(e);
        }
    });
}

function base64UrlToUint8Array(b64url) {
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? 0 : (4 - b64.length % 4);
    const binary = atob(b64 + "=".repeat(pad));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function gmailGet(url, token) {
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Gmail ${res.status}: ${t.slice(0, 200)}`);
    }
    return res.json();
}

function extraerCuerpoMail(payload) {
    let plain = "";
    let html = "";
    function recorrer(p) {
        if (!p) return;
        if (p.mimeType === "text/plain" && p.body && p.body.data && !plain) {
            plain = new TextDecoder().decode(base64UrlToUint8Array(p.body.data));
        } else if (p.mimeType === "text/html" && p.body && p.body.data && !html) {
            html = new TextDecoder().decode(base64UrlToUint8Array(p.body.data));
        }
        if (p.parts) for (const sub of p.parts) recorrer(sub);
    }
    recorrer(payload);
    return { plain, html };
}

function cuerpoATexto({ plain, html }) {
    if (plain) return plain;
    if (html) {
        return html
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/?(p|div|tr|li)[^>]*>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'");
    }
    return "";
}

function detectarColumnasPlan(headerStrings) {
    const header = headerStrings.map(h => String(h).toLowerCase().trim());
    const idx = (preds) => header.findIndex(h => preds.some(p => h.includes(p)));
    return {
        header,
        tnk: idx(["tnk", "tanq"]),
        prod: idx(["prod"]),
        clie: idx(["clie", "cli"]),
        buque: idx(["buque"]),
        viaje: idx(["viaje"]),
        subc: idx(["subc"]),
        conoc: idx(["conoc"]),
        despacho: idx(["despa"]),
        exLegal: idx(["ex.", "legal"]),
        fecha: idx(["fecha"]),
        hora: idx(["hora"]),
        obs: idx(["obs"]),
    };
}

function construirFilaPlan(cols, ci, fuente, seq) {
    const tnk = String(cols[ci.tnk] || "").trim();
    const desp = String(cols[ci.despacho] || "").trim();
    if (!tnk && !desp) return null;
    const get = (i) => i >= 0 ? String(cols[i] || "").trim() : "";
    return {
        id: Date.now() + "-" + fuente + "-" + seq + "-" + Math.random().toString(36).slice(2, 7),
        tanque: tnk.padStart(3, "0"),
        producto: get(ci.prod),
        cliente: get(ci.clie),
        buque: get(ci.buque),
        viaje: get(ci.viaje),
        subCliente: get(ci.subc),
        conoc: get(ci.conoc),
        despacho: desp,
        exLegal: get(ci.exLegal),
        fechaOrig: get(ci.fecha),
        horaCarga: formatearHoraPlan(get(ci.hora)),
        observaciones: get(ci.obs),
        cumplido: false,
        salidaId: null,
        cumplidoAt: null,
        fuente,
    };
}

// Recorta la parte "quoted" del cuerpo de texto (respuestas/forwards), igual
// que hace parsearSalidasDesdeBody. Evita que los parsers de tabla lean filas
// del plan de días anteriores que quedaron en la cola del mail.
function sacarQuotedTexto(texto) {
    if (!texto) return "";
    const re = /(?:^|\n|\r\n)\s*(?:De:|From:|-{5,}\s*(?:Original|Mensaje original)|Enviado\s+(?:el|por):|El\s+.{1,120}?\s+escribió:)/i;
    const m = texto.match(re);
    const cortado = m ? texto.slice(0, m.index) : texto;
    return cortado.split(/\n\s*>/)[0];
}

// Remueve nodos quoted del DOM HTML antes de parsear tablas. Estrategia doble:
// 1. Selectores clásicos (blockquote, gmail_quote, etc.).
// 2. Tree walker buscando el primer marcador de reply en texto renderizado
//    ("De:", "From:", "Enviado el:", etc.) y borra ese nodo + todo lo posterior
//    en orden de documento. Cubre los forwards de Outlook donde la cola queda
//    embebida como texto plano entre divs, sin blockquote.
function sacarQuotedDelDoc(doc) {
    const body = doc.body;
    if (!body) return doc;

    const selectoresBasicos = [
        "blockquote",
        ".gmail_quote",
        ".gmail_quote_container",
        ".gmail_extra",
        ".gmail_attr",
        ".yahoo_quoted",
        ".OutlookMessageHeader",
        "div[id^='divRplyFwdMsg']",
        "hr#stopSpelling",
    ];
    const basicos = body.querySelectorAll(selectoresBasicos.join(","));
    console.log(`[plan:quoted-html] nodos quoted (selectores básicos): ${basicos.length}`);
    basicos.forEach(el => el.remove());

    // Buscar un marcador de reply en los nodos de texto del DOM.
    const marcador = /(?:^|\s)(?:De:|From:|Enviado\s+(?:el|por):|El\s+.{1,80}?\s+escribió:|-{5,}\s*Mensaje\s+original|-{5,}\s*Original\s+Message)\s*/i;
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let nodoHit = null;
    let idxHit = -1;
    let matchHit = null;
    while (walker.nextNode()) {
        const val = walker.currentNode.nodeValue || "";
        const m = val.match(marcador);
        if (m) {
            nodoHit = walker.currentNode;
            idxHit = val.indexOf(m[0]);
            matchHit = m[0];
            break;
        }
    }
    if (nodoHit) {
        console.log(`[plan:quoted-html] corte por marcador de texto: "${matchHit.trim().slice(0, 40)}"`);
        nodoHit.nodeValue = (nodoHit.nodeValue || "").slice(0, idxHit);
        let actual = nodoHit;
        while (actual && actual !== body) {
            let next = actual.nextSibling;
            while (next) {
                const toRemove = next;
                next = next.nextSibling;
                toRemove.remove();
            }
            actual = actual.parentNode;
        }
    } else {
        console.log(`[plan:quoted-html] no se encontró marcador de reply en texto renderizado`);
    }
    return doc;
}

// Dado el texto que precede a una tabla, detecta si se trata de filas a
// "anular" o a "agregar". Si no hay marcadores claros, default "agregar".
function detectarAccionDelBloque(textoPrevio) {
    const t = String(textoPrevio || "").toLowerCase();
    const idxAnul = Math.max(t.lastIndexOf("anul"), t.lastIndexOf("cancel"));
    const idxAgreg = Math.max(t.lastIndexOf("agreg"), t.lastIndexOf("sum"));
    if (idxAnul < 0 && idxAgreg < 0) return "agregar";
    if (idxAnul > idxAgreg) return "anular";
    return "agregar";
}

function textoAntesDeNodo(nodo) {
    const partes = [];
    let actual = nodo;
    while (actual && actual.parentElement) {
        let prev = actual.previousSibling;
        while (prev) {
            partes.unshift(prev.textContent || "");
            prev = prev.previousSibling;
        }
        actual = actual.parentElement;
    }
    return partes.join(" ");
}

// Devuelve array de bloques: [{ accion, filas }]. Encuentra todas las tablas
// en el texto plano (separadas por cambios de header) y asigna acción según
// el texto que las precede.
function parsearBloquesDesdeTexto(texto) {
    if (!texto) return [];
    const cortado = sacarQuotedTexto(texto);
    const lineas = cortado.split("\n").map(l => l.replace(/\r$/, ""));
    const bloques = [];
    let i = 0;
    while (i < lineas.length) {
        const raw = lineas[i];
        if (!raw) { i++; continue; }
        let sep = "\t";
        let headerCols = raw.split(sep);
        if (headerCols.length < 3) {
            if (!/\s{2,}/.test(raw)) { i++; continue; }
            sep = /\s{2,}/;
            headerCols = raw.split(sep);
        }
        if (headerCols.length < 3) { i++; continue; }
        const ci = detectarColumnasPlan(headerCols);
        if (ci.tnk < 0 || ci.despacho < 0) { i++; continue; }

        const textoPrevio = lineas.slice(Math.max(0, i - 10), i).join(" ");
        const accion = detectarAccionDelBloque(textoPrevio);

        const filas = [];
        let j = i + 1;
        while (j < lineas.length) {
            const linea = lineas[j];
            if (!linea.trim()) {
                if (filas.length > 0) break;
                j++;
                continue;
            }
            const cols = linea.split(sep);
            if (cols.length < Math.max(ci.tnk, ci.despacho) + 1) { j++; continue; }
            const fila = construirFilaPlan(cols, ci, "body-tabla", filas.length);
            if (fila) filas.push(fila);
            j++;
        }
        if (filas.length > 0) {
            console.log(`[plan:tabla-texto] bloque desde línea ${i}: acción=${accion}, ${filas.length} filas`);
            bloques.push({ accion, filas });
        }
        i = j;
    }
    return bloques;
}

function parsearBloquesDesdeHTML(html) {
    if (!html) return [];
    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        sacarQuotedDelDoc(doc);
        const tablas = [...doc.querySelectorAll("table")];
        const bloques = [];
        for (const tabla of tablas) {
            const filasHtml = [...tabla.querySelectorAll("tr")].map(tr =>
                [...tr.querySelectorAll("th, td")].map(c => c.textContent.replace(/\s+/g, " ").trim())
            );
            if (filasHtml.length < 2) continue;
            let headerIdx = -1;
            for (let k = 0; k < filasHtml.length; k++) {
                const h = filasHtml[k].map(x => x.toLowerCase());
                const hasTnk = h.some(c => c.includes("tnk") || c.includes("tanq"));
                const hasDesp = h.some(c => c.includes("despa"));
                if (hasTnk && hasDesp) { headerIdx = k; break; }
            }
            if (headerIdx < 0) continue;
            const ci = detectarColumnasPlan(filasHtml[headerIdx]);
            if (ci.tnk < 0 || ci.despacho < 0) continue;

            const textoPrevio = textoAntesDeNodo(tabla);
            const accion = detectarAccionDelBloque(textoPrevio);

            const filas = [];
            for (let k = headerIdx + 1; k < filasHtml.length; k++) {
                const fila = construirFilaPlan(filasHtml[k], ci, "body-tabla", filas.length);
                if (fila) filas.push(fila);
            }
            if (filas.length > 0) {
                console.log(`[plan:tabla-html] tabla header en fila ${headerIdx}: acción=${accion}, ${filas.length} filas`);
                bloques.push({ accion, filas });
            }
        }
        return bloques;
    } catch (e) {
        console.warn("[plan:tabla-html] error parseando:", e);
        return [];
    }
}

function parsearSalidasDesdeBody(bodyText) {
    if (!bodyText) return [];
    // Cortar parte quoted (respuesta/forward): "De:", "From:", "-----Original", lineas que empiezan con ">"
    const cortado = bodyText
        .split(/\n\s*(?:De:|From:|-----+\s*Original|Enviado (?:el|por):)/i)[0]
        .split(/\n\s*>/)[0];
    const filas = [];
    const regex = /\bTK\s*(\d{1,3})\s*[-–—]\s*(.+?)\s+(\S*(?:IC04|IC06|TRP|EC01|REMO|TRM6|IT14)\S*)/gi;
    const usados = new Set();
    let m;
    while ((m = regex.exec(cortado)) !== null) {
        const tanque = m[1].padStart(3, "0");
        const cliente = m[2].trim().replace(/\s+/g, " ");
        const despacho = m[3].trim().toUpperCase();
        const key = `${tanque}|${despacho}`;
        if (usados.has(key)) continue;
        usados.add(key);
        filas.push({
            id: Date.now() + "-body-" + filas.length + "-" + Math.random().toString(36).slice(2, 7),
            tanque,
            producto: "",
            cliente,
            buque: "",
            viaje: "",
            subCliente: "",
            conoc: "",
            despacho,
            exLegal: "",
            fechaOrig: "",
            horaCarga: "",
            observaciones: "(agregado por mail)",
            cumplido: false,
            salidaId: null,
            cumplidoAt: null,
            fuente: "body",
        });
    }
    return filas;
}

// Parser para mails informales que agregan / retiran cargas sueltas escritas en prosa, ej:
//   "se agrega una carga de MDI de PBB POLISUR del tk 76 ( despacho DI26IC04002547U )"
//   "favor retirar la carga del tanque 12 ( despacho DI26IC04001234X )"
// La única señal confiable es el par tanque + despacho; el verbo decide la acción (default: agregar).
function parsearMovimientosInformales(bodyText) {
    const vacio = { agregar: [], anular: [] };
    if (!bodyText) return vacio;
    const cortado = bodyText
        .split(/\n\s*(?:De:|From:|-----+\s*Original|Enviado (?:el|por):)/i)[0]
        .split(/\n\s*>/)[0];
    const agregar = [];
    const anular = [];
    const vistos = new Set();
    const re = /\b(?:tk|tq|tanque|tanq)\.?\s*[:\-#°º]?\s*(\d{1,3})\b[\s\S]{0,90}?\bdespacho\b\s*(?:n[°ºo.:]*|[:\-(#.])*\s*([A-Z0-9]{8,22})/gi;
    let m;
    while ((m = re.exec(cortado)) !== null) {
        const tanque = m[1].padStart(3, "0");
        const despacho = m[2].trim().toUpperCase().replace(/\)+$/, "");
        // Un despacho real tiene letras y números mezclados; descarta falsos positivos (todo dígitos / todo letras).
        if (!/[A-Z]/.test(despacho) || !/[0-9]/.test(despacho)) continue;
        const key = `${tanque}|${despacho}`;
        if (vistos.has(key)) continue;
        vistos.add(key);
        const ctxIni = Math.max(0, m.index - 140);
        const ctxAmplio = cortado.slice(ctxIni, m.index + m[0].length + 140);
        const ctx = ctxAmplio.toLowerCase();
        const esAnular = /\b(anul|cancel|retir|quit|baja|dar de baja|elimin|saca)/i.test(ctx)
            && !/\b(agreg|sum[ao]|incorpor|a[ñn]ad|adicion)/i.test(ctx);
        let producto = "", cliente = "";
        const pm = cortado.slice(ctxIni, m.index + 5)
            .match(/carga\s+de\s+([A-Za-zÁÉÍÓÚÜÑ0-9.\-]+(?:\s+[A-Za-zÁÉÍÓÚÜÑ0-9.\-]+)?)\s+(?:de|para|del?)\s+([A-Za-zÁÉÍÓÚÜÑ0-9.\-&]+(?:\s+[A-Za-zÁÉÍÓÚÜÑ0-9.\-&]+){0,3}?)\s+del?\s+(?:tk|tq|tanque|tanq)\b/i);
        if (pm) { producto = pm[1].trim().toUpperCase(); cliente = pm[2].trim().toUpperCase(); }
        let horaCarga = "";
        const hm = ctx.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:hs?\b|horas?\b)/);
        if (hm) {
            const hh = parseInt(hm[1], 10);
            if (hh >= 0 && hh <= 23) horaCarga = String(hh).padStart(2, "0") + ":" + (hm[2] || "00");
        } else if (/\bmediod[ií]a\b/.test(ctx)) {
            horaCarga = "12:00";
        }
        if (esAnular) {
            anular.push({ tanque, despacho });
        } else {
            agregar.push({
                id: Date.now() + "-inf-" + (agregar.length) + "-" + Math.random().toString(36).slice(2, 7),
                tanque,
                producto,
                cliente,
                buque: "",
                viaje: "",
                subCliente: "",
                conoc: "",
                despacho,
                exLegal: "",
                fechaOrig: "",
                horaCarga,
                observaciones: "(agregado por mail)",
                cumplido: false,
                salidaId: null,
                cumplidoAt: null,
                fuente: "body",
            });
        }
    }
    return { agregar, anular };
}

// Fecha (YYYY-MM-DD, zona local) del mail, a partir de internalDate o el header Date.
function fechaDelMail(msg) {
    let d = null;
    if (msg && msg.internalDate) { const t = parseInt(msg.internalDate, 10); if (!isNaN(t)) d = new Date(t); }
    if (!d || isNaN(d.getTime())) {
        const hd = ((msg && msg.payload && msg.payload.headers) || []).find(h => h.name.toLowerCase() === "date");
        if (hd && hd.value) { const dd = new Date(hd.value); if (!isNaN(dd.getTime())) d = dd; }
    }
    if (!d || isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function listarAdjuntos(part) {
    const out = [];
    function recorrer(p) {
        if (!p) return;
        if (p.body && p.body.attachmentId) {
            out.push({
                id: p.body.attachmentId,
                filename: p.filename || "(sin nombre)",
                mime: (p.mimeType || "").toLowerCase()
            });
        }
        if (p.parts) for (const sub of p.parts) recorrer(sub);
    }
    recorrer(part);
    return out;
}

function listarTodasLasPartes(part) {
    const out = [];
    function recorrer(p) {
        if (!p) return;
        out.push({
            filename: p.filename || "",
            mime: (p.mimeType || "").toLowerCase(),
            hasAtt: !!(p.body && p.body.attachmentId),
            bodySize: (p.body && p.body.size) || 0
        });
        if (p.parts) for (const sub of p.parts) recorrer(sub);
    }
    recorrer(part);
    return out;
}

function buscarAdjuntoExcel(part) {
    const todos = listarAdjuntos(part);
    const excelExt = /\.(xls|xlsx|xlsm|xlsb)$/i;
    const excelMime = /(excel|spreadsheet|ms-excel|officedocument\.spreadsheetml)/i;
    return todos.find(a => excelExt.test(a.filename) || excelMime.test(a.mime)) || null;
}

function parseFechaPlanExcel(val) {
    if (val === null || val === undefined || val === "") return "";
    if (typeof val === "string") return val.trim();
    if (typeof val === "number" && typeof XLSX !== "undefined" && XLSX.SSF) {
        const d = XLSX.SSF.parse_date_code(val);
        if (d) return `${String(d.d).padStart(2, "0")}/${String(d.m).padStart(2, "0")}/${d.y}`;
    }
    if (val instanceof Date) {
        return `${String(val.getDate()).padStart(2, "0")}/${String(val.getMonth() + 1).padStart(2, "0")}/${val.getFullYear()}`;
    }
    return String(val);
}

function formatearHoraPlan(val) {
    if (val === null || val === undefined || val === "") return "";
    const s = String(val).replace(/\D/g, "").padStart(4, "0");
    if (s.length < 3) return s;
    return s.slice(0, 2) + ":" + s.slice(2, 4);
}

async function parsearFilasExcel(msgRef, att, token) {
    const attData = await gmailGet(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgRef.id}/attachments/${att.id}`, token);
    const bytes = base64UrlToUint8Array(attData.data);
    const wb = XLSX.read(bytes, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (rows.length < 2) return [];
    const ci = detectarColumnasPlan(rows[0]);
    if (ci.tnk < 0 || ci.despacho < 0) return [];
    const filas = [];
    for (let i = 1; i < rows.length; i++) {
        const fila = construirFilaPlan(rows[i], ci, "excel", i);
        if (!fila) continue;
        // Excel trae fechas como objetos Date; reformateamos.
        fila.fechaOrig = parseFechaPlanExcel(rows[i][ci.fecha]);
        filas.push(fila);
    }
    return filas;
}

async function obtenerPlanesDesdeGmail(token) {
    let profileEmail = "?";
    try {
        const p = await gmailGet("https://gmail.googleapis.com/gmail/v1/users/me/profile", token);
        profileEmail = p.emailAddress || "?";
    } catch (_) {}

    const runQuery = async (q, maxResults = 30) => {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`;
        const r = await gmailGet(url, token);
        return r.messages || [];
    };

    const queries = [
        ['subject:"plan de cargas" newer_than:60d', 30],
        ['subject:"plan de carga" newer_than:60d', 30],
        ['subject:plan newer_than:60d', 30],
        // Mails informales que agregan / retiran una carga suelta (asunto libre, sin "plan").
        // Ventana corta: estos mails son del día ("al día de hoy se agrega una carga…").
        ['subject:carga newer_than:15d', 20],
        ['carga despacho newer_than:15d', 20],
    ];
    const mapa = new Map();
    for (const [q, max] of queries) {
        const res = await runQuery(q, max);
        res.forEach(m => { if (!mapa.has(m.id)) mapa.set(m.id, m); });
    }
    const candidates = [...mapa.values()];
    if (candidates.length === 0) {
        throw new Error(`Cuenta ${profileEmail}: no encontré mails con "plan" ni "carga" en el asunto. ¿Te loggeaste con tagsaaduana@gmail.com?`);
    }

    // Extrae fecha del asunto. 2-digit year -> +2000.
    const extraerFecha = (asunto) => {
        const m = (asunto || "").match(/(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})/);
        if (!m) return null;
        const dia = parseInt(m[1]);
        const mes = parseInt(m[2]);
        let anio = parseInt(m[3]);
        if (anio < 100) anio += 2000;
        if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
        return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    };

    const porFecha = {};
    const descartados = [];
    console.log(`[plan] ${candidates.length} candidatos encontrados en Gmail (cuenta: ${profileEmail})`);

    // Bajamos los mails completos y los ordenamos por internalDate ASCENDENTE.
    // Así, si para una misma fecha llegan varios mails con Excel, el último (cronológicamente
    // más nuevo) pisa al anterior — es el "plan actualizado/reenvío". Los mails "se agrega/retira"
    // sin Excel que vinieron DESPUÉS del último Excel se suman; los previos se descartan porque
    // el Excel actualizado ya los contempla.
    const mailsFull = [];
    for (const msgRef of candidates) {
        const m = await gmailGet(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgRef.id}?format=full`, token);
        mailsFull.push({ ref: msgRef, msg: m });
    }
    mailsFull.sort((a, b) => parseInt(a.msg.internalDate || "0", 10) - parseInt(b.msg.internalDate || "0", 10));

    for (const { ref: msgRef, msg } of mailsFull) {
        const subject = ((msg.payload.headers || []).find(h => h.name.toLowerCase() === "subject")?.value || "").trim();
        const esPlanFormal = /plan\s+de\s+cargas?/i.test(subject);

        const cuerpo = extraerCuerpoMail(msg.payload);
        let bloques = parsearBloquesDesdeHTML(cuerpo.html);
        if (bloques.length === 0) bloques = parsearBloquesDesdeTexto(cuerpo.plain);
        const textoCuerpo = cuerpoATexto(cuerpo);
        const filasProsa = bloques.length === 0 ? parsearSalidasDesdeBody(textoCuerpo) : [];
        const movInf = bloques.length === 0 ? parsearMovimientosInformales(textoCuerpo) : { agregar: [], anular: [] };
        // Evitar duplicar lo que ya capturó el parser de prosa "TK N - CLIENTE DESPACHO".
        const yaEnProsa = (f) => filasProsa.some(p => p.tanque === f.tanque && normDespacho(p.despacho) === normDespacho(f.despacho));
        const movInfAgregar = movInf.agregar.filter(f => !yaEnProsa(f));

        if (!esPlanFormal && movInfAgregar.length === 0 && movInf.anular.length === 0) {
            console.log(`[plan] descartado (asunto no es "plan de carga(s)" y sin movimientos en el cuerpo): "${subject}"`);
            descartados.push({ subject, motivo: "asunto no matchea y sin movimientos en el cuerpo" });
            continue;
        }

        let fecha;
        if (esPlanFormal) {
            fecha = extraerFecha(subject);
            if (!fecha) {
                console.log(`[plan] descartado (no se pudo extraer fecha del asunto): "${subject}"`);
                descartados.push({ subject, motivo: "fecha no parseable" });
                continue;
            }
        } else {
            fecha = fechaDelMail(msg);
            if (!fecha) {
                console.log(`[plan] descartado (mail informal sin fecha): "${subject}"`);
                descartados.push({ subject, motivo: "mail informal sin fecha" });
                continue;
            }
        }

        let filasExcel = [];
        let filename = "";
        if (esPlanFormal) {
            const att = buscarAdjuntoExcel(msg.payload);
            if (att) {
                filename = att.filename;
                try {
                    filasExcel = await parsearFilasExcel(msgRef, att, token);
                } catch (e) {
                    console.warn(`[plan] error parseando Excel de "${subject}":`, e);
                }
            }
        }

        const filasAgregar = [];
        const filasAnular = [];
        for (const b of bloques) {
            if (b.accion === "anular") filasAnular.push(...b.filas);
            else filasAgregar.push(...b.filas);
        }
        filasAgregar.push(...filasProsa, ...movInfAgregar);
        filasAnular.push(...movInf.anular);

        console.log(`[plan] "${subject}" → fecha=${fecha}, formal=${esPlanFormal}, adjunto=${filename || "(ninguno)"}, filasExcel=${filasExcel.length}, agregar=${filasAgregar.length}, anular=${filasAnular.length}`);

        if (filasExcel.length === 0 && filasAgregar.length === 0 && filasAnular.length === 0) {
            console.warn(`[plan] sin filas. Primeros 800 chars del cuerpo plain del mail "${subject}":\n`, (cuerpo.plain || "").slice(0, 800));
            console.warn(`[plan] primeros 800 chars del cuerpo HTML:\n`, (cuerpo.html || "").slice(0, 800));
            descartados.push({ subject, motivo: "sin filas parseables (Excel, tabla pegada ni cuerpo)", fecha });
            continue;
        }

        if (!porFecha[fecha]) porFecha[fecha] = {
            filasExcel: [],          // siempre = filas del ÚLTIMO mail con Excel (pisa al anterior)
            filasIncrementales: [],  // mails informales ("se agrega…") posteriores al último Excel
            anuladas: [],
            fuentes: [],
            tieneExcel: false,
        };

        // Detectar si este mail trae un "plan completo" (Excel adjunto o tabla pegada con
        // muchas filas) vs. agregados incrementales sueltos ("se agrega una carga…"):
        //   - Excel adjunto → siempre reemplazo total.
        //   - Mail formal sin adjunto pero con >= 3 filas en cuerpo → reemplazo total
        //     (caso: "Reenviamos el plan actualizado" con la tabla pegada).
        //   - Mail formal con < 3 filas en cuerpo, o mail informal → incremental.
        const UMBRAL_REEMPLAZO_TOTAL = 2;
        const esReemplazoTotal = filasExcel.length > 0
            || (esPlanFormal && filasAgregar.length >= UMBRAL_REEMPLAZO_TOTAL);

        if (esReemplazoTotal) {
            const fuenteFilas = filasExcel.length > 0 ? filasExcel : filasAgregar;
            porFecha[fecha].filasExcel = fuenteFilas;
            porFecha[fecha].filasIncrementales = [];
            porFecha[fecha].tieneExcel = true;
        } else {
            porFecha[fecha].filasIncrementales.push(...filasAgregar);
        }
        porFecha[fecha].anuladas.push(...filasAnular);
        porFecha[fecha].fuentes.push({
            asunto: subject,
            filename: filename || "(cuerpo)",
            excelRows: filasExcel.length,
            agregarRows: filasAgregar.length,
            anularRows: filasAnular.length,
        });
    }

    // Consolidación final: para cada fecha, info.filas = último Excel + incrementales posteriores.
    for (const fecha of Object.keys(porFecha)) {
        const p = porFecha[fecha];
        p.filas = [...p.filasExcel, ...p.filasIncrementales];

        // Defensa anti-duplicación FISCAL: si para una misma fecha y mismo tanque hay cargas
        // con despacho real Y cargas con despacho "FISCAL", descartamos las FISCAL — son del
        // Excel viejo del día (cuando aún no había despacho asignado) que el Excel actualizado
        // reemplazó. Excepción: tanques que solo tienen FISCAL en el sync se respetan
        // (ej: TK 025 DALGAR siempre carga FISCAL).
        const tanquesConDespachoReal = new Set();
        for (const f of p.filas) {
            const desp = (f.despacho || "").toUpperCase().trim();
            if (desp && desp !== "FISCAL" && !/REMO/i.test(desp)) {
                tanquesConDespachoReal.add(f.tanque);
            }
        }
        if (tanquesConDespachoReal.size > 0) {
            const antes = p.filas.length;
            p.filas = p.filas.filter(f => {
                const desp = (f.despacho || "").toUpperCase().trim();
                if (desp === "FISCAL" && tanquesConDespachoReal.has(f.tanque)) {
                    return false;
                }
                return true;
            });
            const removidas = antes - p.filas.length;
            if (removidas > 0) console.log(`[plan] ${fecha}: descartadas ${removidas} carga(s) FISCAL en tanques con despacho real`);
        }
    }

    if (Object.keys(porFecha).length === 0) {
        const detalle = descartados.length > 0
            ? ` Descartados: ${descartados.map(d => `"${d.subject}" (${d.motivo})`).join("; ")}`
            : "";
        throw new Error(`Cuenta ${profileEmail}: encontré mails con "plan" en el asunto pero ninguno con filas parseables.${detalle}`);
    }

    return { porFecha, descartados };
}

// --- GITHUB STORAGE (vía proxy Cloudflare Worker) ---
// El token de GitHub ya NO vive acá: lo guarda el Worker como secret. Esto evita
// que GitHub secret-scanning lo revoque (pasaba con el token embebido en repo público).
// Ver public/cloudflare-worker/.
const GH = {
    _base: "https://odfjell-stock-proxy.cam-el-juli.workers.dev",
    _s: ["d19SUV92UWV","IcmQxTlRuNn","J0RnVNUjNNR","U1SenV6R0p0","OThtTDZEazF","SazNoRnR5"],
    get _secret() { return atob(this._s.join("")); },
    repo: "juliani85/odfjell-stock",
    file: "datos.json",
    fileVistas: "vistas.json",
    filePlan: "plan.json",
    sha: null,
    shaVistas: null,
    shaPlan: null,
    _timer: null,
    _pendiente: null,
    _timerVistas: null,
    _pendienteVistas: null,
    _timerPlan: null,
    _pendientePlan: null,
    _estado: "sincronizado",
    _listeners: [],

    onEstado(cb) {
        this._listeners.push(cb);
        try { cb(this._estado); } catch (_) {}
    },

    _setEstado(e) {
        if (this._estado === e) return;
        this._estado = e;
        this._listeners.forEach(cb => { try { cb(e); } catch (_) {} });
    },

    get pendiente() {
        return this._estado !== "sincronizado";
    },

    // atob devuelve un string donde cada char es un byte; para un JSON con
    // caracteres UTF-8 multi-byte (ej: "→") hay que decodificar como UTF-8.
    _b64ToJson(b64) {
        const raw = atob(b64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return JSON.parse(new TextDecoder("utf-8").decode(bytes));
    },

    // --- helpers de bajo nivel contra el proxy ---
    // _ghLeer(archivo) -> { sha, texto } | null (null = el archivo no existe / 404).
    //                    Lanza si hay otro error (network, 5xx, 401, etc.).
    async _ghLeer(archivo) {
        const r = await fetch(`${this._base}/gh/${archivo}?t=${Date.now()}`, { cache: "no-store" });
        if (r.status === 404) return null;
        if (!r.ok) {
            let det = ""; try { const j = await r.json(); det = j && (j.error || j.message) ? ` ${j.error || j.message}` : ""; } catch (_) {}
            throw new Error(`proxy ${r.status}${det}`);
        }
        const data = await r.json();
        return { sha: data.sha || null, texto: typeof data.content === "string" ? data.content : "" };
    },
    _parseTexto(res) {
        if (!res) return null;
        try { return JSON.parse(res.texto); } catch (_) { return null; }
    },
    // _ghEscribir(archivo, contenidoTexto, sha, mensaje) -> { ok, status, detalle, nuevoSha }
    async _ghEscribir(archivo, contenidoTexto, sha, mensaje) {
        try {
            const r = await fetch(`${this._base}/gh/${archivo}`, {
                method: "PUT",
                cache: "no-store",
                headers: { "Content-Type": "application/json", "X-App-Secret": this._secret },
                body: JSON.stringify({ content: contenidoTexto, sha: sha || undefined, message: mensaje || `chore: actualizar ${archivo}` }),
            });
            let payload = null;
            try { payload = await r.json(); } catch (_) {}
            if (!r.ok) {
                const det = payload && (payload.message || payload.error) ? ` — ${payload.message || payload.error}` : "";
                return { ok: false, status: r.status, detalle: det };
            }
            return { ok: true, status: r.status, nuevoSha: (payload && payload.content && payload.content.sha) || null };
        } catch (e) {
            return { ok: false, status: 0, detalle: " — " + (e.message || e) };
        }
    },
    // _ghDispatch(workflow, ref, inputs) -> { ok, status }
    async _ghDispatch(workflow, ref, inputs) {
        try {
            const r = await fetch(`${this._base}/dispatch/${workflow}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-App-Secret": this._secret },
                body: JSON.stringify({ ref: ref || "master", inputs: inputs || {} }),
            });
            let det = "";
            if (!r.ok) { try { const j = await r.json(); det = j && (j.message || j.error) ? ` — ${j.message || j.error}` : ""; } catch (_) {} }
            return { ok: r.ok, status: r.status, detalle: det };
        } catch (e) {
            return { ok: false, status: 0, detalle: " — " + (e.message || e) };
        }
    },

    async cargar() {
        try {
            const res = await this._ghLeer(this.file);
            if (!res) return null;
            this.sha = res.sha;
            return this._parseTexto(res);
        } catch (e) {
            console.warn('[GH cargar]', e.message || e);
            return null;
        }
    },

    async refrescarSha() {
        try {
            const res = await this._ghLeer(this.file);
            if (res) this.sha = res.sha;
        } catch (e) {
            console.warn('[GH refrescarSha]', e.message || e);
        }
    },

    // Recibe un merger (remoto => { stock, historial }) que se ejecuta DENTRO del
    // ciclo de envío, después de leer el remoto fresco. Así dos admin pusheando
    // en paralelo no se pisan: antes de cada PUT se mergea con lo último que hay
    // en GitHub, y si el PUT devuelve 409 (sha stale), reintenta el loop.
    guardar(merger) {
        this._pendiente = merger;
        this._setEstado("pendiente");
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        this._enviar();
    },

    async _enviar() {
        if (!this._pendiente || this._enviando) return;
        this._enviando = true;
        this._setEstado("enviando");

        while (this._pendiente) {
            const merger = this._pendiente;
            try {
                // Leer remoto fresco (actualiza this.sha). _ghLeer lanza si hay error real
                // (network/5xx/auth); devuelve null solo si el archivo no existe (404).
                const res = await this._ghLeer(this.file);
                let remoto = null;
                if (res) { this.sha = res.sha; remoto = this._parseTexto(res); }
                else { this.sha = null; }

                const merged = merger(remoto);

                const datos = { ...merged, actualizado: new Date().toISOString() };
                const out = await this._ghEscribir(this.file, JSON.stringify(datos), this.sha, `Actualizar datos ${new Date().toISOString().slice(0, 16)}`);

                if (out.status === 409 || out.status === 422) {
                    console.warn('[GH sync stock] conflict, reintentando con remoto fresco');
                    continue;
                }
                if (!out.ok) throw new Error(`proxy ${out.status}${out.detalle}`);
                if (out.nuevoSha) this.sha = out.nuevoSha;
                if (this._pendiente === merger) this._pendiente = null;
            } catch (e) {
                console.error('[GH sync stock]', e);
                this._enviando = false;
                this._setEstado("error");
                if (this._timer) clearTimeout(this._timer);
                this._timer = setTimeout(() => this._enviar(), 5000);
                return;
            }
        }

        this._enviando = false;
        this._setEstado("sincronizado");
    },

    async cargarVistas() {
        try {
            const res = await this._ghLeer(this.fileVistas);
            if (!res) return null;
            this.shaVistas = res.sha;
            const c = this._parseTexto(res) || {};
            return { vistas: c.vistas || [], sim: c.sim || {} };
        } catch (e) {
            console.warn('[GH cargarVistas]', e.message || e);
            return null;
        }
    },

    guardarVistas(vistas, sim) {
        this._pendienteVistas = { vistas, sim };
        if (this._timerVistas) clearTimeout(this._timerVistas);
        this._timerVistas = setTimeout(() => this._enviarVistas(), 1500);
    },

    async _enviarVistas() {
        if (!this._pendienteVistas || this._enviandoVistas) return;
        this._enviandoVistas = true;
        const { vistas, sim } = this._pendienteVistas;

        try {
            const res = await this._ghLeer(this.fileVistas);
            this.shaVistas = res ? res.sha : null;

            const datos = { vistas, sim, actualizado: new Date().toISOString() };
            const out = await this._ghEscribir(this.fileVistas, JSON.stringify(datos), this.shaVistas, `Actualizar vistas ${new Date().toISOString().slice(0, 16)}`);
            if (!out.ok) throw new Error(`proxy ${out.status}${out.detalle}`);
            if (out.nuevoSha) this.shaVistas = out.nuevoSha;
            if (this._pendienteVistas && this._pendienteVistas.vistas === vistas && this._pendienteVistas.sim === sim) {
                this._pendienteVistas = null;
            }
        } catch (e) {
            console.error('[GH sync vistas]', e);
            if (this._timerVistas) clearTimeout(this._timerVistas);
            this._timerVistas = setTimeout(() => this._enviarVistas(), 5000);
        } finally {
            this._enviandoVistas = false;
        }
    },

    async cargarPlan() {
        try {
            const res = await this._ghLeer(this.filePlan);
            if (!res) return null;
            this.shaPlan = res.sha;
            const c = this._parseTexto(res) || {};
            return c.planes || {};
        } catch (e) {
            console.warn('[GH cargarPlan]', e.message || e);
            return null;
        }
    },

    guardarPlan(planes) {
        this._pendientePlan = planes;
        if (this._timerPlan) clearTimeout(this._timerPlan);
        this._timerPlan = setTimeout(() => this._enviarPlan(), 1500);
    },

    async _enviarPlan() {
        if (!this._pendientePlan || this._enviandoPlan) return;
        this._enviandoPlan = true;

        // Merge-on-write con tombstones por fila. Sin esto, dos clientes con plan
        // distinto en memoria se pisan en cada PUT. Caso real (2026-05-14): cleanup
        // manual del proxy se revivía cuando otro cliente con plan stale guardaba.
        //
        // Cada fila tiene `modificadoTs` y, si fue eliminada, `eliminada:true` +
        // `eliminadaTs`. El render filtra las eliminadas; al mergear, gana el ts
        // más nuevo por key (tanque|despacho|horaCarga).
        while (this._pendientePlan) {
            const planes = this._pendientePlan;
            try {
                const res = await this._ghLeer(this.filePlan);
                this.shaPlan = res ? res.sha : null;
                const remoto = res ? (this._parseTexto(res) || {}) : {};
                const planesRemoto = remoto.planes || {};

                const keyFila = (f) => `${f.tanque || ""}|${(f.despacho || "").trim().toUpperCase().replace(/\s+/g, "")}|${f.horaCarga || ""}`;
                const tsFila = (f) => f.eliminadaTs || f.modificadoTs || "";
                // Multiset merge por key: si la misma (tanque, despacho, hora) aparece N veces en
                // un lado y M en el otro, se conservan max(N, M) filas (no colapsamos duplicados;
                // dos camiones del mismo slot son válidos).
                const mergeFilas = (locales, remotas) => {
                    const mapL = new Map(), mapR = new Map();
                    for (const f of locales) {
                        const k = keyFila(f); if (!mapL.has(k)) mapL.set(k, []); mapL.get(k).push(f);
                    }
                    for (const f of remotas) {
                        const k = keyFila(f); if (!mapR.has(k)) mapR.set(k, []); mapR.get(k).push(f);
                    }
                    const allKeys = new Set([...mapL.keys(), ...mapR.keys()]);
                    const out = [];
                    for (const k of allKeys) {
                        const arrL = mapL.get(k) || [];
                        const arrR = mapR.get(k) || [];
                        const todas = [...arrL, ...arrR];
                        // Si para esta key hay alguna eliminada cuyo eliminadaTs es > todos los modificadoTs
                        // activos, la key entera está "eliminada": guardo UN solo tombstone canónico.
                        const elimMax = todas
                            .filter(f => f.eliminada)
                            .map(f => f.eliminadaTs || "")
                            .sort()
                            .pop() || "";
                        const modMax = todas
                            .filter(f => !f.eliminada)
                            .map(f => f.modificadoTs || "")
                            .sort()
                            .pop() || "";
                        if (elimMax && elimMax > modMax) {
                            const canon = todas.find(f => f.eliminada && (f.eliminadaTs || "") === elimMax);
                            out.push(canon);
                            continue;
                        }
                        // Activa: multiset merge — conservamos max(N, M) ocurrencias (sin contar
                        // tombstones), ganador por modificadoTs. Si alguna tombstone tiene ts viejo,
                        // se descarta (la key ahora está reactivada por una activa más nueva).
                        const actL = arrL.filter(f => !f.eliminada).sort((a, b) => tsFila(b).localeCompare(tsFila(a)));
                        const actR = arrR.filter(f => !f.eliminada).sort((a, b) => tsFila(b).localeCompare(tsFila(a)));
                        const n = Math.max(actL.length, actR.length);
                        for (let i = 0; i < n; i++) {
                            const cL = actL[i], cR = actR[i];
                            if (!cL) { out.push(cR); continue; }
                            if (!cR) { out.push(cL); continue; }
                            out.push(tsFila(cL) > tsFila(cR) ? cL : cR);
                        }
                    }
                    return out;
                };
                const merged = {};
                const fechas = new Set([...Object.keys(planesRemoto), ...Object.keys(planes)]);
                for (const fecha of fechas) {
                    const local = planes[fecha];
                    const rem = planesRemoto[fecha];
                    if (!local) { merged[fecha] = rem; continue; }
                    if (!rem) { merged[fecha] = local; continue; }
                    const localMod = local.modificadoTs || "";
                    const remMod = rem.modificadoTs || "";
                    const meta = remMod > localMod ? rem : local;
                    merged[fecha] = { ...meta, filas: mergeFilas(local.filas || [], rem.filas || []) };
                }

                const datos = { ...remoto, planes: merged, actualizado: new Date().toISOString() };
                const out = await this._ghEscribir(this.filePlan, JSON.stringify(datos), this.shaPlan, `Actualizar plan ${new Date().toISOString().slice(0, 16)}`);

                if (out.status === 409 || out.status === 422) {
                    console.warn('[GH sync plan] conflict, reintentando con remoto fresco');
                    continue;
                }
                if (!out.ok) throw new Error(`proxy ${out.status}${out.detalle}`);
                if (out.nuevoSha) this.shaPlan = out.nuevoSha;
                // El plan local en memoria se actualiza con el merged para que el cliente vea
                // tombstones y cargas remotas que no tenía.
                for (const f of Object.keys(merged)) planes[f] = merged[f];
                if (this._pendientePlan === planes) this._pendientePlan = null;
            } catch (e) {
                console.error('[GH sync plan]', e);
                this._enviandoPlan = false;
                if (this._timerPlan) clearTimeout(this._timerPlan);
                this._timerPlan = setTimeout(() => this._enviarPlan(), 5000);
                return;
            }
        }
        this._enviandoPlan = false;
    }
};

// --- LOGIN ---
async function initLogin() {
    const loginScreen = document.getElementById("loginScreen");
    const mainApp = document.getElementById("mainApp");
    const btnLogin = document.getElementById("btnLogin");
    const loginError = document.getElementById("loginError");
    const loginUser = document.getElementById("loginUser");
    const loginPass = document.getElementById("loginPass");
    const loginRecordar = document.getElementById("loginRecordar");

    // Logout: borra la sesión, pero conserva las credenciales recordadas
    // (el usuario puso un check explícito para guardarlas en este dispositivo).
    document.getElementById("btnLogout").addEventListener("click", () => {
        sessionStorage.removeItem("usuarioStock");
        location.reload();
    });

    // Pre-completar usuario/contraseña si están guardadas en este dispositivo.
    try {
        const guardado = JSON.parse(localStorage.getItem("loginRecordado") || "null");
        if (guardado && guardado.user) {
            loginUser.value = guardado.user;
            if (guardado.pass) loginPass.value = guardado.pass;
            if (loginRecordar) loginRecordar.checked = true;
        }
    } catch (_) {}

    // Verificar sesión guardada
    const sesion = sessionStorage.getItem("usuarioStock");
    if (sesion && USUARIOS[sesion]) {
        usuarioActual = sesion;
        loginScreen.querySelector(".auth-card").innerHTML = '<h1>Cargando datos…</h1><p class="subtitle">Conectando con el servidor</p>';
        document.getElementById("usuarioLogueado").textContent = usuarioActual.toUpperCase();
        await initApp();
        loginScreen.classList.add("hidden");
        mainApp.classList.remove("hidden");
        return;
    }

    async function intentarLogin() {
        const user = loginUser.value.trim().toLowerCase();
        const pass = loginPass.value;

        if (USUARIOS[user] && USUARIOS[user] === pass) {
            usuarioActual = user;
            sessionStorage.setItem("usuarioStock", user);
            if (loginRecordar && loginRecordar.checked) {
                try { localStorage.setItem("loginRecordado", JSON.stringify({ user, pass })); } catch (_) {}
            } else {
                try { localStorage.removeItem("loginRecordado"); } catch (_) {}
            }
            btnLogin.textContent = "Cargando datos...";
            btnLogin.disabled = true;
            document.getElementById("usuarioLogueado").textContent = usuarioActual.toUpperCase();
            await initApp();
            loginScreen.classList.add("hidden");
            mainApp.classList.remove("hidden");
        } else {
            loginError.classList.remove("hidden");
            loginPass.value = "";
            loginPass.focus();
        }
    }

    btnLogin.addEventListener("click", intentarLogin);
    loginPass.addEventListener("keydown", (e) => {
        if (e.key === "Enter") intentarLogin();
    });
    loginUser.addEventListener("keydown", (e) => {
        if (e.key === "Enter") loginPass.focus();
    });

}

// --- APP PRINCIPAL ---
async function initApp() {
    // Cargar datos desde GitHub, fallback a localStorage, fallback a stock inicial
    const ghData = await GH.cargar();
    let stock, historial, anulados, diferencias;
    if (ghData && ghData.stock) {
        stock = ghData.stock;
        historial = ghData.historial || [];
        anulados = ghData.anulados || [];
        diferencias = Array.isArray(ghData.diferencias) ? ghData.diferencias : [];
        if (ghData.config && ghData.config.gmailClientId) window.__gmailClientIdFromDatos = ghData.config.gmailClientId;
        localStorage.setItem("stockTanquesV3", JSON.stringify(stock));
        localStorage.setItem("historialSalidasV3", JSON.stringify(historial));
        localStorage.setItem("anuladosV3", JSON.stringify(anulados));
        localStorage.setItem("diferenciasV1", JSON.stringify(diferencias));
    } else {
        stock = JSON.parse(localStorage.getItem("stockTanquesV3")) || JSON.parse(JSON.stringify(stockInicial));
        historial = JSON.parse(localStorage.getItem("historialSalidasV3")) || [];
        anulados = JSON.parse(localStorage.getItem("anuladosV3") || "[]");
        diferencias = JSON.parse(localStorage.getItem("diferenciasV1") || "[]");
    }

    // Fecha dinámica en subtítulo
    const hoySub = new Date();
    const subtFecha = document.getElementById("subtFecha");
    if (subtFecha) subtFecha.textContent = `Stock al ${hoySub.toLocaleDateString("es-AR")}`;

    // Aplica una entrada del historial al stock local (para mergear movimientos
    // que hizo otro usuario en paralelo).
    function aplicarEntradaAlStock(h) {
        const tipo = h.tipo || "SALIDA";
        if (tipo === "SALIDA") {
            const tanque = stock.find(t => t.tanque === h.tanque);
            if (!tanque) return;
            const desp = tanque.despachos.find(d => d.despacho === h.despacho);
            if (desp) desp.stock -= h.kilos;
        } else if (tipo === "INGRESO") {
            const tanque = stock.find(t => t.tanque === h.tanque);
            if (!tanque) return;
            const desp = tanque.despachos.find(d => d.despacho === h.despacho);
            if (desp) {
                desp.stock += h.kilos;
            } else {
                const nuevo = { despacho: h.despacho, stock: h.kilos };
                if (h.cliente) nuevo.cliente = h.cliente;
                tanque.despachos.push(nuevo);
            }
            if (!tanque.producto && h.producto) tanque.producto = h.producto;
            if (!tanque.cliente && h.cliente) tanque.cliente = h.cliente;
        } else if (tipo === "TRANSFERENCIA") {
            const partes = String(h.tanque || "").split("→");
            if (partes.length !== 2) return;
            const [origenNum, destinoNum] = partes;
            const origen = stock.find(t => t.tanque === origenNum);
            if (origen) {
                const despO = origen.despachos.find(d => d.despacho === h.despacho);
                if (despO) despO.stock -= h.kilos;
            }
            let destino = stock.find(t => t.tanque === destinoNum);
            if (!destino) {
                destino = { tanque: destinoNum, producto: h.producto, cliente: h.cliente, despachos: [] };
                stock.push(destino);
            }
            const despD = destino.despachos.find(d => d.despacho === h.despacho);
            if (despD) {
                despD.stock += h.kilos;
            } else {
                destino.despachos.push({ despacho: h.despacho, stock: h.kilos });
            }
        }
    }

    // Revierte el efecto de una entrada del historial sobre el stock.
    // Se usa cuando un id queda en `anulados` y todavía está en el historial
    // local (porque la anulación la disparó otro admin).
    function revertirEntradaDelStock(h) {
        const tipo = h.tipo || "SALIDA";
        if (tipo === "SALIDA") {
            const tanque = stock.find(t => t.tanque === h.tanque);
            if (!tanque) return;
            const desp = tanque.despachos.find(d => d.despacho === h.despacho);
            if (desp) desp.stock += h.kilos;
        } else if (tipo === "INGRESO") {
            const tanque = stock.find(t => t.tanque === h.tanque);
            if (!tanque) return;
            const desp = tanque.despachos.find(d => d.despacho === h.despacho);
            if (desp) desp.stock -= h.kilos;
        } else if (tipo === "TRANSFERENCIA") {
            const partes = String(h.tanque || "").split("→");
            if (partes.length !== 2) return;
            const [origenNum, destinoNum] = partes;
            const origen = stock.find(t => t.tanque === origenNum);
            if (origen) {
                const despO = origen.despachos.find(d => d.despacho === h.despacho);
                if (despO) despO.stock += h.kilos;
            }
            const destino = stock.find(t => t.tanque === destinoNum);
            if (destino) {
                const despD = destino.despachos.find(d => d.despacho === h.despacho);
                if (despD) despD.stock -= h.kilos;
            }
        }
    }

    // Mergea estado remoto al local:
    // - Une lista de tombstones (anulados) — si una entrada anulada en remoto
    //   sigue en mi historial local, la quito y reverso su efecto al stock.
    // - Agrega entradas remotas nuevas y aplica su efecto al stock.
    // - Propaga renombramientos de despacho (mismo id, distinto despacho).
    // - Filtra del remoto cualquier entrada cuyo id ya esté en anulados (para
    //   no revivir entradas que un admin acaba de anular).
    // Retorna total de cambios aplicados.
    function mergearEntradasRemotas(remoto) {
        if (!remoto) return 0;
        let cambios = 0;

        // 1. Tombstones: unir lista local + remota.
        const setAnul = new Set(anulados);
        const remoteAnul = Array.isArray(remoto.anulados) ? remoto.anulados : [];
        for (const id of remoteAnul) {
            if (!setAnul.has(id)) {
                anulados.push(id);
                setAnul.add(id);
                // Si la entrada anulada todavía está en mi historial local, removerla.
                const idx = historial.findIndex(h => h.id === id);
                if (idx >= 0) {
                    revertirEntradaDelStock(historial[idx]);
                    historial.splice(idx, 1);
                    cambios++;
                }
            }
        }

        // 2. Entradas remotas nuevas + propagación de renombramientos.
        if (Array.isArray(remoto.historial)) {
            const porIdLocal = new Map();
            historial.forEach(h => porIdLocal.set(h.id, h));
            const nuevas = [];
            let renombrados = 0;
            for (const hR of remoto.historial) {
                if (setAnul.has(hR.id)) continue; // ignorar revivals
                const local = porIdLocal.get(hR.id);
                if (!local) {
                    nuevas.push(hR);
                } else if (local.despacho !== hR.despacho) {
                    local.despacho = hR.despacho;
                    renombrados++;
                }
            }
            for (const h of nuevas) {
                historial.push(h);
                aplicarEntradaAlStock(h);
            }
            if (nuevas.length > 0) historial.sort((a, b) => (b.id || 0) - (a.id || 0));
            cambios += nuevas.length + renombrados;
        }

        // 3. Despachos con diferencia: union por id, last-write-wins por ts.
        if (Array.isArray(remoto.diferencias)) {
            const porId = new Map();
            diferencias.forEach(d => porId.set(d.id, d));
            let nd = 0;
            for (const dR of remoto.diferencias) {
                const local = porId.get(dR.id);
                if (!local) { porId.set(dR.id, dR); nd++; }
                else if ((dR.ts || "") > (local.ts || "")) { porId.set(dR.id, dR); nd++; }
            }
            const merged = [...porId.values()];
            if (nd > 0 || merged.length !== diferencias.length) {
                diferencias.length = 0;
                diferencias.push(...merged);
            }
            cambios += nd;
        }

        return cambios;
    }

    function rerenderAfterMerge() {
        renderStock();
        renderHistorial();
        renderPlan();
        renderDiferencias();
        renderPrecintos(document.getElementById("filtroPrecintos")?.value || "");
        if (document.getElementById("reporteDiario")?.classList.contains("active")) {
            renderReporteDiario();
        }
    }

    function guardarDatos() {
        localStorage.setItem("stockTanquesV3", JSON.stringify(stock));
        localStorage.setItem("historialSalidasV3", JSON.stringify(historial));
        localStorage.setItem("anuladosV3", JSON.stringify(anulados));
        localStorage.setItem("diferenciasV1", JSON.stringify(diferencias));
        GH.guardar((remoto) => {
            const cambios = mergearEntradasRemotas(remoto);
            if (cambios > 0) {
                localStorage.setItem("stockTanquesV3", JSON.stringify(stock));
                localStorage.setItem("historialSalidasV3", JSON.stringify(historial));
                localStorage.setItem("anuladosV3", JSON.stringify(anulados));
                localStorage.setItem("diferenciasV1", JSON.stringify(diferencias));
                rerenderAfterMerge();
                mostrarAlerta(`Se sincronizaron ${cambios} cambio(s) de otro usuario.`, "info");
            }
            return { stock, historial, anulados, diferencias };
        });
    }

    // Indicador visual de sincronización: solo punto de color,
    // excepto en error que muestra "OFFLINE"
    const syncPill = document.getElementById("syncEstado");
    if (syncPill) {
        const titulos = {
            sincronizado: "Sincronizado con el servidor",
            pendiente: "Cambios pendientes de enviar",
            enviando: "Enviando cambios al servidor…",
            error: "Sin conexión — reintentando"
        };
        GH.onEstado((estado) => {
            syncPill.className = "sync-pill sync-" + estado;
            syncPill.textContent = estado === "error" ? "OFFLINE" : "";
            syncPill.title = titulos[estado] || estado;
        });
    }

    // Aviso si se intenta cerrar la pestaña con datos sin sincronizar
    window.addEventListener("beforeunload", (ev) => {
        if (GH.pendiente) {
            ev.preventDefault();
            ev.returnValue = "Hay cambios sin sincronizar. ¿Seguro que querés cerrar?";
            return ev.returnValue;
        }
    });

    // --- RENOMBRADO DE DESPACHOS NO ESTANDAR ---
    // Un despacho es valido para salida si su nombre contiene IC04, IC06, TRP, EC01, REMO, TRM6 o IT14.
    // Los historicos pueden venir con formatos como FISCAL-..., PARTICULAR, IDA4, etc.
    function esDespachoValido(nombre) {
        if (!nombre) return false;
        const n = nombre.toUpperCase();
        return n.includes("IC04") || n.includes("IC06") || n.includes("TRP") ||
               n.includes("EC01") || n.includes("REMO") || n.includes("TRM6") ||
               n.includes("IT14");
    }

    function getDespachosConsultados() {
        try {
            return JSON.parse(localStorage.getItem("despachosConsultados")) || [];
        } catch (_) { return []; }
    }

    function addDespachoConsultado(nombre) {
        const lista = getDespachosConsultados();
        if (!lista.includes(nombre)) {
            lista.push(nombre);
            localStorage.setItem("despachosConsultados", JSON.stringify(lista));
        }
    }

    // Renombra el despacho. Si soloEnTanque está seteado, solo afecta a ese tanque
    // (y sus entradas del historial / plan). Si no, renombra en todos los tanques.
    // Devuelve la lista de tanques afectados.
    function renombrarDespachoEnStock(tanqueObj, despachoViejo, despachoNuevo, soloEnTanque = null, clienteNuevo = null) {
        const tanquesAfectados = [];
        stock.forEach(t => {
            if (soloEnTanque && t.tanque !== soloEnTanque) return;
            const desp = (t.despachos || []).find(d => d.despacho === despachoViejo);
            if (desp) {
                desp.despacho = despachoNuevo;
                if (clienteNuevo) desp.cliente = clienteNuevo;
                // Si en el mismo tanque quedaba un "fantasma" con el nombre nuevo y 0 kg
                // (un despacho ya despachado, oculto en la UI), se descarta para no duplicar.
                t.despachos = t.despachos.filter(d => d === desp || d.despacho !== despachoNuevo || d.stock > 0);
                tanquesAfectados.push(t.tanque);
            }
        });
        // Renombrar entradas del historial: si soloEnTanque, solo las de ese tanque.
        historial.forEach(h => {
            if (h.despacho !== despachoViejo) return;
            if (soloEnTanque && h.tanque !== soloEnTanque) return;
            h.despacho = despachoNuevo;
        });
        // Renombrar las filas del plan de los tanques afectados
        tanquesAfectados.forEach(tq => renombrarDespachoEnPlan(tq, despachoViejo, despachoNuevo));
        guardarDatos();
        return tanquesAfectados;
    }

    function lanzarRenombrarDespacho(despachoObj) {
        const viejo = despachoObj.despacho;
        const stockViejo = despachoObj.stock;
        const inputNombreId = "inputRenombrarDesp";
        const inputKilosId = "inputRenombrarKilos";
        const inputClienteId = "inputRenombrarCliente";
        const errorId = "renombrarError";
        const clienteActual = despachoObj.cliente || (tanqueActual && tanqueActual.cliente) || "";
        const html = `
            <p>El despacho <code>${viejo}</code> no cumple con el formato estándar (<strong>IC04</strong>, <strong>IC06</strong>, <strong>TRP</strong>, <strong>EC01</strong>, <strong>REMO</strong>, <strong>TRM6</strong> o <strong>IT14</strong>).</p>
            <p style="font-size:0.9rem;color:var(--gray-500);margin-bottom:0.25rem">Stock disponible: <strong>${formatKg(stockViejo)} kg</strong></p>
            <div class="form-group" style="margin-top:1rem">
                <label for="${inputNombreId}">Nuevo nombre del despacho</label>
                <input type="text" id="${inputNombreId}" placeholder="Ej: DI26IC04009999Z" style="font-family:monospace;text-transform:uppercase">
            </div>
            <div class="form-group" style="margin-top:0.75rem">
                <label for="${inputClienteId}">Cliente / SubCliente</label>
                <input type="text" id="${inputClienteId}" placeholder="Nombre del cliente">
                <p style="font-size:0.78rem;color:var(--gray-500);margin-top:0.2rem">Confirmá que el cliente es el mismo, o cambialo si corresponde.</p>
            </div>
            <div class="form-group" style="margin-top:0.75rem">
                <label for="${inputKilosId}">Kilos a migrar al nuevo nombre</label>
                <input type="number" id="${inputKilosId}" min="1" max="${stockViejo}" step="1" value="${stockViejo}" placeholder="Cantidad en kg">
            </div>
            <div id="${errorId}" class="alerta error hidden" style="margin-top:0.5rem"></div>
            <p style="font-size:0.8rem;color:var(--gray-500);margin-top:0.75rem">Si migrás <strong>todos</strong> los kilos, el despacho viejo desaparece y se renombra en <strong>todos los tanques que lo tengan</strong> (más los movimientos del historial y las filas del plan). Si migrás <strong>una parte</strong>, se crea un despacho nuevo con esos kilos solo en este tanque y el viejo queda con el saldo restante (útil cuando un despacho viejo representa varios despachos chicos).</p>
        `;
        document.getElementById("modalTitulo").textContent = "Renombrar despacho";
        document.getElementById("btnConfirmar").textContent = "Renombrar";
        modalBody.innerHTML = html;
        document.getElementById(inputClienteId).value = clienteActual;

        const confirmarRenombrar = () => {
            const inpN = document.getElementById(inputNombreId);
            const inpK = document.getElementById(inputKilosId);
            const errBox = document.getElementById(errorId);
            const nuevo = (inpN.value || "").trim().toUpperCase();
            const kilos = parseInt(inpK.value) || 0;

            const mostrarError = (msg) => {
                errBox.textContent = msg;
                errBox.classList.remove("hidden");
                window._confirmarAccion = confirmarRenombrar;
            };

            if (!nuevo) { mostrarError("Ingresá el nuevo nombre del despacho."); return; }
            if (nuevo === viejo) { mostrarError("El nuevo nombre es igual al actual."); return; }
            if (kilos <= 0) { mostrarError("Los kilos deben ser mayores a cero."); return; }
            if (kilos > stockViejo) { mostrarError(`Los kilos no pueden superar el stock disponible (${formatKg(stockViejo)} kg).`); return; }
            // Para split: solo importa el tanque actual (no se propaga).
            // Para rename completo: chequear conflicto en CUALQUIER tanque que tenga el despacho viejo,
            // y avisar al usuario si está replicado en más de un tanque (se renombra en todos).
            const esSplit = kilos < stockViejo;
            // Validamos solo dentro del tanque actual (el único que SIEMPRE se modifica).
            // Permitimos que el mismo nombre exista en otros tanques — dos camiones con el
            // mismo despacho pueden estar en TK distintos sin conflicto. La validación de
            // conflictos en otros tanques (caso de propagación) se hace en ejecutarRenombrar
            // según el alcance que elija el usuario.
            // Los despachos con 0 kg son "fantasmas" (ya despachados, ocultos en la UI): no
            // cuentan como conflicto y se descartan al renombrar.
            const conflictoEnEste = tanqueActual.despachos.some(d => d.despacho === nuevo && d !== despachoObj && d.stock > 0);
            if (conflictoEnEste) {
                mostrarError(`Ya existe un despacho con el nombre "${nuevo}" en este tanque (TK ${tanqueActual.tanque}).`);
                return;
            }

            if (!esSplit) {
                const tanquesConViejo = stock.filter(t => (t.despachos || []).some(d => d.despacho === viejo));
                if (tanquesConViejo.length > 1) {
                    const otrosTks = tanquesConViejo.filter(t => t.tanque !== tanqueActual.tanque).map(t => `TK ${t.tanque}`).join(", ");
                    elegirAlcanceRenombrar(viejo, nuevo, otrosTks, tanqueActual.tanque, (alcance) => {
                        // alcance: "todos" | "soloEste" | "cancelar"
                        if (alcance === "cancelar") {
                            window._confirmarAccion = confirmarRenombrar;
                            return;
                        }
                        ejecutarRenombrar(alcance === "soloEste");
                    });
                    return;
                }
            }

            ejecutarRenombrar(false);
        };

        const ejecutarRenombrar = (soloEnEste) => {
            const inpN = document.getElementById(inputNombreId);
            const inpK = document.getElementById(inputKilosId);
            const inpC = document.getElementById(inputClienteId);
            const nuevo = (inpN.value || "").trim().toUpperCase();
            const kilos = parseInt(inpK.value) || 0;
            const clienteNuevo = (inpC.value || "").trim();
            const esSplit = kilos < stockViejo;

            // Si propaga a todos: validar que ningún otro tanque con el despacho viejo
            // tenga ya el nombre nuevo en su lista (eso generaría 2 despachos iguales en
            // ese tanque — único caso realmente prohibido).
            if (!esSplit && !soloEnEste) {
                const tanquesConViejo = stock.filter(t => (t.despachos || []).some(d => d.despacho === viejo));
                const conflictoOtro = tanquesConViejo.find(t =>
                    t.tanque !== tanqueActual.tanque &&
                    t.despachos.some(d => d.despacho === nuevo && d.stock > 0)
                );
                if (conflictoOtro) {
                    document.getElementById(errorId).textContent =
                        `No se puede propagar a TK ${conflictoOtro.tanque} porque ya tiene un despacho "${nuevo}". Renombrá solo en TK ${tanqueActual.tanque}.`;
                    document.getElementById(errorId).classList.remove("hidden");
                    window._confirmarAccion = confirmarRenombrar;
                    return;
                }
            }

            modal.classList.add("hidden");
            document.getElementById("btnConfirmar").textContent = "Confirmar";

            const cliTxt = (clienteNuevo && clienteNuevo !== clienteActual) ? ` · Cliente: ${clienteNuevo}` : "";
            if (esSplit) {
                despachoObj.stock -= kilos;
                const nuevoDesp = { despacho: nuevo, stock: kilos };
                const cli = clienteNuevo || despachoObj.cliente;
                if (cli) nuevoDesp.cliente = cli;
                // Descartar fantasmas con el mismo nombre y 0 kg antes de agregar el nuevo.
                tanqueActual.despachos = tanqueActual.despachos.filter(d => d.despacho !== nuevo || d.stock > 0);
                tanqueActual.despachos.push(nuevoDesp);
                guardarDatos();
                mostrarAlerta(`Despacho dividido en TK ${tanqueActual.tanque}: ${formatKg(kilos)} kg migrados de "${viejo}" a "${nuevo}". Saldo viejo: ${formatKg(despachoObj.stock)} kg${cliTxt}`, "success");
            } else {
                const tks = renombrarDespachoEnStock(tanqueActual, viejo, nuevo, soloEnEste ? tanqueActual.tanque : null, clienteNuevo);
                const dondeTxt = tks.length > 1 ? ` en ${tks.length} tanques (TK ${tks.join(", TK ")})` : ` en TK ${tks[0] || tanqueActual.tanque}`;
                mostrarAlerta(`Despacho renombrado${dondeTxt}: "${viejo}" → "${nuevo}"${cliTxt}`, "success");
            }

            addDespachoConsultado(nuevo);
            poblarDespachos(tanqueActual);
            const newIdx = tanqueActual.despachos.findIndex(d => d.despacho === nuevo);
            if (newIdx >= 0) {
                selectDespacho.value = newIdx;
                selectDespacho.dispatchEvent(new Event("change"));
            }
            renderStock();
            renderHistorial();
        };

        window._confirmarAccion = confirmarRenombrar;
        modal.classList.remove("hidden");
        setTimeout(() => {
            const inp = document.getElementById(inputNombreId);
            if (inp) inp.focus();
        }, 50);
    }

    let tanqueActual = null;
    let despachoActual = null;

    const inputTanque = document.getElementById("inputTanque");
    const btnBuscar = document.getElementById("btnBuscarTanque");
    const infoTanque = document.getElementById("infoTanque");
    const selectDespacho = document.getElementById("selectDespacho");
    const infoDespacho = document.getElementById("infoDespacho");
    const kilosInput = document.getElementById("kilosSalida");
    const remitoInput = document.getElementById("nroRemito");
    const fechaInput = document.getElementById("fechaSalida");
    const alerta = document.getElementById("alertaStock");
    const btnRegistrar = document.getElementById("btnRegistrar");
    const btnLimpiar = document.getElementById("btnLimpiar");
    const modal = document.getElementById("modalConfirm");
    const modalBody = document.getElementById("modalBody");

    const paso1 = document.getElementById("paso1");
    const paso2 = document.getElementById("paso2");
    const paso3 = document.getElementById("paso3");

    fechaInput.valueAsDate = new Date();

    // --- ROL Y VISIBILIDAD DE PESTAÑAS ---
    const rolActual = ROLES[usuarioActual] || "admin";
    document.querySelectorAll(".tab").forEach(tab => {
        const rolReq = tab.dataset.rol;
        if (rolReq === "admin" && rolActual !== "admin") {
            tab.classList.add("hidden");
            tab.classList.remove("active");
        } else if (rolReq === "viewer" && rolActual === "viewer") {
            tab.classList.remove("hidden");
            tab.classList.add("active");
            document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
            document.getElementById("salidasViewer").classList.add("active");
        }
    });

    // --- TABS ---
    // Si es vista mobile (≤768px) y la pestaña activa está oculta por CSS,
    // cambiar a la primera pestaña visible (default Cargas)
    function ajustarTabsMobile() {
        if (window.innerWidth > 768) return;
        const activa = document.querySelector(".tab.active");
        if (activa && getComputedStyle(activa).display === "none") {
            const primera = Array.from(document.querySelectorAll(".tab")).find(t =>
                getComputedStyle(t).display !== "none" && !t.classList.contains("hidden")
            );
            if (primera) primera.click();
        }
    }
    setTimeout(ajustarTabsMobile, 50);
    window.addEventListener("resize", ajustarTabsMobile);

    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById(tab.dataset.tab).classList.add("active");
            if (tab.dataset.tab === "reporteDiario") renderReporteDiario();
            if (tab.dataset.tab === "salidasViewer") renderViewer();
            if (tab.dataset.tab === "planCargas") { renderPlan(); intentarAutoSync(); }
            if (tab.dataset.tab === "historial") {
                // Renderizar la sub-pestaña activa de historial
                const activa = document.querySelector("#historial .sub-tab.active");
                const sub = activa ? activa.dataset.subtab : "histSalidas";
                if (sub === "histPorTanque") { volverListaHistTanque(); renderHistTanqueLista(); }
                else if (sub === "histPorDespacho") { volverListaHistDespacho(); renderHistDespachoLista(); }
                else renderHistorial();
            }
        });
    });

    // --- PASO 1: BUSCAR TANQUE ---
    function buscarTanque() {
        const num = inputTanque.value.trim().padStart(3, "0");
        inputTanque.value = num;

        if (tanquesDesafectados.includes(num)) {
            infoTanque.className = "info-box not-found";
            infoTanque.innerHTML = `<strong>Tanque ${num} desafectado — no operable.</strong>`;
            infoTanque.classList.remove("hidden");
            desactivarPaso(2);
            desactivarPaso(3);
            tanqueActual = null;
            return;
        }

        const tanque = stock.find(t => t.tanque === num);

        if (!tanque) {
            infoTanque.className = "info-box not-found";
            infoTanque.innerHTML = `<strong>Tanque ${num} no encontrado o está vacío.</strong>`;
            infoTanque.classList.remove("hidden");
            desactivarPaso(2);
            desactivarPaso(3);
            tanqueActual = null;
            return;
        }

        const totalStock = tanque.despachos.reduce((s, d) => s + d.stock, 0);

        infoTanque.className = "info-box found";
        infoTanque.innerHTML = `
            <div class="info-grid">
                <div><span class="info-label">Producto</span><br><span class="info-value">${tanque.producto}</span></div>
                <div><span class="info-label">Cliente</span><br><span class="info-value">${tanque.cliente}</span></div>
                <div><span class="info-label">Stock Total</span><br><span class="info-value">${formatKg(totalStock)} kg</span></div>
            </div>
        `;
        infoTanque.classList.remove("hidden");
        tanqueActual = tanque;

        paso1.className = "paso done";
        activarPaso(2);
        poblarDespachos(tanque);
        setTimeout(() => selectDespacho.focus(), 0);
    }

    btnBuscar.addEventListener("click", buscarTanque);
    inputTanque.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); buscarTanque(); }
    });

    // Buscar duplicados de remito (solo SALIDAS del mismo día)
    function buscarRemitoDuplicado(remito, fecha) {
        if (!remito) return [];
        return historial.filter(s => {
            const tipo = s.tipo || "SALIDA";
            return tipo === "SALIDA" &&
                   s.fecha === fecha &&
                   (s.remito || "").trim() === remito;
        });
    }

    function verificarRemitoEnVivo() {
        const alertaDup = document.getElementById("alertaRemitoDup");
        const remito = remitoInput.value.trim();
        if (remito.length !== 4) {
            alertaDup.classList.add("hidden");
            return;
        }
        const dups = buscarRemitoDuplicado(remito, fechaInput.value);
        if (dups.length === 0) {
            alertaDup.classList.add("hidden");
            return;
        }
        const detalle = dups.map(d => `TK ${d.tanque} - ${formatKg(d.kilos)} kg (${d.hora || "-"})`).join(" · ");
        alertaDup.className = "alerta warning";
        alertaDup.innerHTML = `<strong>⚠ Remito ${remito} ya cargado hoy:</strong> ${detalle}`;
    }

    // Auto-saltar al tanque cuando se completan los 4 dígitos del remito
    remitoInput.addEventListener("input", () => {
        verificarRemitoEnVivo();
        if (remitoInput.value.trim().length === 4) {
            inputTanque.focus();
            inputTanque.select();
        }
    });
    fechaInput.addEventListener("change", verificarRemitoEnVivo);

    // --- PASO 2: SELECCIONAR DESPACHO ---
    function poblarDespachos(tanque) {
        selectDespacho.innerHTML = '<option value="">-- Seleccioná un despacho --</option>';
        tanque.despachos.forEach((d, i) => {
            if (d.stock <= 0) return;
            const opt = document.createElement("option");
            opt.value = i;
            opt.textContent = `${d.despacho}  —  ${formatKg(d.stock)} kg`;
            selectDespacho.appendChild(opt);
        });
    }

    selectDespacho.addEventListener("change", () => {
        const idx = selectDespacho.value;
        if (idx === "" || !tanqueActual) {
            infoDespacho.classList.add("hidden");
            desactivarPaso(3);
            despachoActual = null;
            return;
        }

        const desp = tanqueActual.despachos[parseInt(idx)];
        despachoActual = desp;

        const clienteDesp = desp.cliente || tanqueActual.cliente;
        const invalido = !esDespachoValido(desp.despacho);
        const avisoInvalido = invalido
            ? `<div style="margin-top:0.75rem;padding:0.6rem 0.8rem;background:#fef3c7;color:#92400e;border-radius:6px;font-size:0.85rem">
                    ⚠ Formato no estándar — se espera IC04, IC06, TRP, EC01, REMO, TRM6 o IT14.
                </div>`
            : "";
        infoDespacho.className = "info-box found";
        infoDespacho.innerHTML = `
            <div class="info-grid">
                <div><span class="info-label">Despacho</span><br><span class="info-value" style="font-family:monospace">${desp.despacho}</span></div>
                <div><span class="info-label">Cliente</span><br><span class="info-value">${clienteDesp}</span></div>
                <div><span class="info-label">Stock Disponible</span><br><span class="info-value" style="font-size:1.3rem;color:var(--primary)">${formatKg(desp.stock)} kg</span></div>
            </div>
            <div style="margin-top:0.75rem;display:flex;justify-content:flex-end">
                <button class="btn btn-secondary btn-sm" id="btnRenombrarDespacho" type="button">✎ Renombrar despacho</button>
            </div>
            ${avisoInvalido}
        `;
        infoDespacho.classList.remove("hidden");

        const btnRen = document.getElementById("btnRenombrarDespacho");
        if (btnRen) btnRen.addEventListener("click", () => lanzarRenombrarDespacho(desp));

        if (invalido) {
            const yaConsultado = getDespachosConsultados().includes(desp.despacho);
            if (!yaConsultado) {
                addDespachoConsultado(desp.despacho);
                setTimeout(() => lanzarRenombrarDespacho(desp), 150);
            }
        }

        paso2.className = "paso done";
        activarPaso(3);
    });

    // Enter en el select de despacho = pasar al campo kilos
    selectDespacho.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && despachoActual) {
            e.preventDefault();
            kilosInput.focus();
        }
    });

    // Enter en kilos = registrar salida (abre modal)
    kilosInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !btnRegistrar.disabled) {
            e.preventDefault();
            btnRegistrar.click();
        }
    });

    // --- PASO 3: VALIDAR KILOS ---
    kilosInput.addEventListener("input", () => {
        if (!despachoActual) return;
        const kilos = parseInt(kilosInput.value) || 0;

        if (kilos > despachoActual.stock) {
            mostrarAlerta(`Stock insuficiente. Disponible: ${formatKg(despachoActual.stock)} kg. Excede en ${formatKg(kilos - despachoActual.stock)} kg.`, "error");
            btnRegistrar.disabled = true;
        } else if (kilos > 0) {
            ocultarAlerta();
            btnRegistrar.disabled = false;
        } else {
            ocultarAlerta();
            btnRegistrar.disabled = true;
        }
    });

    // Modal genérico (reusa #modalConfirm)
    function abrirModal(titulo, html, onConfirmar, btnConfirmarTexto = "Confirmar") {
        document.getElementById("modalTitulo").textContent = titulo;
        modalBody.innerHTML = html;
        document.getElementById("btnConfirmar").textContent = btnConfirmarTexto;
        window._confirmarAccion = onConfirmar;
        modal.classList.remove("hidden");
        setTimeout(() => document.getElementById("btnConfirmar").focus(), 0);
    }

    // --- REGISTRAR ---
    function esDespachoConPrecinto(desp) {
        const u = (desp || "").toUpperCase();
        return u.includes("TR06") || u.includes("TRM6");
    }

    btnRegistrar.addEventListener("click", () => {
        if (!tanqueActual || !despachoActual) return;

        const kilos = parseInt(kilosInput.value) || 0;
        const remito = remitoInput.value.trim();

        if (kilos <= 0) { mostrarAlerta("Ingresá una cantidad válida.", "error"); return; }
        if (kilos > despachoActual.stock) { mostrarAlerta("Stock insuficiente.", "error"); return; }

        // Salida TR06/TRM6: el N° de precinto es obligatorio (se insiste hasta cargarlo).
        let precinto = "";
        if (esDespachoConPrecinto(despachoActual.despacho)) {
            while (true) {
                const r = prompt(`Salida con precinto — despacho ${despachoActual.despacho}\n\nIngresá el N° de precinto (obligatorio):`, "");
                if (r === null) { mostrarAlerta("No se registró: esta salida necesita el N° de precinto.", "error"); return; }
                precinto = r.trim();
                if (precinto) break;
                alert("El N° de precinto es obligatorio para las salidas TR06/TRM6. Cargalo.");
            }
        }

        abrirConfirmacionSalida(precinto);
    });

    function abrirConfirmacionSalida(precinto) {
        precinto = (precinto || "").trim();
        const kilos = parseInt(kilosInput.value) || 0;
        const remito = remitoInput.value.trim();
        const restante = despachoActual.stock - kilos;
        const clienteSalida = despachoActual.cliente || tanqueActual.cliente;
        document.getElementById("modalTitulo").textContent = "Confirmar Salida";
        document.getElementById("btnConfirmar").textContent = "Confirmar";
        modalBody.innerHTML = `
            <p><strong>Tanque:</strong> TK ${tanqueActual.tanque}</p>
            <p><strong>Producto:</strong> ${tanqueActual.producto}</p>
            <p><strong>Cliente:</strong> ${clienteSalida}</p>
            <p><strong>Despacho:</strong> <code>${despachoActual.despacho}</code></p>
            ${precinto ? `<p><strong>Precinto:</strong> <code>${precinto}</code></p>` : ""}
            <p><strong>Remito:</strong> ${remito || "Sin remito"}</p>
            <p><strong>Kilos a retirar:</strong> ${formatKg(kilos)} kg</p>
            <p><strong>Stock restante despacho:</strong> ${formatKg(restante)} kg</p>
            <p><strong>Usuario:</strong> ${usuarioActual.toUpperCase()}</p>
        `;

        window._confirmarAccion = () => {
            const ahora = new Date();
            const salida = {
                id: Date.now(),
                fecha: fechaInput.value,
                hora: ahora.toTimeString().slice(0, 5),
                remito: remitoInput.value.trim(),
                tanque: tanqueActual.tanque,
                producto: tanqueActual.producto,
                cliente: clienteSalida,
                despacho: despachoActual.despacho,
                kilos: kilos,
                usuario: usuarioActual,
            };
            if (precinto) salida.precinto = precinto;

            despachoActual.stock -= kilos;
            const restante2 = despachoActual.stock;

            historial.unshift(salida);
            const matchPlan = matchearSalidaConPlan(salida);
            guardarDatos();

            modal.classList.add("hidden");
            limpiarFormulario();
            renderStock();
            renderHistorial();
            renderPlan();
            if (salida.precinto) renderPrecintos(document.getElementById("filtroPrecintos")?.value || "");

            const sufijoPrec = salida.precinto ? ` · Precinto ${salida.precinto} registrado` : "";
            const sufijoPlan = matchPlan ? " · ✓ Plan del día actualizado" : "";
            mostrarAlerta(`Salida registrada: ${formatKg(kilos)} kg del TK ${salida.tanque} - Despacho ${salida.despacho}. Saldo restante: ${formatKg(restante2)} kg${sufijoPrec}${sufijoPlan}`, "success");
            paso1.className = "paso active";

            // Listo para cargar el siguiente remito
            remitoInput.value = "";
            document.getElementById("alertaRemitoDup").classList.add("hidden");
            remitoInput.focus();
        };

        modal.classList.remove("hidden");
        setTimeout(() => document.getElementById("btnConfirmar").focus(), 0);
    }

    document.getElementById("btnCancelar").addEventListener("click", () => {
        modal.classList.add("hidden");
        document.getElementById("btnConfirmar").textContent = "Confirmar";
        window._confirmarAccion = null;
    });

    // --- LIMPIAR ---
    btnLimpiar.addEventListener("click", limpiarFormulario);

    function limpiarFormulario() {
        tanqueActual = null;
        despachoActual = null;
        inputTanque.value = "";
        infoTanque.classList.add("hidden");
        selectDespacho.innerHTML = '<option value="">-- Primero ingresá un tanque --</option>';
        infoDespacho.classList.add("hidden");
        kilosInput.value = "";
        ocultarAlerta();
        btnRegistrar.disabled = true;

        paso1.className = "paso active";
        desactivarPaso(2);
        desactivarPaso(3);
        inputTanque.focus();
    }

    // --- ACTIVAR/DESACTIVAR PASOS ---
    function activarPaso(n) {
        const paso = document.getElementById("paso" + n);
        paso.classList.remove("disabled");
        paso.classList.add("active");
        if (n === 3) kilosInput.disabled = false;
    }

    function desactivarPaso(n) {
        const paso = document.getElementById("paso" + n);
        paso.className = "paso disabled";
        if (n === 3) {
            kilosInput.disabled = true;
            btnRegistrar.disabled = true;
        }
    }

    // --- RENDER STOCK ---
    function renderStock(filtro = "") {
        const container = document.getElementById("stockCards");
        const filtroLower = filtro.toLowerCase();

        const filtrados = stock.filter(t => {
            if (tanquesDesafectados.includes(t.tanque)) return false;
            const totalStock = t.despachos.reduce((s, d) => s + d.stock, 0);
            if (totalStock <= 0) return false;
            if (!filtro) return true;
            return t.tanque.includes(filtroLower) ||
                   t.producto.toLowerCase().includes(filtroLower) ||
                   t.cliente.toLowerCase().includes(filtroLower);
        });

        let totalKg = 0;
        let totalDesp = 0;

        container.innerHTML = filtrados.map(t => {
            const totalTanque = t.despachos.reduce((s, d) => s + d.stock, 0);
            totalKg += totalTanque;
            const despActivos = t.despachos.filter(d => d.stock > 0);
            totalDesp += despActivos.length;

            const despHTML = t.despachos.map(d => {
                if (d.stock <= 0) return "";
                return `<div class="despacho-row">
                    <span class="despacho-nombre">${d.despacho}</span>
                    <span class="despacho-kg">${formatKg(d.stock)} kg</span>
                </div>`;
            }).join("");

            // Gráfico de nivel
            const cap = capacidadTanques[t.tanque] || 0;
            let pct = cap > 0 ? Math.min(Math.round((totalTanque / cap) * 100), 100) : 0;
            if (pct < 0) pct = 0;
            const nivelColor = pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e";
            const nivelHTML = cap > 0 ? `<div class="tanque-nivel-wrap">
                <div class="tanque-nivel-grafico">
                    <div class="tanque-nivel-agua" style="height:${pct}%;background:${nivelColor}"></div>
                    <span class="tanque-nivel-pct">${pct}%</span>
                </div>
                <div class="tanque-nivel-info">
                    <div><span class="info-label">Stock</span><br><strong>${formatKg(totalTanque)} kg</strong></div>
                    <div><span class="info-label">Capacidad (98%)</span><br><strong>${formatKg(cap)} L</strong></div>
                    <div><span class="info-label">Ocupación</span><br><strong style="color:${nivelColor}">${pct}%</strong></div>
                </div>
            </div>` : "";

            const renpq = getRenpqInfo(t.producto);
            const renpqBadge = renpq
                ? `<span class="renpq-badge" title="Precursor químico — RENPQ Lista ${renpq.lista} (Decreto 593/19)">⚠ RNPQ ${renpq.lista}</span>`
                : "";
            const cardCls = renpq ? "stock-card renpq" : "stock-card";
            return `<div class="${cardCls}" onclick="this.classList.toggle('open')">
                <div class="stock-card-header">
                    <div class="stock-card-left">
                        <span class="stock-card-tanque">TK ${t.tanque}</span>
                        <div>
                            <div class="stock-card-producto">${t.producto} ${renpqBadge}</div>
                            <div class="stock-card-cliente">${t.cliente}</div>
                        </div>
                    </div>
                    <span class="stock-card-total">${formatKg(totalTanque)} kg</span>
                </div>
                <div class="stock-card-despachos">${nivelHTML}${despHTML}</div>
            </div>`;
        }).join("");

        document.getElementById("totalTanques").textContent = filtrados.length;
        document.getElementById("totalDespachos").textContent = totalDesp;
        document.getElementById("totalKilos").textContent = formatKg(totalKg);
    }

    document.getElementById("filtroStock").addEventListener("input", (e) => {
        renderStock(e.target.value);
    });

    // --- RENDER HISTORIAL ---
    function renderHistorial(filtro = "") {
        const tbody = document.querySelector("#tablaHistorial tbody");
        const filtroLower = filtro.toLowerCase();

        const datos = historial.filter(s => {
            if (!filtro) return true;
            return (s.remito || "").toLowerCase().includes(filtroLower) ||
                   s.producto.toLowerCase().includes(filtroLower) ||
                   s.tanque.includes(filtroLower) ||
                   s.despacho.toLowerCase().includes(filtroLower);
        });

        if (datos.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="10">No hay movimientos registrados</td></tr>';
            return;
        }

        tbody.innerHTML = datos.map(s => {
            const tipo = s.tipo || "SALIDA";
            const tipoClass = tipo === "INGRESO" ? "tipo-ingreso" : tipo === "TRANSFERENCIA" ? "tipo-transferencia" : "tipo-salida";
            const tipoLabel = tipo === "TRANSFERENCIA" ? "TRANSF." : tipo;
            return `<tr>
            <td>${s.fecha}</td>
            <td>${s.hora || "-"}</td>
            <td><span class="tipo-badge ${tipoClass}">${tipoLabel}</span></td>
            <td><strong>${s.remito || "-"}</strong></td>
            <td><strong>TK ${s.tanque}</strong></td>
            <td>${s.producto}</td>
            <td><code>${s.despacho}</code></td>
            <td><strong>${formatKg(s.kilos)} kg</strong></td>
            <td>${(s.usuario || "-").toUpperCase()}</td>
            <td><button class="btn btn-danger btn-sm" onclick="anularSalida(${s.id})">Anular</button></td>
        </tr>`;
        }).join("");
    }

    document.getElementById("filtroHistorial").addEventListener("input", (e) => {
        renderHistorial(e.target.value);
    });

    // --- ANULAR ---
    window.anularSalida = function(id) {
        const salida = historial.find(s => s.id === id);
        if (!salida) return;
        const tipo = salida.tipo || "SALIDA";
        const verbo = tipo === "INGRESO" ? "el ingreso" : tipo === "TRANSFERENCIA" ? "la transferencia" : "la salida";
        const efecto = tipo === "INGRESO"
            ? `Se quitan ${formatKg(salida.kilos)} kg del despacho ${salida.despacho} (TK ${salida.tanque}).`
            : tipo === "TRANSFERENCIA"
                ? `Se deshace el movimiento de ${formatKg(salida.kilos)} kg (${salida.tanque}).`
                : `Se devuelven ${formatKg(salida.kilos)} kg al despacho ${salida.despacho} del TK ${salida.tanque}.`;
        if (!confirm(`¿Anular ${verbo}?\n${efecto}`)) return;

        // Revertir el efecto sobre el stock según el TIPO de movimiento:
        // SALIDA devuelve kg, INGRESO los quita, TRANSFERENCIA deshace ambos tanques.
        // (Antes esta función siempre sumaba kg — bug: anular un ingreso inflaba el stock.)
        revertirEntradaDelStock(salida);

        historial = historial.filter(s => s.id !== id);
        if (!anulados.includes(id)) anulados.push(id);
        desmatchearSalidaEnPlan(id);
        guardarDatos();

        renderStock();
        renderHistorial();
        renderPlan();
    };

    // --- HELPER: saldo actual de un despacho ---
    function getSaldoDespacho(tanqueNum, despachoNombre) {
        const tNum = tanqueNum.includes("→") ? tanqueNum.split("→")[0] : tanqueNum;
        const tanque = stock.find(t => t.tanque === tNum);
        if (!tanque) return null;
        const desp = tanque.despachos.find(d => d.despacho === despachoNombre);
        return desp ? desp.stock : null;
    }

    // --- REPORTE DIARIO ---
    function getSalidasReporte(fecha) {
        return historial.filter(s => (s.tipo || "SALIDA") === "SALIDA" && s.fecha === fecha);
    }

    function getFechaReporteSeleccionada() {
        const input = document.getElementById("reporteFechaInput");
        if (!input.value) input.value = new Date().toISOString().slice(0, 10);
        return input.value;
    }

    function renderReporteDiario() {
        const fecha = getFechaReporteSeleccionada();
        const salidas = getSalidasReporte(fecha);

        document.getElementById("reporteFecha").textContent = `Fecha: ${fecha.split("-").reverse().join("/")}`;

        const tbody = document.querySelector("#tablaReporte tbody");

        if (salidas.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No hay salidas para esta fecha</td></tr>';
            document.getElementById("reporteTotal").textContent = "";
            return;
        }

        let totalKilos = 0;
        tbody.innerHTML = salidas.map(s => {
            totalKilos += s.kilos;
            const saldo = getSaldoDespacho(s.tanque, s.despacho);
            return `<tr>
                <td>${s.hora || "-"}</td>
                <td><strong>${s.remito || "-"}</strong></td>
                <td><code>${s.despacho}</code></td>
                <td>${s.producto}</td>
                <td><strong>${formatKg(s.kilos)} kg</strong></td>
                <td>${saldo !== null ? formatKg(saldo) + " kg" : "-"}</td>
                <td>${(s.usuario || "-").toUpperCase()}</td>
            </tr>`;
        }).join("");

        document.getElementById("reporteTotal").textContent = `Total: ${formatKg(totalKilos)} kg  |  ${salidas.length} salida(s)`;
    }

    document.getElementById("reporteFechaInput").addEventListener("change", renderReporteDiario);

    // --- IMPRIMIR REPORTE ---
    document.getElementById("btnImprimirReporte").addEventListener("click", () => {
        const fecha = getFechaReporteSeleccionada();
        const salidas = getSalidasReporte(fecha);

        if (salidas.length === 0) { alert("No hay salidas para imprimir en esta fecha."); return; }

        let totalKilos = 0;
        let filas = salidas.map(s => {
            totalKilos += s.kilos;
            const saldo = getSaldoDespacho(s.tanque, s.despacho);
            return `<tr>
                <td>${s.hora || "-"}</td>
                <td>${s.remito || "-"}</td>
                <td>${s.despacho}</td>
                <td>${s.producto}</td>
                <td style="text-align:right">${formatKg(s.kilos)} kg</td>
                <td style="text-align:right">${saldo !== null ? formatKg(saldo) + " kg" : "-"}</td>
                <td>${(s.usuario || "-").toUpperCase()}</td>
            </tr>`;
        }).join("");

        const html = `<!DOCTYPE html><html><head><title>Reporte ${fecha}</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 2rem; }
            h2 { margin-bottom: 0.25rem; }
            p { color: #666; margin-bottom: 1rem; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #ccc; padding: 8px; font-size: 0.9rem; }
            th { background: #f0f0f0; text-align: left; }
            .total { margin-top: 1rem; font-size: 1.1rem; font-weight: bold; text-align: right; }
        </style></head><body>
        <h2>Odfjell Terminals Tagsa SA - Campana</h2>
        <p>Reporte de Salidas del ${fecha.split("-").reverse().join("/")}</p>
        <table>
            <thead><tr><th>Hora</th><th>Remito</th><th>Despacho</th><th>Producto</th><th>Kilos</th><th>Saldo Despacho</th><th>Usuario</th></tr></thead>
            <tbody>${filas}</tbody>
        </table>
        <div class="total">Total: ${formatKg(totalKilos)} kg — ${salidas.length} salida(s)</div>
        </body></html>`;

        const win = window.open("", "_blank");
        win.document.write(html);
        win.document.close();
        win.print();
    });

    // --- SUB-TABS (scoped al section padre) ---
    document.querySelectorAll(".sub-tab").forEach(st => {
        st.addEventListener("click", () => {
            const parent = st.closest(".tab-content");
            if (parent) {
                parent.querySelectorAll(".sub-tab").forEach(s => s.classList.remove("active"));
                parent.querySelectorAll(".sub-tab-content").forEach(sc => sc.classList.remove("active"));
            }
            st.classList.add("active");
            document.getElementById(st.dataset.subtab).classList.add("active");
            if (st.dataset.subtab === "repMensual") renderRepMensual();
            if (st.dataset.subtab === "histSalidas") renderHistorial(document.getElementById("filtroHistorial")?.value || "");
            if (st.dataset.subtab === "histPorTanque") { volverListaHistTanque(); renderHistTanqueLista(); }
            if (st.dataset.subtab === "histPorDespacho") { volverListaHistDespacho(); renderHistDespachoLista(); }
            if (st.dataset.subtab === "repSupervisor") inicializarReporteSupervisor();
            if (st.dataset.subtab === "repDiferencias") renderDiferencias();
            if (st.dataset.subtab === "repPrecintos") renderPrecintos(document.getElementById("filtroPrecintos")?.value || "");
            if (st.dataset.subtab === "sbfaActivas") renderSbfaLista(document.getElementById("sbfaFiltro")?.value || "", "activas");
            if (st.dataset.subtab === "sbfaHistorial") renderSbfaLista(document.getElementById("sbfaHistFiltro")?.value || "", "historial");
        });
    });

    // --- DESPACHOS CON DIFERENCIA (stock vs SIM) ---
    function _escHtml(s) {
        return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function _escAttr(s) {
        return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    }
    function _fmtNumDif(n) {
        const x = Number(n);
        return (n === null || n === undefined || isNaN(x)) ? "0" : Math.round(x).toLocaleString("es-AR");
    }

    // Busca en el stock del sistema qué tanque(s)/producto/cliente tiene ese despacho.
    function infoSistemaDeDespacho(despacho) {
        const nd = normDespacho(despacho);
        const tks = [], prods = [], clis = [];
        for (const t of stock) {
            if ((t.despachos || []).some(x => normDespacho(x.despacho) === nd)) {
                if (t.tanque && !tks.includes(t.tanque)) tks.push(t.tanque);
                if (t.producto && !prods.includes(t.producto)) prods.push(t.producto);
                if (t.cliente && !clis.includes(t.cliente)) clis.push(t.cliente);
            }
        }
        return { tanque: tks.join("-"), producto: prods.join(" / "), cliente: clis.join(" / ") };
    }

    function actualizarBadgeDiferencias() {
        const hayPend = diferencias.some(d => !d.eliminada && d.estado !== "resuelto");
        ["badgeDiferencias", "badgeDiferenciasSub"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle("hidden", !hayPend);
        });
    }

    // Diferencias "activas" = las que están en rojo (titilando): pendientes, no resueltas, no borradas.
    function diferenciasActivas() {
        return diferencias.filter(d => !d.eliminada && d.estado !== "resuelto");
    }

    function renderDiferencias() {
        const tbody = document.querySelector("#tablaDiferencias tbody");
        if (!tbody) { actualizarBadgeDiferencias(); return; }
        // Solo se muestran las activas; al resolver/borrar una, desaparece de la lista.
        const filas = diferenciasActivas().slice().sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
        if (filas.length === 0) {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="10">No hay despachos con diferencia pendientes. 🎉</td></tr>`;
            actualizarBadgeDiferencias();
            return;
        }
        tbody.innerHTML = filas.map(d => {
            const dif = Number(d.dif) || 0;
            const cls = dif > 0 ? "dif-pos" : (dif < 0 ? "dif-neg" : "dif-cero");
            // TK/producto/cliente: lo guardado; si está vacío, lo busco en vivo en el stock actual.
            // Los 3 son inputs editables: si el sistema no los tiene, el usuario los carga a mano acá.
            const live = infoSistemaDeDespacho(d.despacho);
            const tk = d.tanque || live.tanque || "";
            const prod = d.producto || live.producto || "";
            const cli = d.cliente || live.cliente || "";
            return `<tr class="dif-pendiente" data-dif-id="${d.id}">
                <td style="text-align:center"><span class="luz-titila" title="Pendiente de resolver"></span></td>
                <td class="dif-despacho" title="${_escAttr(d.despacho)}">${_escHtml(d.despacho)}</td>
                <td><input class="dif-edit" data-f="tanque" value="${_escAttr(tk)}" placeholder="TK…" autocomplete="off"></td>
                <td><input class="dif-edit" data-f="producto" value="${_escAttr(prod)}" placeholder="Producto…" autocomplete="off"></td>
                <td><input class="dif-edit" data-f="cliente" value="${_escAttr(cli)}" placeholder="Cliente…" autocomplete="off"></td>
                <td class="dif-valor">${_fmtNumDif(d.kgStock)}</td>
                <td class="dif-valor">${_fmtNumDif(d.kgSim)}</td>
                <td class="dif-valor ${cls}">${dif > 0 ? "+" : ""}${_fmtNumDif(dif)}</td>
                <td style="white-space:nowrap;font-size:0.75rem;color:var(--gray-500)">${fmtFechaCorta(d.agregadoTs)}</td>
                <td style="white-space:nowrap"><button class="btn btn-primary btn-xs" data-guardar-dif="${d.id}" title="Guardar el TK / producto / cliente que cargaste">💾</button> <button class="btn btn-secondary btn-xs" data-informe-dif="${d.id}" title="Generar informe (PDF) para firma del depositario">📄</button> <button class="btn btn-danger btn-xs" data-resolver-dif="${d.id}" title="Marcar resuelto: desaparece de la lista y no se incluye en próximos mails">✓ Resuelto</button> <button class="btn btn-secondary btn-xs" data-borrar-dif="${d.id}" title="Borrar (cargado por error)">✕</button></td>
            </tr>`;
        }).join("");
        // Guardado de los campos editables (TK / Producto / Cliente):
        // por botón "💾 Guardar" (con confirmación) o automático al salir del campo.
        tbody.querySelectorAll("tr[data-dif-id]").forEach(tr => {
            const id = tr.dataset.difId;
            const guardarFila = (avisar) => {
                const d = diferencias.find(x => x.id === id && !x.eliminada);
                if (!d) return;
                const nt = (tr.querySelector('[data-f="tanque"]').value || "").trim();
                const np = (tr.querySelector('[data-f="producto"]').value || "").trim();
                const nc = (tr.querySelector('[data-f="cliente"]').value || "").trim();
                if ((d.tanque || "") === nt && (d.producto || "") === np && (d.cliente || "") === nc) {
                    if (avisar) mostrarAlerta(`No hay cambios para guardar en ${d.despacho}.`, "info");
                    return;
                }
                d.tanque = nt; d.producto = np; d.cliente = nc;
                d.ts = new Date().toISOString();
                guardarDatos();
                if (avisar) mostrarAlerta(`✓ TK / producto / cliente del despacho ${d.despacho} guardados.`, "info");
            };
            const btnG = tr.querySelector("[data-guardar-dif]");
            if (btnG) btnG.addEventListener("click", () => guardarFila(true));
            tr.querySelectorAll("input.dif-edit").forEach(inp => {
                inp.addEventListener("blur", () => guardarFila(false));
                inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); guardarFila(true); inp.blur(); } });
            });
        });
        tbody.querySelectorAll("[data-informe-dif]").forEach(b => {
            b.addEventListener("click", () => imprimirInformeDiferencia(b.dataset.informeDif));
        });
        tbody.querySelectorAll("[data-resolver-dif]").forEach(b => {
            b.addEventListener("click", () => resolverDiferencia(b.dataset.resolverDif));
        });
        tbody.querySelectorAll("[data-borrar-dif]").forEach(b => {
            b.addEventListener("click", () => borrarDiferencia(b.dataset.borrarDif));
        });
        actualizarBadgeDiferencias();
    }

    function agregarDiferencia() {
        const inpD = document.getElementById("difDespacho");
        const inpS = document.getElementById("difKgStock");
        const inpM = document.getElementById("difKgSim");
        const despacho = (inpD.value || "").trim().toUpperCase();
        if (!despacho) { mostrarModalInfo("Falta el despacho.", "No se puede agregar"); inpD.focus(); return; }
        const kgStock = sbfaParseKg(inpS.value) || 0;
        const kgSim = sbfaParseKg(inpM.value) || 0;
        const tp = infoSistemaDeDespacho(despacho);
        const ts = new Date().toISOString();
        diferencias.push({
            id: "dif-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
            despacho,
            tanque: tp.tanque,
            producto: tp.producto,
            cliente: tp.cliente,
            kgStock,
            kgSim,
            dif: kgSim - kgStock,
            estado: "pendiente",
            nota: "",
            agregadoPor: usuarioActual,
            agregadoTs: ts,
            resueltoPor: null,
            resueltoTs: null,
            eliminada: false,
            ts,
        });
        guardarDatos();
        inpD.value = ""; inpS.value = ""; inpM.value = "";
        inpD.focus();
        renderDiferencias();
        mostrarAlerta(`Despacho ${despacho} agregado a la lista de diferencias.`, "info");
    }

    function resolverDiferencia(id) {
        const d = diferencias.find(x => x.id === id && !x.eliminada);
        if (!d) return;
        if (!confirm(`¿El despacho ${d.despacho} quedó resuelto?\n\nVa a desaparecer de la lista y no se incluirá en los próximos mails.`)) return;
        d.estado = "resuelto";
        d.resueltoPor = usuarioActual;
        d.resueltoTs = new Date().toISOString();
        d.ts = d.resueltoTs;
        guardarDatos();
        renderDiferencias();
        mostrarAlerta(`Despacho ${d.despacho} resuelto — sale de la lista.`, "info");
    }

    function borrarDiferencia(id) {
        const d = diferencias.find(x => x.id === id && !x.eliminada);
        if (!d) return;
        if (!confirm(`¿Borrar el registro del despacho ${d.despacho}? (usá esto si lo cargaste por error)`)) return;
        d.eliminada = true;
        d.ts = new Date().toISOString();
        guardarDatos();
        renderDiferencias();
    }

    function imprimirInformeDiferencia(id) {
        const d = diferencias.find(x => x.id === id && !x.eliminada);
        if (!d) return;
        // TK/producto/cliente: lo guardado o lo que esté en stock ahora
        const live = infoSistemaDeDespacho(d.despacho);
        const tk = d.tanque || live.tanque || "—";
        const prod = d.producto || live.producto || "";
        const cli = d.cliente || live.cliente || "";
        const dif = (Number(d.kgSim) || 0) - (Number(d.kgStock) || 0);
        const hoy = new Date();
        const fechaTxt = hoy.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
        const productoCliente = [prod, cli].filter(Boolean).join(" — ");
        const detalleProdCli = productoCliente ? ` (${_escHtml(productoCliente)})` : "";

        const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Informe de diferencia — ${_escHtml(d.despacho)}</title>
<style>
@page { size: A4; margin: 2.5cm; }
* { box-sizing: border-box; }
body { font-family: Georgia, "Times New Roman", serif; color: #111; font-size: 12pt; line-height: 1.55; margin: 0; }
header { text-align: center; border-bottom: 2px solid #1a56db; padding-bottom: 14px; margin-bottom: 28px; }
header h1 { margin: 0; font-size: 16pt; color: #1a56db; }
header .sub { font-size: 11pt; color: #555; margin-top: 4px; }
.lugar-fecha { text-align: right; margin: 26px 0 24px; font-style: italic; }
h2 { font-size: 14pt; text-align: center; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 22px; }
p { text-align: justify; margin: 0 0 14px; }
table.detalle { border-collapse: collapse; margin: 18px auto; min-width: 70%; }
table.detalle td { padding: 9px 18px; border: 1px solid #c9c9c9; }
table.detalle td:first-child { background: #f5f7fa; font-weight: 600; }
table.detalle td:last-child { text-align: right; font-variant-numeric: tabular-nums; min-width: 130px; }
.firma { margin-top: 90px; display: flex; justify-content: center; }
.firma-box { text-align: center; width: 62%; }
.firma-linea { border-top: 1px solid #111; padding-top: 6px; font-size: 11pt; color: #444; }
.pie { margin-top: 60px; font-size: 9pt; color: #888; text-align: center; }
.no-print { text-align: center; padding: 18px; background: #eef4ff; border-bottom: 1px solid #cdddef; }
.no-print button { padding: 10px 22px; font-size: 14px; background: #1a56db; color: white; border: none; border-radius: 6px; cursor: pointer; font-family: sans-serif; }
.no-print button:hover { background: #1244b0; }
@media print { .no-print { display: none; } body { margin: 0; } }
</style>
</head><body>
<div class="no-print">
  <button onclick="window.print()">🖨 Imprimir / Guardar como PDF</button>
</div>
<header>
  <h1>Odfjell Terminals Tagsa SA</h1>
  <div class="sub">Terminal Campana — Provincia de Buenos Aires</div>
</header>
<div class="lugar-fecha">Campana, ${fechaTxt}.</div>
<h2>Informe de diferencia de stock</h2>
<p>Por el presente se informa que, respecto del <strong>Tanque ${_escHtml(tk)}</strong> y el despacho <strong>${_escHtml(d.despacho)}</strong>${detalleProdCli}, se constatan las siguientes cantidades:</p>
<table class="detalle">
  <tr><td>Kilos por stock físico (en tanque)</td><td>${_fmtNumDif(d.kgStock)} kg</td></tr>
  <tr><td>Kilos por stock documental (sistema SIM)</td><td>${_fmtNumDif(d.kgSim)} kg</td></tr>
  <tr><td>Diferencia</td><td><strong>${dif >= 0 ? "+" : ""}${_fmtNumDif(dif)} kg</strong></td></tr>
</table>
<p>Dichas diferencias se corresponden tanto a las <strong>tolerancias propias de la medición inicial</strong> como a la <strong>merma natural del producto</strong> durante su almacenamiento.</p>
<p>A los efectos correspondientes, se solicita la firma del depositario al pie del presente informe.</p>
<div class="firma"><div class="firma-box"><div class="firma-linea">Firma y aclaración del depositario</div></div></div>
<div class="pie">Documento generado por el sistema de Control de Stock de Odfjell Terminals Tagsa SA.</div>
</body></html>`;

        const win = window.open("", "_blank");
        if (!win) { mostrarAlerta("Habilitá las ventanas emergentes para generar el informe.", "error"); return; }
        win.document.write(html);
        win.document.close();
        // pequeña pausa para que cargue el HTML antes de abrir el diálogo de impresión
        setTimeout(() => { try { win.focus(); win.print(); } catch (_) {} }, 200);
    }

    function enviarMailDiferencias() {
        const inp = document.getElementById("difMail");
        const estado = document.getElementById("difMailEstado");
        const setEstado = (txt, color) => { if (estado) { estado.textContent = txt; estado.style.color = color || "var(--gray-500)"; } };
        const mails = (inp.value || "").trim();
        if (!mails) { mostrarModalInfo("Cargá al menos un mail destinatario.", "Falta destinatario"); inp.focus(); return; }
        const lista = mails.split(",").map(m => m.trim()).filter(Boolean);
        const invalido = lista.find(m => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m));
        if (invalido) { mostrarModalInfo(`Mail inválido: "${invalido}"`, "Error"); return; }
        const n = diferenciasActivas().length;
        if (n === 0) { mostrarModalInfo("No hay despachos con diferencia pendientes para enviar.", "Nada para enviar"); return; }
        mostrarModalConfirm(
            `Enviar el listado de ${n} despacho(s) con diferencia a:\n\n${lista.join("\n")}`,
            "Confirmar envío",
            async () => {
                setEstado("Disparando workflow…", "var(--gray-500)");
                try {
                    const res = await GH._ghDispatch("reporte-diferencias.yml", "master", { destinatarios: lista.join(",") });
                    if (!res.ok) throw new Error(`proxy ${res.status}${res.detalle || ""}`);
                    setEstado(`✓ Mail con ${n} despacho(s) disparado a ${lista.length} destinatario(s). Llega en ~30 segundos.`, "#16a34a");
                } catch (e) {
                    setEstado(`Error: ${e.message}`, "#b91c1c");
                }
            }
        );
    }

    (function wireDiferencias() {
        const btn = document.getElementById("btnDifAgregar");
        if (btn) btn.addEventListener("click", agregarDiferencia);
        const inpD = document.getElementById("difDespacho");
        if (inpD) inpD.addEventListener("keydown", e => { if (e.key === "Enter") agregarDiferencia(); });
        ["difKgStock", "difKgSim"].forEach(idInp => {
            const inp = document.getElementById(idInp);
            if (!inp) return;
            inp.addEventListener("keydown", sbfaBloquearDecimales);
            inp.addEventListener("input", () => sbfaFormatearInputKg(inp));
            inp.addEventListener("keydown", e => { if (e.key === "Enter") agregarDiferencia(); });
        });
        const btnMail = document.getElementById("btnDifMail");
        if (btnMail) btnMail.addEventListener("click", enviarMailDiferencias);
        const inpMail = document.getElementById("difMail");
        if (inpMail) inpMail.addEventListener("keydown", e => { if (e.key === "Enter") enviarMailDiferencias(); });
        renderDiferencias();
    })();

    // --- PRECINTOS USADOS (salidas TR06) ---
    function precintosUsados() {
        return historial.filter(h => (h.tipo || "SALIDA") === "SALIDA" && h.precinto);
    }
    function _conteoPrecintos() {
        const c = {};
        precintosUsados().forEach(h => { const p = String(h.precinto).trim(); c[p] = (c[p] || 0) + 1; });
        return c;
    }
    function _ordenarPrecintos(arr) {
        return arr.slice().sort((a, b) => {
            const c = String(a.precinto).localeCompare(String(b.precinto), undefined, { numeric: true });
            return c !== 0 ? c : (`${a.fecha || ""} ${a.hora || ""}`).localeCompare(`${b.fecha || ""} ${b.hora || ""}`);
        });
    }

    function renderPrecintos(filtro) {
        const tbody = document.querySelector("#tablaPrecintos tbody");
        if (!tbody) return;
        const f = (filtro || "").trim().toLowerCase();
        const conteo = _conteoPrecintos();
        let usos = precintosUsados();
        if (f) usos = usos.filter(h => `${h.precinto} ${h.despacho || ""} ${h.tanque || ""} ${h.producto || ""} ${h.cliente || ""} ${h.remito || ""} ${h.usuario || ""}`.toLowerCase().includes(f));
        usos = _ordenarPrecintos(usos);

        const resumen = document.getElementById("precintosResumen");
        if (resumen) {
            const totalUsos = precintosUsados().length;
            const distintos = Object.keys(conteo).length;
            const repetidos = Object.values(conteo).filter(n => n > 1).length;
            resumen.textContent = `${totalUsos} uso(s) de precinto · ${distintos} precinto(s) distinto(s)`
                + (repetidos ? ` · ${repetidos} usado(s) en más de un TR06` : "")
                + (f ? ` — mostrando ${usos.length}` : "");
        }
        if (usos.length === 0) {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="10">${f ? "Ningún precinto coincide con la búsqueda." : "No hay precintos registrados todavía. Se cargan al registrar una salida cuyo despacho sea TR06 o TRM6."}</td></tr>`;
            return;
        }
        tbody.innerHTML = usos.map(h => {
            const p = String(h.precinto).trim();
            const rep = (conteo[p] || 0) > 1;
            return `<tr${rep ? ' style="background:#fffbeb"' : ''}>
                <td><strong>${_escHtml(p)}</strong>${rep ? ` <span style="color:#92400e;font-size:0.75rem;white-space:nowrap">(×${conteo[p]})</span>` : ""}</td>
                <td><code>${_escHtml(h.despacho || "")}</code></td>
                <td>${_escHtml(h.tanque || "")}</td>
                <td>${_escHtml(h.producto || "")}</td>
                <td>${_escHtml(h.cliente || "")}</td>
                <td style="white-space:nowrap">${_escHtml(h.fecha || "")}</td>
                <td>${_escHtml(h.hora || "")}</td>
                <td>${_escHtml(h.remito || "")}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums">${formatKg(h.kilos || 0)}</td>
                <td>${_escHtml(h.usuario || "")}</td>
            </tr>`;
        }).join("");
    }

    function imprimirPrecintos() {
        const usos = _ordenarPrecintos(precintosUsados());
        const conteo = _conteoPrecintos();
        const filas = usos.map(h => {
            const p = String(h.precinto).trim();
            const rep = (conteo[p] || 0) > 1;
            return `<tr${rep ? ' style="background:#fff3cd"' : ''}><td>${_escHtml(p)}${rep ? ` (×${conteo[p]})` : ""}</td><td>${_escHtml(h.despacho || "")}</td><td>${_escHtml(h.tanque || "")}</td><td>${_escHtml(h.producto || "")}</td><td>${_escHtml(h.cliente || "")}</td><td>${_escHtml(h.fecha || "")}</td><td>${_escHtml(h.hora || "")}</td><td>${_escHtml(h.remito || "")}</td><td style="text-align:right">${formatKg(h.kilos || 0)}</td><td>${_escHtml(h.usuario || "")}</td></tr>`;
        }).join("");
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Precintos usados</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;padding:20px;color:#111} h1{font-size:16px;margin:0 0 4px} .sub{color:#666;margin:0 0 14px;font-size:11px} table{border-collapse:collapse;width:100%} th,td{border:1px solid #999;padding:4px 8px;text-align:left} th{background:#eee} .total{margin-top:12px;font-weight:700}</style>
</head><body>
<h1>Precintos usados — Odfjell Terminals Tagsa SA — Campana</h1>
<p class="sub">Salidas TR06 / TRM6 · ${new Date().toLocaleString("es-AR")}</p>
<table><thead><tr><th>Precinto N°</th><th>Despacho</th><th>TK</th><th>Producto</th><th>Cliente</th><th>Fecha</th><th>Hora</th><th>Remito</th><th>Kg.</th><th>Usuario</th></tr></thead><tbody>${filas || '<tr><td colspan="10">Sin precintos registrados.</td></tr>'}</tbody></table>
<div class="total">Total: ${usos.length} uso(s) de precinto · ${Object.keys(conteo).length} precinto(s) distinto(s).</div>
</body></html>`;
        const win = window.open("", "_blank");
        if (!win) { mostrarAlerta("Habilitá las ventanas emergentes para imprimir.", "error"); return; }
        win.document.write(html);
        win.document.close();
        win.print();
    }

    (function wirePrecintos() {
        const inp = document.getElementById("filtroPrecintos");
        if (inp) inp.addEventListener("input", e => renderPrecintos(e.target.value));
        const btn = document.getElementById("btnImprimirPrecintos");
        if (btn) btn.addEventListener("click", imprimirPrecintos);
        renderPrecintos("");
    })();

    // --- REPORTE PARA SUPERVISORES ---
    let _repSupInicializado = false;
    function inicializarReporteSupervisor() {
        if (_repSupInicializado) return;
        _repSupInicializado = true;
        const inpFecha = document.getElementById("repSupFecha");
        if (inpFecha && !inpFecha.value) inpFecha.value = new Date().toISOString().slice(0, 10);
        document.getElementById("btnRepSupVista").addEventListener("click", repSupVistaPrevia);
        document.getElementById("btnRepSupEnviar").addEventListener("click", repSupEnviar);
    }

    function repSupFechaISO() {
        return document.getElementById("repSupFecha")?.value || new Date().toISOString().slice(0, 10);
    }
    function repSupFechaDDMMYYYY() {
        const iso = repSupFechaISO();
        const [y, m, d] = iso.split("-");
        return `${d}/${m}/${y}`;
    }

    // Devuelve un map { nombreBuque -> { nombre, imo, descargas[] } } con todas
    // las descargas SB/FA cuya fecha coincide con fechaIso.
    function repSupBuquesDeFecha(fechaIso) {
        const buques = {};
        for (const d of (sbfaConfig.descargas || [])) {
            if (d.anulada) continue;
            if (d.fecha !== fechaIso) continue;
            const nombre = (d.buque || "(sin buque)").trim();
            const key = nombre.toUpperCase();
            if (!buques[key]) {
                // Buscar IMO en barcosConfig por si está cargado
                const cfg = (barcosConfig.barcos || []).find(b =>
                    (b.nombre || "").toUpperCase() === key
                );
                buques[key] = { nombre, imo: cfg?.imo || null, descargas: [] };
            }
            buques[key].descargas.push(d);
        }
        return Object.values(buques);
    }

    function repSupArmarHTML() {
        const isoHoy = repSupFechaISO();
        const fechaHoy = repSupFechaDDMMYYYY();
        const fmt = n => (n === null || n === undefined || isNaN(n)) ? "" : Math.round(Number(n)).toLocaleString("es-AR");
        const fmtPct = p => (p === null || p === undefined || isNaN(p)) ? "" : (p.toFixed(2).replace(".", ",") + "%");

        const buques = repSupBuquesDeFecha(isoHoy);
        let bloquesBarcos = "";
        if (!buques.length) {
            bloquesBarcos = `<p style="color:#6b7280;font-style:italic">Sin descargas registradas en la fecha del reporte.</p>`;
        } else {
            for (const b of buques) {
                for (const d of b.descargas) {
                    const filas = (d.filas || []).filter(f => Object.values(f || {}).some(v => v !== "" && v !== null && v !== undefined));
                    const dap = (d.dap || []).filter(x => Object.values(x || {}).some(v => v !== "" && v !== null && v !== undefined));
                    // Estilo de celda con color negro forzado para que clientes de mail
                    // (Gmail, Outlook) no autolinkeen los números de Cto. en azul.
                    const tdStyle = "padding:4px 6px;border:1px solid #d1d5db;color:#111";
                    const tdR = `${tdStyle};text-align:right`;
                    // Envolver en <a> sin href + estilos forzados evita que Gmail/Outlook
                    // autolinkeen el contenido en azul subrayado.
                    const noLink = (txt) => `<a style="color:#111 !important;text-decoration:none !important;cursor:default;pointer-events:none" tabindex="-1">${txt || ""}</a>`;
                    const rowsPart = filas.map(f => {
                        const decl = Number(f.kgDeclarados) || 0;
                        return `<tr>
                            <td style="${tdStyle}">${noLink(f.solPart)}</td>
                            <td style="${tdStyle}">${noLink(f.cto)}</td>
                            <td style="${tdStyle}">${noLink(f.mercaderia)}</td>
                            <td style="${tdStyle}">${noLink(f.receptor)}</td>
                            <td style="${tdR}">${fmt(decl)}</td>
                            <td style="${tdStyle}">${noLink(f.tkDestino)}</td>
                        </tr>`;
                    }).join("");
                    const tablaPart = filas.length ? `
                        <h4 style="margin:0.8rem 0 0.3rem 0;font-size:13px;color:#111">Conocimientos por Solicitud Particular (${filas.length})</h4>
                        <div class="rep-tabla-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%">
                        <table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #d1d5db">
                            <thead style="background:#e5e7eb"><tr>
                                <th style="${tdStyle};text-align:left">Part. N°</th>
                                <th style="${tdStyle};text-align:left">Cto. N°</th>
                                <th style="${tdStyle};text-align:left">Producto</th>
                                <th style="${tdStyle};text-align:left">Empresa</th>
                                <th style="${tdR}">Kg.</th>
                                <th style="${tdStyle};text-align:left">Tk.</th>
                            </tr></thead>
                            <tbody>${rowsPart}</tbody>
                        </table>
                        </div>` : `<p style='color:#6b7280;font-style:italic'>Sin solicitudes particulares cargadas.</p>`;

                    const rowsDap = dap.map(x => {
                        const docKg = Number(x.cantDoctada) || 0;
                        return `<tr>
                            <td style="${tdStyle}">${noLink(x.documento)}</td>
                            <td style="${tdStyle}">${noLink(x.cto)}</td>
                            <td style="${tdR}">${fmt(docKg)}</td>
                        </tr>`;
                    }).join("");
                    const tablaDap = dap.length ? `
                        <h4 style="margin:0.8rem 0 0.3rem 0;font-size:13px;color:#111">Conocimientos DAP (${dap.length})</h4>
                        <div class="rep-tabla-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%">
                        <table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #d1d5db">
                            <thead style="background:#e5e7eb"><tr>
                                <th style="${tdStyle};text-align:left">Documento Aduanero</th>
                                <th style="${tdStyle};text-align:left">Cto. N°</th>
                                <th style="${tdR}">Cant. Doctada</th>
                            </tr></thead>
                            <tbody>${rowsDap}</tbody>
                        </table>
                        </div>` : "";

                    const imoTxt = b.imo ? `IMO ${b.imo}` : "";
                    bloquesBarcos += `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:1rem;margin-bottom:1rem;background:#fafafa">
                        <h3 style="color:#1e3a8a;margin:0 0 0.3rem 0">${b.nombre} — MANI ${d.manifiesto || "(pendiente)"}</h3>
                        ${imoTxt ? `<p style="color:#6b7280;font-size:12px;margin:0 0 0.6rem 0">${imoTxt}</p>` : ""}
                        ${tablaPart}
                        ${tablaDap}
                    </div>`;
                }
            }
        }

        // Plan del día (estructura: planes[fechaISO].filas[])
        const planDia = filasVisiblesPlan(typeof planes !== "undefined" && planes && planes[isoHoy]);
        let planHtml;
        if (!planDia.length) {
            planHtml = `<p style="color:#6b7280;font-style:italic">Sin plan de cargas para hoy.</p>`;
        } else {
            const cump = planDia.filter(c => c.cumplido).length;
            const pend = planDia.length - cump;
            const rows = planDia.map(c => {
                const cumplido = !!c.cumplido;
                const marcador = cumplido ? "✓" : "⏳";
                const color = cumplido ? "color:#16a34a" : "color:#d97706";
                return `<tr>
                    <td style="padding:4px 6px;border:1px solid #d1d5db;text-align:center;${color};font-weight:bold">${marcador}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db">${c.tanque || ""}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db">${c.producto || ""}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db">${c.cliente || ""}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db">${c.buque || ""}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db">${c.despacho || ""}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db">${c.horaCarga || ""}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db">${c.observaciones || ""}</td>
                </tr>`;
            }).join("");
            planHtml = `<p style="margin:0.3rem 0">Total: <strong>${planDia.length}</strong> cargas · Cumplidas: <strong style="color:#16a34a">${cump}</strong> · Pendientes: <strong style="color:#d97706">${pend}</strong></p>
                <div class="rep-tabla-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%">
                <table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #d1d5db">
                    <thead style="background:#e5e7eb"><tr>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;width:30px"></th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Tk.</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Producto</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Cliente</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Buque</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Despacho</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Hora</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Obs.</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                </div>`;
        }

        return `<div style="font-family:Arial,sans-serif;font-size:13px;color:#111">
            <div style="border-bottom:3px solid #1e3a8a;padding-bottom:0.5rem;margin-bottom:1rem">
                <h2 style="color:#1e3a8a;margin:0;font-size:18px">Reporte para Supervisores — Operaciones del día</h2>
                <p style="margin:0.3rem 0 0 0;color:#6b7280;font-size:12px">Odfjell Terminals Tagsa SA — Campana · ${fechaHoy}</p>
            </div>
            <h3 style="color:#1e3a8a;font-size:15px;margin:1rem 0 0.5rem 0">🚢 Barcos con descarga (${buques.length})</h3>
            ${bloquesBarcos}
            <h3 style="color:#1e3a8a;font-size:15px;margin:2rem 0 0.5rem 0">🚛 Plan de Cargas</h3>
            ${planHtml}
        </div>`;
    }

    function repSupVistaPrevia() {
        const cont = document.getElementById("repSupVistaPrevia");
        cont.innerHTML = repSupArmarHTML();
        cont.style.display = "block";
    }

    function repSupEnviar() {
        const inp = document.getElementById("repSupMail");
        const estado = document.getElementById("repSupEstado");
        const mails = inp.value.trim();
        if (!mails) { mostrarModalInfo("Cargá al menos un mail destinatario.", "Falta destinatario"); inp.focus(); return; }
        const lista = mails.split(",").map(m => m.trim()).filter(Boolean);
        const invalido = lista.find(m => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m));
        if (invalido) { mostrarModalInfo(`Mail inválido: "${invalido}"`, "Error"); return; }

        const fecha = repSupFechaDDMMYYYY();
        const msg = `Enviar reporte del ${fecha} a ${lista.length} destinatario(s):\n\n${lista.join("\n")}`;

        mostrarModalConfirm(msg, "Confirmar envío", async () => {
            estado.style.color = "var(--gray-500)";
            estado.textContent = "Disparando workflow…";
            try {
                const res = await GH._ghDispatch("reporte-supervisor.yml", "master", {
                    destinatarios: lista.join(","),
                    fecha: repSupFechaISO(),
                });
                if (!res.ok) throw new Error(`proxy ${res.status}${res.detalle || ""}`);
                estado.style.color = "#16a34a";
                estado.innerHTML = `✓ Reporte del ${fecha} disparado. Se envía a ${lista.length} destinatario(s) en ~30 segundos. <a href="https://github.com/${GH.repo}/actions/workflows/reporte-supervisor.yml" target="_blank" rel="noopener">Ver progreso ↗</a>`;
            } catch (e) {
                estado.style.color = "#b91c1c";
                estado.textContent = `Error: ${e.message}`;
            }
        });
    }

    // --- REPORTE STOCK MENSUAL ---
    // Lee la fecha+hora del filtro de corte. Devuelve null si no hay fecha
    // (== usar el stock actual).
    function getCorteRepMen() {
        const f = document.getElementById("repMenFecha")?.value;
        if (!f) return null;
        const h = document.getElementById("repMenHora")?.value || "19:00";
        const ms = new Date(`${f}T${h}:00`).getTime();
        return isNaN(ms) ? null : ms;
    }

    // Reconstruye el stock al momento del corte revirtiendo todos los
    // movimientos del historial con fecha+hora posterior. No considera
    // renombramientos (esos no quedan en el historial), así que despachos
    // renombrados después del corte aparecerán con su nombre actual.
    function reconstruirStockAlCorte(corteMs) {
        const clon = JSON.parse(JSON.stringify(stock));
        if (!corteMs) return clon;
        const posteriores = (historial || []).filter(h => {
            const dt = new Date(`${h.fecha}T${h.hora || "00:00"}:00`).getTime();
            return dt > corteMs;
        });
        for (const h of posteriores) {
            const tipo = h.tipo || "SALIDA";
            if (tipo === "SALIDA") {
                const tk = clon.find(t => t.tanque === h.tanque);
                if (!tk) continue;
                const dp = tk.despachos.find(x => x.despacho === h.despacho);
                if (dp) dp.stock += h.kilos;
            } else if (tipo === "INGRESO") {
                const tk = clon.find(t => t.tanque === h.tanque);
                if (!tk) continue;
                const dp = tk.despachos.find(x => x.despacho === h.despacho);
                if (dp) dp.stock -= h.kilos;
            } else if (tipo === "TRANSFERENCIA") {
                const partes = String(h.tanque || "").split("→");
                if (partes.length !== 2) continue;
                const [oN, dN] = partes;
                const o = clon.find(t => t.tanque === oN);
                if (o) { const dp = o.despachos.find(x => x.despacho === h.despacho); if (dp) dp.stock += h.kilos; }
                const dst = clon.find(t => t.tanque === dN);
                if (dst) { const dp = dst.despachos.find(x => x.despacho === h.despacho); if (dp) dp.stock -= h.kilos; }
            }
        }
        return clon;
    }

    // Devuelve un array con TODOS los tanques fiscales en orden, completando
    // con un objeto vacío los que no aparecen en stockBase (para que el reporte
    // muestre los tanques fiscales sin movimientos).
    function expandirFiscales(stockBase) {
        const porId = new Map(stockBase.map(t => [t.tanque, t]));
        return tanquesFiscales.map(id =>
            porId.get(id) || { tanque: id, producto: "", cliente: "", despachos: [] }
        );
    }

    function renderRepMensual(filtro = "") {
        const container = document.getElementById("repMensualCards");
        const filtroLower = filtro.toLowerCase();
        const corte = getCorteRepMen();
        const stockBase = corte ? reconstruirStockAlCorte(corte) : stock;
        const completo = expandirFiscales(stockBase);

        const filtrados = completo.filter(t => {
            if (!filtro) return true;
            return t.tanque.includes(filtroLower) ||
                   (t.producto || "").toLowerCase().includes(filtroLower) ||
                   (t.cliente || "").toLowerCase().includes(filtroLower);
        });

        let totalKg = 0;
        let totalDesp = 0;

        container.innerHTML = filtrados.map(t => {
            const totalTanque = t.despachos.reduce((s, d) => s + d.stock, 0);
            totalKg += totalTanque;
            const despActivos = t.despachos.filter(d => d.stock > 0);
            totalDesp += despActivos.length;

            const despHTML = t.despachos.map(d => {
                if (d.stock <= 0) return "";
                const clienteDesp = d.cliente || t.cliente;
                return `<div class="despacho-row">
                    <span class="despacho-nombre">${d.despacho}</span>
                    <span style="color:var(--gray-500);font-size:0.8rem">${clienteDesp}</span>
                    <span class="despacho-kg">${formatKg(d.stock)} kg</span>
                </div>`;
            }).join("");

            const cap = capacidadTanques[t.tanque] || 0;
            let pct = cap > 0 ? Math.min(Math.round((totalTanque / cap) * 100), 100) : 0;
            if (pct < 0) pct = 0;
            const nivelColor = pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e";
            const nivelHTML = cap > 0 ? `<div class="tanque-nivel-wrap">
                <div class="tanque-nivel-grafico">
                    <div class="tanque-nivel-agua" style="height:${pct}%;background:${nivelColor}"></div>
                    <span class="tanque-nivel-pct">${pct}%</span>
                </div>
                <div class="tanque-nivel-info">
                    <div><span class="info-label">Stock</span><br><strong>${formatKg(totalTanque)} kg</strong></div>
                    <div><span class="info-label">Capacidad (98%)</span><br><strong>${formatKg(cap)} L</strong></div>
                    <div><span class="info-label">Ocupación</span><br><strong style="color:${nivelColor}">${pct}%</strong></div>
                </div>
            </div>` : "";

            const vacio = totalTanque <= 0;
            const productoMostrar = t.producto || (vacio ? "<em style='color:var(--gray-500)'>Tanque vacío</em>" : "");
            const clienteMostrar = t.cliente || "";
            const renpqRm = t.producto ? getRenpqInfo(t.producto) : null;
            const renpqBadgeRm = renpqRm
                ? ` <span class="renpq-badge" title="Precursor químico — RENPQ Lista ${renpqRm.lista}">⚠ RNPQ ${renpqRm.lista}</span>`
                : "";
            const rmCls = renpqRm ? " renpq" : "";
            return `<div class="stock-card rep-mensual-card${vacio ? ' rep-mensual-vacio' : ''}${rmCls}" onclick="this.classList.toggle('open')">
                <div class="stock-card-header">
                    <div class="stock-card-left">
                        <span class="stock-card-tanque">TK ${t.tanque}</span>
                        <div>
                            <div class="stock-card-producto">${productoMostrar}${renpqBadgeRm}</div>
                            <div class="stock-card-cliente">${clienteMostrar}</div>
                        </div>
                    </div>
                    <div style="text-align:right">
                        <span class="stock-card-total">${formatKg(totalTanque)} kg</span>
                        ${cap > 0 ? `<div style="font-size:0.75rem;color:${nivelColor};font-weight:600">${pct}%</div>` : ""}
                    </div>
                </div>
                <div class="stock-card-despachos">${nivelHTML}${despHTML}</div>
            </div>`;
        }).join("");

        document.getElementById("repMenTanques").textContent = filtrados.filter(t => t.despachos.reduce((s, d) => s + d.stock, 0) > 0).length;
        document.getElementById("repMenDespachos").textContent = totalDesp;
        document.getElementById("repMenKilos").textContent = formatKg(totalKg);
    }

    const _filtroRepMen = document.getElementById("filtroRepMensual");
    _filtroRepMen.addEventListener("input", (e) => renderRepMensual(e.target.value));
    document.getElementById("repMenFecha").addEventListener("change", () => renderRepMensual(_filtroRepMen.value));
    document.getElementById("repMenHora").addEventListener("change", () => renderRepMensual(_filtroRepMen.value));
    document.getElementById("btnRepMenAhora").addEventListener("click", () => {
        document.getElementById("repMenFecha").value = "";
        renderRepMensual(_filtroRepMen.value);
    });

    // --- IMPRIMIR STOCK MENSUAL ---
    document.getElementById("btnImprimirMensual").addEventListener("click", () => {
        const corte = getCorteRepMen();
        const stockBase = corte ? reconstruirStockAlCorte(corte) : stock;
        const filtrados = expandirFiscales(stockBase);

        let totalKg = 0;
        const filas = filtrados.map(t => {
            const totalTanque = t.despachos.reduce((s, d) => s + d.stock, 0);
            totalKg += totalTanque;
            const cap = capacidadTanques[t.tanque] || 0;
            let pct = cap > 0 ? Math.min(Math.round((totalTanque / cap) * 100), 100) : 0;
            if (pct < 0) pct = 0;
            const nivelColor = pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e";
            const vacio = totalTanque <= 0;

            const despRows = t.despachos.filter(d => d.stock > 0).map(d => {
                const clienteDesp = d.cliente || t.cliente;
                return `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:0.8rem;color:#555">
                    <span style="font-family:monospace">${d.despacho}</span>
                    <span>${clienteDesp}</span>
                    <span style="font-weight:600">${formatKg(d.stock)} kg</span>
                </div>`;
            }).join("");

            return `<tr${vacio ? ' style="color:#999"' : ''}>
                <td style="font-weight:700;color:#1a56db">TK ${t.tanque}</td>
                <td>${t.producto || (vacio ? "<em>Tanque vacío</em>" : "")}</td>
                <td>${t.cliente || ""}</td>
                <td style="text-align:right;font-weight:600">${formatKg(totalTanque)} kg</td>
                <td style="text-align:center">
                    <div style="display:inline-block;width:40px;height:60px;border:2px solid #888;border-top:3px solid #555;border-radius:0 0 4px 4px;position:relative;background:white;overflow:hidden">
                        <div style="position:absolute;bottom:0;left:0;right:0;height:${pct}%;background:${nivelColor};opacity:0.8;border-radius:0 0 2px 2px"></div>
                        <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;z-index:1">${pct}%</span>
                    </div>
                </td>
                <td style="font-size:0.8rem">${despRows}</td>
            </tr>`;
        }).join("");

        const subtCorte = corte
            ? `Corte al ${new Date(corte).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}`
            : `Stock actual al ${new Date().toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}`;
        const html = `<!DOCTYPE html><html><head><title>Stock Mensual</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 1.5rem; }
            h2 { margin-bottom: 0.25rem; }
            p { color: #666; margin-bottom: 1rem; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #ccc; padding: 8px; font-size: 0.85rem; vertical-align: top; }
            th { background: #f0f0f0; text-align: left; }
            .total { margin-top: 1rem; font-size: 1.1rem; font-weight: bold; text-align: right; }
        </style></head><body>
        <h2>Odfjell Terminals Tagsa SA - Campana</h2>
        <p>Reporte de Stock Mensual — ${subtCorte}</p>
        <table>
            <thead><tr><th>Tanque</th><th>Producto</th><th>Cliente</th><th>Stock</th><th>Nivel</th><th>Despachos</th></tr></thead>
            <tbody>${filas}</tbody>
        </table>
        <div class="total">Total: ${formatKg(totalKg)} kg — ${filtrados.length} tanque(s)</div>
        </body></html>`;

        const win = window.open("", "_blank");
        win.document.write(html);
        win.document.close();
        win.print();
    });

    // =============================================
    // INGRESO A DEPOSITO
    // =============================================
    let ingTanqueActual = null;
    let ingEsVacio = false;

    const ingInputTanque = document.getElementById("ingInputTanque");
    const ingInfoTanque = document.getElementById("ingInfoTanque");
    const ingProductoNuevo = document.getElementById("ingProductoNuevo");
    const ingSelectProducto = document.getElementById("ingSelectProducto");
    const ingClienteNuevo = document.getElementById("ingClienteNuevo");
    const ingProductoOtro = document.getElementById("ingProductoOtro");
    const ingNuevoProducto = document.getElementById("ingNuevoProducto");
    const ingDespacho = document.getElementById("ingDespacho");
    const ingKilos = document.getElementById("ingKilos");
    const ingAlerta = document.getElementById("ingAlerta");
    const ingPaso1 = document.getElementById("ingPaso1");
    const ingPaso2 = document.getElementById("ingPaso2");

    function getProductosUnicos() {
        const set = new Set();
        stock.forEach(t => set.add(t.producto));
        return [...set].sort();
    }

    function poblarProductos() {
        ingSelectProducto.innerHTML = '<option value="">-- Seleccioná un producto --</option>';
        getProductosUnicos().forEach(p => {
            const opt = document.createElement("option");
            opt.value = p;
            opt.textContent = p;
            ingSelectProducto.appendChild(opt);
        });
        const optNuevo = document.createElement("option");
        optNuevo.value = "__NUEVO__";
        optNuevo.textContent = "+ Agregar producto nuevo";
        ingSelectProducto.appendChild(optNuevo);
    }

    function ingBuscarTanque() {
        const num = ingInputTanque.value.trim().padStart(3, "0");
        ingInputTanque.value = num;

        if (tanquesDesafectados.includes(num)) {
            ingTanqueActual = null;
            ingInfoTanque.className = "info-box not-found";
            ingInfoTanque.innerHTML = `<strong>Tanque ${num} desafectado — no operable.</strong>`;
            ingInfoTanque.classList.remove("hidden");
            ingProductoNuevo.classList.add("hidden");
            ingPaso2.className = "paso disabled";
            ingKilos.disabled = true;
            return;
        }

        const tanque = stock.find(t => t.tanque === num);
        const totalStock = tanque ? tanque.despachos.reduce((s, d) => s + d.stock, 0) : 0;

        if (tanque && totalStock > 0) {
            ingEsVacio = false;
            ingTanqueActual = tanque;
            ingInfoTanque.className = "info-box found";
            ingInfoTanque.innerHTML = `
                <div class="info-grid">
                    <div><span class="info-label">Producto</span><br><span class="info-value">${tanque.producto}</span></div>
                    <div><span class="info-label">Cliente</span><br><span class="info-value">${tanque.cliente}</span></div>
                    <div><span class="info-label">Stock Actual</span><br><span class="info-value">${formatKg(totalStock)} kg</span></div>
                </div>
            `;
            ingInfoTanque.classList.remove("hidden");
            ingProductoNuevo.classList.add("hidden");
            ingPaso1.className = "paso done";
            ingPaso2.className = "paso active";
            ingKilos.disabled = false;
            ingDespacho.focus();
        } else {
            ingEsVacio = true;
            ingTanqueActual = tanque || { tanque: num, producto: "", cliente: "", despachos: [] };
            const prodPrevio = ((tanque && tanque.producto) || "").trim();
            ingInfoTanque.className = "info-box warning-box";
            ingInfoTanque.innerHTML = prodPrevio
                ? `<strong>Tanque ${num} vacío</strong> (sin stock). Figura con producto <strong>${prodPrevio}</strong> de una carga anterior — un tanque solo puede tener <strong>un producto</strong>: asegurate de que esté realmente vacío del anterior antes de ingresar otro.`
                : `<strong>Tanque ${num} vacío.</strong> Seleccioná el producto a ingresar.`;
            ingInfoTanque.classList.remove("hidden");
            poblarProductos();
            ingProductoNuevo.classList.remove("hidden");
            ingPaso1.className = "paso active";
            ingPaso2.className = "paso disabled";
            ingKilos.disabled = true;
        }
    }

    document.getElementById("btnIngBuscar").addEventListener("click", ingBuscarTanque);
    ingInputTanque.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); ingBuscarTanque(); }
    });

    // Cuando elige producto en tanque vacío, habilitar paso 2
    ingSelectProducto.addEventListener("change", function() {
        if (this.value === "__NUEVO__") {
            ingProductoOtro.classList.remove("hidden");
        }
        actualizarHabilitacionIngPaso2();
    });

    ingClienteNuevo.addEventListener("input", actualizarHabilitacionIngPaso2);
    ingNuevoProducto.addEventListener("input", actualizarHabilitacionIngPaso2);

    // Enter en cliente / nombre de producto nuevo → mueve el foco al despacho.
    function moverFocoADespachoSiListo() {
        if (estadoIngPaso2Listo()) {
            habilitarIngPaso2();
            ingDespacho.focus();
        }
    }
    ingClienteNuevo.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); moverFocoADespachoSiListo(); }
    });
    ingNuevoProducto.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); ingClienteNuevo.focus(); }
    });

    function estadoIngPaso2Listo() {
        const prodOk = ingSelectProducto.value &&
            (ingSelectProducto.value !== "__NUEVO__" || ingNuevoProducto.value.trim());
        return prodOk && ingClienteNuevo.value.trim();
    }

    function actualizarHabilitacionIngPaso2() {
        if (estadoIngPaso2Listo()) habilitarIngPaso2();
    }

    function habilitarIngPaso2() {
        ingPaso1.className = "paso done";
        ingPaso2.className = "paso active";
        ingKilos.disabled = false;
    }

    // Validar ingreso
    ingDespacho.addEventListener("input", validarIngreso);
    ingKilos.addEventListener("input", validarIngreso);

    // Flujo de teclado: Enter en despacho → kilos; Enter en kilos → registrar.
    ingDespacho.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (ingDespacho.value.trim()) ingKilos.focus();
        }
    });
    ingKilos.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const btn = document.getElementById("btnIngRegistrar");
            if (!btn.disabled) btn.click();
        }
    });

    function validarIngreso() {
        const desp = ingDespacho.value.trim();
        const kilos = parseInt(ingKilos.value) || 0;
        document.getElementById("btnIngRegistrar").disabled = !(desp && kilos > 0);
    }

    // Registrar ingreso
    document.getElementById("btnIngRegistrar").addEventListener("click", () => {
        const desp = ingDespacho.value.trim();
        const kilos = parseInt(ingKilos.value) || 0;
        if (!desp || kilos <= 0) return;

        let producto = ingTanqueActual.producto;
        let cliente = ingTanqueActual.cliente;

        if (ingEsVacio) {
            producto = ingSelectProducto.value === "__NUEVO__" ? ingNuevoProducto.value.trim().toUpperCase() : ingSelectProducto.value;
            cliente = ingClienteNuevo.value.trim().toUpperCase();
            if (!producto || !cliente) {
                ingAlerta.textContent = "Completá producto y cliente.";
                ingAlerta.className = "alerta error";
                return;
            }
        }

        // Un tanque solo puede tener UN producto. Verificar contra lo que hay realmente
        // en stock antes de ingresar (puede haber cambiado por la sincronización).
        const tanqueEnStock = stock.find(t => t.tanque === ingTanqueActual.tanque);
        const stockActualTk = tanqueEnStock ? tanqueEnStock.despachos.reduce((s, d) => s + d.stock, 0) : 0;
        const prodIngU = (producto || "").trim().toUpperCase();
        const prodTkU = ((tanqueEnStock && tanqueEnStock.producto) || "").trim().toUpperCase();
        let avisoCambioProducto = "";
        if (prodTkU && prodTkU !== prodIngU) {
            if (stockActualTk > 0) {
                // Bloqueo: el tanque tiene stock de OTRO producto. No se puede mezclar.
                ingAlerta.textContent = `El TK ${ingTanqueActual.tanque} ya tiene ${formatKg(stockActualTk)} kg de ${tanqueEnStock.producto}. Un tanque solo puede tener un producto — no se puede ingresar ${producto}. Si el tanque se vació, volvé a buscarlo.`;
                ingAlerta.className = "alerta error";
                return;
            }
            // El tanque está vacío pero figuraba con otro producto: avisar (no bloquear).
            avisoCambioProducto = `<p style="background:#fef3c7;color:#92400e;padding:0.5rem 0.7rem;border-radius:6px;margin-top:0.5rem;font-size:0.9rem">⚠ El tanque figuraba con producto <strong>${tanqueEnStock.producto}</strong>. Lo vas a cambiar a <strong>${producto}</strong>. Un tanque solo puede tener <strong>un producto</strong> — confirmá solo si el tanque se vació del anterior.</p>`;
        }

        document.getElementById("modalTitulo").textContent = "Confirmar Ingreso";
        modalBody.innerHTML = `
            <p><strong>Tanque:</strong> TK ${ingTanqueActual.tanque}</p>
            <p><strong>Producto:</strong> ${producto}</p>
            <p><strong>Cliente:</strong> ${cliente}</p>
            <p><strong>Despacho:</strong> <code>${desp}</code></p>
            <p><strong>Kilos a ingresar:</strong> ${formatKg(kilos)} kg</p>
            <p><strong>Usuario:</strong> ${usuarioActual.toUpperCase()}</p>
            ${avisoCambioProducto}
        `;

        // Guardar callback de confirmación
        window._confirmarAccion = () => {
            let tanque = stock.find(t => t.tanque === ingTanqueActual.tanque);
            if (!tanque) {
                tanque = { tanque: ingTanqueActual.tanque, producto: producto, cliente: cliente, despachos: [] };
                stock.push(tanque);
            }
            if (ingEsVacio) {
                tanque.producto = producto;
                tanque.cliente = cliente;
            }

            const despExistente = tanque.despachos.find(d => d.despacho === desp);
            if (despExistente) {
                despExistente.stock += kilos;
            } else {
                tanque.despachos.push({ despacho: desp, stock: kilos });
            }

            const ahora = new Date();
            historial.unshift({
                id: Date.now(),
                fecha: ahora.toISOString().slice(0, 10),
                hora: ahora.toTimeString().slice(0, 5),
                tipo: "INGRESO",
                tanque: tanque.tanque,
                producto: producto,
                cliente: cliente,
                despacho: desp,
                kilos: kilos,
                usuario: usuarioActual,
            });

            guardarDatos();

            modal.classList.add("hidden");
            ingLimpiar();
            renderStock();
            renderHistorial();
            ingAlerta.textContent = `Ingreso registrado: ${formatKg(kilos)} kg al TK ${tanque.tanque} - Despacho ${desp}`;
            ingAlerta.className = "alerta success";
        };

        modal.classList.remove("hidden");
        setTimeout(() => document.getElementById("btnConfirmar").focus(), 0);
    });

    document.getElementById("btnIngLimpiar").addEventListener("click", ingLimpiar);

    function ingLimpiar() {
        ingTanqueActual = null;
        ingEsVacio = false;
        ingInputTanque.value = "";
        ingInfoTanque.classList.add("hidden");
        ingProductoNuevo.classList.add("hidden");
        ingProductoOtro.classList.add("hidden");
        ingDespacho.value = "";
        ingKilos.value = "";
        ingKilos.disabled = true;
        ingAlerta.className = "alerta hidden";
        document.getElementById("btnIngRegistrar").disabled = true;
        ingPaso1.className = "paso active";
        ingPaso2.className = "paso disabled";
        ingInputTanque.focus();
    }

    // =============================================
    // TRANSFERENCIA DE TANQUE
    // =============================================
    let trfOrigenTanque = null;
    let trfOrigenDespacho = null;

    const trfInputOrigen = document.getElementById("trfInputOrigen");
    const trfInfoOrigen = document.getElementById("trfInfoOrigen");
    const trfSelectDespacho = document.getElementById("trfSelectDespacho");
    const trfInfoDespacho = document.getElementById("trfInfoDespacho");
    const trfInputDestino = document.getElementById("trfInputDestino");
    const trfInfoDestino = document.getElementById("trfInfoDestino");
    const trfKilos = document.getElementById("trfKilos");
    const trfAlerta = document.getElementById("trfAlerta");
    const trfPaso1 = document.getElementById("trfPaso1");
    const trfPaso2 = document.getElementById("trfPaso2");
    const trfPaso3 = document.getElementById("trfPaso3");

    function trfBuscarOrigen() {
        const num = trfInputOrigen.value.trim().padStart(3, "0");
        trfInputOrigen.value = num;

        if (tanquesDesafectados.includes(num)) {
            trfInfoOrigen.className = "info-box not-found";
            trfInfoOrigen.innerHTML = `<strong>Tanque ${num} desafectado — no operable.</strong>`;
            trfInfoOrigen.classList.remove("hidden");
            trfOrigenTanque = null;
            trfPaso2.className = "paso disabled";
            trfPaso3.className = "paso disabled";
            return;
        }

        const tanque = stock.find(t => t.tanque === num);
        const totalStock = tanque ? tanque.despachos.reduce((s, d) => s + d.stock, 0) : 0;

        if (!tanque || totalStock <= 0) {
            trfInfoOrigen.className = "info-box not-found";
            trfInfoOrigen.innerHTML = `<strong>Tanque ${num} no encontrado o vacío.</strong>`;
            trfInfoOrigen.classList.remove("hidden");
            trfOrigenTanque = null;
            trfPaso2.className = "paso disabled";
            trfPaso3.className = "paso disabled";
            return;
        }

        trfOrigenTanque = tanque;
        trfInfoOrigen.className = "info-box found";
        trfInfoOrigen.innerHTML = `
            <div class="info-grid">
                <div><span class="info-label">Producto</span><br><span class="info-value">${tanque.producto}</span></div>
                <div><span class="info-label">Cliente</span><br><span class="info-value">${tanque.cliente}</span></div>
                <div><span class="info-label">Stock Total</span><br><span class="info-value">${formatKg(totalStock)} kg</span></div>
            </div>
        `;
        trfInfoOrigen.classList.remove("hidden");
        trfPaso1.className = "paso done";
        trfPaso2.className = "paso active";

        // Poblar despachos origen
        trfSelectDespacho.innerHTML = '<option value="">-- Seleccioná un despacho --</option>';
        tanque.despachos.forEach((d, i) => {
            if (d.stock <= 0) return;
            const opt = document.createElement("option");
            opt.value = i;
            opt.textContent = `${d.despacho}  —  ${formatKg(d.stock)} kg`;
            trfSelectDespacho.appendChild(opt);
        });
    }

    document.getElementById("btnTrfBuscarOrigen").addEventListener("click", trfBuscarOrigen);
    trfInputOrigen.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); trfBuscarOrigen(); }
    });

    trfSelectDespacho.addEventListener("change", () => {
        const idx = trfSelectDespacho.value;
        if (idx === "" || !trfOrigenTanque) {
            trfInfoDespacho.classList.add("hidden");
            trfPaso3.className = "paso disabled";
            trfOrigenDespacho = null;
            return;
        }

        trfOrigenDespacho = trfOrigenTanque.despachos[parseInt(idx)];
        trfInfoDespacho.className = "info-box found";
        trfInfoDespacho.innerHTML = `
            <div class="info-grid">
                <div><span class="info-label">Despacho</span><br><span class="info-value" style="font-family:monospace">${trfOrigenDespacho.despacho}</span></div>
                <div><span class="info-label">Stock Disponible</span><br><span class="info-value" style="font-size:1.3rem;color:var(--primary)">${formatKg(trfOrigenDespacho.stock)} kg</span></div>
            </div>
        `;
        trfInfoDespacho.classList.remove("hidden");
        trfPaso2.className = "paso done";
        trfPaso3.className = "paso active";
        trfInputDestino.disabled = false;
        document.getElementById("btnTrfBuscarDestino").disabled = false;
        trfKilos.disabled = false;
        trfInputDestino.focus();
    });

    let trfDestinoTanque = null;

    function trfBuscarDestino() {
        const num = trfInputDestino.value.trim().padStart(3, "0");
        trfInputDestino.value = num;

        if (num === trfOrigenTanque.tanque) {
            trfInfoDestino.className = "info-box not-found";
            trfInfoDestino.innerHTML = `<strong>El destino no puede ser igual al origen.</strong>`;
            trfInfoDestino.classList.remove("hidden");
            trfDestinoTanque = null;
            return;
        }

        if (tanquesDesafectados.includes(num)) {
            trfInfoDestino.className = "info-box not-found";
            trfInfoDestino.innerHTML = `<strong>Tanque ${num} desafectado — no operable.</strong>`;
            trfInfoDestino.classList.remove("hidden");
            trfDestinoTanque = null;
            return;
        }

        const tanque = stock.find(t => t.tanque === num);
        const totalStock = tanque ? tanque.despachos.reduce((s, d) => s + d.stock, 0) : 0;

        if (tanque && totalStock > 0 && tanque.producto !== trfOrigenTanque.producto) {
            trfInfoDestino.className = "info-box not-found";
            trfInfoDestino.innerHTML = `<strong>El tanque ${num} contiene ${tanque.producto}. No se puede mezclar con ${trfOrigenTanque.producto}.</strong>`;
            trfInfoDestino.classList.remove("hidden");
            trfDestinoTanque = null;
            return;
        }

        trfDestinoTanque = tanque || { tanque: num, producto: trfOrigenTanque.producto, cliente: trfOrigenTanque.cliente, despachos: [] };

        if (tanque && totalStock > 0) {
            trfInfoDestino.className = "info-box found";
            trfInfoDestino.innerHTML = `
                <div class="info-grid">
                    <div><span class="info-label">Producto</span><br><span class="info-value">${tanque.producto}</span></div>
                    <div><span class="info-label">Stock Actual</span><br><span class="info-value">${formatKg(totalStock)} kg</span></div>
                </div>
            `;
        } else {
            trfInfoDestino.className = "info-box warning-box";
            trfInfoDestino.innerHTML = `<strong>Tanque ${num} vacío.</strong> Recibirá ${trfOrigenTanque.producto}.`;
        }
        trfInfoDestino.classList.remove("hidden");
    }

    document.getElementById("btnTrfBuscarDestino").addEventListener("click", trfBuscarDestino);
    trfInputDestino.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); trfBuscarDestino(); }
    });

    trfKilos.addEventListener("input", () => {
        if (!trfOrigenDespacho) return;
        const kilos = parseInt(trfKilos.value) || 0;
        if (kilos > trfOrigenDespacho.stock) {
            trfAlerta.textContent = `Stock insuficiente. Disponible: ${formatKg(trfOrigenDespacho.stock)} kg.`;
            trfAlerta.className = "alerta error";
            document.getElementById("btnTrfRegistrar").disabled = true;
        } else if (kilos > 0 && trfDestinoTanque) {
            trfAlerta.className = "alerta hidden";
            document.getElementById("btnTrfRegistrar").disabled = false;
        } else {
            trfAlerta.className = "alerta hidden";
            document.getElementById("btnTrfRegistrar").disabled = true;
        }
    });

    document.getElementById("btnTrfRegistrar").addEventListener("click", () => {
        if (!trfOrigenTanque || !trfOrigenDespacho || !trfDestinoTanque) return;
        const kilos = parseInt(trfKilos.value) || 0;
        if (kilos <= 0 || kilos > trfOrigenDespacho.stock) return;

        document.getElementById("modalTitulo").textContent = "Confirmar Transferencia";
        modalBody.innerHTML = `
            <p><strong>Origen:</strong> TK ${trfOrigenTanque.tanque} (${trfOrigenTanque.producto})</p>
            <p><strong>Despacho:</strong> <code>${trfOrigenDespacho.despacho}</code></p>
            <p><strong>Destino:</strong> TK ${trfDestinoTanque.tanque}</p>
            <p><strong>Kilos a transferir:</strong> ${formatKg(kilos)} kg</p>
            <p><strong>Usuario:</strong> ${usuarioActual.toUpperCase()}</p>
        `;

        window._confirmarAccion = () => {
            // Descontar origen
            trfOrigenDespacho.stock -= kilos;

            // Agregar a destino
            let destino = stock.find(t => t.tanque === trfDestinoTanque.tanque);
            if (!destino) {
                destino = { tanque: trfDestinoTanque.tanque, producto: trfOrigenTanque.producto, cliente: trfOrigenTanque.cliente, despachos: [] };
                stock.push(destino);
            }

            const despDestino = destino.despachos.find(d => d.despacho === trfOrigenDespacho.despacho);
            if (despDestino) {
                despDestino.stock += kilos;
            } else {
                destino.despachos.push({ despacho: trfOrigenDespacho.despacho, stock: kilos });
            }

            const ahoraTrf = new Date();
            historial.unshift({
                id: Date.now(),
                fecha: ahoraTrf.toISOString().slice(0, 10),
                hora: ahoraTrf.toTimeString().slice(0, 5),
                tipo: "TRANSFERENCIA",
                tanque: `${trfOrigenTanque.tanque}→${trfDestinoTanque.tanque}`,
                producto: trfOrigenTanque.producto,
                cliente: trfOrigenTanque.cliente,
                despacho: trfOrigenDespacho.despacho,
                kilos: kilos,
                usuario: usuarioActual,
            });

            guardarDatos();

            modal.classList.add("hidden");
            trfLimpiar();
            renderStock();
            renderHistorial();
            trfAlerta.textContent = `Transferencia registrada: ${formatKg(kilos)} kg de TK ${trfOrigenTanque.tanque} a TK ${trfDestinoTanque.tanque}`;
            trfAlerta.className = "alerta success";
        };

        modal.classList.remove("hidden");
    });

    document.getElementById("btnTrfLimpiar").addEventListener("click", trfLimpiar);

    function trfLimpiar() {
        trfOrigenTanque = null;
        trfOrigenDespacho = null;
        trfDestinoTanque = null;
        trfInputOrigen.value = "";
        trfInfoOrigen.classList.add("hidden");
        trfSelectDespacho.innerHTML = '<option value="">-- Seleccioná un despacho --</option>';
        trfInfoDespacho.classList.add("hidden");
        trfInputDestino.value = "";
        trfInputDestino.disabled = true;
        document.getElementById("btnTrfBuscarDestino").disabled = true;
        trfInfoDestino.classList.add("hidden");
        trfKilos.value = "";
        trfKilos.disabled = true;
        trfAlerta.className = "alerta hidden";
        document.getElementById("btnTrfRegistrar").disabled = true;
        trfPaso1.className = "paso active";
        trfPaso2.className = "paso disabled";
        trfPaso3.className = "paso disabled";
        trfInputOrigen.focus();
    }

    // =============================================
    // MODAL GENERICO (reutilizado por salida, ingreso, transferencia)
    // =============================================
    // Sobreescribir confirmar para soportar acciones dinámicas
    document.getElementById("btnConfirmar").addEventListener("click", () => {
        if (window._confirmarAccion) {
            window._confirmarAccion();
            window._confirmarAccion = null;
        }
    });

    // --- EXPORTAR CSV ---
    document.getElementById("btnExportar").addEventListener("click", () => {
        if (historial.length === 0) { alert("No hay datos."); return; }
        const headers = ["Fecha", "Remito", "Tanque", "Producto", "Despacho", "Kilos", "Usuario"];
        const rows = historial.map(s => [s.fecha, s.remito, `TK ${s.tanque}`, s.producto, s.despacho, s.kilos, s.usuario]);
        let csv = headers.join(";") + "\n";
        rows.forEach(r => { csv += r.map(v => `"${v || ''}"`).join(";") + "\n"; });
        const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `salidas_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    });

    // --- VISTA UMA ---
    let vistasCache = JSON.parse(localStorage.getItem("vistasUma") || "[]");
    let simCache = JSON.parse(localStorage.getItem("simUma") || "{}");

    function getVistas() {
        return vistasCache;
    }

    function getSim() {
        return simCache;
    }

    function setVistas(arr) {
        vistasCache = arr;
        localStorage.setItem("vistasUma", JSON.stringify(arr));
    }

    function setSim(obj) {
        simCache = obj;
        localStorage.setItem("simUma", JSON.stringify(obj));
    }

    function marcarVista(id) {
        if (!vistasCache.includes(id)) {
            vistasCache.push(id);
            setVistas(vistasCache);
            GH.guardarVistas(vistasCache, simCache);
        }
        actualizarBadgeNuevas();
    }

    function guardarSimSalida(id, numeroSim) {
        simCache[id] = numeroSim;
        setSim(simCache);
        if (!vistasCache.includes(id)) {
            vistasCache.push(id);
            setVistas(vistasCache);
        }
        GH.guardarVistas(vistasCache, simCache);
        actualizarBadgeNuevas();
    }

    function actualizarBadgeNuevas() {
        const badge = document.getElementById("badgeNuevas");
        if (!badge) return;
        const salidas = historial.filter(s => (s.tipo || "SALIDA") === "SALIDA");
        const vistas = getVistas();
        const nuevas = salidas.filter(s => !vistas.includes(s.id)).length;
        if (nuevas > 0) {
            badge.textContent = nuevas;
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }
    }

    function renderViewer(filtro = "") {
        const tbody = document.querySelector("#tablaViewer tbody");
        if (!tbody) return;
        const filtroLower = filtro.toLowerCase();
        const vistas = getVistas();
        const sims = getSim();
        const fechaSel = document.getElementById("fechaViewer")?.value || "";

        const salidas = historial
            .filter(s => (s.tipo || "SALIDA") === "SALIDA")
            .filter(s => {
                if (!fechaSel) return true;
                return s.fecha === fechaSel;
            })
            .filter(s => {
                if (!filtro) return true;
                return (s.remito || "").toLowerCase().includes(filtroLower) ||
                       s.producto.toLowerCase().includes(filtroLower) ||
                       s.tanque.includes(filtroLower) ||
                       s.despacho.toLowerCase().includes(filtroLower);
            });

        if (salidas.length === 0) {
            const msgFecha = fechaSel ? ` para el ${fechaSel.split("-").reverse().join("/")}` : "";
            tbody.innerHTML = `<tr class="empty-row"><td colspan="9">No hay salidas registradas${msgFecha}</td></tr>`;
            return;
        }

        tbody.innerHTML = salidas.map(s => {
            const esNueva = !vistas.includes(s.id);
            const sim = sims[s.id] || "";
            return `<tr class="${esNueva ? 'fila-nueva' : ''}" data-id="${s.id}">
                <td>${esNueva ? '<span class="circulo-nuevo"></span>' : ''}</td>
                <td>${s.fecha}</td>
                <td>${s.hora || "-"}</td>
                <td><strong>${s.remito || "-"}</strong></td>
                <td><strong>TK ${s.tanque}</strong></td>
                <td>${s.producto}</td>
                <td><code>${s.despacho}</code></td>
                <td><strong>${formatKg(s.kilos)} kg</strong></td>
                <td>${sim ? `<strong>${sim}</strong>` : '-'}</td>
            </tr>`;
        }).join("");

        // Listener para marcar como vista / cargar SIM
        tbody.querySelectorAll("tr[data-id]").forEach(tr => {
            tr.addEventListener("click", () => {
                const id = parseInt(tr.dataset.id);
                if (tr.classList.contains("fila-nueva")) {
                    pedirSimSalida(id);
                }
            });
        });
    }

    function pedirSimSalida(id) {
        abrirModal(
            "Cargar Salida SIM",
            `<p>Ingresá el número de salida SIM:</p>
             <input type="text" id="inputSimSalida" style="width:100%;padding:0.6rem;font-size:1.1rem;border:1px solid var(--gray-300);border-radius:6px;margin-top:0.5rem" autocomplete="off">`,
            () => {
                const input = document.getElementById("inputSimSalida");
                const valor = (input?.value || "").trim();
                if (!valor) return;
                guardarSimSalida(id, valor);
                modal.classList.add("hidden");
                document.getElementById("btnConfirmar").textContent = "Confirmar";
                renderViewer(document.getElementById("filtroViewer").value || "");
            },
            "Guardar"
        );
        setTimeout(() => {
            const input = document.getElementById("inputSimSalida");
            if (input) {
                input.focus();
                input.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        document.getElementById("btnConfirmar").click();
                    }
                });
            }
        }, 50);
    }

    const fechaViewer = document.getElementById("fechaViewer");
    if (fechaViewer) {
        const hoy = new Date();
        fechaViewer.value = hoy.toISOString().split("T")[0];
        fechaViewer.addEventListener("change", () => renderViewer(document.getElementById("filtroViewer")?.value || ""));
    }

    const filtroViewer = document.getElementById("filtroViewer");
    if (filtroViewer) {
        filtroViewer.addEventListener("input", (e) => renderViewer(e.target.value));
    }

    // Mergear vistas y SIM locales con las de GitHub (unión)
    async function sincronizarVistasDesdeGH() {
        const remoto = await GH.cargarVistas();
        if (!remoto) return;
        const mergedVistas = Array.from(new Set([...vistasCache, ...(remoto.vistas || [])]));
        setVistas(mergedVistas);
        // Para sim, lo local pisa lo remoto solo si tiene valor (lo más nuevo gana via polling)
        const mergedSim = { ...(remoto.sim || {}), ...simCache };
        setSim(mergedSim);
    }

    // =============================================
    // PLAN DE CARGAS (importacion desde Gmail)
    // =============================================
    let planes = {};
    const planRemoto = await GH.cargarPlan();
    if (planRemoto) planes = planRemoto;

    function hoyISO() {
        return new Date().toISOString().slice(0, 10);
    }

    function getFechaPlan() {
        const inp = document.getElementById("planFechaInput");
        if (!inp) return hoyISO();
        if (!inp.value) inp.value = hoyISO();
        return inp.value;
    }

    function mostrarEstadoPlan(msg, tipo = "info") {
        const el = document.getElementById("planEstado");
        if (!el) return;
        el.textContent = msg;
        el.className = "alerta " + (tipo === "error" ? "error" : tipo === "success" ? "success" : "warning");
        el.classList.remove("hidden");
    }

    function ocultarEstadoPlan() {
        const el = document.getElementById("planEstado");
        if (el) el.classList.add("hidden");
    }

    function actualizarBadgePlan() {
        const badge = document.getElementById("badgePlanPendientes");
        if (!badge) return;
        const fecha = hoyISO();
        // Auto-match antes de contar para que el badge no muestre pendientes que ya tienen
        // salida hecha (evita el "blink" inicial: badge dice 4, abrís el plan y muestra 3).
        if (planes[fecha] && autoMatchearPlan(fecha)) {
            GH.guardarPlan(planes);
        }
        const plan = planes[fecha];
        const visibles = filasVisiblesPlan(plan);
        const pend = visibles.filter(f => !f.cumplido).length;
        if (pend > 0) {
            badge.textContent = pend;
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }
    }

    function renderPlan() {
        const fecha = getFechaPlan();
        let persistir = false;
        // Cleanup automático: tombstones cuya eliminadaTs es >30 días vieja se eliminan
        // físicamente del array. Las que tienen eliminadaTs futura (lock permanente, ej 2099)
        // se mantienen siempre. Sin este cleanup plan.json crecía sin tope.
        const cutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
        const ahora = new Date().toISOString();
        Object.values(planes).forEach(p => {
            if (!p || !p.filas) return;
            const antes = p.filas.length;
            p.filas = p.filas.filter(f => {
                if (!f.eliminada) return true;
                const ts = f.eliminadaTs || "";
                if (ts > ahora) return true; // tombstone futura (lock permanente): mantener
                if (ts < cutoff) return false; // tombstone vieja: descartar
                return true;
            });
            if (p.filas.length !== antes) persistir = true;
            p.filas.forEach(f => {
                if (!f.eliminada && despachoExcluidoDelPlan(f.despacho)) {
                    eliminarFilaPlan(f);
                    persistir = true;
                }
            });
        });
        if (autoMatchearPlan(fecha)) persistir = true;
        if (persistir) GH.guardarPlan(planes);
        const plan = planes[fecha];
        const tbody = document.querySelector("#tablaPlan tbody");
        const resumen = document.getElementById("planResumen");
        if (!tbody) return;

        const visibles = filasVisiblesPlan(plan);
        if (visibles.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No hay plan cargado para esta fecha. Usá <strong>Sincronizar con Gmail</strong> para importarlo.</td></tr>';
            if (resumen) resumen.classList.add("hidden");
            actualizarBadgePlan();
            return;
        }

        const pendientes = visibles.filter(f => !f.cumplido).length;
        const cumplidos = visibles.length - pendientes;

        if (resumen) resumen.classList.remove("hidden");
        document.getElementById("planTotalFilas").textContent = visibles.length;
        document.getElementById("planPendientes").textContent = pendientes;
        document.getElementById("planCumplidos").textContent = cumplidos;

        const filasOrdenadas = [...visibles].sort((a, b) =>
            (a.horaCarga || "99:99").localeCompare(b.horaCarga || "99:99")
        );

        tbody.innerHTML = filasOrdenadas.map(f => {
            const cls = f.cumplido ? "plan-cumplido" : "";
            const estadoBadge = f.cumplido
                ? '<span class="plan-estado-badge plan-estado-cumplido">✓ OK</span>'
                : '<span class="plan-estado-badge plan-estado-pendiente">PEND.</span>';
            const buqueViaje = [f.buque, f.viaje].filter(Boolean).join(" / ");
            const tanqueStock = stock.find(t => t.tanque === f.tanque);
            const productoMostrar = (tanqueStock && tanqueStock.producto) || f.producto;
            return `<tr class="${cls}" data-id="${f.id}">
                <td>${estadoBadge}</td>
                <td><strong>${f.horaCarga || "-"}</strong></td>
                <td><strong>TK ${f.tanque}</strong></td>
                <td>${productoMostrar}</td>
                <td>${f.cliente}</td>
                <td><code>${f.despacho}</code></td>
                <td>${buqueViaje}</td>
            </tr>`;
        }).join("");

        actualizarBadgePlan();
    }

    function normDespacho(d) {
        // Normaliza para matchear despachos pese a typos/formatos distintos:
        // - quita prefijo "DI" opcional
        // - quita "008" intermedio cuando aparece justo después del año
        //   (typo frecuente: copiar el TK 008 dentro del número de despacho)
        // - normaliza la secuencia numérica a 6 dígitos (típico formato), lo
        //   que tolera ceros extras o faltantes en la secuencia
        //   (ej: 26TR060002482A ↔ 26TR06002482A).
        let s = String(d || "").toUpperCase().replace(/^DI/, "");
        s = s.replace(/^(\d{2})008/, "$1");
        s = s.replace(
            /^(\d{2})([A-Z]{2,4}\d{0,2})(\d{4,8})([A-Z])$/,
            (_, anio, tipo, seq, letra) => anio + tipo + String(parseInt(seq, 10)).padStart(6, "0") + letra
        );
        return s;
    }

    // Helpers de tombstones para sync multi-cliente del plan (ver _enviarPlan).
    // Cualquier modificación a una fila debe marcarse con modificadoTs para que el merge
    // last-write-wins funcione. Las "eliminaciones" son soft: se setea eliminada:true en
    // lugar de sacar del array, así otros clientes con plan stale no las reviven.
    function marcarFilaPlan(f) {
        if (f) f.modificadoTs = new Date().toISOString();
    }
    function eliminarFilaPlan(f) {
        if (!f) return;
        f.eliminada = true;
        f.eliminadaTs = new Date().toISOString();
    }
    function filasVisiblesPlan(plan) {
        if (!plan || !plan.filas) return [];
        return plan.filas.filter(f => !f.eliminada);
    }

    // Despachos excluidos del plan de cargas a pedido de Julian.
    function despachoExcluidoDelPlan(desp) {
        return /REMO/i.test(String(desp || ""));
    }

    function matchearSalidaConPlan(salida) {
        const fechas = Object.keys(planes).sort().reverse();
        const despSalida = normDespacho(salida.despacho);
        for (const f of fechas) {
            const plan = planes[f];
            if (!plan || !plan.filas) continue;
            const match = plan.filas.find(fi =>
                !fi.eliminada &&
                !fi.cumplido &&
                fi.tanque === salida.tanque &&
                (fi.producto || "").toUpperCase() === (salida.producto || "").toUpperCase() &&
                normDespacho(fi.despacho) === despSalida
            );
            if (match) {
                match.cumplido = true;
                match.salidaId = salida.id;
                match.cumplidoAt = new Date().toISOString();
                marcarFilaPlan(match);
                GH.guardarPlan(planes);
                return match;
            }
        }
        return null;
    }

    function desmatchearSalidaEnPlan(salidaId) {
        let cambio = false;
        Object.values(planes).forEach(plan => {
            if (!plan.filas) return;
            plan.filas.forEach(f => {
                if (f.salidaId === salidaId) {
                    f.cumplido = false;
                    f.salidaId = null;
                    f.cumplidoAt = null;
                    marcarFilaPlan(f);
                    cambio = true;
                }
            });
        });
        if (cambio) GH.guardarPlan(planes);
    }

    function renombrarDespachoEnPlan(tanqueNum, despachoViejo, despachoNuevo) {
        let cambio = false;
        Object.values(planes).forEach(plan => {
            if (!plan.filas) return;
            plan.filas.forEach(f => {
                if (f.tanque === tanqueNum && f.despacho === despachoViejo) {
                    f.despacho = despachoNuevo;
                    marcarFilaPlan(f);
                    cambio = true;
                }
            });
        });
        if (cambio) GH.guardarPlan(planes);
    }

    function autoMatchearPlan(fecha) {
        const plan = planes[fecha];
        if (!plan || !plan.filas) return false;
        let cambio = false;

        // Limpieza: si una carga está marcada cumplida pero su salidaId ya no apunta a una salida
        // de esta fecha (borrada o editada a otro día), la desmarcamos. Evita que una carga del plan
        // del 14 quede colgada por una salida que terminó siendo del 13.
        plan.filas.forEach(fila => {
            if (fila.eliminada) return;
            if (!fila.cumplido || !fila.salidaId) return;
            const sal = historial.find(h => h.id === fila.salidaId);
            if (!sal || sal.fecha !== fecha) {
                fila.cumplido = false;
                fila.salidaId = null;
                fila.cumplidoAt = null;
                marcarFilaPlan(fila);
                cambio = true;
            }
        });

        const salidasDia = historial.filter(h => (h.tipo || "SALIDA") === "SALIDA" && h.fecha === fecha);
        const yaMatcheadas = new Set();
        plan.filas.forEach(f => { if (!f.eliminada && f.salidaId) yaMatcheadas.add(f.salidaId); });
        plan.filas.forEach(fila => {
            if (fila.eliminada || fila.cumplido) return;
            const despFila = normDespacho(fila.despacho);
            const match = salidasDia.find(s =>
                !yaMatcheadas.has(s.id) &&
                s.tanque === fila.tanque &&
                (s.producto || "").toUpperCase() === (fila.producto || "").toUpperCase() &&
                normDespacho(s.despacho) === despFila
            );
            if (match) {
                fila.cumplido = true;
                fila.salidaId = match.id;
                fila.cumplidoAt = new Date().toISOString();
                marcarFilaPlan(fila);
                yaMatcheadas.add(match.id);
                cambio = true;
            }
        });
        return cambio;
    }

    function mergearFilasPlan(filasExistentes, filasNuevas) {
        // filasNuevas = todas las filas que vienen de Gmail ahora (Excel + cuerpo, todos los mails del dia).
        // No dedupeamos dentro de filasNuevas: cada fila repetida representa un camion distinto
        // (3 filas iguales = 3 camiones del mismo despacho).
        // filasExistentes puede tener filas ya marcadas como cumplidas; transferimos ese estado
        // a filasNuevas por match 1-a-1 (tanque+despacho+horaCarga).
        filasNuevas = filasNuevas.filter(f => !despachoExcluidoDelPlan(f.despacho));
        // Ignorar eliminadas para los matcheos (siguen como tombstones en el array final).
        const existentesActivas = filasExistentes.filter(p => !p.eliminada);
        const existentesCumplidas = existentesActivas.filter(p => p.cumplido);
        const existentesPendientes = existentesActivas.filter(p => !p.cumplido);
        const usadas = new Set();

        for (const nueva of filasNuevas) {
            const despNueva = normDespacho(nueva.despacho);
            // Primero buscar match en cumplidas (prioridad: mantener cumplido)
            let match = existentesCumplidas.find(p =>
                !usadas.has(p.id) &&
                p.tanque === nueva.tanque &&
                normDespacho(p.despacho) === despNueva &&
                (p.horaCarga || "") === (nueva.horaCarga || "")
            );
            if (match) {
                nueva.id = match.id;
                nueva.cumplido = true;
                nueva.salidaId = match.salidaId;
                nueva.cumplidoAt = match.cumplidoAt;
                usadas.add(match.id);
                continue;
            }
            // Sino buscar en pendientes para preservar el mismo ID
            match = existentesPendientes.find(p =>
                !usadas.has(p.id) &&
                p.tanque === nueva.tanque &&
                normDespacho(p.despacho) === despNueva &&
                (p.horaCarga || "") === (nueva.horaCarga || "")
            );
            if (match) {
                nueva.id = match.id;
                usadas.add(match.id);
            }
        }

        // Filtrar filas del cuerpo que ya aparecen en Excel (mismo tanque+despacho, ignorando hora)
        const excelKeys = new Set(
            filasNuevas.filter(f => f.fuente === "excel").map(f => `${f.tanque}|${normDespacho(f.despacho)}`)
        );
        return filasNuevas.filter(f => {
            if (f.fuente !== "excel" && excelKeys.has(`${f.tanque}|${normDespacho(f.despacho)}`)) return false;
            return true;
        });
    }

    async function sincronizarPlanDesdeGmail(modo = "manual") {
        const esAuto = modo === "auto";
        const btn = document.getElementById("btnPlanSincronizar");
        if (btn && !esAuto) { btn.disabled = true; btn.textContent = "⏳ Sincronizando…"; }
        try {
            if (!esAuto) mostrarEstadoPlan("Abriendo autenticación de Google (tagsaaduana@gmail.com)…", "info");
            const tokenOpts = esAuto
                ? { prompt: "none", hint: "tagsaaduana@gmail.com" }
                : { prompt: "" };
            const token = await requestGmailToken(tokenOpts);
            if (!esAuto) mostrarEstadoPlan("Buscando mails con plan de cargas…", "info");
            const { porFecha, descartados } = await obtenerPlanesDesdeGmail(token);

            const fechaSeleccionada = getFechaPlan();
            const resumenPorFecha = {};

            for (const [fecha, info] of Object.entries(porFecha)) {
                const filasActuales = (planes[fecha] && planes[fecha].filas) ? planes[fecha].filas : [];
                const activas = filasActuales.filter(f => !f.eliminada);
                const tombstonesPrevias = filasActuales.filter(f => f.eliminada);
                const keyNorm = (f) => `${f.tanque}|${normDespacho(f.despacho)}|${f.horaCarga || ""}`;

                // Descartar del Excel/incrementales las filas cuya key ya está tombstoneada
                // localmente. Esto evita oscilación cuando un mail viejo trae cargas que se
                // anularon explícitamente (ej: el primer Excel del día con cargas FISCAL que
                // el Excel actualizado reemplazó).
                const tombKeys = new Set(tombstonesPrevias.map(keyNorm));
                if (tombKeys.size > 0) {
                    info.filas = info.filas.filter(f => !tombKeys.has(keyNorm(f)));
                }

                // 1. Aplicar anulaciones explícitas del mail como tombstones (soft-delete in-place).
                let anuladasAplicadas = 0;
                let anuladasIgnoradas = 0;
                if (info.anuladas && info.anuladas.length > 0) {
                    for (const a of info.anuladas) {
                        const target = activas.find(f =>
                            !f.eliminada &&
                            f.tanque === a.tanque &&
                            normDespacho(f.despacho) === normDespacho(a.despacho)
                        );
                        if (!target) continue;
                        if (target.cumplido) { anuladasIgnoradas++; continue; }
                        eliminarFilaPlan(target);
                        anuladasAplicadas++;
                    }
                }

                // 2. Merge de las filas a agregar (Excel + incrementales).
                const activasNoEliminadas = activas.filter(f => !f.eliminada);
                let mergadas = mergearFilasPlan(activasNoEliminadas, info.filas);

                // 3. Reconciliación con el Excel actualizado:
                //    - Cumplidas existentes que no figuran en el Excel: se preservan.
                //    - Pendientes existentes que no figuran: tombstone (era el bug del 14/05).
                let cumplidasPreservadas = 0;
                if (info.tieneExcel) {
                    const enMergadas = new Set(mergadas.map(keyNorm));
                    for (const f of activasNoEliminadas) {
                        if (enMergadas.has(keyNorm(f))) continue;
                        if (f.cumplido) {
                            cumplidasPreservadas++;
                            mergadas.push(f);
                        } else {
                            eliminarFilaPlan(f);
                            mergadas.push(f); // queda como tombstone para que el merge multi-cliente lo respete
                        }
                    }
                } else {
                    // Sync incremental sin Excel: preservar todo lo activo que no matcheó.
                    const enMergadas = new Set(mergadas.map(keyNorm));
                    for (const f of activasNoEliminadas) {
                        if (!enMergadas.has(keyNorm(f))) mergadas.push(f);
                    }
                }

                // Mantener tombstones previas para que sigan propagándose.
                mergadas.push(...tombstonesPrevias);

                // Marcar modificadoTs en todas las filas activas (sin él el merge no las propaga).
                mergadas.forEach(f => {
                    if (!f.eliminada) marcarFilaPlan(f);
                    const tq = stock.find(t => t.tanque === f.tanque);
                    if (tq && tq.producto && !f.eliminada) f.producto = tq.producto;
                });

                const pendientesAntes = activasNoEliminadas.filter(f => !f.cumplido).length;
                const pendientesAhora = mergadas.filter(f => !f.eliminada && !f.cumplido).length;

                planes[fecha] = {
                    filas: mergadas,
                    asunto: info.fuentes.map(s => s.asunto).join(" | "),
                    filename: info.fuentes.map(s => s.filename).join(" | "),
                    importadoAt: new Date().toISOString(),
                    importadoPor: usuarioActual,
                    modificadoTs: new Date().toISOString(),
                };
                autoMatchearPlan(fecha);
                const totalActivas = mergadas.filter(f => !f.eliminada).length;
                const detalles = [];
                if (info.tieneExcel) {
                    const delta = pendientesAhora - pendientesAntes;
                    const signo = delta >= 0 ? `+${delta}` : `${delta}`;
                    detalles.push(`Excel actualizado · pendientes: ${signo}`);
                    if (cumplidasPreservadas > 0) detalles.push(`${cumplidasPreservadas} cumplidas preservadas`);
                } else {
                    const agregadas = totalActivas - activasNoEliminadas.length;
                    if (agregadas > 0) detalles.push(`+${agregadas} nuevas`);
                }
                if (anuladasAplicadas > 0) detalles.push(`-${anuladasAplicadas} anuladas`);
                if (anuladasIgnoradas > 0) detalles.push(`⚠ ${anuladasIgnoradas} anuladas ignoradas (ya cumplidas)`);
                const sufijo = detalles.length > 0 ? ` (${detalles.join(", ")})` : "";
                resumenPorFecha[fecha] = `${fecha.split("-").reverse().join("/")}: ${totalActivas} total${sufijo}`;
            }

            GH.guardarPlan(planes);

            renderPlan();

            if (!esAuto) localStorage.setItem("planGmailConsentio", "1");
            const fechaSelDDMM = fechaSeleccionada.split("-").reverse().join("/");
            const msg = resumenPorFecha[fechaSeleccionada] || "";
            const falta = !porFecha[fechaSeleccionada];
            let avisoFalta = "";
            if (falta) {
                const descPorFecha = descartados.filter(d => d.fecha === fechaSeleccionada);
                if (descPorFecha.length > 0) {
                    avisoFalta = `⚠️ Para ${fechaSelDDMM}: ${descPorFecha.map(d => `"${d.subject}" descartado (${d.motivo})`).join("; ")}`;
                } else {
                    avisoFalta = `⚠️ No llegó plan para ${fechaSelDDMM}.`;
                }
            }
            const textoEstado = falta ? avisoFalta : `Sincronizado · ${msg}`;
            if (!esAuto) mostrarEstadoPlan(textoEstado, falta ? "info" : "success");
            else console.log("[plan] auto-sync OK:", resumenPorFecha[fechaSeleccionada] || "(sin cambios para fecha seleccionada)");
        } catch (e) {
            if (esAuto) {
                console.log("[plan] auto-sync falló (se ignora):", e.message);
            } else {
                console.error("[plan]", e);
                mostrarEstadoPlan("Error: " + e.message, "error");
            }
        } finally {
            if (btn && !esAuto) { btn.disabled = false; btn.textContent = "📧 Sincronizar con Gmail"; }
        }
    }

    // Cooldown del auto-sync: persistido en localStorage para compartir entre sesiones
    // del mismo navegador. Tras el baneo de tagsaaduana@gmail.com el 15/05/2026 (Google
    // detectó "actividad inusual"), bajamos drásticamente la frecuencia: solo se permite
    // un auto-sync cada 30 min, y el intervalo de chequeo pasó de 10 min a 60 min.
    const AUTO_SYNC_COOLDOWN_MS = 30 * 60 * 1000;
    function intentarAutoSync() {
        if (localStorage.getItem("planGmailConsentio") !== "1") return;
        const ahora = Date.now();
        const ultimo = parseInt(localStorage.getItem("planUltimoAutoSync") || "0", 10) || 0;
        if (ahora - ultimo < AUTO_SYNC_COOLDOWN_MS) return;
        localStorage.setItem("planUltimoAutoSync", String(ahora));
        sincronizarPlanDesdeGmail("auto");
    }

    const planFechaInput = document.getElementById("planFechaInput");
    if (planFechaInput) {
        planFechaInput.value = hoyISO();
        if (fechaInput) fechaInput.value = planFechaInput.value;
        planFechaInput.addEventListener("change", () => {
            ocultarEstadoPlan();
            if (fechaInput) fechaInput.value = planFechaInput.value;
            verificarRemitoEnVivo();
            renderPlan();
        });
    }

    const btnPlanSinc = document.getElementById("btnPlanSincronizar");
    if (btnPlanSinc) btnPlanSinc.addEventListener("click", sincronizarPlanDesdeGmail);

    const btnPlanImp = document.getElementById("btnPlanImprimir");
    if (btnPlanImp) btnPlanImp.addEventListener("click", () => {
        const fecha = getFechaPlan();
        const plan = planes[fecha];
        const visibles = filasVisiblesPlan(plan);
        if (visibles.length === 0) {
            alert("No hay plan para imprimir en esta fecha.");
            return;
        }
        const filasOrden = [...visibles].sort((a, b) =>
            (a.horaCarga || "99:99").localeCompare(b.horaCarga || "99:99")
        );
        const filas = filasOrden.map(f => {
            const tq = stock.find(t => t.tanque === f.tanque);
            const productoMostrar = (tq && tq.producto) || f.producto;
            return `<tr${f.cumplido ? ' style="background:#f0fdf4;color:#15803d;text-decoration:line-through"' : ''}>
            <td>${f.cumplido ? "✓" : ""}</td>
            <td>${f.horaCarga || "-"}</td>
            <td>TK ${f.tanque}</td>
            <td>${productoMostrar}</td>
            <td>${f.cliente}</td>
            <td>${f.despacho}</td>
            <td>${[f.buque, f.viaje].filter(Boolean).join(" / ")}</td>
        </tr>`;
        }).join("");
        const html = `<!DOCTYPE html><html><head><title>Plan ${fecha}</title>
        <style>body{font-family:Arial,sans-serif;padding:2rem}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px;font-size:0.85rem}th{background:#f0f0f0;text-align:left}</style>
        </head><body>
        <h2>Odfjell Terminals Tagsa SA - Campana</h2>
        <p>Plan de Cargas del ${fecha.split("-").reverse().join("/")} — ${visibles.length} cargas</p>
        <table><thead><tr><th></th><th>Hora</th><th>Tanque</th><th>Producto</th><th>Cliente</th><th>Despacho</th><th>Buque/Viaje</th></tr></thead>
        <tbody>${filas}</tbody></table>
        </body></html>`;
        const win = window.open("", "_blank");
        win.document.write(html); win.document.close(); win.print();
    });

    actualizarBadgePlan();

    // Auto-sync Gmail al iniciar (si el admin ya consintió alguna vez) y reintento cada 60 min.
    // Intencionalmente conservador post-baneo 15/05/2026: el cooldown de 30 min en
    // intentarAutoSync filtra dispares redundantes entre sesiones.
    if (rolActual === "admin") {
        setTimeout(intentarAutoSync, 5000);
        setInterval(intentarAutoSync, 60 * 60 * 1000);

        // Polling unificado cada 30s: trae cambios remotos de stock/historial Y del plan
        // en el mismo tick. Antes había dos setIntervals independientes; ahora un solo timer
        // los dispara en paralelo y reduce a la mitad las llamadas al Worker.
        setInterval(async () => {
            // 1) Stock/historial
            if (!(GH._enviando || GH._pendiente)) {
                const remoto = await GH.cargar();
                if (remoto) {
                    const cambios = mergearEntradasRemotas(remoto);
                    if (cambios > 0) {
                        localStorage.setItem("stockTanquesV3", JSON.stringify(stock));
                        localStorage.setItem("historialSalidasV3", JSON.stringify(historial));
                        localStorage.setItem("anuladosV3", JSON.stringify(anulados));
                        rerenderAfterMerge();
                        mostrarAlerta(`Se sincronizaron ${cambios} cambio(s) de otro usuario.`, "info");
                    }
                }
            }
            // 2) Plan: si otro cliente o un cleanup manual modificó plan.json, traer.
            if (!(GH._enviandoPlan || GH._pendientePlan)) {
                const remoto = await GH.cargarPlan();
                if (remoto) {
                    const fechaSel = getFechaPlan ? getFechaPlan() : null;
                    const filasAntes = (fechaSel && planes[fechaSel] && planes[fechaSel].filas) ? planes[fechaSel].filas.filter(f => !f.eliminada).length : 0;
                    planes = remoto;
                    const filasDespues = (fechaSel && planes[fechaSel] && planes[fechaSel].filas) ? planes[fechaSel].filas.filter(f => !f.eliminada).length : 0;
                    if (filasAntes !== filasDespues) renderPlan();
                }
            }
        }, 30000);

        // --- BARCOS: tracking AIS ---
        inicializarBarcos();

        // --- SB/FA ---
        inicializarSbfa();
    }

    // Si es viewer, sincronizar vistas, render inicial y polling cada 30s
    if (rolActual === "viewer") {
        sincronizarVistasDesdeGH().then(() => {
            renderViewer();
            actualizarBadgeNuevas();
        });
        setInterval(async () => {
            const ghData = await GH.cargar();
            if (ghData && ghData.historial) {
                historial = ghData.historial;
            }
            await sincronizarVistasDesdeGH();
            renderViewer(document.getElementById("filtroViewer").value || "");
            actualizarBadgeNuevas();
            if (document.getElementById("reporteDiario").classList.contains("active")) {
                renderReporteDiario();
            }
        }, 30000);
    }

    // --- HISTORIAL POR TANQUE ---
    function renderHistTanqueLista(filtro = "") {
        const container = document.getElementById("histTanqueCards");
        const filtroLower = filtro.toLowerCase();

        // Unir tanques del stock + tanques que aparecen sólo en historial
        const mapa = new Map();
        stock.forEach(t => {
            mapa.set(t.tanque, {
                tanque: t.tanque,
                producto: t.producto,
                cliente: t.cliente,
                stockTotal: t.despachos.reduce((s, d) => s + d.stock, 0),
            });
        });
        historial.forEach(h => {
            if (!mapa.has(h.tanque)) {
                mapa.set(h.tanque, {
                    tanque: h.tanque,
                    producto: h.producto || "—",
                    cliente: h.cliente || "—",
                    stockTotal: 0,
                });
            }
        });

        const lista = Array.from(mapa.values())
            .filter(t => {
                if (tanquesDesafectados.includes(t.tanque)) return false;
                if (!filtro) return true;
                return t.tanque.includes(filtroLower) ||
                       (t.producto || "").toLowerCase().includes(filtroLower) ||
                       (t.cliente || "").toLowerCase().includes(filtroLower);
            })
            .sort((a, b) => a.tanque.localeCompare(b.tanque));

        if (lista.length === 0) {
            container.innerHTML = '<p style="padding:1rem;color:var(--gray-500)">No hay tanques para mostrar.</p>';
            return;
        }

        container.innerHTML = lista.map(t => {
            const movs = historial.filter(h => h.tanque === t.tanque).length;
            return `<div class="stock-card hist-tanque-card" data-tanque="${t.tanque}">
                <div class="stock-card-header">
                    <div class="stock-card-left">
                        <span class="stock-card-tanque">TK ${t.tanque}</span>
                        <div>
                            <div class="stock-card-producto">${t.producto}</div>
                            <div class="stock-card-cliente">${t.cliente}</div>
                        </div>
                    </div>
                    <span class="stock-card-total">${movs} mov.</span>
                </div>
            </div>`;
        }).join("");

        container.querySelectorAll(".hist-tanque-card").forEach(card => {
            card.addEventListener("click", () => {
                renderHistTanqueDetalle(card.dataset.tanque);
            });
        });
    }

    function renderHistTanqueDetalle(numTanque) {
        const movs = historial
            .filter(h => h.tanque === numTanque)
            .slice()
            .sort((a, b) => {
                const fa = `${a.fecha} ${a.hora || ""}`;
                const fb = `${b.fecha} ${b.hora || ""}`;
                return fb.localeCompare(fa);
            });

        document.getElementById("histTanqueListaView").classList.add("hidden");
        document.getElementById("histTanqueDetalleView").classList.remove("hidden");
        document.getElementById("histTanqueDetalleTitulo").textContent = `Movimientos del TK ${numTanque}`;

        const tbody = document.querySelector("#tablaHistTanque tbody");
        if (movs.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No hay movimientos para este tanque.</td></tr>';
            return;
        }

        tbody.innerHTML = movs.map(s => {
            const tipo = s.tipo || "SALIDA";
            const tipoClass = tipo === "INGRESO" ? "tipo-ingreso" : tipo === "TRANSFERENCIA" ? "tipo-transferencia" : "tipo-salida";
            return `<tr>
                <td>${s.fecha}</td>
                <td>${s.hora || "-"}</td>
                <td><span class="tipo-badge ${tipoClass}">${tipo}</span></td>
                <td><strong>${s.remito || "-"}</strong></td>
                <td>${s.producto || "-"}</td>
                <td><code>${s.despacho || "-"}</code></td>
                <td><strong>${formatKg(s.kilos)} kg</strong></td>
                <td>${(s.usuario || "-").toUpperCase()}</td>
            </tr>`;
        }).join("");
    }

    function volverListaHistTanque() {
        document.getElementById("histTanqueDetalleView").classList.add("hidden");
        document.getElementById("histTanqueListaView").classList.remove("hidden");
    }

    document.getElementById("btnVolverHistTanque").addEventListener("click", volverListaHistTanque);
    document.getElementById("filtroHistTanque").addEventListener("input", (e) => {
        renderHistTanqueLista(e.target.value);
    });

    // --- HISTORIAL POR DESPACHO ---
    function renderHistDespachoLista(filtro = "") {
        const container = document.getElementById("histDespachoCards");
        const filtroLower = filtro.toLowerCase();

        // Unir despachos en stock + los que solo aparecen en historial
        const mapa = new Map();
        stock.forEach(t => {
            t.despachos.forEach(d => {
                const key = d.despacho;
                if (!mapa.has(key)) {
                    mapa.set(key, {
                        despacho: key,
                        productos: new Set(),
                        clientes: new Set(),
                        tanques: new Set(),
                        stockActual: 0,
                    });
                }
                const obj = mapa.get(key);
                obj.productos.add(t.producto);
                if (d.cliente || t.cliente) obj.clientes.add(d.cliente || t.cliente);
                obj.tanques.add(t.tanque);
                obj.stockActual += d.stock;
            });
        });
        historial.forEach(h => {
            if (!h.despacho) return;
            if (!mapa.has(h.despacho)) {
                mapa.set(h.despacho, {
                    despacho: h.despacho,
                    productos: new Set(h.producto ? [h.producto] : []),
                    clientes: new Set(h.cliente ? [h.cliente] : []),
                    tanques: new Set(h.tanque ? [h.tanque.split("→")[0]] : []),
                    stockActual: 0,
                });
            } else {
                const obj = mapa.get(h.despacho);
                if (h.producto) obj.productos.add(h.producto);
                if (h.cliente) obj.clientes.add(h.cliente);
                if (h.tanque) obj.tanques.add(h.tanque.split("→")[0]);
            }
        });

        const lista = Array.from(mapa.values())
            .filter(d => {
                if (!filtro) return true;
                return d.despacho.toLowerCase().includes(filtroLower) ||
                       [...d.productos].some(p => (p || "").toLowerCase().includes(filtroLower)) ||
                       [...d.clientes].some(c => (c || "").toLowerCase().includes(filtroLower));
            })
            .sort((a, b) => a.despacho.localeCompare(b.despacho));

        if (lista.length === 0) {
            container.innerHTML = '<p style="padding:1rem;color:var(--gray-500)">No hay despachos para mostrar.</p>';
            return;
        }

        container.innerHTML = lista.map(d => {
            const movs = historial.filter(h => h.despacho === d.despacho).length;
            const tanques = [...d.tanques].map(t => "TK " + t).join(", ");
            const productos = [...d.productos].filter(Boolean).join(", ") || "—";
            const clientes = [...d.clientes].filter(Boolean).join(", ") || "—";
            return `<div class="stock-card hist-despacho-card" data-despacho="${d.despacho.replace(/"/g, '&quot;')}">
                <div class="stock-card-header">
                    <div class="stock-card-left">
                        <div>
                            <div class="stock-card-producto" style="font-family:monospace"><code>${d.despacho}</code></div>
                            <div class="stock-card-cliente">${productos} · ${clientes}</div>
                            <div class="stock-card-cliente" style="font-size:0.75rem">${tanques || "sin tanque"}</div>
                        </div>
                    </div>
                    <div style="text-align:right">
                        <span class="stock-card-total">${movs} mov.</span>
                        ${d.stockActual > 0 ? `<div style="font-size:0.75rem;color:var(--gray-500)">saldo ${formatKg(d.stockActual)} kg</div>` : ""}
                    </div>
                </div>
            </div>`;
        }).join("");

        container.querySelectorAll(".hist-despacho-card").forEach(card => {
            card.addEventListener("click", () => {
                renderHistDespachoDetalle(card.dataset.despacho);
            });
        });
    }

    function renderHistDespachoDetalle(despacho) {
        const movs = historial
            .filter(h => h.despacho === despacho)
            .slice()
            .sort((a, b) => {
                const fa = `${a.fecha} ${a.hora || ""}`;
                const fb = `${b.fecha} ${b.hora || ""}`;
                return fb.localeCompare(fa);
            });

        document.getElementById("histDespachoListaView").classList.add("hidden");
        document.getElementById("histDespachoDetalleView").classList.remove("hidden");
        document.getElementById("histDespachoDetalleTitulo").innerHTML = `Movimientos del despacho <code>${despacho}</code>`;

        const tbody = document.querySelector("#tablaHistDespacho tbody");
        if (movs.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No hay movimientos para este despacho.</td></tr>';
            return;
        }

        tbody.innerHTML = movs.map(s => {
            const tipo = s.tipo || "SALIDA";
            const tipoClass = tipo === "INGRESO" ? "tipo-ingreso" : tipo === "TRANSFERENCIA" ? "tipo-transferencia" : "tipo-salida";
            return `<tr>
                <td>${s.fecha}</td>
                <td>${s.hora || "-"}</td>
                <td><span class="tipo-badge ${tipoClass}">${tipo}</span></td>
                <td><strong>${s.remito || "-"}</strong></td>
                <td><strong>TK ${s.tanque}</strong></td>
                <td>${s.producto || "-"}</td>
                <td><strong>${formatKg(s.kilos)} kg</strong></td>
                <td>${(s.usuario || "-").toUpperCase()}</td>
            </tr>`;
        }).join("");
    }

    function volverListaHistDespacho() {
        document.getElementById("histDespachoDetalleView").classList.add("hidden");
        document.getElementById("histDespachoListaView").classList.remove("hidden");
    }

    document.getElementById("btnVolverHistDespacho").addEventListener("click", volverListaHistDespacho);
    document.getElementById("filtroHistDespacho").addEventListener("input", (e) => {
        renderHistDespachoLista(e.target.value);
    });

    // --- HELPERS ---
    function formatKg(n) { return n.toLocaleString("es-AR"); }
    function mostrarAlerta(msg, tipo) { alerta.textContent = msg; alerta.className = `alerta ${tipo}`; }

    // Modal de confirmación centrado (reemplazo de confirm() nativo)
    function elegirAlcanceRenombrar(viejo, nuevo, otrosTks, tkActual, callback) {
        const modal = document.getElementById("modalInfo");
        if (!modal) {
            const ok = confirm(`Este despacho también está en ${otrosTks}.\n"${viejo}" → "${nuevo}"\n\nAceptar = todos, Cancelar = solo TK ${tkActual}`);
            callback(ok ? "todos" : "soloEste");
            return;
        }
        document.getElementById("modalInfoTitulo").textContent = "Renombrar despacho";
        document.getElementById("modalInfoBody").innerHTML = `
            <p style="margin:0 0 0.6rem;line-height:1.5">Este despacho también está en <strong>${otrosTks}</strong>.</p>
            <p style="margin:0;line-height:1.5">"<code>${viejo}</code>" → "<code>${nuevo}</code>"</p>
            <p style="margin:0.6rem 0 0;line-height:1.5">¿Dónde querés aplicar el cambio?</p>
        `;
        const actions = modal.querySelector(".modal-actions");
        const accionesPrev = actions.innerHTML;
        actions.innerHTML = `
            <button class="btn btn-primary" id="btnRenAlcTodos">Renombrar en TODOS</button>
            <button class="btn btn-secondary" id="btnRenAlcSolo">Solo en TK ${tkActual}</button>
            <button class="btn btn-danger" id="btnRenAlcCancel">Cancelar</button>
        `;
        modal.classList.remove("hidden");
        const cerrar = (alcance) => {
            modal.classList.add("hidden");
            actions.innerHTML = accionesPrev;
            document.removeEventListener("keydown", esc);
            callback(alcance);
        };
        const esc = (e) => { if (e.key === "Escape") cerrar("cancelar"); };
        document.getElementById("btnRenAlcTodos").addEventListener("click", () => cerrar("todos"));
        document.getElementById("btnRenAlcSolo").addEventListener("click", () => cerrar("soloEste"));
        document.getElementById("btnRenAlcCancel").addEventListener("click", () => cerrar("cancelar"));
        document.addEventListener("keydown", esc);
        document.getElementById("btnRenAlcTodos").focus();
    }

    function mostrarModalConfirm(mensaje, titulo, onConfirm) {
        const modal = document.getElementById("modalInfo");
        if (!modal) { if (window.confirm(mensaje)) onConfirm(); return; }
        document.getElementById("modalInfoTitulo").textContent = titulo || "Confirmar";
        document.getElementById("modalInfoBody").innerHTML = `<p style="margin:0;line-height:1.5;white-space:pre-wrap">${mensaje}</p>`;
        // Reemplazar el botón único OK por dos: Confirmar + Cancelar
        const actions = modal.querySelector(".modal-actions");
        const accionesPrev = actions.innerHTML;
        actions.innerHTML = `
            <button class="btn btn-primary" id="btnModalConfirmOk">Confirmar</button>
            <button class="btn btn-secondary" id="btnModalConfirmCancel">Cancelar</button>
        `;
        modal.classList.remove("hidden");
        const restaurar = () => {
            modal.classList.add("hidden");
            actions.innerHTML = accionesPrev;
            document.removeEventListener("keydown", esc);
        };
        const esc = (e) => {
            if (e.key === "Escape") { restaurar(); }
            else if (e.key === "Enter") { restaurar(); onConfirm(); }
        };
        document.getElementById("btnModalConfirmOk").addEventListener("click", () => { restaurar(); onConfirm(); });
        document.getElementById("btnModalConfirmCancel").addEventListener("click", restaurar);
        document.addEventListener("keydown", esc);
        document.getElementById("btnModalConfirmOk").focus();
    }

    // Modal de aviso centrado (reemplazo de alert() nativo que aparece arriba de la pantalla)
    function mostrarModalInfo(mensaje, titulo) {
        const modal = document.getElementById("modalInfo");
        if (!modal) { alert(mensaje); return; }
        document.getElementById("modalInfoTitulo").textContent = titulo || "Aviso";
        document.getElementById("modalInfoBody").innerHTML = `<p style="margin:0;line-height:1.5">${mensaje}</p>`;
        modal.classList.remove("hidden");
        const btn = document.getElementById("btnModalInfoOk");
        btn.focus();
        const cerrar = () => {
            modal.classList.add("hidden");
            btn.removeEventListener("click", cerrar);
            modal.removeEventListener("click", overlay);
            document.removeEventListener("keydown", esc);
        };
        const overlay = (e) => { if (e.target === modal) cerrar(); };
        const esc = (e) => { if (e.key === "Escape" || e.key === "Enter") cerrar(); };
        btn.addEventListener("click", cerrar);
        modal.addEventListener("click", overlay);
        document.addEventListener("keydown", esc);
    }
    function ocultarAlerta() { alerta.className = "alerta hidden"; }

    // --- BARCOS: tracking AIS ---
    let barcosConfig = { barcos: [] };
    let barcosTracking = { actualizado: null, barcos: {} };
    let sbfaConfig = { descargas: [] };
    let sbfaEditandoId = null;
    const SBFA_TOLERANCIA_PCT = 0.6;

    async function fetchJSON(path) {
        try {
            const r = await fetch(path + "?b=" + Date.now());
            if (!r.ok) return null;
            return await r.json();
        } catch (_) { return null; }
    }

    function umbralAlertaHs() {
        const v = parseInt(document.getElementById("barcosUmbral")?.value, 10);
        return isNaN(v) || v <= 0 ? 24 : v;
    }

    function fmtFechaCorta(iso) {
        if (!iso) return "—";
        const d = new Date(iso);
        if (isNaN(d)) return "—";
        return d.toLocaleString("es-AR", {
            day: "2-digit", month: "2-digit",
            hour: "2-digit", minute: "2-digit", hour12: false,
        });
    }

    function horasHasta(iso) {
        if (!iso) return null;
        const ms = new Date(iso) - Date.now();
        return ms / 3600000;
    }

    async function cargarBarcosCfg() {
        try {
            const obj = GH._parseTexto(await GH._ghLeer("barcos.json"));
            if (obj) barcosConfig = obj;
        } catch (e) { console.warn("[barcos] cargar:", e.message || e); }
    }

    async function cargarTracking() {
        try {
            const obj = GH._parseTexto(await GH._ghLeer("tracking.json"));
            if (obj) barcosTracking = obj;
        } catch (e) { console.warn("[tracking] cargar:", e.message || e); }
    }

    function renderBarcos() {
        const c = document.getElementById("barcosCards");
        if (!c) return;
        const ts = document.getElementById("barcosActualizado");
        if (ts) ts.textContent = barcosTracking.actualizado
            ? `Última actualización del tracking: ${fmtFechaCorta(barcosTracking.actualizado)} (UTC ${barcosTracking.actualizado.replace("T", " ").slice(0, 16)})`
            : "Esperando primer tracking…";

        const umbral = umbralAlertaHs();
        // Ordenar por llegada a Campana: primero los que ya llegaron / llegan antes.
        // La ETA solo cuenta si el destino es Campana (la ETA de VesselFinder es al
        // destino actual del barco, que puede ser otro puerto antes de venir acá).
        const ordenLlegada = (b, t) => {
            if (t.estado === "en_puerto" && /campana/i.test(t.puerto_actual || "")) {
                const ms = Date.parse(t.arribo || "");
                return isNaN(ms) ? -8.64e15 : ms; // ya en Campana → arriba de todo
            }
            if (t.estado === "en_route" && /campana/i.test(t.destino || "")) {
                const ms = Date.parse(t.eta || "");
                return isNaN(ms) ? 8.64e15 - 1 : ms; // viene a Campana, ETA desconocida
            }
            return 8.64e15; // no viene a Campana / sin datos / sin IMO → al final
        };
        const listaBarcos = (barcosConfig.barcos || []).slice().sort((x, y) => {
            const tx = x.imo ? ((barcosTracking.barcos || {})[x.imo] || {}) : {};
            const ty = y.imo ? ((barcosTracking.barcos || {})[y.imo] || {}) : {};
            const ox = ordenLlegada(x, tx), oy = ordenLlegada(y, ty);
            if (ox !== oy) return ox - oy;
            return (x.nombre || "").localeCompare(y.nombre || "");
        });
        const filas = listaBarcos.map(b => {
            const t = b.imo ? ((barcosTracking.barcos || {})[b.imo] || {}) : {};
            const hs = horasHasta(t.eta);
            const acerca = hs !== null && hs >= 0 && hs <= umbral;
            const cls = acerca ? "barco-card alerta" : (t.estado === "en_route" ? "barco-card en-ruta" : "barco-card");

            let estadoTxt = "";
            if (!b.imo) {
                estadoTxt = `<span style="color:var(--warning)">⏳ Buscando IMO por nombre… aparecerá en la próxima corrida del tracking.</span>`;
            } else if (t.estado === "en_route") {
                const hsTxt = hs === null ? "" : (hs < 0 ? `<span style="color:#b91c1c">demorado ${Math.round(-hs)} hs</span>` : `en ${hs.toFixed(1)} hs`);
                estadoTxt = `🚢 En ruta a <strong>${t.destino || "—"}</strong> · ETA <strong>${fmtFechaCorta(t.eta)}</strong> ${hsTxt}`;
            } else if (t.estado === "en_puerto") {
                estadoTxt = `⚓ En puerto: <strong>${t.puerto_actual || "—"}</strong> desde ${fmtFechaCorta(t.arribo)}`;
            } else if (t.estado === "navegando") {
                estadoTxt = `🌊 Navegando · zarpó de <strong>${t.ultimo_puerto || "—"}</strong> el ${fmtFechaCorta(t.partida)}`;
            } else if (t.error) {
                estadoTxt = `<span style="color:var(--gray-500)">Sin datos: ${t.error}</span>`;
            } else {
                estadoTxt = `<span style="color:var(--gray-500)">Sin datos de tracking aún. Esperar próxima corrida (cada 10 min).</span>`;
            }

            const detalles = [];
            if (t.velocidad_nudos != null) detalles.push(`${t.velocidad_nudos} nudos`);
            if (t.rumbo != null) detalles.push(`rumbo ${t.rumbo}°`);
            if (t.calado_m != null) detalles.push(`calado ${t.calado_m} m`);
            if (t.bandera) detalles.push(t.bandera);

            const linkVF = b.imo
                ? `<a href="https://www.vesselfinder.com/vessels/details/${b.imo}" target="_blank" rel="noopener" style="font-size:0.8rem">VesselFinder ↗</a>`
                : "";
            const imoTxt = b.imo
                ? `IMO ${b.imo}`
                : `<span style="color:var(--warning)">IMO pendiente</span>`;

            // Resumen de descargas SB/FA asociadas a este barco (sin anuladas)
            const dx = (sbfaConfig.descargas || []).filter(d =>
                !d.anulada && !d.archivada && (d.buque || "").toUpperCase() === (b.nombre || "").toUpperCase()
            );
            const sbfaInfo = dx.length
                ? `<div style="margin-top:0.4rem;font-size:0.85rem;color:var(--primary)">📋 ${dx.length} descarga(s) SB/FA registradas</div>`
                : "";

            return `<div class="${cls}" style="padding:1rem;border-radius:10px;border:2px solid ${acerca ? '#dc2626' : (t.estado === "en_route" ? '#1a56db' : 'var(--gray-200)')};margin-bottom:0.75rem;background:white">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">
                    <div>
                        <div style="font-weight:700;font-size:1.05rem">${b.nombre} ${acerca ? '<span style="color:#dc2626">⚠</span>' : ''}</div>
                        <div style="font-size:0.8rem;color:var(--gray-500);font-family:monospace">${imoTxt}</div>
                    </div>
                    ${linkVF}
                </div>
                <div style="margin-top:0.5rem;font-size:0.95rem">${estadoTxt}</div>
                ${detalles.length ? `<div style="margin-top:0.4rem;font-size:0.85rem;color:var(--gray-500)">${detalles.join(" · ")}</div>` : ""}
                ${sbfaInfo}
                <div style="margin-top:0.6rem;display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center">
                    <button class="btn btn-primary btn-sm" data-sbfa-buque="${b.nombre}" type="button">📋 Cargar SB/FA</button>
                    ${dx.length ? `<button class="btn btn-secondary btn-sm" data-sbfa-ver="${b.nombre}" type="button">Ver descargas (${dx.length})</button>` : ""}
                    <button class="btn btn-sm" data-quitar-barco="${b.imo || b.nombre}" type="button" title="Quitar del seguimiento" style="margin-left:auto;background:none;color:#b91c1c;border:1px solid #fca5a5">✕ Quitar</button>
                </div>
            </div>`;
        }).join("");

        c.innerHTML = filas || `<p style="color:var(--gray-500)">No hay barcos en seguimiento. Agregá uno arriba.</p>`;

        // Eventos de los botones SB/FA (después de setear innerHTML)
        c.querySelectorAll("[data-sbfa-buque]").forEach(btn => {
            btn.addEventListener("click", e => {
                e.stopPropagation();
                irASbfaDesdeBarco(btn.dataset.sbfaBuque);
            });
        });
        c.querySelectorAll("[data-sbfa-ver]").forEach(btn => {
            btn.addEventListener("click", e => {
                e.stopPropagation();
                verDescargasSbfaDeBarco(btn.dataset.sbfaVer);
            });
        });
        c.querySelectorAll("[data-quitar-barco]").forEach(btn => {
            btn.addEventListener("click", e => {
                e.stopPropagation();
                quitarBarco(btn.dataset.quitarBarco);
            });
        });

        // badge en la pestaña: cantidad de barcos en alerta
        const cerca = (barcosConfig.barcos || []).filter(b => {
            const t = (barcosTracking.barcos || {})[b.imo] || {};
            const hs = horasHasta(t.eta);
            return hs !== null && hs >= 0 && hs <= umbral;
        }).length;
        const badge = document.getElementById("badgeBarcosCerca");
        if (badge) {
            if (cerca > 0) { badge.textContent = cerca; badge.classList.remove("hidden"); }
            else badge.classList.add("hidden");
        }

        renderListaBarcos();
    }

    function renderListaBarcos() {
        const lista = document.getElementById("barcosLista");
        if (!lista) return;
        if (!(barcosConfig.barcos || []).length) {
            lista.innerHTML = "";
            return;
        }
        lista.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:0.5rem">` +
            barcosConfig.barcos.map(b => {
                const clave = b.imo || b.nombre;
                const imoTxt = b.imo ? `<code style="color:var(--gray-500)">${b.imo}</code>` : `<span style="color:var(--warning);font-size:0.75rem">IMO pendiente</span>`;
                return `<span style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.3rem 0.6rem;background:white;border:1px solid var(--gray-300);border-radius:14px;font-size:0.8rem">
                    ${b.nombre} ${imoTxt}
                    <button data-quitar="${clave}" type="button" style="border:none;background:none;cursor:pointer;color:#dc2626;font-weight:700">×</button>
                </span>`;
            }).join("") + `</div>`;
        lista.querySelectorAll("[data-quitar]").forEach(b => {
            b.addEventListener("click", () => quitarBarco(b.dataset.quitar));
        });
    }

    async function guardarBarcosCfg() {
        // read-modify-write con sha, vía el proxy.
        const msg = `chore: actualizar barcos.json ${new Date().toISOString().slice(0, 16)}`;
        const cuerpo = JSON.stringify(barcosConfig, null, 2);
        try {
            const cur = await GH._ghLeer("barcos.json");
            let out = await GH._ghEscribir("barcos.json", cuerpo, cur ? cur.sha : null, msg);
            if (!out.ok && (out.status === 409 || out.status === 422)) {
                const cur2 = await GH._ghLeer("barcos.json");
                out = await GH._ghEscribir("barcos.json", cuerpo, cur2 ? cur2.sha : null, msg);
            }
            if (!out.ok) throw new Error(`proxy ${out.status}${out.detalle}`);
            return true;
        } catch (e) {
            console.error("[barcos] error guardando:", e);
            mostrarAlerta(`Error guardando barcos.json: ${e.message || e}`, "error");
            return false;
        }
    }

    async function agregarBarco() {
        const nombre = document.getElementById("barcoNombre").value.trim().toUpperCase();
        if (!nombre) { alert("Falta el nombre del barco."); return; }
        const yaExiste = (barcosConfig.barcos || []).some(b =>
            (b.nombre || "").toUpperCase() === nombre
        );
        if (yaExiste) { alert(`"${nombre}" ya está en la lista.`); return; }
        barcosConfig.barcos = barcosConfig.barcos || [];
        // imo: null → el script Python lo resuelve por nombre en la próxima corrida.
        barcosConfig.barcos.push({ nombre, imo: null });
        if (await guardarBarcosCfg()) {
            document.getElementById("barcoNombre").value = "";
            renderBarcos();
            // Disparar el tracking ahora mismo: el barco resuelve su IMO y datos
            // en ~30 s, sin esperar al cron.
            const disp = await GH._ghDispatch("track-vessels.yml", "master", {});
            if (disp.ok) {
                mostrarAlerta(`${nombre} agregado. Buscando IMO y datos ahora — refrescá la pestaña en ~1 minuto.`, "info");
            } else {
                mostrarAlerta(`${nombre} agregado. Se buscará el IMO en la próxima corrida del tracking.`, "info");
            }
        }
    }

    async function quitarBarco(clave) {
        if (!confirm("¿Quitar este barco del seguimiento?")) return;
        barcosConfig.barcos = (barcosConfig.barcos || []).filter(b =>
            (b.imo || b.nombre) !== clave
        );
        if (await guardarBarcosCfg()) renderBarcos();
    }

    function renderMailsArriboLista() {
        const lista = document.getElementById("mailsArriboLista");
        if (!lista) return;
        const mails = ((barcosConfig.notificaciones || {}).mailsArribo) || [];
        if (!mails.length) {
            lista.innerHTML = `<p style="font-size:0.8rem;color:var(--gray-500);font-style:italic">Sin destinatarios. Cuando un barco arribe no se enviará mail.</p>`;
            return;
        }
        lista.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:0.4rem">` +
            mails.map(m => `<span style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.3rem 0.6rem;background:white;border:1px solid var(--gray-300);border-radius:14px;font-size:0.8rem">
                ${m}
                <button data-quitar-mail="${m}" type="button" style="border:none;background:none;cursor:pointer;color:#dc2626;font-weight:700">×</button>
            </span>`).join("") + `</div>`;
        lista.querySelectorAll("[data-quitar-mail]").forEach(b => {
            b.addEventListener("click", () => quitarMailArribo(b.dataset.quitarMail));
        });
    }

    async function agregarMailArribo() {
        const inp = document.getElementById("mailArribo");
        const mail = inp.value.trim().toLowerCase();
        if (!mail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
            alert("Ingresá un mail válido.");
            return;
        }
        barcosConfig.notificaciones = barcosConfig.notificaciones || { mailsArribo: [] };
        barcosConfig.notificaciones.mailsArribo = barcosConfig.notificaciones.mailsArribo || [];
        if (barcosConfig.notificaciones.mailsArribo.includes(mail)) {
            alert(`"${mail}" ya está en la lista.`);
            return;
        }
        barcosConfig.notificaciones.mailsArribo.push(mail);
        if (await guardarBarcosCfg()) {
            inp.value = "";
            renderMailsArriboLista();
            mostrarAlerta(`Mail agregado: ${mail}`, "info");
        }
    }

    async function quitarMailArribo(mail) {
        if (!confirm(`¿Quitar "${mail}" de la lista de avisos?`)) return;
        const lista = (barcosConfig.notificaciones || {}).mailsArribo || [];
        barcosConfig.notificaciones.mailsArribo = lista.filter(m => m !== mail);
        if (await guardarBarcosCfg()) {
            renderMailsArriboLista();
        }
    }

    async function inicializarBarcos() {
        await Promise.all([cargarBarcosCfg(), cargarTracking()]);
        renderBarcos();
        renderMailsArriboLista();

        document.getElementById("btnAgregarBarco").addEventListener("click", agregarBarco);
        document.getElementById("btnAgregarMailArribo").addEventListener("click", agregarMailArribo);
        document.getElementById("mailArribo").addEventListener("keydown", e => {
            if (e.key === "Enter") agregarMailArribo();
        });

        // Auto-refresh tracking cada 5 min mientras la app está abierta
        setInterval(async () => {
            await cargarTracking();
            renderBarcos();
        }, 5 * 60 * 1000);
    }

    // --- SB/FA: SOBRANTES Y FALTANTES POR DESCARGA DE BUQUE ---

    // Lee sbfa.json fresco vía el proxy. Devuelve { content, sha } o null.
    async function cargarSbfaRemoto() {
        try {
            const res = await GH._ghLeer("sbfa.json");
            if (!res) return null;
            const obj = GH._parseTexto(res);
            if (!obj) return null;
            return { content: obj, sha: res.sha };
        } catch (e) {
            console.warn("[sbfa] cargarSbfaRemoto falló:", e.message || e);
            return null;
        }
    }

    // Merge de descargas por id con last-write-wins. La descarga que un usuario tocó
    // recién tiene un actualizadoTs (o anuladaTs) más nuevo y gana; las que tocó otro
    // usuario quedan con el ts más nuevo y no se pisan.
    function sbfaTsDescarga(d) {
        return d.anuladaTs && d.anuladaTs > (d.actualizadoTs || "") ? d.anuladaTs : (d.actualizadoTs || d.anuladaTs || "");
    }
    function sbfaMergeDescargas(base, otras) {
        const porId = new Map();
        (base || []).forEach(d => porId.set(d.id, d));
        (otras || []).forEach(d => {
            const ex = porId.get(d.id);
            if (!ex) { porId.set(d.id, d); return; }
            porId.set(d.id, sbfaTsDescarga(d) >= sbfaTsDescarga(ex) ? d : ex);
        });
        return [...porId.values()];
    }

    async function cargarSbfaCfg() {
        const remoto = await cargarSbfaRemoto();
        if (remoto && remoto.content) sbfaConfig = remoto.content;
        if (!sbfaConfig.descargas) sbfaConfig.descargas = [];
    }

    let sbfaUltimoErrorGuardado = "";

    async function guardarSbfaCfg() {
        sbfaUltimoErrorGuardado = "";
        const cuerpo = () => JSON.stringify(sbfaConfig, null, 2);
        const msg = () => `chore: actualizar sbfa.json ${new Date().toISOString().slice(0, 16)}`;
        try {
            // Releer remoto fresco y mergear: así no pisamos descargas que otro usuario
            // (ej. Claudia) cargó/editó mientras esta sesión tenía una copia vieja.
            const remoto = await cargarSbfaRemoto();
            if (remoto && remoto.content && Array.isArray(remoto.content.descargas)) {
                sbfaConfig.descargas = sbfaMergeDescargas(remoto.content.descargas, sbfaConfig.descargas);
            }
            let out = await GH._ghEscribir("sbfa.json", cuerpo(), remoto ? remoto.sha : null, msg());
            if (!out.ok && (out.status === 409 || out.status === 422)) {
                // sha viejo (otro guardó en el medio): reintentar con remoto fresco.
                const r2 = await cargarSbfaRemoto();
                if (r2 && r2.content && Array.isArray(r2.content.descargas)) {
                    sbfaConfig.descargas = sbfaMergeDescargas(r2.content.descargas, sbfaConfig.descargas);
                }
                out = await GH._ghEscribir("sbfa.json", cuerpo(), r2 ? r2.sha : null, msg());
            }
            if (!out.ok) {
                sbfaUltimoErrorGuardado = `proxy ${out.status}${out.detalle}`;
                throw new Error(sbfaUltimoErrorGuardado);
            }
            return true;
        } catch (e) {
            if (!sbfaUltimoErrorGuardado) sbfaUltimoErrorGuardado = e.message || String(e);
            console.error("[sbfa] error guardando sbfa.json:", e);
            mostrarAlerta(`Error guardando sbfa.json: ${sbfaUltimoErrorGuardado}`, "error");
            return false;
        }
    }

    // Trae cambios de sbfa.json que cargó otro usuario y refresca la lista,
    // siempre que no haya un editor abierto (para no pisar lo que se está editando).
    async function sincronizarSbfaDesdeRemoto() {
        if (!document.getElementById("sbfaEditor").classList.contains("hidden")) return;
        const remoto = await cargarSbfaRemoto();
        if (!remoto || !remoto.content || !Array.isArray(remoto.content.descargas)) return;
        const antes = JSON.stringify(sbfaConfig.descargas);
        sbfaConfig.descargas = sbfaMergeDescargas(sbfaConfig.descargas, remoto.content.descargas);
        if (JSON.stringify(sbfaConfig.descargas) === antes) return;
        renderSbfaLista(document.getElementById("sbfaFiltro")?.value || "", "activas");
        renderSbfaLista(document.getElementById("sbfaHistFiltro")?.value || "", "historial");
        if (typeof renderBarcos === "function") renderBarcos();
        console.log("[sbfa] sincronizado con cambios remotos");
    }

    function sbfaCalcDif(decl, res) {
        const d = Number(decl) || 0;
        const r = Number(res) || 0;
        const dif = r - d;
        const pct = d > 0 ? (dif / d) * 100 : 0;
        return { dif, pct };
    }

    function sbfaFmt(n) {
        if (n === null || n === undefined || isNaN(n)) return "0";
        return Math.round(n).toLocaleString("es-AR");
    }

    function sbfaFmtPct(p) {
        if (p === null || p === undefined || isNaN(p)) return "0,00%";
        return p.toFixed(2).replace(".", ",") + "%";
    }

    function sbfaResumen(d) {
        let totDecl = 0, totRes = 0, fueraTol = 0, pendientes = 0, medidas = 0;
        (d.filas || []).forEach(f => {
            const decl = Number(f.kgDeclarados) || 0;
            const res = Number(f.kgResultantes) || 0;
            totDecl += decl;
            totRes += res;
            if (decl > 0 && res > 0) {
                medidas++;
                const pct = (res - decl) / decl * 100;
                if (Math.abs(pct) > SBFA_TOLERANCIA_PCT) fueraTol++;
            } else if (decl > 0 && res <= 0) {
                pendientes++;
            }
        });
        return { totDecl, totRes, totDif: totRes - totDecl, fueraTol, pendientes, medidas };
    }

    // Una descarga está "completa" cuando se le hizo la medición a TODO: cada fila
    // y cada DAP con cantidad declarada tiene su resultante cargada. Las descargas
    // completas se archivan solas (pasan al Historial) — ver guardarSbfaDescarga.
    function sbfaDescargaCompleta(d) {
        let medidas = 0, pendientes = 0;
        (d.filas || []).forEach(f => {
            const decl = Number(f.kgDeclarados) || 0;
            const res = Number(f.kgResultantes) || 0;
            if (decl > 0 && res > 0) medidas++;
            else if (decl > 0) pendientes++;
        });
        (d.dap || []).forEach(x => {
            const doc = Number(x.cantDoctada) || 0;
            const res = Number(x.cantResult) || 0;
            if (doc > 0 && res > 0) medidas++;
            else if (doc > 0) pendientes++;
        });
        return medidas > 0 && pendientes === 0;
    }

    function sbfaDescargaMatch(d, filtro) {
        if (!filtro) return true;
        const f = filtro.toUpperCase().trim();
        if ((d.buque || "").toUpperCase().includes(f)) return true;
        if ((d.manifiesto || "").toUpperCase().includes(f)) return true;
        if ((d.agencia || "").toUpperCase().includes(f)) return true;
        if ((d.cuit || "").toUpperCase().includes(f)) return true;
        // Buscar también dentro de filas (Cto, Sol Part, mercadería, receptor, SBFA, medic, tk)
        const enFilas = (d.filas || []).some(row =>
            ["solPart", "cto", "mercaderia", "receptor", "sbfa", "medic", "tkDestino"].some(k =>
                String(row[k] || "").toUpperCase().includes(f)
            )
        );
        if (enFilas) return true;
        // Buscar en DAP
        const enDap = (d.dap || []).some(x =>
            ["documento", "cto", "obs"].some(k =>
                String(x[k] || "").toUpperCase().includes(f)
            )
        );
        return enDap;
    }

    function renderSbfaLista(filtro = "", modo = "activas") {
        const esHist = modo === "historial";
        const cont = document.getElementById(esHist ? "sbfaHistLista" : "sbfaLista");
        if (!cont) return;
        const items = (sbfaConfig.descargas || [])
            .filter(d => !d.anulada) // tombstones: ocultar descargas borradas
            .filter(d => esHist ? d.archivada : !d.archivada) // historial = descargas terminadas
            .filter(d => sbfaDescargaMatch(d, filtro))
            .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || (b.id || 0) - (a.id || 0));

        if (!items.length) {
            cont.innerHTML = esHist
                ? `<p style="color:var(--gray-500)">Todavía no hay descargas en el historial. Una descarga pasa acá sola cuando se completa la medición de todas sus filas.</p>`
                : `<p style="color:var(--gray-500)">No hay descargas registradas. Para crear una, andá a la pestaña <strong>Barcos</strong> y tocá <strong>📋 Cargar SB/FA</strong> en el barco que corresponda.</p>`;
            return;
        }
        cont.innerHTML = items.map(d => {
            const r = sbfaResumen(d);
            const claseFuera = r.fueraTol > 0 ? "sbfa-card requiere-acta" : "sbfa-card";
            const fechaTxt = d.fecha ? d.fecha.split("-").reverse().join("/") : "—";
            const difPct = r.totDecl > 0 && r.totRes > 0 ? r.totDif / r.totDecl * 100 : 0;

            let estado;
            if (r.fueraTol > 0) {
                // No es un error: las diferencias > tolerancia son justamente lo que dispara el acta de denuncia
                estado = `<span style="color:#d97706;font-weight:600">📋 ${r.fueraTol} para Acta de Denuncia</span>`;
            } else if (r.pendientes > 0 && r.medidas === 0) {
                estado = `<span style="color:#1e40af;font-weight:600">⏳ Pendiente medición (${r.pendientes} fila${r.pendientes > 1 ? "s" : ""})</span>`;
            } else if (r.pendientes > 0) {
                estado = `<span style="color:#1e40af;font-weight:600">⏳ ${r.pendientes} pendiente${r.pendientes > 1 ? "s" : ""} · ${r.medidas} medida${r.medidas > 1 ? "s" : ""}</span>`;
            } else if (r.medidas > 0) {
                estado = `<span style="color:#16a34a">✓ Dentro de tolerancia</span>`;
            } else {
                estado = `<span style="color:var(--gray-500)">Sin filas cargadas</span>`;
            }

            return `<div class="${claseFuera}" data-sbfa-id="${d.id}">
                <div class="sbfa-card-header">
                    <div>
                        <div class="sbfa-card-titulo">${d.buque || "(sin buque)"} — MANI ${d.manifiesto || "—"}</div>
                        <div class="sbfa-card-meta">${fechaTxt} · ${(d.filas || []).length} sol. particular · ${(d.dap || []).length} DAP${d.archivada && d.archivadaTs ? ` · 📦 archivada ${d.archivadaTs.slice(0, 10).split("-").reverse().join("/")}` : ""}</div>
                    </div>
                    ${estado}
                </div>
                <div class="sbfa-card-totales">
                    <span><strong>Declarados:</strong> ${sbfaFmt(r.totDecl)} kg</span>
                    <span><strong>Resultantes:</strong> ${sbfaFmt(r.totRes)} kg</span>
                    ${r.totRes > 0 ? `<span><strong>Dif:</strong> ${sbfaFmt(r.totDif)} kg (${sbfaFmtPct(difPct)})</span>` : ""}
                </div>
            </div>`;
        }).join("");
        cont.querySelectorAll("[data-sbfa-id]").forEach(el => {
            el.addEventListener("click", () => abrirSbfaEditor(Number(el.dataset.sbfaId)));
        });
    }

    // ---- AUTO-GUARDADO en localStorage ----
    const SBFA_BORRADOR_PREFIX = "sbfaBorrador_";
    let _sbfaAutoSaveTimer = null;

    function sbfaBorradorKey(id) { return SBFA_BORRADOR_PREFIX + (id || "nuevo"); }

    function sbfaGuardarBorrador() {
        if (document.getElementById("sbfaEditor").classList.contains("hidden")) return;
        try {
            const d = sbfaArmarDescarga();
            const key = sbfaBorradorKey(sbfaEditandoId || "nuevo");
            localStorage.setItem(key, JSON.stringify({ ...d, _ts: Date.now() }));
        } catch (e) { /* localStorage lleno o privado: ignorar silenciosamente */ }
    }

    function sbfaLeerBorrador(id) {
        try {
            const raw = localStorage.getItem(sbfaBorradorKey(id || "nuevo"));
            if (!raw) return null;
            const obj = JSON.parse(raw);
            // Borradores de más de 7 días se descartan
            if (obj._ts && Date.now() - obj._ts > 7 * 24 * 3600 * 1000) {
                localStorage.removeItem(sbfaBorradorKey(id || "nuevo"));
                return null;
            }
            return obj;
        } catch (e) { return null; }
    }

    function sbfaLimpiarBorrador(id) {
        try { localStorage.removeItem(sbfaBorradorKey(id || "nuevo")); } catch (e) {}
    }

    function sbfaIniciarAutoSave() {
        if (_sbfaAutoSaveTimer) clearInterval(_sbfaAutoSaveTimer);
        _sbfaAutoSaveTimer = setInterval(sbfaGuardarBorrador, 30000); // cada 30s
    }

    function sbfaDetenerAutoSave() {
        if (_sbfaAutoSaveTimer) { clearInterval(_sbfaAutoSaveTimer); _sbfaAutoSaveTimer = null; }
    }

    // Compara dos descargas SOLO por su contenido editable (ignora id, ts, anulada, etc.)
    function sbfaDescargasIguales(a, b) {
        if (!a || !b) return !a && !b;
        const norm = (d) => JSON.stringify({
            buque: (d.buque || "").trim().toUpperCase(),
            manifiesto: (d.manifiesto || "").trim(),
            agencia: (d.agencia || "").trim(),
            cuit: (d.cuit || "").trim(),
            fecha: d.fecha || "",
            filas: (d.filas || []).filter(f => Object.values(f).some(v => v !== "" && v !== null && v !== undefined)),
            dap: (d.dap || []).filter(x => Object.values(x).some(v => v !== "" && v !== null && v !== undefined)),
        });
        return norm(a) === norm(b);
    }

    function abrirSbfaEditor(id) {
        const editor = document.getElementById("sbfaEditor");
        const eliminarBtn = document.getElementById("btnSbfaEliminar");
        if (id) {
            const d = (sbfaConfig.descargas || []).find(x => x.id === id && !x.anulada);
            if (!d) return;
            sbfaEditandoId = id;
            document.getElementById("sbfaEditorTitulo").textContent = `Editando ${d.buque || ""} — MANI ${d.manifiesto || ""}`;
            document.getElementById("sbfaBuque").value = d.buque || "";
            document.getElementById("sbfaManifiesto").value = d.manifiesto || "";
            document.getElementById("sbfaAgencia").value = d.agencia || "B&M";
            document.getElementById("sbfaCuit").value = d.cuit || "30-71631314-6";
            document.getElementById("sbfaFecha").value = d.fecha || "";
            renderSbfaTablaFilas(d.filas || []);
            renderSbfaTablaDap(d.dap || []);
            eliminarBtn.style.display = "";
        } else {
            sbfaEditandoId = null;
            document.getElementById("sbfaEditorTitulo").textContent = "Nueva descarga";
            document.getElementById("sbfaBuque").value = "";
            document.getElementById("sbfaManifiesto").value = "";
            document.getElementById("sbfaAgencia").value = "";
            document.getElementById("sbfaCuit").value = "";
            document.getElementById("sbfaFecha").value = new Date().toISOString().slice(0, 10);
            const notaInput = document.getElementById("sbfaNotaNumero");
            if (notaInput) notaInput.value = "";
            // 6 filas por default para ir cargando particulares antes del arribo
            renderSbfaTablaFilas([{}, {}, {}, {}, {}, {}]);
            renderSbfaTablaDap([{}]);
            eliminarBtn.style.display = "";
        }

        // Recuperar borrador SI Y SOLO SI:
        //  1) existe en localStorage
        //  2) su contenido es DIFERENTE al de la descarga guardada (descarte de borradores idénticos)
        //  3) su _ts es posterior al actualizadoTs de la descarga
        const borrador = sbfaLeerBorrador(sbfaEditandoId);
        const guardada = sbfaEditandoId
            ? sbfaConfig.descargas.find(x => x.id === sbfaEditandoId) || null
            : null;
        const borradorDistinto = borrador && !sbfaDescargasIguales(borrador, guardada);
        const borradorPosterior = borrador && (
            !guardada || !guardada.actualizadoTs ||
            new Date(borrador._ts).getTime() > new Date(guardada.actualizadoTs).getTime()
        );

        if (borrador && borradorDistinto && borradorPosterior) {
            const fechaTxt = new Date(borrador._ts).toLocaleString("es-AR");
            // Detalle de qué cambia: contar filas pre/post completas en cada versión
            const contar = (d) => (d?.filas || []).filter(f => Object.values(f || {}).some(v => v !== "" && v !== null && v !== undefined)).length;
            const filasBorrador = contar(borrador);
            const filasGuardada = contar(guardada);
            const msg = `Hay un borrador sin guardar de esta descarga del ${fechaTxt}.\n\n` +
                `Filas con datos:\n` +
                `   • Versión guardada: ${filasGuardada}\n` +
                `   • Borrador: ${filasBorrador}\n\n` +
                `¿Recuperás el borrador? (Cancelar = mantener la versión guardada)`;
            if (confirm(msg)) {
                document.getElementById("sbfaBuque").value = borrador.buque || "";
                document.getElementById("sbfaManifiesto").value = borrador.manifiesto || "";
                document.getElementById("sbfaAgencia").value = borrador.agencia || "";
                document.getElementById("sbfaCuit").value = borrador.cuit || "";
                document.getElementById("sbfaFecha").value = borrador.fecha || "";
                renderSbfaTablaFilas(borrador.filas?.length ? borrador.filas : [{}, {}, {}, {}, {}, {}]);
                renderSbfaTablaDap(borrador.dap?.length ? borrador.dap : [{}]);
            } else {
                sbfaLimpiarBorrador(sbfaEditandoId);
            }
        } else if (borrador) {
            // Borrador existente pero idéntico/obsoleto: limpiar para evitar confusión futura
            sbfaLimpiarBorrador(sbfaEditandoId);
        }

        editor.classList.remove("hidden");
        editor.scrollIntoView({ behavior: "smooth", block: "start" });
        sbfaIniciarAutoSave();
    }

    function cerrarSbfaEditor() {
        document.getElementById("sbfaEditor").classList.add("hidden");
        sbfaDetenerAutoSave();
        sbfaEditandoId = null;
    }

    function renderSbfaTablaFilas(filas) {
        const tbody = document.querySelector("#sbfaTablaFilas tbody");
        tbody.innerHTML = filas.map((f, i) => sbfaFilaHTML(f, i)).join("");
        sbfaBindFilaEvents();
        sbfaRecalcularTotales();
    }

    function sbfaFmtKgInput(n) {
        if (n === null || n === undefined || n === "") return "";
        const num = Math.round(Number(n));
        if (isNaN(num)) return "";
        return num.toLocaleString("es-AR");
    }

    function sbfaParseKg(str) {
        // Acepta solo enteros: descarta cualquier caracter que no sea dígito o signo
        if (str === null || str === undefined || str === "") return null;
        const limpio = String(str).replace(/[^\d-]/g, "");
        if (limpio === "" || limpio === "-") return null;
        const n = parseInt(limpio, 10);
        return isNaN(n) ? null : n;
    }

    function sbfaFilaHTML(f, i) {
        return `<tr data-i="${i}">
            <td class="col-pre col-part"><input data-k="solPart" value="${f.solPart || ""}" placeholder="1883"></td>
            <td class="col-pre col-cto"><input data-k="cto" value="${f.cto || ""}" placeholder="OTUS 35-A-B"></td>
            <td class="col-pre col-producto"><input data-k="mercaderia" value="${f.mercaderia || ""}" placeholder="ISOPAR L"></td>
            <td class="col-pre col-empresa"><input data-k="receptor" value="${f.receptor || ""}" placeholder="BRENTAG-PBB"></td>
            <td class="col-pre col-num col-kg-pre"><input data-k="kgDeclarados" data-kg inputmode="numeric" value="${sbfaFmtKgInput(f.kgDeclarados)}" placeholder="0" maxlength="9"></td>
            <td class="col-pre col-tk"><input data-k="tkDestino" value="${f.tkDestino || ""}" placeholder="61-67"></td>
            <td class="col-post col-sbfa"><input data-k="sbfa" value="${f.sbfa || ""}"></td>
            <td class="col-post col-medic"><input data-k="medic" value="${f.medic || ""}"></td>
            <td class="col-post col-num col-kg-post"><input data-k="kgResultantes" data-kg inputmode="numeric" value="${sbfaFmtKgInput(f.kgResultantes)}" placeholder="0" maxlength="9"></td>
            <td class="dif-kg col-dif-kg" data-difkg>0</td>
            <td class="dif-pct col-dif-pct" data-difpct>0,00%</td>
            <td class="col-borrar"><button class="btn-borrar-fila" data-borrar="${i}" title="Borrar fila">×</button></td>
        </tr>`;
    }

    function sbfaBloquearDecimales(e) {
        // Los Kg son enteros: bloquear coma, punto, "e" (notación científica)
        if (e.key === "," || e.key === "." || e.key === "e" || e.key === "E") {
            e.preventDefault();
        }
    }

    function sbfaTabPorGrupo(e) {
        // Tab navega solo dentro del mismo grupo (col-pre o col-post). Si estás
        // cargando pre-arribo no querés pasar por los campos post-medición vacíos.
        if (e.key !== "Tab") return;
        const inp = e.target;
        const td = inp.closest("td");
        if (!td) return;
        const grupo = td.classList.contains("col-pre")
            ? "col-pre"
            : td.classList.contains("col-post") ? "col-post" : null;
        if (!grupo) return;
        const tbody = inp.closest("tbody");
        if (!tbody) return;
        const inputs = Array.from(tbody.querySelectorAll(`td.${grupo} input`));
        const idx = inputs.indexOf(inp);
        if (idx === -1) return;
        const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
        if (nextIdx >= 0 && nextIdx < inputs.length) {
            e.preventDefault();
            inputs[nextIdx].focus();
            inputs[nextIdx].select();
        }
        // Si nextIdx queda fuera de rango → comportamiento default (sale de la tabla)
    }

    function sbfaFormatearInputKg(inp) {
        // Reformatea con separadores de miles preservando posición del cursor
        const raw = inp.value;
        const cursor = inp.selectionStart || 0;
        const digitsBefore = (raw.slice(0, cursor).match(/\d/g) || []).length;
        const num = sbfaParseKg(raw);
        const formateado = num === null ? "" : num.toLocaleString("es-AR");
        if (formateado === raw) return;
        inp.value = formateado;
        // Restaurar cursor al N-ésimo dígito
        let nuevoCursor = formateado.length;
        let dig = 0;
        for (let i = 0; i < formateado.length; i++) {
            if (/\d/.test(formateado[i])) {
                dig++;
                if (dig === digitsBefore) { nuevoCursor = i + 1; break; }
            }
        }
        try { inp.setSelectionRange(nuevoCursor, nuevoCursor); } catch (_) {}
    }

    function sbfaBindFilaEvents() {
        document.querySelectorAll("#sbfaTablaFilas tbody input").forEach(inp => {
            inp.addEventListener("keydown", sbfaTabPorGrupo);
            if (inp.dataset.kg !== undefined) {
                inp.addEventListener("keydown", sbfaBloquearDecimales);
                inp.addEventListener("input", () => {
                    sbfaFormatearInputKg(inp);
                    sbfaRecalcularTotales();
                });
            } else {
                inp.addEventListener("input", sbfaRecalcularTotales);
            }
        });
        document.querySelectorAll("#sbfaTablaFilas [data-borrar]").forEach(b => {
            b.addEventListener("click", () => {
                const idx = Number(b.dataset.borrar);
                const filas = sbfaLeerFilas();
                filas.splice(idx, 1);
                renderSbfaTablaFilas(filas);
            });
        });
    }

    function sbfaLeerFilas() {
        return Array.from(document.querySelectorAll("#sbfaTablaFilas tbody tr")).map(tr => {
            const obj = {};
            tr.querySelectorAll("input[data-k]").forEach(inp => {
                if (inp.dataset.kg !== undefined) {
                    obj[inp.dataset.k] = sbfaParseKg(inp.value);
                } else {
                    obj[inp.dataset.k] = inp.value.trim();
                }
            });
            return obj;
        });
    }

    function sbfaRecalcularTotales() {
        let totDecl = 0, totRes = 0;
        document.querySelectorAll("#sbfaTablaFilas tbody tr").forEach(tr => {
            const decl = sbfaParseKg(tr.querySelector('[data-k="kgDeclarados"]').value) || 0;
            const res = sbfaParseKg(tr.querySelector('[data-k="kgResultantes"]').value) || 0;
            totDecl += decl;
            totRes += res;
            const tdKg = tr.querySelector("[data-difkg]");
            const tdPct = tr.querySelector("[data-difpct]");
            // Solo calcular y mostrar diferencias si AMBOS valores están cargados
            if (decl > 0 && res > 0) {
                const { dif, pct } = sbfaCalcDif(decl, res);
                tdKg.textContent = sbfaFmt(dif);
                tdPct.textContent = sbfaFmtPct(pct);
                const fuera = Math.abs(pct) > SBFA_TOLERANCIA_PCT;
                tdKg.classList.toggle("fuera-tol", fuera);
                tdPct.classList.toggle("fuera-tol", fuera);
                tdKg.classList.toggle("dentro-tol", !fuera);
                tdPct.classList.toggle("dentro-tol", !fuera);
                tdKg.classList.remove("pendiente-tol");
                tdPct.classList.remove("pendiente-tol");
            } else if (decl > 0 || res > 0) {
                // Pendiente: una de las dos partes cargada, la otra no
                tdKg.textContent = "—";
                tdPct.textContent = "pendiente";
                tdKg.classList.remove("fuera-tol", "dentro-tol");
                tdPct.classList.remove("fuera-tol", "dentro-tol");
                tdKg.classList.add("pendiente-tol");
                tdPct.classList.add("pendiente-tol");
            } else {
                tdKg.textContent = "";
                tdPct.textContent = "";
                tdKg.classList.remove("fuera-tol", "dentro-tol", "pendiente-tol");
                tdPct.classList.remove("fuera-tol", "dentro-tol", "pendiente-tol");
            }
        });
        document.getElementById("sbfaTotalDecl").textContent = sbfaFmt(totDecl);
        document.getElementById("sbfaTotalRes").textContent = totRes > 0 ? sbfaFmt(totRes) : "—";
        document.getElementById("sbfaTotalDif").textContent = totRes > 0 ? sbfaFmt(totRes - totDecl) : "—";
        document.getElementById("sbfaTotalDifPct").textContent = totRes > 0 && totDecl > 0 ? sbfaFmtPct((totRes - totDecl) / totDecl * 100) : "—";

        // DAP — misma lógica
        let totDoc = 0, totDapRes = 0;
        document.querySelectorAll("#sbfaTablaDap tbody tr").forEach(tr => {
            const doc = sbfaParseKg(tr.querySelector('[data-k="cantDoctada"]').value) || 0;
            const res = sbfaParseKg(tr.querySelector('[data-k="cantResult"]').value) || 0;
            totDoc += doc;
            totDapRes += res;
            const tdKg = tr.querySelector("[data-difkg]");
            const tdPct = tr.querySelector("[data-difpct]");
            if (doc > 0 && res > 0) {
                const { dif, pct } = sbfaCalcDif(doc, res);
                tdKg.textContent = sbfaFmt(dif);
                tdPct.textContent = sbfaFmtPct(pct);
                const fuera = Math.abs(pct) > SBFA_TOLERANCIA_PCT;
                tdKg.classList.toggle("fuera-tol", fuera);
                tdPct.classList.toggle("fuera-tol", fuera);
                tdKg.classList.remove("pendiente-tol");
                tdPct.classList.remove("pendiente-tol");
            } else if (doc > 0 || res > 0) {
                tdKg.textContent = "—";
                tdPct.textContent = "pendiente";
                tdKg.classList.remove("fuera-tol");
                tdPct.classList.remove("fuera-tol");
                tdKg.classList.add("pendiente-tol");
                tdPct.classList.add("pendiente-tol");
            } else {
                tdKg.textContent = "";
                tdPct.textContent = "";
                tdKg.classList.remove("fuera-tol", "pendiente-tol");
                tdPct.classList.remove("fuera-tol", "pendiente-tol");
            }
        });
        document.getElementById("sbfaDapTotalDoc").textContent = sbfaFmt(totDoc);
        document.getElementById("sbfaDapTotalRes").textContent = totDapRes > 0 ? sbfaFmt(totDapRes) : "—";
        document.getElementById("sbfaDapTotalDif").textContent = totDapRes > 0 ? sbfaFmt(totDapRes - totDoc) : "—";
        document.getElementById("sbfaDapTotalDifPct").textContent = totDapRes > 0 && totDoc > 0 ? sbfaFmtPct((totDapRes - totDoc) / totDoc * 100) : "—";
    }

    function renderSbfaTablaDap(items) {
        const tbody = document.querySelector("#sbfaTablaDap tbody");
        tbody.innerHTML = items.map((d, i) => sbfaDapHTML(d, i)).join("");
        sbfaBindDapEvents();
        sbfaRecalcularTotales();
    }

    function sbfaDapHTML(d, i) {
        return `<tr data-i="${i}">
            <td class="dap-doc"><input data-k="documento" value="${d.documento || ""}"></td>
            <td class="dap-cto"><input data-k="cto" value="${d.cto || ""}"></td>
            <td class="col-num dap-doctada"><input data-k="cantDoctada" data-kg inputmode="numeric" value="${sbfaFmtKgInput(d.cantDoctada)}" placeholder="0" maxlength="9"></td>
            <td class="col-num dap-result"><input data-k="cantResult" data-kg inputmode="numeric" value="${sbfaFmtKgInput(d.cantResult)}" placeholder="0" maxlength="9"></td>
            <td class="dif-kg dap-difkg" data-difkg>0</td>
            <td class="dif-pct dap-difpct" data-difpct>0,00%</td>
            <td class="col-borrar"><button class="btn-borrar-fila" data-borrar="${i}" title="Borrar">×</button></td>
        </tr>`;
    }

    function sbfaBindDapEvents() {
        document.querySelectorAll("#sbfaTablaDap tbody input").forEach(inp => {
            if (inp.dataset.kg !== undefined) {
                inp.addEventListener("keydown", sbfaBloquearDecimales);
                inp.addEventListener("input", () => {
                    sbfaFormatearInputKg(inp);
                    sbfaRecalcularTotales();
                });
            } else {
                inp.addEventListener("input", sbfaRecalcularTotales);
            }
        });
        document.querySelectorAll("#sbfaTablaDap [data-borrar]").forEach(b => {
            b.addEventListener("click", () => {
                const idx = Number(b.dataset.borrar);
                const items = sbfaLeerDap();
                items.splice(idx, 1);
                renderSbfaTablaDap(items);
            });
        });
    }

    function sbfaLeerDap() {
        return Array.from(document.querySelectorAll("#sbfaTablaDap tbody tr")).map(tr => {
            const obj = {};
            tr.querySelectorAll("input[data-k]").forEach(inp => {
                if (inp.dataset.kg !== undefined) {
                    obj[inp.dataset.k] = sbfaParseKg(inp.value);
                } else {
                    obj[inp.dataset.k] = inp.value.trim();
                }
            });
            return obj;
        });
    }

    function sbfaArmarDescarga() {
        return {
            id: sbfaEditandoId || Date.now(),
            buque: document.getElementById("sbfaBuque").value.trim().toUpperCase(),
            manifiesto: document.getElementById("sbfaManifiesto").value.trim(),
            agencia: document.getElementById("sbfaAgencia").value.trim(),
            cuit: document.getElementById("sbfaCuit").value.trim(),
            fecha: document.getElementById("sbfaFecha").value,
            filas: sbfaLeerFilas().filter(f => Object.values(f).some(v => v !== "" && v !== null)),
            dap: sbfaLeerDap().filter(d => Object.values(d).some(v => v !== "" && v !== null)),
            actualizadoPor: usuarioActual,
            actualizadoTs: new Date().toISOString(),
        };
    }

    // Saca un buque del seguimiento de Barcos (barcos.json). Lo usa el archivado
    // automático de SB/FA. No pide confirmación (a diferencia de quitarBarco()).
    async function sbfaSacarBarcoDelSeguimiento(buque) {
        const bU = (buque || "").trim().toUpperCase();
        if (!bU) return false;
        const antes = (barcosConfig.barcos || []).length;
        barcosConfig.barcos = (barcosConfig.barcos || []).filter(b => (b.nombre || "").trim().toUpperCase() !== bU);
        if (barcosConfig.barcos.length === antes) return false; // no estaba en seguimiento
        return await guardarBarcosCfg();
    }

    async function guardarSbfaDescarga() {
        const btn = document.getElementById("btnSbfaGuardar");
        let d;
        try {
            d = sbfaArmarDescarga();
        } catch (e) {
            console.error("[sbfa] error armando la descarga:", e);
            mostrarModalInfo("No se pudo leer la descarga del formulario: " + e.message, "Error al guardar");
            return;
        }
        if (!d.buque) { mostrarModalInfo("Falta el nombre del buque.", "No se puede guardar"); return; }
        const i = sbfaConfig.descargas.findIndex(x => x.id === d.id);
        // Archivado automático: si la medición está completa, la descarga pasa al
        // Historial y el buque se saca del seguimiento. Se recalcula en cada guardado:
        // si se borra una medición y deja de estar completa, vuelve a Descargas.
        const estabaArchivada = i >= 0 && !!sbfaConfig.descargas[i].archivada;
        let recienArchivada = false;
        if (sbfaDescargaCompleta(d)) {
            d.archivada = true;
            d.archivadaTs = (estabaArchivada && sbfaConfig.descargas[i].archivadaTs) || new Date().toISOString();
            recienArchivada = !estabaArchivada;
        }
        if (i >= 0) sbfaConfig.descargas[i] = d;
        else sbfaConfig.descargas.push(d);
        const txtPrev = btn ? btn.textContent : "";
        if (btn) { btn.disabled = true; btn.textContent = "⏳ Guardando…"; }
        let ok = false;
        try {
            ok = await guardarSbfaCfg();
        } catch (e) {
            console.error("[sbfa] guardarSbfaCfg lanzó:", e);
            ok = false;
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = txtPrev; }
        }
        if (!ok) {
            const det = sbfaUltimoErrorGuardado ? `<br><br><strong>Detalle:</strong> ${sbfaUltimoErrorGuardado}` : "";
            mostrarModalInfo(`No se pudo guardar la descarga en GitHub. Revisá la conexión y volvé a intentar.${det}`, "Error al guardar");
            return;
        }
        // Limpiar borradores de AMBAS keys posibles (la nueva y la del id)
        sbfaLimpiarBorrador(sbfaEditandoId);
        sbfaLimpiarBorrador(null);  // por si era nueva descarga, limpiar "sbfaBorrador_nuevo"
        sbfaEditandoId = d.id;
        // Reset del timer del auto-save: que la próxima ejecución sea 30s desde ahora,
        // no inmediata, y así no se genere un borrador idéntico al guardado.
        sbfaIniciarAutoSave();

        // Si recién se archivó (medición completa): sacar el buque del seguimiento.
        let barcoSacado = false;
        if (recienArchivada) {
            try { barcoSacado = await sbfaSacarBarcoDelSeguimiento(d.buque); }
            catch (e) { console.error("[sbfa] no se pudo sacar el barco del seguimiento:", e); }
        }

        try {
            mostrarAlerta(`Descarga ${d.buque} guardada.`, "info");
            renderSbfaLista(document.getElementById("sbfaFiltro")?.value || "", "activas");
            renderSbfaLista(document.getElementById("sbfaHistFiltro")?.value || "", "historial");
            if (typeof renderBarcos === "function") renderBarcos();
        } catch (e) {
            console.error("[sbfa] error re-renderizando tras guardar (la descarga SÍ se guardó):", e);
        }
        const manifTxt = d.manifiesto ? ` (MANI ${d.manifiesto})` : " (manifiesto pendiente)";
        if (recienArchivada) {
            const bTxt = barcoSacado ? ` y el buque se sacó del seguimiento de <strong>Barcos</strong>` : "";
            mostrarModalInfo(`✓ Descarga del buque <strong>${d.buque}</strong>${manifTxt} guardada.<br><br>La medición está completa, así que pasó al <strong>Historial</strong> de SB/FA${bTxt}.`, "Descarga terminada → Historial");
        } else {
            mostrarModalInfo(`✓ Descarga del buque <strong>${d.buque}</strong>${manifTxt} guardada correctamente.`, "Descarga guardada");
        }
    }

    async function eliminarSbfaDescarga() {
        if (!sbfaEditandoId) { cerrarSbfaEditor(); return; }
        const pass = prompt("Para eliminar una descarga SB/FA, ingresá la contraseña del usuario JULIAN:");
        if (pass === null) return; // canceló
        if (pass !== USUARIOS.julian) {
            alert("Contraseña incorrecta. La descarga NO se eliminó.");
            return;
        }
        if (!confirm("¿Confirmás la eliminación? No se puede deshacer.")) return;
        // Soft-delete (tombstone): marcar como anulada en lugar de quitarla del array.
        // Así el borrado se propaga correctamente cuando otros admins sincronizan.
        const i = sbfaConfig.descargas.findIndex(x => x.id === sbfaEditandoId);
        if (i >= 0) {
            sbfaConfig.descargas[i].anulada = true;
            sbfaConfig.descargas[i].anuladaTs = new Date().toISOString();
            sbfaConfig.descargas[i].anuladaPor = usuarioActual;
        }
        if (await guardarSbfaCfg()) {
            sbfaLimpiarBorrador(sbfaEditandoId);
            cerrarSbfaEditor();
            renderSbfaLista(document.getElementById("sbfaFiltro")?.value || "", "activas");
            renderSbfaLista(document.getElementById("sbfaHistFiltro")?.value || "", "historial");
            if (typeof renderBarcos === "function") renderBarcos();
            mostrarAlerta("Descarga eliminada.", "info");
        }
    }

    function sbfaFmtFechaLarga(iso) {
        const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        const f = iso ? new Date(iso + "T00:00:00") : new Date();
        return `${f.getDate()} de ${meses[f.getMonth()]} ${f.getFullYear()}`;
    }

    function sbfaFmtFechaCorta(iso) {
        if (!iso) return new Date().toLocaleDateString("es-AR");
        const [y, m, d] = iso.split("-");
        return `${d}/${m}/${y}`;
    }

    function imprimirInformeSbfa() {
        const d = sbfaArmarDescarga();
        if (!d.buque || !d.manifiesto) { alert("Falta buque o manifiesto."); return; }

        const filas = (d.filas || []).filter(f => Object.values(f).some(v => v !== "" && v !== null));
        const dap = (d.dap || []).filter(x => Object.values(x).some(v => v !== "" && v !== null));
        const fueraTol = filas.filter(f => {
            const decl = Number(f.kgDeclarados) || 0;
            const res = Number(f.kgResultantes) || 0;
            if (decl <= 0 || res <= 0) return false;
            return Math.abs((res - decl) / decl * 100) > SBFA_TOLERANCIA_PCT;
        });

        const numeroNota = (document.getElementById("sbfaNotaNumero").value || "").trim() || "____";
        const anioNota = new Date().getFullYear();
        const hoy = new Date().toLocaleDateString("es-AR");
        const fechaLarga = sbfaFmtFechaLarga();
        const fechaDescarga = sbfaFmtFechaCorta(d.fecha);

        const fmt = n => (n === null || n === undefined || isNaN(n)) ? "" : Math.round(Number(n)).toLocaleString("es-AR");
        const fmtPct = p => (p === null || p === undefined || isNaN(p)) ? "" : (p.toFixed(2).replace(".", ",") + "%");

        // Totales
        let totDecl = 0, totRes = 0;
        filas.forEach(f => {
            totDecl += Number(f.kgDeclarados) || 0;
            totRes += Number(f.kgResultantes) || 0;
        });
        const totDif = totRes - totDecl;
        const totPct = totDecl > 0 ? totDif / totDecl * 100 : 0;

        let totDoc = 0, totDapRes = 0;
        dap.forEach(x => {
            totDoc += Number(x.cantDoctada) || 0;
            totDapRes += Number(x.cantResult) || 0;
        });
        const totDapDif = totDapRes - totDoc;
        const totDapPct = totDoc > 0 ? totDapDif / totDoc * 100 : 0;

        // Planilla agrupada por producto: ordena alfabéticamente por mercaderia y
        // agrega un subtotal por grupo (kg declarados / resultantes / dif / %).
        const filasOrdenadas = filas.slice().sort((a, b) =>
            String(a.mercaderia || "").localeCompare(String(b.mercaderia || ""))
        );
        let filasHtml = "";
        let grupoActual = null;
        let subDecl = 0, subRes = 0, subCount = 0;
        const cerrarGrupo = () => {
            if (subCount > 0) {
                const subDif = subRes - subDecl;
                const subPct = subDecl > 0 ? subDif / subDecl * 100 : 0;
                filasHtml += `<tr class="subtotal">
                    <th colspan="4" style="text-align:right">SUBTOTAL ${grupoActual || ""}</th>
                    <th class="num">${fmt(subDecl)}</th>
                    <th colspan="3"></th>
                    <th class="num">${fmt(subRes)}</th>
                    <th class="num">${fmt(subDif)}</th>
                    <th class="num">${fmtPct(subPct)}</th>
                </tr>
                <tr class="separador"><td colspan="11"></td></tr>`;
            }
            subDecl = 0; subRes = 0; subCount = 0;
        };
        filasOrdenadas.forEach(f => {
            const prod = (f.mercaderia || "").trim();
            if (prod !== grupoActual) {
                cerrarGrupo();
                grupoActual = prod;
            }
            const decl = Number(f.kgDeclarados) || 0;
            const res = Number(f.kgResultantes) || 0;
            const dif = res - decl;
            const pct = decl > 0 ? dif / decl * 100 : 0;
            const fuera = decl > 0 && res > 0 && Math.abs(pct) > SBFA_TOLERANCIA_PCT;
            subDecl += decl; subRes += res; subCount++;
            filasHtml += `<tr class="${fuera ? "fuera" : ""}">
                <td>${f.solPart || ""}</td>
                <td>${f.cto || ""}</td>
                <td>${prod}</td>
                <td>${f.receptor || ""}</td>
                <td class="num">${fmt(decl)}</td>
                <td>${f.tkDestino || ""}</td>
                <td>${f.sbfa || ""}</td>
                <td>${f.medic || ""}</td>
                <td class="num">${fmt(res)}</td>
                <td class="num">${fmt(dif)}</td>
                <td class="num">${fmtPct(pct)}</td>
            </tr>`;
        });
        cerrarGrupo();

        const dapHtml = dap.map(x => {
            const doc = Number(x.cantDoctada) || 0;
            const res = Number(x.cantResult) || 0;
            const dif = res - doc;
            const pct = doc > 0 ? dif / doc * 100 : 0;
            const fuera = doc > 0 && res > 0 && Math.abs(pct) > SBFA_TOLERANCIA_PCT;
            return `<tr class="${fuera ? "fuera" : ""}">
                <td>${x.documento || ""}</td>
                <td>${x.cto || ""}</td>
                <td class="num">${fmt(doc)}</td>
                <td class="num">${fmt(res)}</td>
                <td class="num">${fmt(dif)}</td>
                <td class="num">${fmtPct(pct)}</td>
                <td>${x.obs || ""}</td>
            </tr>`;
        }).join("");

        const fueraHtml = fueraTol.map(f => {
            const decl = Number(f.kgDeclarados) || 0;
            const res = Number(f.kgResultantes) || 0;
            const dif = res - decl;
            const pct = decl > 0 ? dif / decl * 100 : 0;
            return `<tr>
                <td>${f.solPart || ""}</td>
                <td>${f.cto || ""}</td>
                <td>${f.mercaderia || ""}</td>
                <td>${f.receptor || ""}</td>
                <td class="num">${fmt(decl)}</td>
                <td>${f.tkDestino || ""}</td>
                <td>${f.sbfa || ""}</td>
                <td class="num">${fmt(res)}</td>
                <td class="num">${fmt(dif)}</td>
                <td class="num">${fmtPct(pct)}</td>
            </tr>`;
        }).join("");

        const listaFueras = fueraTol.map(f => {
            const decl = Number(f.kgDeclarados) || 0;
            const res = Number(f.kgResultantes) || 0;
            const dif = res - decl;
            return `<li>${f.cto || f.solPart || "—"} (${f.mercaderia || "s/d"}, dif. ${dif > 0 ? "+" : ""}${fmt(dif)} kg)</li>`;
        }).join("");

        const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Informe SBFA — ${d.buque} — MANI ${d.manifiesto}</title>
<style>
@page { size: A4 portrait; margin: 1.4cm; }
@page page-detalle { size: A4 landscape; margin: 1.2cm; }
body { font-family: 'Times New Roman', Times, serif; font-size: 10pt; color: #111; margin: 0; padding: 0; }
.pagina { page-break-after: always; }
.pagina:last-child { page-break-after: auto; }
.detalle { page: page-detalle; }
.header-arca { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.7rem; }
.logo-arca { background: #1e3a8a; padding: 6px; border-radius: 4px; }
.logo-arca svg { display: block; height: 38px; width: auto; }
.org { font-size: 9pt; line-height: 1.25; }
.org strong { font-size: 10pt; }
h1.titulo { text-align: center; font-size: 16pt; margin: 0.4rem 0 0.6rem; padding: 0.3rem; border: 1.5px solid #000; background: #f3f4f6; letter-spacing: 0.05em; }
h2.subt { font-size: 11pt; margin: 0.6rem 0 0.3rem; }
.subtitulo-detalle { font-size: 11pt; font-weight: bold; margin-bottom: 0.4rem; }
.meta { font-size: 9pt; margin-bottom: 0.4rem; }
table { width: 100%; border-collapse: collapse; font-size: 8pt; margin: 0.3rem 0; }
table th, table td { border: 0.5px solid #6b7280; padding: 3px 4px; vertical-align: middle; }
table thead th { background: #e5e7eb; font-weight: bold; text-align: left; }
table tfoot th { background: #f3f4f6; font-weight: bold; text-align: right; }
table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table tr.fuera td { background: #fee2e2; }
table tr.fuera td.num { color: #b91c1c; font-weight: bold; }
table tr.subtotal th { background: #fef3c7; font-weight: bold; font-size: 8pt; border-top: 1.5px solid #000; }
table tr.subtotal th.num { text-align: right; font-variant-numeric: tabular-nums; }
table tr.separador td { border: none; height: 10px; padding: 0; background: #fff; }
.recuadro { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; }
.recuadro > div { padding: 4px 8px; border-right: 1px solid #000; }
.recuadro > div:last-child { border-right: none; }
.recuadro .label { background: #e5e7eb; font-weight: bold; font-size: 8pt; }
.checkboxes { border: 1px solid #000; padding: 6px 10px; margin: 0.4rem 0; font-size: 10pt; text-align: center; }
/* ===== Acta de Denuncia OM-2090 ===== */
.acta-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; }
.acta-logo-arca { background: #1e3a8a; padding: 6px 8px; border: 1px solid #000; }
.acta-logo-arca img { height: 32px; display: block; }
.acta-logo-leyenda { font-size: 7pt; font-weight: bold; text-align: center; line-height: 1.2; margin-top: 2px; }
.acta-codigo-box { border: 1px solid #000; min-width: 230px; }
.acta-codigo-box-row { display: grid; grid-template-columns: 1fr 1fr; }
.acta-codigo-box-row > div { padding: 3px 6px; font-size: 8pt; text-align: center; }
.acta-codigo-box-row > div:first-child { border-right: 1px solid #000; }
.acta-codigo-box-header { background: #fff; font-weight: bold; border-bottom: 1px solid #000; }
.acta-codigo-box-data { min-height: 24px; }
.acta-titulo { text-align: center; font-size: 13pt; font-weight: bold; margin: 0.6rem 0 0.5rem; letter-spacing: 0.04em; }
.acta-lugar-fecha { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin: 0.4rem 0 0.6rem; font-size: 9pt; }
.acta-lugar-fecha > div { border-bottom: 1px solid #000; padding: 0.2rem 0.5rem 0.1rem; text-align: center; }
.acta-lugar-fecha .lbl { border-bottom: none; font-size: 8pt; padding: 0; margin-top: 2px; color: #4b5563; }
.acta-checks { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 8px; margin: 0.4rem 0; font-size: 8pt; }
.acta-checks .ch { display: flex; align-items: center; gap: 4px; }
.acta-checks .ch-box { display: inline-block; width: 11px; height: 11px; border: 1px solid #000; text-align: center; line-height: 9px; font-size: 9pt; flex-shrink: 0; }
.acta-checks .ch-box.checked { font-weight: bold; }
.acta-section-title { background: #e5e7eb; border: 1px solid #000; font-weight: bold; font-size: 9pt; padding: 3px 6px; text-align: center; margin-top: 0.4rem; }
.acta-tabla { width: 100%; border-collapse: collapse; font-size: 8pt; }
.acta-tabla th, .acta-tabla td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
.acta-tabla th { background: #f3f4f6; font-weight: bold; text-align: center; font-size: 8pt; }
.acta-tabla td.vacio { height: 20px; }
.acta-relacion { border: 1px solid #000; min-height: 80px; padding: 6px 8px; font-size: 9pt; line-height: 1.35; text-align: justify; border-top: none; }
.acta-ratifica { display: flex; align-items: center; gap: 4px; margin-top: 0.4rem; font-size: 9pt; padding: 3px 6px; }
.acta-firma-receptor { text-align: right; margin-top: 0.4rem; font-size: 8pt; }
.acta-firma-receptor .linea { border-top: 1px solid #000; display: inline-block; min-width: 200px; padding-top: 2px; margin-bottom: 2px; }
.acta-om { font-size: 7pt; color: #4b5563; margin-top: 0.5rem; }
.acta-denunciantes-box { border: 2px solid #000; padding: 0.4rem; margin-top: 0.6rem; }
.acta-denunciantes-titulo { font-weight: bold; font-size: 9pt; }
.acta-pagina2-section { border: 1px solid #000; margin-top: 0.4rem; }
.acta-pagina2-section .head { background: #f3f4f6; padding: 3px 6px; font-weight: bold; font-size: 9pt; border-bottom: 1px solid #000; display: flex; gap: 0.5rem; }
.acta-pagina2-section .body { padding: 6px 8px; font-size: 9pt; line-height: 1.45; }
.acta-firma-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; margin-top: 1rem; font-size: 8pt; text-align: center; }
.acta-firma-3 > div { border-top: 1px solid #000; padding-top: 2px; }
.cuerpo p { line-height: 1.4; text-align: justify; margin: 0.4rem 0; }
.firma-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem; text-align: center; font-size: 10pt; }
.firma-grid .linea { border-top: 1px solid #000; padding-top: 0.3rem; margin-top: 2rem; }
.notas { font-size: 8pt; color: #374151; margin-top: 0.4rem; }
@media print { .no-print { display: none !important; } }
.no-print { position: fixed; top: 10px; right: 10px; padding: 8px 12px; background: #1e3a8a; color: #fff; border: none; cursor: pointer; font-size: 12pt; border-radius: 4px; z-index: 9999; }
</style></head><body>

<button class="no-print" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>

<!-- ============== PÁGINA 1: DETALLE SBFA ============== -->
<section class="pagina detalle">
${headerArcaHtml()}
<div class="subtitulo-detalle">Detalle resultante del ingreso de MANI N° <strong>${d.manifiesto}</strong></div>
<div class="meta">B/T <strong>${d.buque}</strong> · AGENCIA MARÍTIMA <strong>${d.agencia || ""}</strong> · CUIT N° <strong>${d.cuit || ""}</strong> · Fecha: <strong>${fechaDescarga}</strong></div>

<table>
<thead>
<tr>
<th>Part. N°</th><th>Cto. N°</th><th>Producto</th><th>Empresa</th><th class="num">Kg.</th><th>Tk.</th>
<th>SBFA N°</th><th>Medic. N°</th><th class="num">Kg.</th>
<th class="num">Dif. Kg.</th><th class="num">Dif. %</th>
</tr>
</thead>
<tbody>
${filasHtml || `<tr><td colspan="11" style="text-align:center;color:#6b7280">Sin filas cargadas</td></tr>`}
</tbody>
<tfoot>
<tr>
<th colspan="4">TOTALES</th>
<th class="num">${fmt(totDecl)}</th>
<th colspan="3"></th>
<th class="num">${fmt(totRes)}</th>
<th class="num">${fmt(totDif)}</th>
<th class="num">${fmtPct(totPct)}</th>
</tr>
</tfoot>
</table>

${dap.length ? `
<h2 class="subt">Conocimientos con destinación Aduanera Directos a Plaza (DAP)</h2>
<table>
<thead>
<tr><th>Documento Aduanero</th><th>Cto. N°</th><th class="num">Cant. Doctada</th><th class="num">Cant. Result.</th><th class="num">Dif. Kg.</th><th class="num">Dif. %</th><th>Observaciones</th></tr>
</thead>
<tbody>${dapHtml}</tbody>
<tfoot>
<tr><th colspan="2">TOTALES DAP</th>
<th class="num">${fmt(totDoc)}</th>
<th class="num">${fmt(totDapRes)}</th>
<th class="num">${fmt(totDapDif)}</th>
<th class="num">${fmtPct(totDapPct)}</th>
<th></th></tr>
</tfoot>
</table>` : ""}

</section>

<!-- ============== PÁGINA 2: ACTA DE DENUNCIA — OM-2090 (página 1) ============== -->
<section class="pagina">
${actaHeaderHtml(numeroNota, anioNota)}

<div class="acta-titulo">ACTA DE DENUNCIA</div>

<div class="acta-lugar-fecha">
<div>Campana, Provincia de Buenos Aires<div class="lbl">Lugar</div></div>
<div>${hoy}<div class="lbl">Fecha</div></div>
</div>

<div class="acta-checks">
<div class="ch"><span class="ch-box checked">X</span> COMPARENDO PERSONAL</div>
<div class="ch"><span class="ch-box"></span> TELEFÓNICA</div>
<div class="ch"><span class="ch-box"></span> DE OFICIO</div>
<div class="ch"><span class="ch-box"></span> SE AGREGA</div>
<div class="ch"><span class="ch-box"></span> ANÓNIMA</div>
<div class="ch"><span class="ch-box"></span> POSTAL</div>
<div class="ch"><span class="ch-box"></span> OTROS MEDIOS</div>
<div class="ch"><span class="ch-box"></span> SE AGREGA</div>
</div>

<div class="acta-section-title">RELACIÓN DEL/LOS HECHO/S DENUNCIADO/S:</div>
<div class="acta-relacion">
Sobrante / Faltante a la descarga.
</div>

<div class="acta-section-title">LUGAR EN QUE OCURREN:</div>
<table class="acta-tabla">
<thead>
<tr>
<th rowspan="2" style="width:35%">DOMICILIO</th>
<th rowspan="2" style="width:25%">LOCALIDAD</th>
<th rowspan="2" style="width:25%">PROVINCIA</th>
<th colspan="2" style="width:15%">ACOMPAÑA CROQUIS</th>
</tr>
<tr><th style="width:7.5%">SI</th><th style="width:7.5%">NO</th></tr>
</thead>
<tbody>
<tr>
<td>Ribera del Río Paraná km. 93,4</td>
<td>Campana</td>
<td>Buenos Aires</td>
<td style="text-align:center"></td>
<td style="text-align:center">X</td>
</tr>
</tbody>
</table>

<div class="acta-section-title">DATOS DEL/LOS DENUNCIADO/S:</div>
<table class="acta-tabla">
<thead><tr><th style="width:35%">APELLIDOS Y NOMBRES O RAZÓN SOCIAL</th><th style="width:25%">TIPO Y N° DE DOCUMENTO</th><th style="width:40%">DOMICILIO</th></tr></thead>
<tbody>
<tr><td>Agencia ${d.agencia || ""}</td><td>CUIT ${d.cuit || ""}</td><td></td></tr>
</tbody>
</table>

<div class="acta-section-title">DATOS DEL/LOS TESTIGO/S Y/U OTRO MEDIO DE PRUEBA:</div>
<table class="acta-tabla">
<thead><tr><th style="width:35%">APELLIDOS Y NOMBRES</th><th style="width:25%">TIPO Y N° DE DOCUMENTO</th><th style="width:40%">DOMICILIO</th></tr></thead>
<tbody>
<tr><td class="vacio"></td><td class="vacio"></td><td class="vacio"></td></tr>
</tbody>
</table>

<div class="acta-ratifica">
RATIFICA DENUNCIA: SI <span class="ch-box checked" style="margin:0 4px">X</span> NO <span class="ch-box" style="margin:0 4px"></span>
</div>

<div class="acta-firma-receptor">
<div class="linea">&nbsp;</div><br>
<strong>FIRMA Y SELLO AGENTE RECEPTOR</strong><br>
<span style="font-size:7pt">(NECESARIAMENTE)</span>
</div>

<div class="acta-denunciantes-box">
<div class="acta-denunciantes-titulo">AGENCIA DE RECAUDACIÓN Y CONTROL ADUANERO</div>
<div style="font-size:11pt;font-weight:bold;margin:2px 0">DENUNCIANTE/S</div>
<div style="font-size:8pt;font-style:italic">(en caso de ratificar denuncia)</div>

<table class="acta-tabla" style="margin-top:0.4rem">
<thead><tr><th style="width:35%">APELLIDOS Y NOMBRES</th><th style="width:25%">TIPO Y N° DE DOCUMENTO</th><th style="width:40%">DOMICILIO</th></tr></thead>
<tbody>
<tr><td>IGLESIAS, JULIAN</td><td>DNI L30388-7</td><td>Luis Costa 651 — Campana</td></tr>
<tr><td>ESCALANTE, CESAR</td><td>DNI 25929-2</td><td>Luis Costa 651 — Campana</td></tr>
<tr><td>ROMANO, CLAUDIA</td><td>DNI 25549-1</td><td>Luis Costa 651 — Campana</td></tr>
</tbody>
</table>

<div style="margin-top:0.4rem;font-size:9pt">
SOLICITA RESERVA DE IDENTIDAD: SI <span class="ch-box" style="margin:0 4px"></span> NO <span class="ch-box checked" style="margin:0 4px">X</span> <em>(Proceder Conforme)</em><br>
FIRMA DENUNCIANTE/S:
</div>

<div class="acta-firma-receptor">
<div class="linea">&nbsp;</div><br>
<strong>FIRMA Y SELLO AGENTE RECEPTOR</strong><br>
<span style="font-size:7pt">(NECESARIAMENTE)</span>
</div>
</div>

<div class="acta-om">OM - 2090</div>
</section>

<!-- ============== PÁGINA 3: OM-2090 (página 2) — uso administrativo ============== -->
<section class="pagina">

<div class="acta-pagina2-section">
<div class="head"><span style="width:18px">1.</span> AUTORIDAD ADUANERA RECEPTORA</div>
<div class="body">
<div style="display:grid;grid-template-columns:18px 1fr;gap:6px"><span>1.1.</span><div>
<div style="display:flex;gap:1.5rem;align-items:end">
<div style="flex:1;border-bottom:1px solid #000;padding:0 4px;font-size:9pt">Buenos Aires,</div>
<div style="flex:1;border-bottom:1px solid #000;padding:0 4px"></div>
</div>
<div style="display:flex;gap:1.5rem;font-size:7pt;color:#4b5563"><div style="flex:1;text-align:center">Lugar</div><div style="flex:1;text-align:center">Fecha</div></div>
<p style="margin:0.4rem 0">Al SR. JUEZ ADMINISTRATIVO, en los términos del art. 1.082, C.A.<br>Previamente, regístrese.</p>
<div style="text-align:right;margin-top:1rem"><div style="display:inline-block;border-top:1px solid #000;padding-top:2px;min-width:200px"><strong>FUNCIONARIO RESPONSABLE</strong></div></div>
</div></div>
<hr style="margin:0.4rem 0;border:none;border-top:1px solid #000">
<div style="display:grid;grid-template-columns:18px 1fr;gap:6px"><span>1.2.</span><div>
<div style="display:flex;gap:1.5rem;align-items:end">
<div style="flex:1;border-bottom:1px solid #000;padding:0 4px;height:14px"></div>
<div style="flex:1;border-bottom:1px solid #000;padding:0 4px;height:14px"></div>
</div>
<div style="display:flex;gap:1.5rem;font-size:7pt;color:#4b5563"><div style="flex:1;text-align:center">Lugar</div><div style="flex:1;text-align:center">Fecha</div></div>
<p style="margin:0.4rem 0">PROCÉDASE A INVESTIGAR.</p>
<div style="text-align:right;margin-top:1rem"><div style="display:inline-block;border-top:1px solid #000;padding-top:2px;min-width:200px"><strong>FUNCIONARIO RESPONSABLE</strong></div></div>
</div></div>
</div>
</div>

<div class="acta-pagina2-section">
<div class="head" style="justify-content:center">RESULTADO DE LA INVESTIGACIÓN</div>
<div class="body">
<div style="display:flex;gap:2rem;font-size:9pt;margin-bottom:0.4rem">
<div><span class="ch-box"></span> NEGATIVO — ARCHÍVESE</div>
<div><span class="ch-box"></span> POSITIVO — DAR CURSO SEGÚN 1.1.</div>
</div>
<div>OBSERVACIONES:</div>
<div style="border-bottom:1px solid #000;height:14px;margin:0.2rem 0"></div>
<div style="border-bottom:1px solid #000;height:14px;margin:0.2rem 0"></div>
<div style="border-bottom:1px solid #000;height:14px;margin:0.2rem 0"></div>
<div style="margin-top:0.5rem;font-size:9pt">SE ADOPTARON MEDIDAS PRECAUTORIAS:
<span class="ch-box" style="margin:0 4px"></span> AFIRMATIVO — DAR CURSO SEGÚN 1.1.
<span class="ch-box" style="margin:0 4px"></span> NEGATIVO</div>
<div class="acta-firma-3"><div>Lugar</div><div>Fecha</div><div>P/SECRETARÍA DE CONTROL</div></div>
</div>
</div>

<div class="acta-pagina2-section">
<div class="head"><span style="width:18px">2.</span> INFORMACIÓN DE LA AUTORIDAD DE SUMARIO A POLICÍA ADUANERA</div>
<div class="body">
<p>RECAYÓ RESOLUCIÓN/FALLO N° ____________ / __________, QUE SI/NO SE ENCUENTRA FIRME.</p>
<p>SE DIO SI/NO CUMPLIMIENTO OM-2032.</p>
<div class="acta-firma-3"><div>Lugar</div><div>Fecha</div><div>P/AUTORIDAD DEL SUMARIO</div></div>
</div>
</div>

<div class="acta-pagina2-section">
<div class="head"><span style="width:18px">3.</span> INFORMACIÓN DEL SERVICIO JURÍDICO A POLICÍA ADUANERA</div>
<div style="font-size:8pt;font-style:italic;text-align:center;border-bottom:1px solid #000;padding:2px">( EN CASO DE HABERSE INTERPUESTO RECURSO )</div>
<div class="body">
<p>TRAMITA CAUSA ____________________________________ POR ANTE ____________________________________</p>
<p>RECAYÓ SENTENCIA: <span class="ch-box" style="margin:0 4px"></span> CONFIRMA &nbsp; <span class="ch-box" style="margin:0 4px"></span> REVOCA &nbsp; <span class="ch-box" style="margin:0 4px"></span> OTRA (EXPLICAR) ____________</p>
<p>QUE SI/NO SE ENCUENTRA FIRME.</p>
<p style="margin-top:0.4rem">TRAMITA CAUSA ____________________________________ POR ANTE ____________________________________</p>
<p>RECAYÓ SENTENCIA: <span class="ch-box" style="margin:0 4px"></span> CONFIRMA ANTERIOR &nbsp; <span class="ch-box" style="margin:0 4px"></span> REVOCA ANTERIOR &nbsp; <span class="ch-box" style="margin:0 4px"></span> OTRO (EXPLICAR) ____________</p>
<p style="margin-top:0.4rem">PRESCRIBE ____________________________________</p>
<div class="acta-firma-3"><div>Lugar</div><div>Fecha</div><div>INFORMANTE</div></div>
</div>
</div>
</section>

<!-- ============== PÁGINA 3: NOTA SBFA ============== -->
<section class="pagina">
<div style="font-size:11pt;line-height:1.5">
<p><strong>Actuación Inicial:</strong></p>
<p>CAMPANA, ${fechaLarga}</p>
<p><strong>Nota N°: ${numeroNota} / ${anioNota} (DF TAGSA)</strong></p>
<p style="margin-top:0.8rem">Al Señor Jefe de Oficina Cargas a Granel y Tanques Fiscales:</p>
<p><strong>Asunto:</strong> SB/FA B/T <strong>${d.buque}</strong> — MANI <strong>${d.manifiesto}</strong></p>

<div class="cuerpo" style="margin-top:0.6rem">
<p>Quien suscribe, agente <strong>IGLESIAS, JULIAN</strong> — Legajo 30388-7, destacado como medidor en el depósito fiscal TAGSA, informa a Ud. que:</p>

<p>Finalizada la descarga e ingreso a depósito fiscal de la mercadería arribada en el B/T del asunto (MANI N° ${d.manifiesto}, descargado el ${sbfaFmtFechaLarga(d.fecha)}), resultó como se detalla en hoja adjunta.</p>

${fueraTol.length ? `
<p>Tal como se puede observar del citado detalle, <strong>${fueraTol.length} conocimiento(s) se hallan fuera de la tolerancia de ley</strong> establecida por el punto 12.1, Anexo II de la Resolución 2220/1990:</p>
<ul style="margin:0.3rem 0 0.6rem 1.4rem;padding:0">${listaFueras}</ul>` : `
<p>Tal como se puede observar del citado detalle, los conocimientos se hallan dentro de la tolerancia de ley establecida por el punto 12.1, Anexo II de la Resolución 2220/1990.</p>`}

<p>Respecto a los conocimientos que se hallan dentro de la tolerancia indicada, de acuerdo a instrucciones emanadas verbalmente por esa jefatura, se procedió a justificar y presentar, respectivamente en el SIM, los SB/FA generadas por la permisionaria.</p>

<p>Sin otro particular se eleva el presente informe para su conocimiento y fines que estime corresponder.</p>

<p><strong>Para mejor proveer se adjunta:</strong> MANI SIM; Planillas de medición y Sobrantes Faltantes.</p>
</div>

<div style="margin-top:3rem;text-align:center">
<div style="border-top:1px solid #000;width:60%;margin:0 auto;padding-top:0.3rem">
<strong>IGLESIAS, JULIAN</strong><br>
<span style="font-size:10pt">Legajo 30388-7 — Agente medidor — DF TAGSA</span>
</div>
</div>
</div>
</section>

<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 300); });</script>
</body></html>`;

        const w = window.open("", "_blank", "width=900,height=1100");
        if (!w) { alert("No se pudo abrir la ventana de impresión. Revisá los popups bloqueados."); return; }
        w.document.write(html);
        w.document.close();
    }

    function headerArcaHtml() {
        // URL absoluta del logo (la ventana popup tiene URL about:blank y no resuelve relativas)
        const logoUrl = new URL("img/logo-arca.svg", window.location.href).href;
        return `<div class="header-arca">
            <div class="logo-arca">
                <img src="${logoUrl}" style="height:38px;display:block" alt="ARCA">
            </div>
            <div class="org">
                <strong>AGENCIA DE RECAUDACIÓN Y CONTROL ADUANERO</strong><br>
                Dirección General de Aduanas<br>
                Depósito Fiscal TAGSA — Odfjell Terminals Tagsa SA — Campana
            </div>
        </div>`;
    }

    function actaHeaderHtml(numeroNota, anioNota) {
        // Header del Acta de Denuncia OM-2090: logo a la izquierda + recuadro código a la derecha
        const logoUrl = new URL("img/logo-arca.svg", window.location.href).href;
        return `<div class="acta-header">
            <div>
                <div class="acta-logo-arca"><img src="${logoUrl}" alt="ARCA"></div>
                <div class="acta-logo-leyenda">
                    AGENCIA DE RECAUDACIÓN<br>
                    Y CONTROL ADUANERO<br>
                    <span style="font-weight:normal">Dirección General de Aduanas</span>
                </div>
            </div>
            <div class="acta-codigo-box">
                <div class="acta-codigo-box-row acta-codigo-box-header">
                    <div>CÓDIGO ORIGEN</div>
                    <div>NÚMERO Y AÑO</div>
                </div>
                <div class="acta-codigo-box-row">
                    <div class="acta-codigo-box-data">DF-TAGSA</div>
                    <div class="acta-codigo-box-data">${numeroNota || ""} / ${anioNota || ""}</div>
                </div>
            </div>
        </div>`;
    }

    function irASbfaDesdeBarco(buque) {
        // Cambiar a pestaña SB/FA
        const tabBtn = document.querySelector('.tab[data-tab="sbfa"]');
        if (tabBtn) tabBtn.click();
        const buqueU = (buque || "").toUpperCase();

        // Buscar descargas existentes del buque con cargas pendientes
        // (filas con kgDeclarados pero sin kgResultantes, o sin filas todavía)
        const candidatas = (sbfaConfig.descargas || [])
            .filter(d => !d.anulada && (d.buque || "").toUpperCase() === buqueU)
            .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || (b.id || 0) - (a.id || 0));

        const pendiente = candidatas.find(d => {
            if (!d.filas || !d.filas.length) return true;
            return d.filas.some(f => (Number(f.kgDeclarados) || 0) > 0 && !(Number(f.kgResultantes) > 0));
        });

        if (pendiente) {
            abrirSbfaEditor(pendiente.id);
            mostrarAlerta(`Abriendo descarga existente de ${buque} (con cargas pendientes).`, "info");
        } else {
            // Nueva descarga pre-cargada con buque y fecha de hoy
            abrirSbfaEditor(null);
            document.getElementById("sbfaBuque").value = buque;
            document.getElementById("sbfaBuque").focus();
            mostrarAlerta(`Nueva descarga para ${buque}. Cargá manifiesto y solicitudes particulares.`, "info");
        }
    }

    function verDescargasSbfaDeBarco(buque) {
        const tabBtn = document.querySelector('.tab[data-tab="sbfa"]');
        if (tabBtn) tabBtn.click();
        const filtro = document.getElementById("sbfaFiltro");
        if (filtro) {
            filtro.value = buque;
            filtro.dispatchEvent(new Event("input"));
        }
        cerrarSbfaEditor();
    }

    async function inicializarSbfa() {
        await cargarSbfaCfg();
        renderSbfaLista("", "activas");
        renderSbfaLista("", "historial");
        // Re-renderizar barcos para que cada card muestre el conteo de descargas SB/FA del buque
        if (typeof renderBarcos === "function") renderBarcos();

        document.getElementById("btnSbfaCancelar").addEventListener("click", cerrarSbfaEditor);
        document.getElementById("btnSbfaGuardar").addEventListener("click", guardarSbfaDescarga);
        document.getElementById("btnSbfaEliminar").addEventListener("click", eliminarSbfaDescarga);
        document.getElementById("btnSbfaAddFila").addEventListener("click", () => {
            const filas = sbfaLeerFilas();
            filas.push({});
            renderSbfaTablaFilas(filas);
        });
        document.getElementById("btnSbfaAddDap").addEventListener("click", () => {
            const items = sbfaLeerDap();
            items.push({});
            renderSbfaTablaDap(items);
        });
        document.getElementById("btnSbfaImprimir").addEventListener("click", imprimirInformeSbfa);
        document.getElementById("sbfaFiltro").addEventListener("input", e => renderSbfaLista(e.target.value, "activas"));
        const sbfaHistFiltroInp = document.getElementById("sbfaHistFiltro");
        if (sbfaHistFiltroInp) sbfaHistFiltroInp.addEventListener("input", e => renderSbfaLista(e.target.value, "historial"));

        // Polling: traer descargas SB/FA cargadas por otro usuario cada 45s.
        setInterval(sincronizarSbfaDesdeRemoto, 45000);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") sincronizarSbfaDesdeRemoto();
        });
    }

    // --- INIT ---
    paso1.classList.add("active");
    renderStock();
    renderHistorial();
    inputTanque.focus();
}

// Arrancar login al cargar
document.addEventListener("DOMContentLoaded", initLogin);
