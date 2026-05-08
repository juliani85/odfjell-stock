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
const GMAIL_CLIENT_ID = "933883889395-ofaj2ikjfgk227so46qm06o65htra0hm.apps.googleusercontent.com";
let gmailTokenClient = null;

function requestGmailToken(opts = {}) {
    return new Promise((resolve, reject) => {
        if (!gmailTokenClient) {
            try {
                if (typeof google === "undefined" || !google.accounts || !google.accounts.oauth2) {
                    return reject(new Error("Google Identity Services no cargó todavía. Refrescá la página (Ctrl+Shift+R) y probá de nuevo."));
                }
                gmailTokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: GMAIL_CLIENT_ID,
                    scope: "https://www.googleapis.com/auth/gmail.readonly",
                    callback: () => {},
                });
            } catch (e) {
                return reject(e);
            }
        }
        gmailTokenClient.callback = (resp) => {
            if (resp.error) reject(new Error(resp.error_description || resp.error));
            else resolve(resp.access_token);
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

    const runQuery = async (q) => {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=30`;
        const r = await gmailGet(url, token);
        return r.messages || [];
    };

    const qA = await runQuery('subject:"plan de cargas" newer_than:60d');
    const qB = await runQuery('subject:"plan de carga" newer_than:60d');
    const qC = await runQuery('subject:plan newer_than:60d');
    const mapa = new Map();
    [...qA, ...qB, ...qC].forEach(m => { if (!mapa.has(m.id)) mapa.set(m.id, m); });
    const candidates = [...mapa.values()];
    if (candidates.length === 0) {
        throw new Error(`Cuenta ${profileEmail}: no encontré mails con "plan" en el asunto. ¿Te loggeaste con tagsaaduana@gmail.com?`);
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
    for (const msgRef of candidates) {
        const msg = await gmailGet(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgRef.id}?format=full`, token);
        const subject = ((msg.payload.headers || []).find(h => h.name.toLowerCase() === "subject")?.value || "").trim();
        if (!/plan\s+de\s+cargas?/i.test(subject)) {
            console.log(`[plan] descartado (no contiene "plan de carga(s)"): "${subject}"`);
            descartados.push({ subject, motivo: "asunto no matchea" });
            continue;
        }
        const fecha = extraerFecha(subject);
        if (!fecha) {
            console.log(`[plan] descartado (no se pudo extraer fecha del asunto): "${subject}"`);
            descartados.push({ subject, motivo: "fecha no parseable" });
            continue;
        }

        const att = buscarAdjuntoExcel(msg.payload);
        let filasExcel = [];
        let filename = "";
        if (att) {
            filename = att.filename;
            try {
                filasExcel = await parsearFilasExcel(msgRef, att, token);
            } catch (e) {
                console.warn(`[plan] error parseando Excel de "${subject}":`, e);
            }
        }

        const cuerpo = extraerCuerpoMail(msg.payload);
        let bloques = parsearBloquesDesdeHTML(cuerpo.html);
        if (bloques.length === 0) bloques = parsearBloquesDesdeTexto(cuerpo.plain);
        const filasProsa = bloques.length === 0 ? parsearSalidasDesdeBody(cuerpoATexto(cuerpo)) : [];

        const filasAgregar = [];
        const filasAnular = [];
        for (const b of bloques) {
            if (b.accion === "anular") filasAnular.push(...b.filas);
            else filasAgregar.push(...b.filas);
        }
        filasAgregar.push(...filasProsa);

        console.log(`[plan] "${subject}" → fecha=${fecha}, adjunto=${filename || "(ninguno)"}, filasExcel=${filasExcel.length}, agregar=${filasAgregar.length}, anular=${filasAnular.length}`);

        if (filasExcel.length === 0 && filasAgregar.length === 0 && filasAnular.length === 0) {
            console.warn(`[plan] sin filas. Primeros 800 chars del cuerpo plain del mail "${subject}":\n`, (cuerpo.plain || "").slice(0, 800));
            console.warn(`[plan] primeros 800 chars del cuerpo HTML:\n`, (cuerpo.html || "").slice(0, 800));
            descartados.push({ subject, motivo: "sin filas parseables (Excel, tabla pegada ni cuerpo)", fecha });
            continue;
        }

        if (!porFecha[fecha]) porFecha[fecha] = { filas: [], anuladas: [], fuentes: [] };
        porFecha[fecha].filas.push(...filasExcel, ...filasAgregar);
        porFecha[fecha].anuladas.push(...filasAnular);
        porFecha[fecha].fuentes.push({
            asunto: subject,
            filename: filename || "(cuerpo)",
            excelRows: filasExcel.length,
            agregarRows: filasAgregar.length,
            anularRows: filasAnular.length,
        });
    }

    if (Object.keys(porFecha).length === 0) {
        const detalle = descartados.length > 0
            ? ` Descartados: ${descartados.map(d => `"${d.subject}" (${d.motivo})`).join("; ")}`
            : "";
        throw new Error(`Cuenta ${profileEmail}: encontré mails con "plan" en el asunto pero ninguno con filas parseables.${detalle}`);
    }

    return { porFecha, descartados };
}

