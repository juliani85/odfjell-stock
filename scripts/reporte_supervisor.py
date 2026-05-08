"""Genera el reporte para supervisores y lo envía por mail.

Lee los JSONs del repo (tracking.json, sbfa.json, plan.json, barcos.json),
identifica los barcos en estado "en_puerto" en Campana, sus descargas SB/FA
y el plan de cargas del día. Arma un HTML y lo manda con SMTP Gmail.

Uso (desde GitHub Actions con workflow_dispatch):
    python scripts/reporte_supervisor.py --destinatarios "a@b.com,c@d.com"

Variables de entorno requeridas:
    GMAIL_USER         (ej: tagsaaduana@gmail.com)
    GMAIL_APP_PASSWORD (App Password de 16 chars)
"""
from __future__ import annotations

import argparse
import json
import os
import smtplib
import sys
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRACKING_JSON = ROOT / "tracking.json"
SBFA_JSON = ROOT / "sbfa.json"
PLAN_JSON = ROOT / "plan.json"
BARCOS_JSON = ROOT / "barcos.json"


def cargar_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  Error leyendo {path.name}: {e}")
        return default


def fmt_kg(n) -> str:
    if n is None or n == "":
        return ""
    try:
        return f"{int(round(float(n))):,}".replace(",", ".")
    except Exception:
        return str(n)


def fmt_pct(n) -> str:
    try:
        return f"{float(n):.2f}".replace(".", ",") + "%"
    except Exception:
        return ""


def fecha_local_str() -> str:
    # Argentina: UTC-3
    arg = datetime.now(timezone.utc) - timedelta(hours=3)
    return arg.strftime("%d/%m/%Y")


def fecha_local_iso() -> str:
    arg = datetime.now(timezone.utc) - timedelta(hours=3)
    return arg.strftime("%Y-%m-%d")


def barcos_en_puerto_campana(tracking: dict) -> list[dict]:
    """Devuelve lista de barcos cuyo estado AIS es en_puerto y el puerto
    contiene 'campana' (case-insensitive)."""
    out = []
    for imo, datos in (tracking.get("barcos") or {}).items():
        if not isinstance(datos, dict):
            continue
        if (datos.get("estado") or "").lower() != "en_puerto":
            continue
        puerto = (datos.get("puerto_actual") or "").lower()
        if "campana" not in puerto:
            continue
        out.append({
            "imo": imo,
            "nombre": datos.get("nombre") or imo,
            "puerto": datos.get("puerto_actual") or "Campana",
            "arribo": datos.get("arribo"),
        })
    return out


def descargas_de_barco(sbfa: dict, nombre_buque: str) -> list[dict]:
    """Devuelve descargas SB/FA del buque (no anuladas)."""
    nombre_u = (nombre_buque or "").upper().strip()
    return [
        d for d in (sbfa.get("descargas") or [])
        if not d.get("anulada") and (d.get("buque") or "").upper().strip() == nombre_u
    ]


