document.addEventListener("DOMContentLoaded", () => {
    let stock = JSON.parse(localStorage.getItem("stockTanquesV2")) || JSON.parse(JSON.stringify(stockInicial));
    let historial = JSON.parse(localStorage.getItem("historialSalidasV2")) || [];

    // Estado actual del formulario
    let tanqueActual = null;
    let despachoActual = null;

    // DOM
    const inputTanque = document.getElementById("inputTanque");
    const btnBuscar = document.getElementById("btnBuscarTanque");
    const infoTanque = document.getElementById("infoTanque");
    const selectDespacho = document.getElementById("selectDespacho");
    const infoDespacho = document.getElementById("infoDespacho");
    const kilosInput = document.getElementById("kilosSalida");
    const remitoInput = document.getElementById("nroRemito");
    const fechaInput = document.getElementById("fechaSalida");
    const transportistaInput = document.getElementById("transportista");
    const alerta = document.getElementById("alertaStock");
    const btnRegistrar = document.getElementById("btnRegistrar");
    const btnLimpiar = document.getElementById("btnLimpiar");
    const modal = document.getElementById("modalConfirm");
    const modalBody = document.getElementById("modalBody");

    const paso1 = document.getElementById("paso1");
    const paso2 = document.getElementById("paso2");
    const paso3 = document.getElementById("paso3");

    fechaInput.valueAsDate = new Date();

    // --- TABS ---
    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById(tab.dataset.tab).classList.add("active");
        });
    });

    // --- PASO 1: BUSCAR TANQUE ---
    function buscarTanque() {
        const num = inputTanque.value.trim().padStart(3, "0");
        inputTanque.value = num;

        const tanque = stock.find(t => t.tanque === num);

        if (!tanque) {
            infoTanque.className = "info-box not-found";
            infoTanque.innerHTML = `<strong>Tanque ${num} no encontrado o est\u00e1 vac\u00edo.</strong>`;
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

        // Activar paso 2
        paso1.className = "paso done";
        activarPaso(2);
        poblarDespachos(tanque);
    }

    btnBuscar.addEventListener("click", buscarTanque);
    inputTanque.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); buscarTanque(); }
    });

    // --- PASO 2: SELECCIONAR DESPACHO ---
    function poblarDespachos(tanque) {
        selectDespacho.innerHTML = '<option value="">-- Seleccion\u00e1 un despacho --</option>';
        tanque.despachos.forEach((d, i) => {
            if (d.stock <= 0) return;
            const opt = document.createElement("option");
            opt.value = i;
            opt.textContent = `${d.despacho}  \u2014  ${formatKg(d.stock)} kg`;
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

        infoDespacho.className = "info-box found";
        infoDespacho.innerHTML = `
            <div class="info-grid">
                <div><span class="info-label">Despacho</span><br><span class="info-value" style="font-family:monospace">${desp.despacho}</span></div>
                <div><span class="info-label">Stock Disponible</span><br><span class="info-value" style="font-size:1.3rem;color:var(--primary)">${formatKg(desp.stock)} kg</span></div>
            </div>
        `;
        infoDespacho.classList.remove("hidden");

        // Activar paso 3
        paso2.className = "paso done";
        activarPaso(3);
        kilosInput.focus();
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

    // --- REGISTRAR ---
    btnRegistrar.addEventListener("click", () => {
        if (!tanqueActual || !despachoActual) return;

        const kilos = parseInt(kilosInput.value) || 0;
        const remito = remitoInput.value.trim();

        if (kilos <= 0) { mostrarAlerta("Ingres\u00e1 una cantidad v\u00e1lida.", "error"); return; }
        if (kilos > despachoActual.stock) { mostrarAlerta("Stock insuficiente.", "error"); return; }

        const restante = despachoActual.stock - kilos;

        modalBody.innerHTML = `
            <p><strong>Tanque:</strong> TK ${tanqueActual.tanque}</p>
            <p><strong>Producto:</strong> ${tanqueActual.producto}</p>
            <p><strong>Cliente:</strong> ${tanqueActual.cliente}</p>
            <p><strong>Despacho:</strong> <code>${despachoActual.despacho}</code></p>
            <p><strong>Remito:</strong> ${remito}</p>
            <p><strong>Kilos a retirar:</strong> ${formatKg(kilos)} kg</p>
            <p><strong>Stock restante despacho:</strong> ${formatKg(restante)} kg</p>
        `;
        modal.classList.remove("hidden");
    });

    // --- CONFIRMAR ---
    document.getElementById("btnConfirmar").addEventListener("click", () => {
        const kilos = parseInt(kilosInput.value) || 0;

        const salida = {
            id: Date.now(),
            fecha: fechaInput.value,
            remito: remitoInput.value.trim(),
            tanque: tanqueActual.tanque,
            producto: tanqueActual.producto,
            cliente: tanqueActual.cliente,
            despacho: despachoActual.despacho,
            kilos: kilos,
            transportista: transportistaInput.value.trim(),
        };

        // Descontar
        despachoActual.stock -= kilos;
        const restante = despachoActual.stock;

        // Guardar
        historial.unshift(salida);
        localStorage.setItem("stockTanquesV2", JSON.stringify(stock));
        localStorage.setItem("historialSalidasV2", JSON.stringify(historial));

        modal.classList.add("hidden");
        limpiarFormulario();
        renderStock();
        renderHistorial();

        mostrarAlerta(`Salida registrada: ${formatKg(kilos)} kg del TK ${salida.tanque} - Despacho ${salida.despacho}. Saldo restante en despacho: ${formatKg(restante)} kg`, "success");
        paso1.className = "paso active";
    });

    document.getElementById("btnCancelar").addEventListener("click", () => {
        modal.classList.add("hidden");
    });

    // --- LIMPIAR ---
    btnLimpiar.addEventListener("click", limpiarFormulario);

    function limpiarFormulario() {
        tanqueActual = null;
        despachoActual = null;
        inputTanque.value = "";
        infoTanque.classList.add("hidden");
        selectDespacho.innerHTML = '<option value="">-- Primero ingres\u00e1 un tanque --</option>';
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
        if (n === 3) {
            kilosInput.disabled = false;
        }
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
            return s.remito.toLowerCase().includes(filtroLower) ||
                   s.producto.toLowerCase().includes(filtroLower) ||
                   s.tanque.includes(filtroLower) ||
                   s.despacho.toLowerCase().includes(filtroLower);
        });

        if (datos.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No hay salidas registradas</td></tr>';
            return;
        }

        tbody.innerHTML = datos.map(s => `<tr>
            <td>${s.fecha}</td>
            <td><strong>${s.remito}</strong></td>
            <td><strong>TK ${s.tanque}</strong></td>
            <td>${s.producto}</td>
            <td><code>${s.despacho}</code></td>
            <td><strong>${formatKg(s.kilos)} kg</strong></td>
            <td>${s.transportista || '-'}</td>
            <td><button class="btn btn-danger" onclick="anularSalida(${s.id})">Anular</button></td>
        </tr>`).join("");
    }

    document.getElementById("filtroHistorial").addEventListener("input", (e) => {
        renderHistorial(e.target.value);
    });

    // --- ANULAR ---
    window.anularSalida = function(id) {
        const salida = historial.find(s => s.id === id);
        if (!salida) return;
        if (!confirm(`Anular remito ${salida.remito}?\nSe devuelven ${formatKg(salida.kilos)} kg al despacho ${salida.despacho} del TK ${salida.tanque}.`)) return;

        const tanque = stock.find(t => t.tanque === salida.tanque);
        if (tanque) {
            const desp = tanque.despachos.find(d => d.despacho === salida.despacho);
            if (desp) desp.stock += salida.kilos;
        }

        historial = historial.filter(s => s.id !== id);
        localStorage.setItem("stockTanquesV2", JSON.stringify(stock));
        localStorage.setItem("historialSalidasV2", JSON.stringify(historial));

        renderStock();
        renderHistorial();
    };

    // --- EXPORTAR CSV ---
    document.getElementById("btnExportar").addEventListener("click", () => {
        if (historial.length === 0) { alert("No hay datos."); return; }
        const headers = ["Fecha", "Remito", "Tanque", "Producto", "Despacho", "Kilos", "Transportista"];
        const rows = historial.map(s => [s.fecha, s.remito, `TK ${s.tanque}`, s.producto, s.despacho, s.kilos, s.transportista]);
        let csv = headers.join(";") + "\n";
        rows.forEach(r => { csv += r.map(v => `"${v || ''}"`).join(";") + "\n"; });
        const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `salidas_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
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
});