// --- GITHUB STORAGE ---
const GH = {
    _p: ["Z2hwX1lFS0k4","d1FLRmtobEtW","YlE1ODNpcU00","cks3WUpzazJi","YjYxag=="],
    get token() { return atob(this._p.join("")); },
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

    async cargar() {
        try {
            const res = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.file}`, {
                headers: { Authorization: `token ${this.token}` }
            });
            if (!res.ok) return null;
            const data = await res.json();
            this.sha = data.sha;
            const contenido = this._b64ToJson(data.content);
            return contenido;
        } catch (e) {
            return null;
        }
    },

    async refrescarSha() {
        try {
            const res = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.file}`, {
                headers: { Authorization: `token ${this.token}` }
            });
            if (res.ok) {
                const data = await res.json();
                this.sha = data.sha;
            } else if (res.status !== 404) {
                console.warn('[GH refrescarSha]', res.status);
            }
        } catch (e) {
            console.error('[GH refrescarSha]', e);
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
                // Leer remoto fresco (actualiza this.sha).
                let remoto = null;
                try {
                    const res = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.file}`, {
                        headers: { Authorization: `token ${this.token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        this.sha = data.sha;
                        remoto = this._b64ToJson(data.content);
                    } else if (res.status !== 404) {
                        throw new Error(`GitHub GET ${res.status}`);
                    }
                } catch (e) {
                    throw e;
                }

                const merged = merger(remoto);

                const datos = { ...merged, actualizado: new Date().toISOString() };
                const contenido = btoa(new TextEncoder().encode(JSON.stringify(datos)).reduce((s, b) => s + String.fromCharCode(b), ""));
                const body = {
                    message: `Actualizar datos ${new Date().toISOString().slice(0, 16)}`,
                    content: contenido
                };
                if (this.sha) body.sha = this.sha;

                const res = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.file}`, {
                    method: "PUT",
                    headers: {
                        Authorization: `token ${this.token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(body)
                });

                if (res.status === 409 || res.status === 422) {
                    console.warn('[GH sync stock] conflict, reintentando con remoto fresco');
                    continue;
                }
                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    throw new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`);
                }
                const data = await res.json();
                this.sha = data.content.sha;
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
            const res = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.fileVistas}`, {
                headers: { Authorization: `token ${this.token}` }
            });
            if (!res.ok) {
                if (res.status !== 404) console.warn('[GH cargarVistas]', res.status);
                return null;
            }
            const data = await res.json();
            this.shaVistas = data.sha;
            const contenido = this._b64ToJson(data.content);
            return { vistas: contenido.vistas || [], sim: contenido.sim || {} };
        } catch (e) {
            console.error('[GH cargarVistas]', e);
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
            const r = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.fileVistas}`, {
                headers: { Authorization: `token ${this.token}` }
            });
            if (r.ok) {
                const d = await r.json();
                this.shaVistas = d.sha;
            } else if (r.status === 404) {
                this.shaVistas = null;
            } else {
                throw new Error(`GitHub ${r.status} al refrescar sha de vistas`);
            }

            const datos = { vistas, sim, actualizado: new Date().toISOString() };
            const contenido = btoa(new TextEncoder().encode(JSON.stringify(datos)).reduce((s, b) => s + String.fromCharCode(b), ""));
            const body = {
                message: `Actualizar vistas ${new Date().toISOString().slice(0, 16)}`,
                content: contenido
            };
            if (this.shaVistas) body.sha = this.shaVistas;

            const res = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.fileVistas}`, {
                method: "PUT",
                headers: {
                    Authorization: `token ${this.token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`);
            }
            const data = await res.json();
            this.shaVistas = data.content.sha;
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
            const res = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.filePlan}`, {
                headers: { Authorization: `token ${this.token}` }
            });
            if (!res.ok) {
                if (res.status !== 404) console.warn('[GH cargarPlan]', res.status);
                return null;
            }
            const data = await res.json();
            this.shaPlan = data.sha;
            const contenido = this._b64ToJson(data.content);
            return contenido.planes || {};
        } catch (e) {
            console.error('[GH cargarPlan]', e);
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
        const planes = this._pendientePlan;
        try {
            const r = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.filePlan}`, {
                headers: { Authorization: `token ${this.token}` }
            });
            if (r.ok) {
                const d = await r.json();
                this.shaPlan = d.sha;
            } else if (r.status === 404) {
                this.shaPlan = null;
            } else {
                throw new Error(`GitHub ${r.status} al refrescar sha de plan`);
            }

            const datos = { planes, actualizado: new Date().toISOString() };
            const contenido = btoa(new TextEncoder().encode(JSON.stringify(datos)).reduce((s, b) => s + String.fromCharCode(b), ""));
            const body = {
                message: `Actualizar plan ${new Date().toISOString().slice(0, 16)}`,
                content: contenido
            };
            if (this.shaPlan) body.sha = this.shaPlan;

            const res = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.filePlan}`, {
                method: "PUT",
                headers: {
                    Authorization: `token ${this.token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`);
            }
            const data = await res.json();
            this.shaPlan = data.content.sha;
            if (this._pendientePlan === planes) this._pendientePlan = null;
        } catch (e) {
            console.error('[GH sync plan]', e);
            if (this._timerPlan) clearTimeout(this._timerPlan);
            this._timerPlan = setTimeout(() => this._enviarPlan(), 5000);
        } finally {
            this._enviandoPlan = false;
        }
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

    // Logout (registrar siempre, antes de cualquier return)
    document.getElementById("btnLogout").addEventListener("click", () => {
        sessionStorage.removeItem("usuarioStock");
        location.reload();
    });

    // Verificar sesión guardada
    const sesion = sessionStorage.getItem("usuarioStock");
    if (sesion && USUARIOS[sesion]) {
        usuarioActual = sesion;
        loginScreen.querySelector(".login-box").innerHTML = '<h2>Cargando datos...</h2><p class="login-subtitle">Conectando con el servidor</p>';
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
    let stock, historial, anulados;
    if (ghData && ghData.stock) {
        stock = ghData.stock;
        historial = ghData.historial || [];
        anulados = ghData.anulados || [];
        localStorage.setItem("stockTanquesV3", JSON.stringify(stock));
        localStorage.setItem("historialSalidasV3", JSON.stringify(historial));
        localStorage.setItem("anuladosV3", JSON.stringify(anulados));
    } else {
        stock = JSON.parse(localStorage.getItem("stockTanquesV3")) || JSON.parse(JSON.stringify(stockInicial));
        historial = JSON.parse(localStorage.getItem("historialSalidasV3")) || [];
        anulados = JSON.parse(localStorage.getItem("anuladosV3") || "[]");
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

        return cambios;
    }

    function rerenderAfterMerge() {
        renderStock();
        renderHistorial();
        renderPlan();
        if (document.getElementById("reporteDiario")?.classList.contains("active")) {
            renderReporteDiario();
        }
    }

    function guardarDatos() {
        localStorage.setItem("stockTanquesV3", JSON.stringify(stock));
        localStorage.setItem("historialSalidasV3", JSON.stringify(historial));
        localStorage.setItem("anuladosV3", JSON.stringify(anulados));
        GH.guardar((remoto) => {
            const cambios = mergearEntradasRemotas(remoto);
            if (cambios > 0) {
                localStorage.setItem("stockTanquesV3", JSON.stringify(stock));
                localStorage.setItem("historialSalidasV3", JSON.stringify(historial));
                localStorage.setItem("anuladosV3", JSON.stringify(anulados));
                rerenderAfterMerge();
                mostrarAlerta(`Se sincronizaron ${cambios} cambio(s) de otro usuario.`, "info");
            }
            return { stock, historial, anulados };
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

    function renombrarDespachoEnStock(tanqueObj, despachoViejo, despachoNuevo) {
        const desp = tanqueObj.despachos.find(d => d.despacho === despachoViejo);
        if (desp) desp.despacho = despachoNuevo;
        historial.forEach(h => {
            if (h.despacho === despachoViejo && h.tanque === tanqueObj.tanque) {
                h.despacho = despachoNuevo;
            }
        });
        renombrarDespachoEnPlan(tanqueObj.tanque, despachoViejo, despachoNuevo);
        guardarDatos();
    }

    function lanzarRenombrarDespacho(despachoObj) {
        const viejo = despachoObj.despacho;
        const stockViejo = despachoObj.stock;
        const inputNombreId = "inputRenombrarDesp";
        const inputKilosId = "inputRenombrarKilos";
        const errorId = "renombrarError";
        const html = `
            <p>El despacho <code>${viejo}</code> no cumple con el formato estándar (<strong>IC04</strong>, <strong>IC06</strong>, <strong>TRP</strong>, <strong>EC01</strong>, <strong>REMO</strong>, <strong>TRM6</strong> o <strong>IT14</strong>).</p>
            <p style="font-size:0.9rem;color:var(--gray-500);margin-bottom:0.25rem">Stock disponible: <strong>${formatKg(stockViejo)} kg</strong></p>
            <div class="form-group" style="margin-top:1rem">
                <label for="${inputNombreId}">Nuevo nombre del despacho</label>
                <input type="text" id="${inputNombreId}" placeholder="Ej: DI26IC04009999Z" style="font-family:monospace;text-transform:uppercase">
            </div>
            <div class="form-group" style="margin-top:0.75rem">
                <label for="${inputKilosId}">Kilos a migrar al nuevo nombre</label>
                <input type="number" id="${inputKilosId}" min="1" max="${stockViejo}" step="1" value="${stockViejo}" placeholder="Cantidad en kg">
            </div>
            <div id="${errorId}" class="alerta error hidden" style="margin-top:0.5rem"></div>
            <p style="font-size:0.8rem;color:var(--gray-500);margin-top:0.75rem">Si migrás <strong>todos</strong> los kilos, el despacho viejo desaparece y los movimientos previos del mismo tanque quedan renombrados. Si migrás <strong>una parte</strong>, se crea un despacho nuevo con esos kilos y el viejo queda con el saldo restante (útil cuando un despacho viejo representa varios despachos chicos).</p>
        `;
        document.getElementById("modalTitulo").textContent = "Renombrar despacho";
        document.getElementById("btnConfirmar").textContent = "Renombrar";
        modalBody.innerHTML = html;

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
            if (tanqueActual.despachos.some(d => d.despacho === nuevo)) {
                mostrarError(`Ya existe un despacho con el nombre "${nuevo}" en este tanque.`);
                return;
            }

            const esSplit = kilos < stockViejo;
            modal.classList.add("hidden");
            document.getElementById("btnConfirmar").textContent = "Confirmar";

            if (esSplit) {
                despachoObj.stock -= kilos;
                const nuevoDesp = { despacho: nuevo, stock: kilos };
                if (despachoObj.cliente) nuevoDesp.cliente = despachoObj.cliente;
                tanqueActual.despachos.push(nuevoDesp);
                guardarDatos();
                mostrarAlerta(`Despacho dividido: ${formatKg(kilos)} kg migrados de "${viejo}" a "${nuevo}". Saldo viejo: ${formatKg(despachoObj.stock)} kg`, "success");
            } else {
                renombrarDespachoEnStock(tanqueActual, viejo, nuevo);
                mostrarAlerta(`Despacho renombrado: "${viejo}" → "${nuevo}"`, "success");
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
    btnRegistrar.addEventListener("click", () => {
        if (!tanqueActual || !despachoActual) return;

        const kilos = parseInt(kilosInput.value) || 0;
        const remito = remitoInput.value.trim();

        if (kilos <= 0) { mostrarAlerta("Ingresá una cantidad válida.", "error"); return; }
        if (kilos > despachoActual.stock) { mostrarAlerta("Stock insuficiente.", "error"); return; }

        abrirConfirmacionSalida();
    });

    function abrirConfirmacionSalida() {
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

            const sufijoPlan = matchPlan ? " · ✓ Plan del día actualizado" : "";
            mostrarAlerta(`Salida registrada: ${formatKg(kilos)} kg del TK ${salida.tanque} - Despacho ${salida.despacho}. Saldo restante: ${formatKg(restante2)} kg${sufijoPlan}`, "success");
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

            return `<div class="stock-card" onclick="this.classList.toggle('open')">
                <div class="stock-card-header">
                    <div class="stock-card-left">
                        <span class="stock-card-tanque">TK ${t.tanque}</span>
                        <div>
                            <div class="stock-card-producto">${t.producto}</div>
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
        if (!confirm(`Anular remito ${salida.remito || "sin remito"}?\nSe devuelven ${formatKg(salida.kilos)} kg al despacho ${salida.despacho} del TK ${salida.tanque}.`)) return;

        const tanque = stock.find(t => t.tanque === salida.tanque);
        if (tanque) {
            const desp = tanque.despachos.find(d => d.despacho === salida.despacho);
            if (desp) desp.stock += salida.kilos;
        }

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
        });
    });

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
            return `<div class="stock-card rep-mensual-card${vacio ? ' rep-mensual-vacio' : ''}" onclick="this.classList.toggle('open')">
                <div class="stock-card-header">
                    <div class="stock-card-left">
                        <span class="stock-card-tanque">TK ${t.tanque}</span>
                        <div>
                            <div class="stock-card-producto">${productoMostrar}</div>
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
            ingInfoTanque.className = "info-box warning-box";
            ingInfoTanque.innerHTML = `<strong>Tanque ${num} vacío.</strong> Seleccioná el producto a ingresar.`;
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

        document.getElementById("modalTitulo").textContent = "Confirmar Ingreso";
        modalBody.innerHTML = `
            <p><strong>Tanque:</strong> TK ${ingTanqueActual.tanque}</p>
            <p><strong>Producto:</strong> ${producto}</p>
            <p><strong>Cliente:</strong> ${cliente}</p>
            <p><strong>Despacho:</strong> <code>${desp}</code></p>
            <p><strong>Kilos a ingresar:</strong> ${formatKg(kilos)} kg</p>
            <p><strong>Usuario:</strong> ${usuarioActual.toUpperCase()}</p>
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
        const plan = planes[hoyISO()];
        if (plan && plan.filas) {
            const pend = plan.filas.filter(f => !f.cumplido).length;
            if (pend > 0) {
                badge.textContent = pend;
                badge.classList.remove("hidden");
            } else {
                badge.classList.add("hidden");
            }
        } else {
            badge.classList.add("hidden");
        }
    }

    function renderPlan() {
        const fecha = getFechaPlan();
        let persistir = false;
        Object.values(planes).forEach(p => {
            if (!p || !p.filas) return;
            const antes = p.filas.length;
            p.filas = p.filas.filter(f => !despachoExcluidoDelPlan(f.despacho));
            if (p.filas.length !== antes) persistir = true;
        });
        if (autoMatchearPlan(fecha)) persistir = true;
        if (persistir) GH.guardarPlan(planes);
        const plan = planes[fecha];
        const tbody = document.querySelector("#tablaPlan tbody");
        const resumen = document.getElementById("planResumen");
        if (!tbody) return;

        if (!plan || !plan.filas || plan.filas.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No hay plan cargado para esta fecha. Usá <strong>Sincronizar con Gmail</strong> para importarlo.</td></tr>';
            if (resumen) resumen.classList.add("hidden");
            actualizarBadgePlan();
            return;
        }

        const pendientes = plan.filas.filter(f => !f.cumplido).length;
        const cumplidos = plan.filas.length - pendientes;

        if (resumen) resumen.classList.remove("hidden");
        document.getElementById("planTotalFilas").textContent = plan.filas.length;
        document.getElementById("planPendientes").textContent = pendientes;
        document.getElementById("planCumplidos").textContent = cumplidos;

        const filasOrdenadas = [...plan.filas].sort((a, b) =>
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
                !fi.cumplido &&
                fi.tanque === salida.tanque &&
                (fi.producto || "").toUpperCase() === (salida.producto || "").toUpperCase() &&
                normDespacho(fi.despacho) === despSalida
            );
            if (match) {
                match.cumplido = true;
                match.salidaId = salida.id;
                match.cumplidoAt = new Date().toISOString();
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
                    cambio = true;
                }
            });
        });
        if (cambio) GH.guardarPlan(planes);
    }

    function autoMatchearPlan(fecha) {
        const plan = planes[fecha];
        if (!plan || !plan.filas) return false;
        const salidasDia = historial.filter(h => (h.tipo || "SALIDA") === "SALIDA" && h.fecha === fecha);
        const yaMatcheadas = new Set();
        plan.filas.forEach(f => { if (f.salidaId) yaMatcheadas.add(f.salidaId); });
        let cambio = false;
        plan.filas.forEach(fila => {
            if (fila.cumplido) return;
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
        const existentesCumplidas = filasExistentes.filter(p => p.cumplido);
        const existentesPendientes = filasExistentes.filter(p => !p.cumplido);
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
            const resumenPorFecha = [];

            for (const [fecha, info] of Object.entries(porFecha)) {
                // 1. Aplicar anulaciones sobre filas existentes no cumplidas.
                let anuladasAplicadas = 0;
                let anuladasIgnoradas = 0;
                let existentes = (planes[fecha] && planes[fecha].filas) ? planes[fecha].filas : [];
                if (info.anuladas && info.anuladas.length > 0) {
                    const restantes = [];
                    for (const f of existentes) {
                        const match = info.anuladas.find(a =>
                            a.tanque === f.tanque &&
                            normDespacho(a.despacho) === normDespacho(f.despacho)
                        );
                        if (match) {
                            if (f.cumplido) {
                                anuladasIgnoradas++;
                                restantes.push(f);
                            } else {
                                anuladasAplicadas++;
                            }
                        } else {
                            restantes.push(f);
                        }
                    }
                    existentes = restantes;
                }

                // 2. Merge de las filas a agregar.
                const mergadas = mergearFilasPlan(existentes, info.filas);

                mergadas.forEach(f => {
                    const tq = stock.find(t => t.tanque === f.tanque);
                    if (tq && tq.producto) f.producto = tq.producto;
                });

                planes[fecha] = {
                    filas: mergadas,
                    asunto: info.fuentes.map(s => s.asunto).join(" | "),
                    filename: info.fuentes.map(s => s.filename).join(" | "),
                    importadoAt: new Date().toISOString(),
                    importadoPor: usuarioActual,
                };
                autoMatchearPlan(fecha);
                const agregadas = mergadas.length - existentes.length;
                const detalles = [];
                if (agregadas > 0) detalles.push(`+${agregadas} nuevas`);
                if (anuladasAplicadas > 0) detalles.push(`-${anuladasAplicadas} anuladas`);
                if (anuladasIgnoradas > 0) detalles.push(`⚠ ${anuladasIgnoradas} anuladas ignoradas (ya cumplidas)`);
                const sufijo = detalles.length > 0 ? ` (${detalles.join(", ")})` : "";
                resumenPorFecha.push(`${fecha.split("-").reverse().join("/")}: ${mergadas.length} total${sufijo}`);
            }

            GH.guardarPlan(planes);

            renderPlan();

            if (!esAuto) localStorage.setItem("planGmailConsentio", "1");
            const msg = resumenPorFecha.join(" · ");
            const falta = !porFecha[fechaSeleccionada];
            let avisoFalta = "";
            if (falta) {
                const descPorFecha = descartados.filter(d => d.fecha === fechaSeleccionada);
                if (descPorFecha.length > 0) {
                    avisoFalta = ` ⚠️ Para ${fechaSeleccionada.split("-").reverse().join("/")}: ${descPorFecha.map(d => `"${d.subject}" descartado (${d.motivo})`).join("; ")}`;
                } else {
                    avisoFalta = ` ⚠️ No llegó plan para ${fechaSeleccionada.split("-").reverse().join("/")}.`;
                }
            }
            if (!esAuto) mostrarEstadoPlan(`Sincronizado. ${msg}${avisoFalta}`, falta ? "info" : "success");
            else console.log("[plan] auto-sync OK:", msg, avisoFalta);
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

    let ultimoAutoSync = 0;
    function intentarAutoSync() {
        if (localStorage.getItem("planGmailConsentio") !== "1") return;
        const ahora = Date.now();
        if (ahora - ultimoAutoSync < 2 * 60 * 1000) return;
        ultimoAutoSync = ahora;
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
        if (!plan || !plan.filas || plan.filas.length === 0) {
            alert("No hay plan para imprimir en esta fecha.");
            return;
        }
        const filasOrden = [...plan.filas].sort((a, b) =>
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
        <p>Plan de Cargas del ${fecha.split("-").reverse().join("/")} — ${plan.filas.length} cargas</p>
        <table><thead><tr><th></th><th>Hora</th><th>Tanque</th><th>Producto</th><th>Cliente</th><th>Despacho</th><th>Buque/Viaje</th></tr></thead>
        <tbody>${filas}</tbody></table>
        </body></html>`;
        const win = window.open("", "_blank");
        win.document.write(html); win.document.close(); win.print();
    });

    actualizarBadgePlan();

    // Auto-sync Gmail al iniciar (si el admin ya consintió alguna vez)
    // y reintento cada 10 minutos.
    if (rolActual === "admin") {
        setTimeout(intentarAutoSync, 2000);
        setInterval(intentarAutoSync, 10 * 60 * 1000);

        // Polling del historial remoto cada 30s: trae movimientos cargados por
        // otro admin y los aplica al stock local.
        setInterval(async () => {
            if (GH._enviando || GH._pendiente) return;
            const remoto = await GH.cargar();
            if (!remoto) return;
            const cambios = mergearEntradasRemotas(remoto);
            if (cambios > 0) {
                localStorage.setItem("stockTanquesV3", JSON.stringify(stock));
                localStorage.setItem("historialSalidasV3", JSON.stringify(historial));
                localStorage.setItem("anuladosV3", JSON.stringify(anulados));
                rerenderAfterMerge();
                mostrarAlerta(`Se sincronizaron ${cambios} cambio(s) de otro usuario.`, "info");
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
        const cfg = await fetchJSON("barcos.json");
        if (cfg) barcosConfig = cfg;
    }

    async function cargarTracking() {
        const trk = await fetchJSON("tracking.json");
        if (trk) barcosTracking = trk;
    }

    function renderBarcos() {
        const c = document.getElementById("barcosCards");
        if (!c) return;
        const ts = document.getElementById("barcosActualizado");
        if (ts) ts.textContent = barcosTracking.actualizado
            ? `Última actualización del tracking: ${fmtFechaCorta(barcosTracking.actualizado)} (UTC ${barcosTracking.actualizado.replace("T", " ").slice(0, 16)})`
            : "Esperando primer tracking…";

        const umbral = umbralAlertaHs();
        const filas = (barcosConfig.barcos || []).map(b => {
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
                estadoTxt = `<span style="color:var(--gray-500)">Sin datos de tracking aún. Esperar próxima corrida (cada 30 min).</span>`;
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

            // Resumen de descargas SB/FA asociadas a este barco
            const dx = (sbfaConfig.descargas || []).filter(d =>
                (d.buque || "").toUpperCase() === (b.nombre || "").toUpperCase()
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
                <div style="margin-top:0.6rem;display:flex;gap:0.4rem;flex-wrap:wrap">
                    <button class="btn btn-primary btn-sm" data-sbfa-buque="${b.nombre}" type="button">📋 Cargar SB/FA</button>
                    ${dx.length ? `<button class="btn btn-secondary btn-sm" data-sbfa-ver="${b.nombre}" type="button">Ver descargas (${dx.length})</button>` : ""}
                </div>
            </div>`;
        }).join("");

        c.innerHTML = filas || `<p style="color:var(--gray-500)">No hay barcos en seguimiento. Agregá uno abajo.</p>`;

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
        // Igual que GH._enviar pero para barcos.json — read-modify-write con sha.
        try {
            const url = `https://api.github.com/repos/${GH.repo}/contents/barcos.json`;
            const get = await fetch(url, { headers: { Authorization: `token ${GH.token}` } });
            let sha = null;
            if (get.ok) {
                const data = await get.json();
                sha = data.sha;
            }
            const contenido = btoa(new TextEncoder().encode(JSON.stringify(barcosConfig, null, 2)).reduce((s, b) => s + String.fromCharCode(b), ""));
            const body = { message: `chore: actualizar barcos.json ${new Date().toISOString().slice(0, 16)}`, content: contenido };
            if (sha) body.sha = sha;
            const put = await fetch(url, {
                method: "PUT",
                headers: { Authorization: `token ${GH.token}`, "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!put.ok) throw new Error(`GitHub ${put.status}`);
            return true;
        } catch (e) {
            console.error("[barcos] error guardando:", e);
            mostrarAlerta(`Error guardando barcos.json: ${e.message}`, "error");
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
            mostrarAlerta(`${nombre} agregado. Buscando IMO y datos en la próxima corrida del tracking (≤30 min).`, "info");
        }
    }

    async function quitarBarco(clave) {
        if (!confirm("¿Quitar este barco del seguimiento?")) return;
        barcosConfig.barcos = (barcosConfig.barcos || []).filter(b =>
            (b.imo || b.nombre) !== clave
        );
        if (await guardarBarcosCfg()) renderBarcos();
    }

    async function inicializarBarcos() {
        await Promise.all([cargarBarcosCfg(), cargarTracking()]);
        renderBarcos();

        document.getElementById("barcosUmbral").addEventListener("change", renderBarcos);
        document.getElementById("btnBarcosRefresh").addEventListener("click", async () => {
            await cargarTracking();
            renderBarcos();
        });
        document.getElementById("btnAgregarBarco").addEventListener("click", agregarBarco);

        // Auto-refresh tracking cada 5 min mientras la app está abierta
        setInterval(async () => {
            await cargarTracking();
            renderBarcos();
        }, 5 * 60 * 1000);
    }

    // --- SB/FA: SOBRANTES Y FALTANTES POR DESCARGA DE BUQUE ---
    async function cargarSbfaCfg() {
        const cfg = await fetchJSON("sbfa.json");
        if (cfg) sbfaConfig = cfg;
        if (!sbfaConfig.descargas) sbfaConfig.descargas = [];
    }

    async function guardarSbfaCfg() {
        try {
            const url = `https://api.github.com/repos/${GH.repo}/contents/sbfa.json`;
            const get = await fetch(url, { headers: { Authorization: `token ${GH.token}` } });
            let sha = null;
            if (get.ok) {
                const data = await get.json();
                sha = data.sha;
            }
            const contenido = btoa(new TextEncoder().encode(JSON.stringify(sbfaConfig, null, 2)).reduce((s, b) => s + String.fromCharCode(b), ""));
            const body = { message: `chore: actualizar sbfa.json ${new Date().toISOString().slice(0, 16)}`, content: contenido };
            if (sha) body.sha = sha;
            const put = await fetch(url, {
                method: "PUT",
                headers: { Authorization: `token ${GH.token}`, "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!put.ok) throw new Error(`GitHub ${put.status}`);
            return true;
        } catch (e) {
            console.error("[sbfa] error guardando:", e);
            mostrarAlerta(`Error guardando sbfa.json: ${e.message}`, "error");
            return false;
        }
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
        if (p === null || p === undefined || isNaN(p)) return "0,000%";
        return p.toFixed(3).replace(".", ",") + "%";
    }

    function sbfaResumen(d) {
        let totDecl = 0, totRes = 0, fueraTol = 0;
        (d.filas || []).forEach(f => {
            const decl = Number(f.kgDeclarados) || 0;
            const res = Number(f.kgResultantes) || 0;
            totDecl += decl;
            totRes += res;
            if (decl > 0) {
                const pct = (res - decl) / decl * 100;
                if (Math.abs(pct) > SBFA_TOLERANCIA_PCT) fueraTol++;
            }
        });
        return { totDecl, totRes, totDif: totRes - totDecl, fueraTol };
    }

    function renderSbfaLista(filtro = "") {
        const cont = document.getElementById("sbfaLista");
        if (!cont) return;
        const f = (filtro || "").toUpperCase().trim();
        const items = (sbfaConfig.descargas || [])
            .filter(d => !f || (d.buque || "").toUpperCase().includes(f) || (d.manifiesto || "").toUpperCase().includes(f))
            .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || (b.id || 0) - (a.id || 0));

        if (!items.length) {
            cont.innerHTML = `<p style="color:var(--gray-500)">No hay descargas registradas. Tocá <strong>+ Nueva descarga</strong> para empezar.</p>`;
            return;
        }
        cont.innerHTML = items.map(d => {
            const r = sbfaResumen(d);
            const claseFuera = r.fueraTol > 0 ? "sbfa-card fuera-tol" : "sbfa-card";
            const fechaTxt = d.fecha ? d.fecha.split("-").reverse().join("/") : "—";
            const difPct = r.totDecl > 0 ? r.totDif / r.totDecl * 100 : 0;
            return `<div class="${claseFuera}" data-sbfa-id="${d.id}">
                <div class="sbfa-card-header">
                    <div>
                        <div class="sbfa-card-titulo">${d.buque || "(sin buque)"} — MANI ${d.manifiesto || "—"}</div>
                        <div class="sbfa-card-meta">${fechaTxt} · ${(d.filas || []).length} sol. particular · ${(d.dap || []).length} DAP</div>
                    </div>
                    ${r.fueraTol > 0 ? `<span style="color:#b91c1c;font-weight:700">⚠ ${r.fueraTol} fuera de tolerancia</span>` : `<span style="color:#16a34a">Dentro de tolerancia</span>`}
                </div>
                <div class="sbfa-card-totales">
                    <span><strong>Declarados:</strong> ${sbfaFmt(r.totDecl)} kg</span>
                    <span><strong>Resultantes:</strong> ${sbfaFmt(r.totRes)} kg</span>
                    <span><strong>Dif:</strong> ${sbfaFmt(r.totDif)} kg (${sbfaFmtPct(difPct)})</span>
                </div>
            </div>`;
        }).join("");
        cont.querySelectorAll("[data-sbfa-id]").forEach(el => {
            el.addEventListener("click", () => abrirSbfaEditor(Number(el.dataset.sbfaId)));
        });
    }

    function abrirSbfaEditor(id) {
        const editor = document.getElementById("sbfaEditor");
        const eliminarBtn = document.getElementById("btnSbfaEliminar");
        if (id) {
            const d = (sbfaConfig.descargas || []).find(x => x.id === id);
            if (!d) return;
            sbfaEditandoId = id;
            document.getElementById("sbfaEditorTitulo").textContent = `Editando ${d.buque || ""} — MANI ${d.manifiesto || ""}`;
            document.getElementById("sbfaBuque").value = d.buque || "";
            document.getElementById("sbfaManifiesto").value = d.manifiesto || "";
            document.getElementById("sbfaAgencia").value = d.agencia || "B&M";
            document.getElementById("sbfaCuit").value = d.cuit || "30-71631314-6";
            document.getElementById("sbfaFecha").value = d.fecha || "";
            document.getElementById("sbfaNotas").value = d.notas || "";
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
            document.getElementById("sbfaNotas").value = "MEDICIONES INICIALES REALIZADAS, SE AUTORIZA EL INICIO DE OPERACIONES.";
            const notaInput = document.getElementById("sbfaNotaNumero");
            if (notaInput) notaInput.value = "";
            // 6 filas por default para ir cargando particulares antes del arribo
            renderSbfaTablaFilas([{}, {}, {}, {}, {}, {}]);
            renderSbfaTablaDap([{}]);
            eliminarBtn.style.display = "";
        }
        editor.classList.remove("hidden");
        editor.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function cerrarSbfaEditor() {
        document.getElementById("sbfaEditor").classList.add("hidden");
        sbfaEditandoId = null;
    }

    function renderSbfaTablaFilas(filas) {
        const tbody = document.querySelector("#sbfaTablaFilas tbody");
        tbody.innerHTML = filas.map((f, i) => sbfaFilaHTML(f, i)).join("");
        sbfaBindFilaEvents();
        sbfaRecalcularTotales();
    }

    function sbfaFilaHTML(f, i) {
        return `<tr data-i="${i}">
            <td class="col-pre"><input data-k="solPart" value="${f.solPart || ""}" placeholder="1883-1884"></td>
            <td class="col-pre"><input data-k="cto" value="${f.cto || ""}" placeholder="OTUS 35-A-B"></td>
            <td class="col-pre"><input data-k="mercaderia" value="${f.mercaderia || ""}" placeholder="ISOPAR L"></td>
            <td class="col-pre"><input data-k="receptor" value="${f.receptor || ""}" placeholder="BRE-PBB"></td>
            <td class="col-pre col-num"><input data-k="kgDeclarados" type="number" step="1" value="${f.kgDeclarados ?? ""}"></td>
            <td class="col-pre"><input data-k="tkDestino" value="${f.tkDestino || ""}" placeholder="61-67"></td>
            <td class="col-post"><input data-k="sbfa" value="${f.sbfa || ""}"></td>
            <td class="col-post"><input data-k="medic" value="${f.medic || ""}"></td>
            <td class="col-post col-num"><input data-k="kgResultantes" type="number" step="1" value="${f.kgResultantes ?? ""}"></td>
            <td class="dif-kg" data-difkg>0</td>
            <td class="dif-pct" data-difpct>0,000%</td>
            <td><button class="btn-borrar-fila" data-borrar="${i}" title="Borrar fila">×</button></td>
        </tr>`;
    }

    function sbfaBindFilaEvents() {
        document.querySelectorAll("#sbfaTablaFilas tbody input").forEach(inp => {
            inp.addEventListener("input", sbfaRecalcularTotales);
        });
        document.querySelectorAll("#sbfaTablaFilas [data-borrar]").forEach(b => {
            b.addEventListener("click", () => {
                const idx = Number(b.dataset.borrar);
                const filas = sbfaLeerFilas();
                filas.splice(idx, 1);
                renderSbfaTablaFilas(filas.length ? filas : [{}]);
            });
        });
    }

    function sbfaLeerFilas() {
        return Array.from(document.querySelectorAll("#sbfaTablaFilas tbody tr")).map(tr => {
            const obj = {};
            tr.querySelectorAll("input[data-k]").forEach(inp => {
                const v = inp.value.trim();
                if (inp.type === "number") obj[inp.dataset.k] = v === "" ? null : Number(v);
                else obj[inp.dataset.k] = v;
            });
            return obj;
        });
    }

    function sbfaRecalcularTotales() {
        let totDecl = 0, totRes = 0;
        document.querySelectorAll("#sbfaTablaFilas tbody tr").forEach(tr => {
            const decl = Number(tr.querySelector('[data-k="kgDeclarados"]').value) || 0;
            const res = Number(tr.querySelector('[data-k="kgResultantes"]').value) || 0;
            totDecl += decl;
            totRes += res;
            const { dif, pct } = sbfaCalcDif(decl, res);
            const tdKg = tr.querySelector("[data-difkg]");
            const tdPct = tr.querySelector("[data-difpct]");
            tdKg.textContent = sbfaFmt(dif);
            tdPct.textContent = sbfaFmtPct(pct);
            const fuera = decl > 0 && Math.abs(pct) > SBFA_TOLERANCIA_PCT;
            tdKg.classList.toggle("fuera-tol", fuera);
            tdPct.classList.toggle("fuera-tol", fuera);
            tdKg.classList.toggle("dentro-tol", !fuera && decl > 0);
            tdPct.classList.toggle("dentro-tol", !fuera && decl > 0);
        });
        document.getElementById("sbfaTotalDecl").textContent = sbfaFmt(totDecl);
        document.getElementById("sbfaTotalRes").textContent = sbfaFmt(totRes);
        document.getElementById("sbfaTotalDif").textContent = sbfaFmt(totRes - totDecl);
        document.getElementById("sbfaTotalDifPct").textContent = sbfaFmtPct(totDecl > 0 ? (totRes - totDecl) / totDecl * 100 : 0);

        // DAP
        let totDoc = 0, totDapRes = 0;
        document.querySelectorAll("#sbfaTablaDap tbody tr").forEach(tr => {
            const doc = Number(tr.querySelector('[data-k="cantDoctada"]').value) || 0;
            const res = Number(tr.querySelector('[data-k="cantResult"]').value) || 0;
            totDoc += doc;
            totDapRes += res;
            const { dif, pct } = sbfaCalcDif(doc, res);
            const tdKg = tr.querySelector("[data-difkg]");
            const tdPct = tr.querySelector("[data-difpct]");
            tdKg.textContent = sbfaFmt(dif);
            tdPct.textContent = sbfaFmtPct(pct);
            const fuera = doc > 0 && Math.abs(pct) > SBFA_TOLERANCIA_PCT;
            tdKg.classList.toggle("fuera-tol", fuera);
            tdPct.classList.toggle("fuera-tol", fuera);
        });
        document.getElementById("sbfaDapTotalDoc").textContent = sbfaFmt(totDoc);
        document.getElementById("sbfaDapTotalRes").textContent = sbfaFmt(totDapRes);
        document.getElementById("sbfaDapTotalDif").textContent = sbfaFmt(totDapRes - totDoc);
        document.getElementById("sbfaDapTotalDifPct").textContent = sbfaFmtPct(totDoc > 0 ? (totDapRes - totDoc) / totDoc * 100 : 0);
    }

    function renderSbfaTablaDap(items) {
        const tbody = document.querySelector("#sbfaTablaDap tbody");
        tbody.innerHTML = items.map((d, i) => sbfaDapHTML(d, i)).join("");
        sbfaBindDapEvents();
        sbfaRecalcularTotales();
    }

    function sbfaDapHTML(d, i) {
        return `<tr data-i="${i}">
            <td><input data-k="documento" value="${d.documento || ""}"></td>
            <td><input data-k="cto" value="${d.cto || ""}"></td>
            <td class="col-num"><input data-k="cantDoctada" type="number" step="1" value="${d.cantDoctada ?? ""}"></td>
            <td class="col-num"><input data-k="cantResult" type="number" step="1" value="${d.cantResult ?? ""}"></td>
            <td class="dif-kg" data-difkg>0</td>
            <td class="dif-pct" data-difpct>0,000%</td>
            <td><input data-k="obs" value="${d.obs || ""}"></td>
            <td><button class="btn-borrar-fila" data-borrar="${i}" title="Borrar">×</button></td>
        </tr>`;
    }

    function sbfaBindDapEvents() {
        document.querySelectorAll("#sbfaTablaDap tbody input").forEach(inp => {
            inp.addEventListener("input", sbfaRecalcularTotales);
        });
        document.querySelectorAll("#sbfaTablaDap [data-borrar]").forEach(b => {
            b.addEventListener("click", () => {
                const idx = Number(b.dataset.borrar);
                const items = sbfaLeerDap();
                items.splice(idx, 1);
                renderSbfaTablaDap(items.length ? items : [{}]);
            });
        });
    }

    function sbfaLeerDap() {
        return Array.from(document.querySelectorAll("#sbfaTablaDap tbody tr")).map(tr => {
            const obj = {};
            tr.querySelectorAll("input[data-k]").forEach(inp => {
                const v = inp.value.trim();
                if (inp.type === "number") obj[inp.dataset.k] = v === "" ? null : Number(v);
                else obj[inp.dataset.k] = v;
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
            notas: document.getElementById("sbfaNotas").value.trim(),
            filas: sbfaLeerFilas().filter(f => Object.values(f).some(v => v !== "" && v !== null)),
            dap: sbfaLeerDap().filter(d => Object.values(d).some(v => v !== "" && v !== null)),
            actualizadoPor: usuarioActual,
            actualizadoTs: new Date().toISOString(),
        };
    }

    async function guardarSbfaDescarga() {
        const d = sbfaArmarDescarga();
        if (!d.buque || !d.manifiesto) { alert("Falta buque o manifiesto."); return; }
        const i = sbfaConfig.descargas.findIndex(x => x.id === d.id);
        if (i >= 0) sbfaConfig.descargas[i] = d;
        else sbfaConfig.descargas.push(d);
        if (await guardarSbfaCfg()) {
            sbfaEditandoId = d.id;
            mostrarAlerta(`Descarga ${d.buque} guardada.`, "info");
            renderSbfaLista(document.getElementById("sbfaFiltro").value || "");
            if (typeof renderBarcos === "function") renderBarcos();
        }
    }

    async function eliminarSbfaDescarga() {
        if (!sbfaEditandoId) { cerrarSbfaEditor(); return; }
        if (!confirm("¿Eliminar esta descarga? No se puede deshacer.")) return;
        sbfaConfig.descargas = sbfaConfig.descargas.filter(x => x.id !== sbfaEditandoId);
        if (await guardarSbfaCfg()) {
            cerrarSbfaEditor();
            renderSbfaLista(document.getElementById("sbfaFiltro").value || "");
            if (typeof renderBarcos === "function") renderBarcos();
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
        const fmtPct = p => (p === null || p === undefined || isNaN(p)) ? "" : (p.toFixed(3).replace(".", ",") + "%");

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

        const filasHtml = filas.map(f => {
            const decl = Number(f.kgDeclarados) || 0;
            const res = Number(f.kgResultantes) || 0;
            const dif = res - decl;
            const pct = decl > 0 ? dif / decl * 100 : 0;
            const fuera = decl > 0 && res > 0 && Math.abs(pct) > SBFA_TOLERANCIA_PCT;
            const cls = fuera ? "fuera" : "";
            return `<tr class="${cls}">
                <td>${f.solPart || ""}</td>
                <td>${f.cto || ""}</td>
                <td>${f.mercaderia || ""}</td>
                <td>${f.receptor || ""}</td>
                <td class="num">${fmt(decl)}</td>
                <td>${f.tkDestino || ""}</td>
                <td>${f.sbfa || ""}</td>
                <td>${f.medic || ""}</td>
                <td class="num">${fmt(res)}</td>
                <td class="num">${fmt(dif)}</td>
                <td class="num">${fmtPct(pct)}</td>
            </tr>`;
        }).join("");

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
            return `${f.cto || f.solPart || "—"} (${f.mercaderia || "s/d"}, dif. ${dif > 0 ? "+" : ""}${fmt(dif)} kg)`;
        }).join("; ");

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
.recuadro { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; }
.recuadro > div { padding: 4px 8px; border-right: 1px solid #000; }
.recuadro > div:last-child { border-right: none; }
.recuadro .label { background: #e5e7eb; font-weight: bold; font-size: 8pt; }
.checkboxes { border: 1px solid #000; padding: 6px 10px; margin: 0.4rem 0; font-size: 10pt; text-align: center; }
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

${d.notas ? `<div class="notas"><strong>NOTAS:</strong> ${d.notas}</div>` : ""}
</section>

<!-- ============== PÁGINA 2: ACTA DE DENUNCIA ============== -->
<section class="pagina">
${headerArcaHtml()}

<div class="recuadro">
<div class="label">CÓDIGO ORIGEN</div><div class="label">NÚMERO Y AÑO</div>
<div>DF-TAGSA</div><div>${numeroNota} / ${anioNota}</div>
</div>

<h1 class="titulo">ACTA DE DENUNCIA</h1>

<div class="recuadro">
<div class="label">LUGAR</div><div class="label">FECHA</div>
<div>Campana, Provincia de Buenos Aires</div><div>${hoy}</div>
</div>

<div class="checkboxes">
☐ SE AGREGA &nbsp;&nbsp;&nbsp; ☒ DE OFICIO &nbsp;&nbsp;&nbsp; ☐ COMPARENDO PERSONAL &nbsp;&nbsp;&nbsp; ☐ TELEFÓNICA
</div>

<div class="cuerpo">
<p>En la ciudad de Campana, Provincia de Buenos Aires, a los ${hoy}, el agente abajo firmante, destacado en el Depósito Fiscal TAGSA — Odfjell Terminals Tagsa SA — deja constancia de la siguiente denuncia:</p>

<p><strong>HECHOS:</strong> Finalizada la descarga e ingreso a depósito fiscal de la mercadería arribada en el B/T <strong>${d.buque}</strong>, MANI N° <strong>${d.manifiesto}</strong>, fecha de descarga <strong>${fechaDescarga}</strong>, se constataron diferencias entre los kilos declarados y los kilos resultantes de la medición en tanque que <strong>exceden la tolerancia legal de ±${fmtPct(SBFA_TOLERANCIA_PCT)}</strong> establecida en el punto 12.1, Anexo II de la Resolución 2220/1990.</p>

${fueraTol.length ? `
<p><strong>CONOCIMIENTOS FUERA DE TOLERANCIA (${fueraTol.length}):</strong></p>
<table>
<thead><tr><th>Part.</th><th>Cto.</th><th>Producto</th><th>Empresa</th><th class="num">Kg. Decl.</th><th>Tk.</th><th>SBFA</th><th class="num">Kg. Result.</th><th class="num">Dif. Kg.</th><th class="num">Dif. %</th></tr></thead>
<tbody>${fueraHtml}</tbody>
</table>
` : `<p><em>No se detectaron conocimientos fuera de la tolerancia legal en esta descarga.</em></p>`}

<p><strong>FUNDAMENTOS:</strong> El art. 956 y siguientes del Código Aduanero (Ley 22.415) y la Resolución 2220/1990 (Anexo II, punto 12.1) regulan los sobrantes y faltantes en mercadería ingresada a depósito fiscal. Las diferencias detectadas exceden la tolerancia admitida y configuran un caso a relevar para que la Jefatura disponga el curso a seguir.</p>

<p><strong>ELEMENTOS QUE SE ADJUNTAN:</strong> Manifiesto SIM, planillas de medición y Sobrantes/Faltantes; detalle resultante del ingreso de MANI; conocimientos referidos.</p>
</div>

<div class="firma-grid">
<div><div class="linea"><strong>Agente actuante</strong></div><div style="font-size:9pt">Aclaración y legajo</div></div>
<div><div class="linea"><strong>Jefe / Supervisor</strong></div><div style="font-size:9pt">Aclaración y legajo</div></div>
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
<p>Tal como se puede observar del citado detalle, <strong>${fueraTol.length} conocimiento(s) se hallan fuera de la tolerancia de ley</strong> establecida por el punto 12.1, Anexo II de la Resolución 2220/1990: ${listaFueras}.</p>` : `
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

    function irASbfaDesdeBarco(buque) {
        // Cambiar a pestaña SB/FA
        const tabBtn = document.querySelector('.tab[data-tab="sbfa"]');
        if (tabBtn) tabBtn.click();
        const buqueU = (buque || "").toUpperCase();

        // Buscar descargas existentes del buque con cargas pendientes
        // (filas con kgDeclarados pero sin kgResultantes, o sin filas todavía)
        const candidatas = (sbfaConfig.descargas || [])
            .filter(d => (d.buque || "").toUpperCase() === buqueU)
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
        renderSbfaLista();
        // Re-renderizar barcos para que cada card muestre el conteo de descargas SB/FA del buque
        if (typeof renderBarcos === "function") renderBarcos();

        document.getElementById("btnSbfaNueva").addEventListener("click", () => abrirSbfaEditor(null));
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
        document.getElementById("sbfaFiltro").addEventListener("input", e => renderSbfaLista(e.target.value));
    }

    // --- INIT ---
    paso1.classList.add("active");
    renderStock();
    renderHistorial();
    inputTanque.focus();
}

// Arrancar login al cargar
document.addEventListener("DOMContentLoaded", initLogin);
