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

    # Frase principal con destino + velocidad + ETA. Ejemplo:
    # "en route to the port of <strong>Campana, Argentina</strong>,
    #   sailing at a speed of 9.8 knots
    #   and expected to arrive there on <strong>May 10, 06:00</strong>."
    m = re.search(
        r"en route to the port of\s*<strong>([^<]+)</strong>[^<]*"
        r"sailing at a speed of\s*([\d.]+)\s*knots[^<]*"
        r"expected to arrive[^<]*<strong>([^<]+)</strong>",
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if m:
        out["estado"] = "en_route"
        out["destino"] = m.group(1).strip()
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


def main() -> int:
    config = json.loads(BARCOS_JSON.read_text(encoding="utf-8"))
    barcos = config.get("barcos", [])
    print(f"Trackeando {len(barcos)} barcos...")

    salida: dict[str, Any] = {
        "actualizado": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "barcos": {},
    }
    for b in barcos:
        imo = str(b.get("imo", "")).strip()
        if not imo:
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
