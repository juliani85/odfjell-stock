// Usuarios válidos
const USUARIOS = {
    cesar: "admin",
    julian: "admin",
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
    // Prioriza text/plain, sino text/html stripeado. Recorre recursivamente.
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

function parsearSalidasDesdeBody(bodyText) {
    if (!bodyText) return [];
    // Cortar parte quoted (respuesta/forward): "De:", "From:", "-----Original", lineas que empiezan con ">"
    const cortado = bodyText
        .split(/\n\s*(?:De:|From:|-----+\s*Original|Enviado (?:el|por):)/i)[0]
        .split(/\n\s*>/)[0];
    const filas = [];
    const regex = /\bTK\s*(\d{1,3})\s*[-–—]\s*(.+?)\s+(\S*(?:IC04|IC06|TRP|EC01|REMO|TRM6)\S*)/gi;
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
    console.log(`[plan:excel] hojas en el workbook:`, wb.SheetNames);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    console.log(`[plan:excel] "${att.filename}" → ${rows.length} filas (incluye header)`);
    if (rows.length < 2) {
        console.warn(`[plan:excel] Excel vacío o sólo header. Primera fila:`, rows[0]);
        return [];
    }
    const header = rows[0].map(h => String(h).toLowerCase().trim());
    console.log(`[plan:excel] header:`, header);
    const idx = (preds) => header.findIndex(h => preds.some(p => h.includes(p)));
    const ci = {
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
    console.log(`[plan:excel] columnas detectadas: tnk=${ci.tnk}, despacho=${ci.despacho}, prod=${ci.prod}, cliente=${ci.clie}`);
    if (ci.tnk < 0 || ci.despacho < 0) {
        console.warn(`[plan:excel] no se encontró columna "tnk/tanq" (${ci.tnk}) o "despa" (${ci.despacho}) en el header.`);
        return [];
    }
    const filas = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const tnk = String(r[ci.tnk] || "").trim();
        const desp = String(r[ci.despacho] || "").trim();
        if (!tnk && !desp) continue;
        filas.push({
            id: Date.now() + "-" + i + "-" + Math.random().toString(36).slice(2, 7),
            tanque: tnk.padStart(3, "0"),
            producto: String(r[ci.prod] || "").trim(),
            cliente: String(r[ci.clie] || "").trim(),
            buque: String(r[ci.buque] || "").trim(),
            viaje: String(r[ci.viaje] || "").trim(),
            subCliente: String(r[ci.subc] || "").trim(),
            conoc: String(r[ci.conoc] || "").trim(),
            despacho: desp,
            exLegal: String(r[ci.exLegal] || "").trim(),
            fechaOrig: parseFechaPlanExcel(r[ci.fecha]),
            horaCarga: formatearHoraPlan(r[ci.hora]),
            observaciones: String(r[ci.obs] || "").trim(),
            cumplido: false,
            salidaId: null,
            cumplidoAt: null,
            fuente: "excel",
        });
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
        } else {
            const adjuntos = listarAdjuntos(msg.payload);
            console.log(`[plan] "${subject}" no tiene adjunto Excel reconocido. Adjuntos del mail:`, adjuntos);
        }

        const bodyTxt = extraerCuerpoMail(msg.payload);
        const filasBody = parsearSalidasDesdeBody(bodyTxt);

        console.log(`[plan] "${subject}" → fecha=${fecha}, adjunto=${filename || "(ninguno)"}, filasExcel=${filasExcel.length}, filasBody=${filasBody.length}`);

        if (filasExcel.length === 0 && filasBody.length === 0) {
            console.warn(`[plan] sin filas. Primeros 500 chars del cuerpo del mail "${subject}":\n`, (bodyTxt || "").slice(0, 500));
            descartados.push({ subject, motivo: "sin filas parseables (Excel ni cuerpo)", fecha });
            continue;
        }

        if (!porFecha[fecha]) porFecha[fecha] = { filas: [], fuentes: [] };
        porFecha[fecha].filas.push(...filasExcel, ...filasBody);
        porFecha[fecha].fuentes.push({
            asunto: subject,
            filename: filename || "(cuerpo)",
            excelRows: filasExcel.length,
            bodyRows: filasBody.length,
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

    async cargar() {
        try {
            const res = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.file}`, {
                headers: { Authorization: `token ${this.token}` }
            });
            if (!res.ok) return null;
            const data = await res.json();
            this.sha = data.sha;
            const contenido = JSON.parse(atob(data.content));
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

    guardar(stock, historial) {
        this._pendiente = { stock, historial };
        this._setEstado("pendiente");
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        this._enviar();
    },

    async _enviar() {
        if (!this._pendiente || this._enviando) return;
        this._enviando = true;
        this._setEstado("enviando");

        while (this._pendiente) {
            const { stock, historial } = this._pendiente;
            try {
                await this.refrescarSha();

                const datos = { stock, historial, actualizado: new Date().toISOString() };
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

                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    throw new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`);
                }
                const data = await res.json();
                this.sha = data.content.sha;
                if (this._pendiente && this._pendiente.stock === stock && this._pendiente.historial === historial) {
                    this._pendiente = null;
                }
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
            const contenido = JSON.parse(atob(data.content));
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
            const contenido = JSON.parse(atob(data.content));
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
    let stock, historial;
    if (ghData && ghData.stock) {
        stock = ghData.stock;
        historial = ghData.historial || [];
        localStorage.setItem("stockTanquesV3", JSON.stringify(stock));
        localStorage.setItem("historialSalidasV3", JSON.stringify(historial));
    } else {
        stock = JSON.parse(localStorage.getItem("stockTanquesV3")) || JSON.parse(JSON.stringify(stockInicial));
        historial = JSON.parse(localStorage.getItem("historialSalidasV3")) || [];
    }

    // Fecha dinámica en subtítulo
    const hoySub = new Date();
    const subtFecha = document.getElementById("subtFecha");
    if (subtFecha) subtFecha.textContent = `Stock al ${hoySub.toLocaleDateString("es-AR")}`;

    // Función para guardar en localStorage + GitHub
    function guardarDatos() {
        localStorage.setItem("stockTanquesV3", JSON.stringify(stock));
        localStorage.setItem("historialSalidasV3", JSON.stringify(historial));
        GH.guardar(stock, historial);
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
    // Un despacho es valido para salida si su nombre contiene IC04, IC06, TRP, EC01, REMO o TRM6.
    // Los historicos pueden venir con formatos como FISCAL-..., PARTICULAR, IDA4, etc.
    function esDespachoValido(nombre) {
        if (!nombre) return false;
        const n = nombre.toUpperCase();
        return n.includes("IC04") || n.includes("IC06") || n.includes("TRP") ||
               n.includes("EC01") || n.includes("REMO") || n.includes("TRM6");
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
            <p>El despacho <code>${viejo}</code> no cumple con el formato estándar (<strong>IC04</strong>, <strong>IC06</strong>, <strong>TRP</strong>, <strong>EC01</strong>, <strong>REMO</strong> o <strong>TRM6</strong>).</p>
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
            ? `<div style="margin-top:0.75rem;padding:0.6rem 0.8rem;background:#fef3c7;color:#92400e;border-radius:6px;font-size:0.85rem;display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap">
                    <span>⚠ Formato no estándar — se espera IC04, IC06, TRP, EC01, REMO o TRM6.</span>
                    <button class="btn btn-secondary btn-sm" id="btnRenombrarDespacho" type="button">✎ Renombrar</button>
                </div>`
            : "";
        infoDespacho.className = "info-box found";
        infoDespacho.innerHTML = `
            <div class="info-grid">
                <div><span class="info-label">Despacho</span><br><span class="info-value" style="font-family:monospace">${desp.despacho}</span></div>
                <div><span class="info-label">Cliente</span><br><span class="info-value">${clienteDesp}</span></div>
                <div><span class="info-label">Stock Disponible</span><br><span class="info-value" style="font-size:1.3rem;color:var(--primary)">${formatKg(desp.stock)} kg</span></div>
            </div>
            ${avisoInvalido}
        `;
        infoDespacho.classList.remove("hidden");

        if (invalido) {
            const btnRen = document.getElementById("btnRenombrarDespacho");
            if (btnRen) btnRen.addEventListener("click", () => lanzarRenombrarDespacho(desp));
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
            return `<tr>
            <td>${s.fecha}</td>
            <td>${s.hora || "-"}</td>
            <td><span class="tipo-badge ${tipoClass}">${tipo}</span></td>
            <td><strong>${s.remito || "-"}</strong></td>
            <td><strong>TK ${s.tanque}</strong></td>
            <td>${s.producto}</td>
            <td><code>${s.despacho}</code></td>
            <td><strong>${formatKg(s.kilos)} kg</strong></td>
            <td>${(s.usuario || "-").toUpperCase()}</td>
            <td><button class="btn btn-danger" onclick="anularSalida(${s.id})">Anular</button></td>
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
    function renderRepMensual(filtro = "") {
        const container = document.getElementById("repMensualCards");
        const filtroLower = filtro.toLowerCase();

        const filtrados = stock.filter(t => {
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

            return `<div class="stock-card rep-mensual-card" onclick="this.classList.toggle('open')">
                <div class="stock-card-header">
                    <div class="stock-card-left">
                        <span class="stock-card-tanque">TK ${t.tanque}</span>
                        <div>
                            <div class="stock-card-producto">${t.producto}</div>
                            <div class="stock-card-cliente">${t.cliente}</div>
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

        document.getElementById("repMenTanques").textContent = filtrados.length;
        document.getElementById("repMenDespachos").textContent = totalDesp;
        document.getElementById("repMenKilos").textContent = formatKg(totalKg);
    }

    document.getElementById("filtroRepMensual").addEventListener("input", (e) => {
        renderRepMensual(e.target.value);
    });

    // --- IMPRIMIR STOCK MENSUAL ---
    document.getElementById("btnImprimirMensual").addEventListener("click", () => {
        const filtrados = stock.filter(t => t.despachos.reduce((s, d) => s + d.stock, 0) > 0);
        if (filtrados.length === 0) { alert("No hay stock para imprimir."); return; }

        let totalKg = 0;
        const filas = filtrados.map(t => {
            const totalTanque = t.despachos.reduce((s, d) => s + d.stock, 0);
            totalKg += totalTanque;
            const cap = capacidadTanques[t.tanque] || 0;
            let pct = cap > 0 ? Math.min(Math.round((totalTanque / cap) * 100), 100) : 0;
            if (pct < 0) pct = 0;
            const nivelColor = pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e";

            const despRows = t.despachos.filter(d => d.stock > 0).map(d => {
                const clienteDesp = d.cliente || t.cliente;
                return `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:0.8rem;color:#555">
                    <span style="font-family:monospace">${d.despacho}</span>
                    <span>${clienteDesp}</span>
                    <span style="font-weight:600">${formatKg(d.stock)} kg</span>
                </div>`;
            }).join("");

            return `<tr>
                <td style="font-weight:700;color:#1a56db">TK ${t.tanque}</td>
                <td>${t.producto}</td>
                <td>${t.cliente}</td>
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

        const hoy = new Date().toISOString().slice(0, 10);
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
        <p>Reporte de Stock Mensual — ${hoy.split("-").reverse().join("/")}</p>
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
        if (this.value && this.value !== "__NUEVO__" && ingClienteNuevo.value.trim()) {
            habilitarIngPaso2();
        } else if (this.value === "__NUEVO__") {
            ingProductoOtro.classList.remove("hidden");
        }
    });

    ingClienteNuevo.addEventListener("input", () => {
        const prodOk = ingSelectProducto.value && (ingSelectProducto.value !== "__NUEVO__" || ingNuevoProducto.value.trim());
        if (prodOk && ingClienteNuevo.value.trim()) habilitarIngPaso2();
    });

    ingNuevoProducto.addEventListener("input", () => {
        if (ingNuevoProducto.value.trim() && ingClienteNuevo.value.trim()) habilitarIngPaso2();
    });

    function habilitarIngPaso2() {
        ingPaso1.className = "paso done";
        ingPaso2.className = "paso active";
        ingKilos.disabled = false;
        ingDespacho.focus();
    }

    // Validar ingreso
    ingDespacho.addEventListener("input", validarIngreso);
    ingKilos.addEventListener("input", validarIngreso);

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
        return String(d || "").toUpperCase().replace(/^DI/, "");
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
            if (f.fuente === "body" && excelKeys.has(`${f.tanque}|${normDespacho(f.despacho)}`)) return false;
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
                const existentes = (planes[fecha] && planes[fecha].filas) ? planes[fecha].filas : [];
                const mergadas = mergearFilasPlan(existentes, info.filas);

                // Completar producto desde stock si falta
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
                resumenPorFecha.push(`${fecha.split("-").reverse().join("/")}: ${mergadas.length} total${agregadas > 0 ? " (+" + agregadas + " nuevas)" : ""}`);
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

    // --- INIT ---
    paso1.classList.add("active");
    renderStock();
    renderHistorial();
    inputTanque.focus();
}

// Arrancar login al cargar
document.addEventListener("DOMContentLoaded", initLogin);
