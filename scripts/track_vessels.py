"""Scrapea posicion/ETA/velocidad de los barcos en barcos.json y escribe
tracking.json en la raiz del frontend. Se ejecuta desde GitHub Actions
cada 30 minutos.

Uso local:
    python scripts/track_vessels.py

Salida:
    tracking.json con estructura:
    {
        "actualizado": "2026-05-08T15:00:00Z",
        "barcos": {
            "9367554": {
                "imo": "9367554",
                "nombre": "BOW CAROLINE",
                "posicion": [lat, lon] | null,
                "destino": "Campana, Argentina" | null,
                "eta": "2026-05-08T23:00:00Z" | null,
                "velocidad_nudos": 14.7 | null,
                "rumbo": 210 | null,
                "ultimo_puerto": "Santos, Brazil" | null,
                "ultimo_reporte": "2026-05-07T11:07:00Z" | null,
                "fuente": "myshiptracking" | "vesselfinder",
                "error": null | "mensaje"
            }
        }
    }
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parent.parent
BARCOS_JSON = ROOT / "barcos.json"
TRACKING_JSON = ROOT / "tracking.json"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}
TIMEOUT = 20


def fetch(url: str) -> str | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        if r.status_code != 200:
            return None
        return r.text
    except Exception:
        return None


def _to_iso(ts: str) -> str | None:
    """Convierte una variedad de formatos de fecha+hora UTC a ISO 8601."""
    if not ts:
        return None
    ts = ts.strip()
    formatos = [
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%b %d, %H:%M",
        "%b %d, %Y %H:%M",
    ]
    for fmt in formatos:
        try:
            d = datetime.strptime(ts, fmt)
            if d.year == 1900:
                d = d.replace(year=datetime.now(timezone.utc).year)
            return d.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        except ValueError:
            continue
    return None


def parsear_myshiptracking(html: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    txt = re.sub(r"\s+", " ", html)

    m = re.search(r"Latitude\s*/\s*Longitude[^<]*<[^>]*>\s*([-\d.]+)\s*/\s*([-\d.]+)", txt)
    if m:
        out["posicion"] = [float(m.group(1)), float(m.group(2))]

    m = re.search(r"Destination[^<]*<[^>]*>\s*([A-Z][A-Z0-9 ,/\-]{2,60})", txt)
    if m:
        out["destino"] = m.group(1).strip().rstrip("|").strip()

    m = re.search(r"ETA[^<]*<[^>]*>\s*([\d\-: ]{10,19})", txt)
    if m:
        out["eta"] = _to_iso(m.group(1))

    m = re.search(r"Speed[^<]*<[^>]*>\s*([\d.]+)\s*Knots", txt)
    if m:
        out["velocidad_nudos"] = float(m.group(1))

    m = re.search(r"Course[^<]*<[^>]*>\s*([\d.]+)", txt)
    if m:
        out["rumbo"] = float(m.group(1))

    m = re.search(r"Last\s*Port[^<]*<[^>]*>\s*([A-Z][A-Z0-9 ,/\-]{2,60})", txt, re.IGNORECASE)
    if m:
        out["ultimo_puerto"] = m.group(1).strip().rstrip("|").strip()

    m = re.search(r"Last\s*Report[^<]*<[^>]*>\s*([\d\-: ]{10,19})", txt, re.IGNORECASE)
    if m:
        out["ultimo_reporte"] = _to_iso(m.group(1))

    return out


def parsear_vesselfinder(html: str) -> dict[str, Any]:
    out: dict[str, Any] = {}

    # Frase principal con destino + (velocidad) + ETA. Ejemplos:
    #   "en route to the port of <strong>Campana, Argentina</strong>,
    #     sailing at a speed of 9.8 knots
    #     and expected to arrive there on <strong>May 10, 06:00</strong>."
    #   Si el barco está fondeado/parado, VesselFinder OMITE el "sailing at a speed of …":
    #     "en route to the port of <strong>Campana, Argentina</strong> , and
    #      expected to arrive there on <strong>May 8, 20:00</strong>."
    #   → por eso la cláusula de velocidad es opcional (era el bug del BOW CAROLINE: fondeado,
    #     sin línea de velocidad, no matcheaba y quedaba sin estado).
    m = re.search(
        r"en route to the port of\s*<strong>([^<]+)</strong>"
        r"(?:[\s\S]{0,300}?sailing at a speed of\s*([\d.]+)\s*knots)?"
        r"[\s\S]{0,300}?expected to arrive[\s\S]{0,40}?<strong>([^<]+)</strong>",
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if m:
        out["estado"] = "en_route"
        out["destino"] = m.group(1).strip()
        if m.group(2):
            out["velocidad_nudos"] = float(m.group(2))
        out["eta"] = _to_iso(m.group(3).strip())
    else:
        m = re.search(
            r"arrived at the port of\s*<strong>([^<]+)</strong>\s*on\s*([A-Za-z]+\s+\d{1,2},\s+\d{2}:\d{2})",
            html, re.IGNORECASE | re.DOTALL,
        )
        if m:
            out["estado"] = "en_puerto"
            out["puerto_actual"] = m.group(1).strip()
            out["arribo"] = _to_iso(m.group(2).strip())
        else:
            m = re.search(
                r"departed from the port of\s*<strong>([^<]+)</strong>\s*on\s*([A-Za-z]+\s+\d{1,2},\s+\d{2}:\d{2})",
                html, re.IGNORECASE | re.DOTALL,
            )
            if m:
                out["estado"] = "navegando"
                out["ultimo_puerto"] = m.group(1).strip()
                out["partida"] = _to_iso(m.group(2).strip())

    # Calado actual
    m = re.search(r"draught</td>\s*<td[^>]*>\s*([\d.]+)\s*m", html, re.IGNORECASE)
    if m:
        out["calado_m"] = float(m.group(1))

    # Estado de navegación AIS (ej: "At anchor", "Moored", "Under way using engine").
    # En VesselFinder el valor va dentro de <span data-title="Moored">Moored</span>.
    m = re.search(r"Navigation Status</td>[\s\S]{0,200}?data-title=\"([^\"]+)\"", html, re.IGNORECASE)
    if not m:
        m = re.search(r"Navigation Status</td>[\s\S]{0,200}?>\s*([A-Za-z][A-Za-z /]+?)\s*</span>", html, re.IGNORECASE)
    if m:
        out["nav_status"] = m.group(1).strip()

    # Zona AIS general: "<NAME> is at <ZONA> reported X ago by AIS." (ej: "South America Inland",
    # "South America East Coast"). Sirve para distinguir "fondeado en el río cerca de Campana"
    # de "fondeado mar afuera esperando".
    m = re.search(r"</strong>\s*is\s*at\s+([A-Za-z][A-Za-z ,/()\-]{2,60}?)\s+reported\b", html, re.IGNORECASE)
    if m:
        out["zona"] = m.group(1).strip()

    # Heurística de "arribó a Campana" para cuando VesselFinder NO escribe el "arrived at the
    # port of Campana on DATE" (pasa cuando el barco está amarrado/fondeado en el río: sigue
    # mostrándolo "en route to Campana" pero con Navigation Status = Moored / At anchor).
    # Era el bug por el que no llegó la notificación del BOW CARDINAL.
    if out.get("estado") != "en_puerto":
        nav = (out.get("nav_status") or "").lower()
        zona = (out.get("zona") or "").lower()
        dest = (out.get("destino") or "").lower()
        parado = any(s in nav for s in ("moored", "at anchor", "aground"))
        cerca_campana = ("campana" in zona) or ("inland" in zona and "campana" in dest)
        if parado and cerca_campana:
            out["estado"] = "en_puerto"
            out["puerto_actual"] = out.get("destino") or "Campana, Argentina"
            # No hay hora de arribo real; usamos la ETA como estimación.
            if out.get("eta") and not out.get("arribo"):
                out["arribo"] = out["eta"]
            out["arribo_estimado"] = True

    # Tipo / flag (descripción del header)
    m = re.search(
        r"is a\s*([A-Za-z/ ]+?)\s*built in\s*\d{4}.{0,80}flag of\s*<strong>([^<]+)</strong>",
        html,
    )
    if m:
        out["tipo"] = m.group(1).strip()
        out["bandera"] = m.group(2).strip()

    return out


def fetch_imo(imo: str) -> dict[str, Any]:
    """Intenta varias fuentes en orden y retorna lo que pudo extraer."""
    fuentes = [
        ("myshiptracking", f"https://www.myshiptracking.com/vessels/imo-{imo}", parsear_myshiptracking),
        ("vesselfinder", f"https://www.vesselfinder.com/vessels/details/{imo}", parsear_vesselfinder),
    ]
    last_err = None
    for nombre, url, parser in fuentes:
        html = fetch(url)
        if not html:
            last_err = f"sin respuesta de {nombre}"
            continue
        datos = parser(html)
        if datos:
            datos["fuente"] = nombre
            datos["error"] = None
            return datos
        last_err = f"{nombre} sin datos parseables"
    return {"fuente": None, "error": last_err or "fuentes agotadas"}


def buscar_imo_por_nombre(nombre: str) -> str | None:
    """Busca en VesselFinder el IMO correspondiente al nombre. Si hay
    varios resultados, prioriza los que tengan destino que contenga
    "Campana" o "Argentina"."""
    if not nombre:
        return None
    url = f"https://www.vesselfinder.com/vessels?name={quote(nombre)}"
    html = fetch(url)
    if not html:
        return None

    # Cada fila de resultado tiene un link a /vessels/details/IMO y
    # las columnas de la fila incluyen Destination/ETA. Extraemos por
    # filas <tr> y dentro cada IMO + texto de la fila para priorizar.
    candidatos: list[tuple[str, str]] = []
    for fila in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL):
        m = re.search(r"/vessels/details/(\d{7})", fila)
        if not m:
            continue
        # Validar que el nombre del barco coincida con el buscado.
        # El nombre suele aparecer como <a ...>NOMBRE</a> dentro de la
        # primera celda. Permitimos coincidencia case-insensitive y
        # match parcial al inicio para tolerar sufijos tipo "(IMO ...)".
        m_nom = re.search(r">\s*([A-Z][A-Z0-9 \-/.]{2,40})\s*<", fila)
        nombre_fila = m_nom.group(1).strip() if m_nom else ""
        if nombre_fila and nombre_fila.upper() != nombre.strip().upper():
            # tolerar variaciones leves (espacios o guiones)
            if nombre.strip().upper() not in nombre_fila.upper():
                continue
        candidatos.append((m.group(1), fila))

    if not candidatos:
        # fallback: cualquier match en todo el HTML
        m = re.search(r"/vessels/details/(\d{7})", html)
        return m.group(1) if m else None

    # Priorizar los que mencionen Campana o Argentina en la fila.
    for imo, fila in candidatos:
        txt = fila.lower()
        if "campana" in txt:
            return imo
    for imo, fila in candidatos:
        txt = fila.lower()
        if "argentina" in txt:
            return imo
    return candidatos[0][0]


def cargar_tracking_previo() -> dict[str, Any]:
    """Lee el tracking.json previo (si existe) para comparar contra el nuevo
    y detectar transiciones de estado."""
    if not TRACKING_JSON.exists():
        return {"barcos": {}}
    try:
        return json.loads(TRACKING_JSON.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  No se pudo leer tracking previo: {e}")
        return {"barcos": {}}


def detectar_arribos(tracking_previo: dict, tracking_nuevo: dict) -> list[dict]:
    """Devuelve lista de barcos que arribaron (transición a en_puerto en Campana)
    desde el tracking previo. Cada item: {imo, nombre, puerto, arribo}."""
    arribos = []
    barcos_prev = tracking_previo.get("barcos", {})
    barcos_nuevos = tracking_nuevo.get("barcos", {})
    for imo, datos in barcos_nuevos.items():
        if not isinstance(datos, dict):
            continue
        estado_nuevo = (datos.get("estado") or "").lower()
        if estado_nuevo != "en_puerto":
            continue
        puerto = (datos.get("puerto_actual") or "").lower()
        if "campana" not in puerto:
            continue  # solo nos interesa Campana
        prev = barcos_prev.get(imo) or {}
        estado_prev = (prev.get("estado") or "").lower() if isinstance(prev, dict) else ""
        # Solo notificamos si es una transición (antes no estaba en puerto en Campana)
        if estado_prev == "en_puerto" and "campana" in (prev.get("puerto_actual") or "").lower():
            continue  # ya estaba ahí, no es un arribo nuevo
        arribos.append({
            "imo": imo,
            "nombre": datos.get("nombre") or imo,
            "puerto": datos.get("puerto_actual") or "Campana",
            "arribo": datos.get("arribo") or datos.get("ultimo_reporte"),
            "estimado": bool(datos.get("arribo_estimado")),
        })
    return arribos


def enviar_mail_arribos(arribos: list[dict], destinatarios: list[str]) -> bool:
    """Envía un mail por cada arribo detectado a la lista de destinatarios.
    Usa SMTP de Gmail con App Password (variables de entorno GMAIL_USER y
    GMAIL_APP_PASSWORD). Devuelve True si se envió todo OK."""
    if not arribos or not destinatarios:
        return True

    user = os.environ.get("GMAIL_USER", "").strip()
    pwd = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    if not user or not pwd:
        print("  GMAIL_USER / GMAIL_APP_PASSWORD no configurados — no se envía mail.")
        return False

    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    ok = True
    for arr in arribos:
        nombre = arr["nombre"]
        puerto = arr["puerto"]
        arribo = arr.get("arribo") or "ahora"
        if arr.get("estimado") and arr.get("arribo"):
            arribo = f"{arribo} (aprox.)"
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"🚢 Arribo a Campana — {nombre}"
        msg["From"] = f"TAGSA Aduana <{user}>"
        msg["To"] = ", ".join(destinatarios)

        texto = (
            f"El buque {nombre} (IMO {arr['imo']}) acaba de arribar al puerto.\n\n"
            f"Puerto: {puerto}\n"
            f"Hora de arribo: {arribo}\n\n"
            f"Aviso automático del sistema de tracking AIS de Odfjell Terminals Tagsa SA — Campana.\n"
        )
        html = f"""
        <html><body style="font-family:Arial,sans-serif;font-size:14px;color:#111">
        <h2 style="color:#1e3a8a">🚢 Arribo a Campana — {nombre}</h2>
        <p>El buque <strong>{nombre}</strong> (IMO {arr['imo']}) acaba de arribar al puerto.</p>
        <table style="border-collapse:collapse;margin:1em 0">
            <tr><td style="padding:4px 12px;color:#6b7280">Puerto</td><td style="padding:4px 12px"><strong>{puerto}</strong></td></tr>
            <tr><td style="padding:4px 12px;color:#6b7280">Hora de arribo</td><td style="padding:4px 12px"><strong>{arribo}</strong></td></tr>
        </table>
        <p style="color:#6b7280;font-size:12px">Aviso automático del sistema de tracking AIS de Odfjell Terminals Tagsa SA — Campana.</p>
        </body></html>
        """
        msg.attach(MIMEText(texto, "plain", "utf-8"))
        msg.attach(MIMEText(html, "html", "utf-8"))

        try:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
                smtp.login(user, pwd)
                smtp.send_message(msg)
            print(f"  Mail de arribo enviado: {nombre} → {len(destinatarios)} destinatarios")
        except Exception as e:
            print(f"  ERROR enviando mail para {nombre}: {e}")
            ok = False
    return ok


def main() -> int:
    config = json.loads(BARCOS_JSON.read_text(encoding="utf-8"))
    barcos = config.get("barcos", [])
    print(f"Trackeando {len(barcos)} barcos...")

    # Cargar tracking previo para detectar transiciones
    tracking_previo = cargar_tracking_previo()

    config_modificado = False
    # Primero resolver IMOs faltantes por nombre
    for b in barcos:
        if not str(b.get("imo") or "").strip():
            nombre = b.get("nombre", "").strip()
            if not nombre:
                continue
            print(f"  Buscando IMO de '{nombre}'...", end=" ", flush=True)
            imo = buscar_imo_por_nombre(nombre)
            if imo:
                b["imo"] = imo
                config_modificado = True
                print(f"encontrado: {imo}")
            else:
                print("no encontrado (queda pendiente)")

    if config_modificado:
        BARCOS_JSON.write_text(
            json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"  barcos.json actualizado con IMOs resueltos.")

    salida: dict[str, Any] = {
        "actualizado": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "barcos": {},
    }
    for b in barcos:
        imo = str(b.get("imo") or "").strip()
        if not imo:
            # entrada que aún no resolvió IMO; la representamos en tracking
            # con error para que la UI sepa el estado
            salida["barcos"][b.get("nombre", "?")] = {
                "imo": None, "nombre": b.get("nombre", ""),
                "fuente": None, "error": "IMO no resuelto",
            }
            continue
        nombre = b.get("nombre", "")
        print(f"  {nombre} (IMO {imo})...", end=" ", flush=True)
        datos = fetch_imo(imo)
        datos["imo"] = imo
        datos["nombre"] = nombre
        salida["barcos"][imo] = datos
        if datos.get("eta"):
            print(f"ok ({datos['fuente']}, ETA {datos['eta']})")
        elif datos.get("error"):
            print(f"sin datos: {datos['error']}")
        else:
            print(f"parcial ({datos.get('fuente')})")

    TRACKING_JSON.write_text(
        json.dumps(salida, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Escrito {TRACKING_JSON}")

    # Detectar arribos y enviar mails
    arribos = detectar_arribos(tracking_previo, salida)
    if arribos:
        nombres = ", ".join(a["nombre"] for a in arribos)
        print(f"Arribos detectados: {nombres}")
        destinatarios = (config.get("notificaciones") or {}).get("mailsArribo") or []
        if destinatarios:
            enviar_mail_arribos(arribos, destinatarios)
        else:
            print("  Sin destinatarios configurados (notificaciones.mailsArribo en barcos.json).")
    else:
        print("Sin arribos nuevos.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