def html_descargas_buque(barco: dict, descargas: list[dict]) -> str:
    if not descargas:
        return f"""
        <h3 style="color:#1e3a8a;margin:1.5rem 0 0.5rem 0">🚢 {barco["nombre"]} (IMO {barco["imo"]})</h3>
        <p style="color:#6b7280;font-style:italic">Sin descargas SB/FA registradas en el sistema.</p>
        """
    bloques = []
    for d in descargas:
        filas = d.get("filas") or []
        dap = d.get("dap") or []
        mani = d.get("manifiesto") or "(pendiente)"
        fecha = d.get("fecha", "")
        if fecha:
            try:
                y, m, dd = fecha.split("-")
                fecha = f"{dd}/{m}/{y}"
            except Exception:
                pass

        # Tabla particulares
        if filas:
            rows = []
            tot_decl = tot_res = 0
            for f in filas:
                decl = float(f.get("kgDeclarados") or 0)
                res = float(f.get("kgResultantes") or 0)
                dif = res - decl if (decl > 0 and res > 0) else None
                pct = (dif / decl * 100) if (dif is not None and decl > 0) else None
                tot_decl += decl
                tot_res += res
                fuera = pct is not None and abs(pct) > 0.6
                color = "background:#fee2e2" if fuera else ""
                pct_txt = fmt_pct(pct) if pct is not None else "<em>pendiente</em>"
                dif_txt = fmt_kg(dif) if dif is not None else "—"
                rows.append(f"""
                <tr style="{color}">
                    <td>{f.get("solPart") or ""}</td>
                    <td>{f.get("cto") or ""}</td>
                    <td>{f.get("mercaderia") or ""}</td>
                    <td>{f.get("receptor") or ""}</td>
                    <td style="text-align:right">{fmt_kg(decl)}</td>
                    <td>{f.get("tkDestino") or ""}</td>
                    <td>{f.get("sbfa") or ""}</td>
                    <td>{f.get("medic") or ""}</td>
                    <td style="text-align:right">{fmt_kg(res) if res else ""}</td>
                    <td style="text-align:right">{dif_txt}</td>
                    <td style="text-align:right">{pct_txt}</td>
                </tr>
                """)
            tabla_part = f"""
            <h4 style="margin:0.8rem 0 0.3rem 0;font-size:0.95rem">Conocimientos por Solicitud Particular ({len(filas)})</h4>
            <table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #d1d5db">
                <thead style="background:#e5e7eb">
                    <tr>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Part. N°</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Cto. N°</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Producto</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Empresa</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">Kg. Decl.</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Tk.</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">SBFA</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Medic.</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">Kg. Result.</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">Dif. Kg.</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">Dif. %</th>
                    </tr>
                </thead>
                <tbody>{"".join(rows)}</tbody>
                <tfoot style="background:#f3f4f6;font-weight:bold">
                    <tr>
                        <td colspan="4" style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">Totales</td>
                        <td style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">{fmt_kg(tot_decl)}</td>
                        <td colspan="3" style="border:1px solid #d1d5db"></td>
                        <td style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">{fmt_kg(tot_res)}</td>
                        <td style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">{fmt_kg(tot_res - tot_decl)}</td>
                        <td style="padding:4px 6px;border:1px solid #d1d5db"></td>
                    </tr>
                </tfoot>
            </table>
            """
        else:
            tabla_part = "<p style='color:#6b7280;font-style:italic;margin:0.5rem 0'>Sin solicitudes particulares cargadas.</p>"

        # Tabla DAP
        if dap:
            rows_dap = []
            for x in dap:
                doc_kg = float(x.get("cantDoctada") or 0)
                res_kg = float(x.get("cantResult") or 0)
                dif = res_kg - doc_kg if (doc_kg > 0 and res_kg > 0) else None
                pct = (dif / doc_kg * 100) if (dif is not None and doc_kg > 0) else None
                fuera = pct is not None and abs(pct) > 0.6
                color = "background:#fee2e2" if fuera else ""
                rows_dap.append(f"""
                <tr style="{color}">
                    <td style="padding:4px 6px;border:1px solid #d1d5db">{x.get("documento") or ""}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db">{x.get("cto") or ""}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">{fmt_kg(doc_kg)}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">{fmt_kg(res_kg) if res_kg else ""}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">{fmt_kg(dif) if dif is not None else "—"}</td>
                    <td style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">{fmt_pct(pct) if pct is not None else "<em>pendiente</em>"}</td>
                </tr>
                """)
            tabla_dap = f"""
            <h4 style="margin:0.8rem 0 0.3rem 0;font-size:0.95rem">Conocimientos DAP ({len(dap)})</h4>
            <table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #d1d5db">
                <thead style="background:#e5e7eb">
                    <tr>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Documento Aduanero</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Cto. N°</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">Cant. Doctada</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">Cant. Result.</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">Dif. Kg.</th>
                        <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:right">Dif. %</th>
                    </tr>
                </thead>
                <tbody>{"".join(rows_dap)}</tbody>
            </table>
            """
        else:
            tabla_dap = ""

        bloques.append(f"""
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:1rem;margin-bottom:1rem;background:#fafafa">
            <h3 style="color:#1e3a8a;margin:0 0 0.3rem 0">🚢 {barco["nombre"]} — MANI {mani}</h3>
            <p style="color:#6b7280;font-size:12px;margin:0 0 0.6rem 0">
                IMO {barco["imo"]} · Puerto: {barco["puerto"]} · Fecha de descarga: {fecha or "—"}
            </p>
            {tabla_part}
            {tabla_dap}
        </div>
        """)
    return "".join(bloques)


