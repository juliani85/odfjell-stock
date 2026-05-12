"""Manda por mail el listado de despachos con diferencia (stock vs SIM) que están
pendientes (los que en la app están con la luz roja titilando).

Lee `datos.json` del repo, toma el campo `diferencias`, deja solo los que NO están
resueltos ni borrados, arma un HTML y lo envía con SMTP Gmail.

Uso (desde GitHub Actions con workflow_dispatch):
    DESTINATARIOS="a@b.com,c@d.com" python scripts/reporte_diferencias.py

Variables de entorno requeridas:
    DESTINATARIOS       mails separados por coma
    GMAIL_USER          (ej: tagsaaduana@gmail.com)
    GMAIL_APP_PASSWORD  (App Password de 16 chars)
"""
from __future__ import annotations

import json
import os
import smtplib
import sys
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATOS_JSON = ROOT / "datos.json"


def fmt_kg(n) -> str:
    try:
        return f"{int(round(float(n))):,}".replace(",", ".")
    except Exception:
        return "0"


def fecha_hoy_ar() -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=3)).strftime("%d/%m/%Y")


def fmt_ts(iso: str | None) -> str:
    if not iso:
        return "—"
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (dt.astimezone(timezone(timedelta(hours=-3)))).strftime("%d/%m/%Y %H:%M")
    except Exception:
        return str(iso)


# Gmail/Outlook autolinkean los códigos largos (DI26IC04...) en azul subrayado.
# Envolvemos cada valor en un <a> "muerto" para que se vean en negro común.
def nolink(txt) -> str:
    t = "" if txt is None else str(txt)
    return (f'<a tabindex="-1" style="color:#111 !important;text-decoration:none !important;'
            f'cursor:default;pointer-events:none">{t}</a>')


def cargar_diferencias() -> list[dict]:
    if not DATOS_JSON.exists():
        return []
    try:
        d = json.loads(DATOS_JSON.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Error leyendo datos.json: {e}")
        return []
    arr = d.get("diferencias") or []
    return [x for x in arr if isinstance(x, dict) and not x.get("eliminada") and x.get("estado") != "resuelto"]


def armar_html(items: list[dict]) -> tuple[str, str]:
    hoy = fecha_hoy_ar()
    n = len(items)
    subject = (f"Despachos con diferencia (stock vs SIM) — {hoy} — "
               + (f"{n} pendiente{'s' if n != 1 else ''}" if n else "sin pendientes"))

    if not items:
        cuerpo = "<p>No hay despachos con diferencia pendientes. 🎉</p>"
    else:
        filas = []
        for x in items:
            kg_st = x.get("kgStock") or 0
            kg_si = x.get("kgSim") or 0
            try:
                dif = float(kg_si) - float(kg_st)
            except Exception:
                dif = x.get("dif") or 0
            color_dif = "#166534" if dif > 0 else ("#b91c1c" if dif < 0 else "#6b7280")
            signo = "+" if dif > 0 else ""
            filas.append(
                f"<tr>"
                f"<td style='padding:6px 10px;border:1px solid #e5e7eb'>{nolink(x.get('despacho') or '')}</td>"
                f"<td style='padding:6px 10px;border:1px solid #e5e7eb;text-align:right'>{nolink(fmt_kg(kg_st))}</td>"
                f"<td style='padding:6px 10px;border:1px solid #e5e7eb;text-align:right'>{nolink(fmt_kg(kg_si))}</td>"
                f"<td style='padding:6px 10px;border:1px solid #e5e7eb;text-align:right;color:{color_dif};font-weight:700'>{nolink(signo + fmt_kg(dif))}</td>"
                f"<td style='padding:6px 10px;border:1px solid #e5e7eb;color:#6b7280;font-size:12px'>{nolink(fmt_ts(x.get('agregadoTs')))} · {nolink(x.get('agregadoPor') or '?')}</td>"
                f"</tr>"
            )
        cuerpo = (
            f"<p>Hay <strong>{n}</strong> despacho{'s' if n != 1 else ''} con diferencia entre stock y SIM sin resolver:</p>"
            "<div style='overflow-x:auto'>"
            "<table style='border-collapse:collapse;font-size:13px;min-width:520px'>"
            "<thead><tr style='background:#f3f4f6'>"
            "<th style='padding:6px 10px;border:1px solid #e5e7eb;text-align:left'>Despacho</th>"
            "<th style='padding:6px 10px;border:1px solid #e5e7eb;text-align:right'>Kg. Stock</th>"
            "<th style='padding:6px 10px;border:1px solid #e5e7eb;text-align:right'>Kg. SIM</th>"
            "<th style='padding:6px 10px;border:1px solid #e5e7eb;text-align:right'>Diferencia</th>"
            "<th style='padding:6px 10px;border:1px solid #e5e7eb;text-align:left'>Cargado</th>"
            "</tr></thead><tbody>" + "".join(filas) + "</tbody></table></div>"
        )

    html = f"""<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="x-apple-disable-message-reformatting">
<style>
 a, a:link, a:visited, a:hover, a:active {{ color:#111 !important; text-decoration:none !important; font-weight:inherit !important; }}
 .il, span.il, [class*="x-gmail"], [class*="x-yahoo"] {{ color:#111 !important; text-decoration:none !important; }}
 body, td, th, p, h2, h3, span, a {{ color:#111; }}
</style>
</head><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
<h2 style="color:#1e3a8a;margin:0 0 4px">Despachos con diferencia — stock vs SIM</h2>
<p style="color:#6b7280;margin:0 0 16px">Odfjell Terminals Tagsa SA — Campana · {hoy}</p>
{cuerpo}
<p style="color:#6b7280;font-size:12px;margin-top:18px">Generado desde el sistema de Control de Stock. Los despachos resueltos en la app dejan de aparecer en este mail.</p>
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
    msg.attach(MIMEText("Ver este mail en HTML.", "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
            smtp.login(user, pwd)
            smtp.send_message(msg)
        print(f"Mail enviado a {len(destinatarios)} destinatario(s).")
        return True
    except Exception as e:
        print(f"ERROR enviando mail: {e}")
        return False


def main() -> int:
    dest_raw = os.environ.get("DESTINATARIOS", "").strip()
    destinatarios = [m.strip() for m in dest_raw.split(",") if m.strip()]
    if not destinatarios:
        print("ERROR: falta DESTINATARIOS.")
        return 1
    items = cargar_diferencias()
    print(f"{len(items)} despacho(s) con diferencia pendiente(s).")
    subject, html = armar_html(items)
    return 0 if enviar(destinatarios, subject, html) else 1


if __name__ == "__main__":
    sys.exit(main())
