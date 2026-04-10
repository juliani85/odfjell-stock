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

// --- GITHUB STORAGE ---
const GH = {
    _p: ["Z2hwX1lFS0k4","d1FLRmtobEtW","YlE1ODNpcU00","cks3WUpzazJi","YjYxag=="],
    get token() { return atob(this._p.join("")); },
    repo: "juliani85/odfjell-stock",
    file: "datos.json",
    fileVistas: "vistas.json",
    sha: null,
    shaVistas: null,
    _timer: null,
    _pendiente: null,
    _timerVistas: null,
    _pendienteVistas: null,

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
            }
        } catch (e) {}
    },

    guardar(stock, historial) {
        this._pendiente = { stock, historial };
        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => this._enviar(), 2000);
    },

    async _enviar() {
        if (!this._pendiente) return;
        const { stock, historial } = this._pendiente;
        this._pendiente = null;

        await this.refrescarSha();

        const datos = { stock, historial, actualizado: new Date().toISOString() };
        const contenido = btoa(new TextEncoder().encode(JSON.stringify(datos)).reduce((s, b) => s + String.fromCharCode(b), ""));
        try {
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
            if (res.ok) {
                const data = await res.json();
                this.sha = data.content.sha;
            }
        } catch (e) {}
    },

    async cargarVistas() {
        try {
            const res = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.fileVistas}`, {
                headers: { Authorization: `token ${this.token}` }
            });
            if (!res.ok) return null;
            const data = await res.json();
            this.shaVistas = data.sha;
            const contenido = JSON.parse(atob(data.content));
            return { vistas: contenido.vistas || [], sim: contenido.sim || {} };
        } catch (e) {
            return null;
        }
    },

    guardarVistas(vistas, sim) {
        this._pendienteVistas = { vistas, sim };
        if (this._timerVistas) clearTimeout(this._timerVistas);
        this._timerVistas = setTimeout(() => this._enviarVistas(), 1500);
    },

    async _enviarVistas() {
        if (!this._pendienteVistas) return;
        const { vistas, sim } = this._pendienteVistas;
        this._pendienteVistas = null;

        // Refrescar sha
        try {
            const r = await fetch(`https://api.github.com/repos/${this.repo}/contents/${this.fileVistas}`, {
                headers: { Authorization: `token ${this.token}` }
            });
            if (r.ok) {
                const d = await r.json();
                this.shaVistas = d.sha;
            } else if (r.status === 404) {
                this.shaVistas = null;
            }
        } catch (e) {}

        const datos = { vistas, sim, actualizado: new Date().toISOString() };
        const contenido = btoa(new TextEncoder().encode(JSON.stringify(datos)).reduce((s, b) => s + String.fromCharCode(b), ""));
        try {
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
            if (res.ok) {
                const data = await res.json();
                this.shaVistas = data.content.sha;
            }
        } catch (e) {}
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

    // Logout
    document.getElementById("btnLogout").addEventListener("click", () => {
        sessionStorage.removeItem("usuarioStock");
        location.reload();
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

    // Función para guardar en localStorage + GitHub
    function guardarDatos() {
        localStorage.setItem("stockTanquesV3", JSON.stringify(stock));
        localStorage.setItem("historialSalidasV3", JSON.stringify(historial));
        GH.guardar(stock, historial);
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
            if (tab.dataset.tab === "historialTanque") {
                volverListaHistTanque();
                renderHistTanqueLista();
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
        infoDespacho.className = "info-box found";
        infoDespacho.innerHTML = `
            <div class="info-grid">
                <div><span class="info-label">Despacho</span><br><span class="info-value" style="font-family:monospace">${desp.despacho}</span></div>
                <div><span class="info-label">Cliente</span><br><span class="info-value">${clienteDesp}</span></div>
                <div><span class="info-label">Stock Disponible</span><br><span class="info-value" style="font-size:1.3rem;color:var(--primary)">${formatKg(desp.stock)} kg</span></div>
            </div>
        `;
        infoDespacho.classList.remove("hidden");

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

        // Validar remito duplicado en la misma fecha → modal estilizado
        const duplicados = remito ? buscarRemitoDuplicado(remito, fechaInput.value) : [];
        if (duplicados.length > 0) {
            const detalle = duplicados.map(d =>
                `<li>TK ${d.tanque} — ${formatKg(d.kilos)} kg — ${d.hora || "-"} — ${(d.usuario || "-").toUpperCase()}</li>`
            ).join("");
            abrirModal(
                "Remito ya cargado",
                `<p>El remito <strong>${remito}</strong> ya fue cargado hoy:</p>
                 <ul style="margin:0.5rem 0 1rem 1.2rem;line-height:1.6">${detalle}</ul>
                 <p>¿Querés continuar de todos modos?</p>`,
                () => { modal.classList.add("hidden"); abrirConfirmacionSalida(); },
                "Continuar"
            );
            return;
        }

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
            guardarDatos();

            modal.classList.add("hidden");
            limpiarFormulario();
            renderStock();
            renderHistorial();

            mostrarAlerta(`Salida registrada: ${formatKg(kilos)} kg del TK ${salida.tanque} - Despacho ${salida.despacho}. Saldo restante: ${formatKg(restante2)} kg`, "success");
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
                <div class="stock-card-despachos">${despHTML}</div>
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
        guardarDatos();

        renderStock();
        renderHistorial();
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
        let salidas = historial.filter(s => (s.tipo || "SALIDA") === "SALIDA" && s.fecha === fecha);
        if (rolActual === "viewer") {
            salidas = salidas.filter(s => s.despacho && (s.despacho.includes("IC04") || s.despacho.includes("IC06")));
        }
        return salidas;
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
        const salidas = historial
            .filter(s => (s.tipo || "SALIDA") === "SALIDA")
            .filter(s => s.despacho && (s.despacho.includes("IC04") || s.despacho.includes("IC06")));
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
            .filter(s => s.despacho && (s.despacho.includes("IC04") || s.despacho.includes("IC06")))
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