def html_plan_dia(plan: dict) -> str:
    fecha_hoy = fecha_local_iso()
    # Estructura: plan["planes"][fecha]["filas"][...]
    plan_fecha = (plan or {}).get("planes", {}).get(fecha_hoy, {})
    cargas = plan_fecha.get("filas", []) if isinstance(plan_fecha, dict) else []
    if not cargas:
        return "<p style='color:#6b7280;font-style:italic'>Sin plan de cargas para hoy.</p>"

    rows = []
    pend = cump = 0
    for c in cargas:
        cumplido = bool(c.get("cumplido"))
        if cumplido:
            cump += 1
        else:
            pend += 1
        marcador = "✓" if cumplido else "⏳"
        color = "color:#16a34a" if cumplido else "color:#d97706"
        rows.append(f"""
        <tr>
            <td style="padding:4px 6px;border:1px solid #d1d5db;text-align:center;{color};font-weight:bold">{marcador}</td>
            <td style="padding:4px 6px;border:1px solid #d1d5db">{c.get("tanque") or ""}</td>
            <td style="padding:4px 6px;border:1px solid #d1d5db">{c.get("producto") or ""}</td>
            <td style="padding:4px 6px;border:1px solid #d1d5db">{c.get("cliente") or ""}</td>
            <td style="padding:4px 6px;border:1px solid #d1d5db">{c.get("buque") or ""}</td>
            <td style="padding:4px 6px;border:1px solid #d1d5db">{c.get("despacho") or ""}</td>
            <td style="padding:4px 6px;border:1px solid #d1d5db">{c.get("horaCarga") or ""}</td>
            <td style="padding:4px 6px;border:1px solid #d1d5db">{c.get("observaciones") or ""}</td>
        </tr>
        """)
    return f"""
    <p style="margin:0.3rem 0">Total: <strong>{len(cargas)}</strong> cargas · Cumplidas: <strong style="color:#16a34a">{cump}</strong> · Pendientes: <strong style="color:#d97706">{pend}</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #d1d5db">
        <thead style="background:#e5e7eb">
            <tr>
                <th style="padding:4px 6px;border:1px solid #d1d5db;width:30px"></th>
                <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Tk.</th>
                <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Producto</th>
                <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Cliente</th>
                <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Buque</th>
                <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Despacho</th>
                <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Hora</th>
                <th style="padding:4px 6px;border:1px solid #d1d5db;text-align:left">Obs.</th>
            </tr>
        </thead>
        <tbody>{"".join(rows)}</tbody>
    </table>
    """


def armar_html_reporte() -> tuple[str, str]:
    """Devuelve (subject, html_body)."""
    tracking = cargar_json(TRACKING_JSON, {})
    sbfa = cargar_json(SBFA_JSON, {})
    plan = cargar_json(PLAN_JSON, {})

    fecha = fecha_local_str()
    barcos = barcos_en_puerto_campana(tracking)

    # Bloques por barco
    if barcos:
        bloques_barcos = []
        for b in barcos:
            descargas = descargas_de_barco(sbfa, b["nombre"])
            bloques_barcos.append(html_descargas_buque(b, descargas))
        seccion_barcos = "".join(bloques_barcos)
    else:
        seccion_barcos = "<p style='color:#6b7280;font-style:italic'>Ningún barco operando en Campana al momento del reporte.</p>"

    seccion_plan = html_plan_dia(plan)

    subject = f"Reporte para Supervisores — {fecha} — {len(barcos)} buque(s) operando"

    html = f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"></head>
<body style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111; max-width: 1200px; margin: 0 auto; padding: 1rem">

<div style="border-bottom: 3px solid #1e3a8a; padding-bottom: 0.5rem; margin-bottom: 1rem">
    <h1 style="color: #1e3a8a; margin: 0; font-size: 18px">Reporte para Supervisores — Operaciones del día</h1>
    <p style="margin: 0.3rem 0 0 0; color: #6b7280; font-size: 12px">
        Odfjell Terminals Tagsa SA — Campana · {fecha} · Generado automáticamente
    </p>
</div>

<h2 style="color: #1e3a8a; font-size: 15px; margin: 1rem 0 0.5rem 0">🚢 Barcos operando en Campana ({len(barcos)})</h2>
{seccion_barcos}

<h2 style="color: #1e3a8a; font-size: 15px; margin: 2rem 0 0.5rem 0">🚛 Plan de Cargas del día</h2>
{seccion_plan}

<hr style="margin: 2rem 0 0.5rem 0; border: none; border-top: 1px solid #e5e7eb">
<p style="color: #9ca3af; font-size: 11px; text-align: center; margin: 0">
    Reporte generado por el sistema de Control de Stock de TAGSA · {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")} UTC
</p>

</body></html>"""

    return subject, html


def enviar(destinatarios: list[str], subject: str, html: str) -> bool:
    user = os.environ.get("GMAIL_USER", "").strip()
    pwd = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    if not user or not pwd:
        print("ERROR: GMAIL_USER / GMAIL_APP_PASSWORD no configurados.")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"TAGSA Aduana <{user}>"
    msg["To"] = ", ".join(destinatarios)
    # Texto plano de fallback
    texto = "Este reporte se ve mejor en un cliente que renderice HTML."
    msg.attach(MIMEText(texto, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
            smtp.login(user, pwd)
            smtp.send_message(msg)
        print(f"OK — reporte enviado a {len(destinatarios)} destinatario(s).")
        return True
    except Exception as e:
        print(f"ERROR enviando reporte: {e}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--destinatarios", required=True,
                        help="Lista separada por comas (a@b.com,c@d.com)")
    args = parser.parse_args()

    destinatarios = [m.strip() for m in args.destinatarios.split(",") if m.strip()]
    if not destinatarios:
        print("ERROR: No se pasaron destinatarios.")
        return 1

    subject, html = armar_html_reporte()
    ok = enviar(destinatarios, subject, html)
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
