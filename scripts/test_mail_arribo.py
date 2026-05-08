"""Manda un mail de PRUEBA usando la misma función de notificación de arribos.
Útil para validar que GMAIL_USER + GMAIL_APP_PASSWORD están bien cargados
y que las casillas en barcos.json reciben los avisos.

Uso (local o desde GitHub Actions):
    python scripts/test_mail_arribo.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BARCOS_JSON = ROOT / "barcos.json"

sys.path.insert(0, str(Path(__file__).parent))
from track_vessels import enviar_mail_arribos  # noqa: E402


def main() -> int:
    config = json.loads(BARCOS_JSON.read_text(encoding="utf-8"))
    destinatarios = (config.get("notificaciones") or {}).get("mailsArribo") or []
    if not destinatarios:
        print("ERROR: No hay destinatarios en barcos.json -> notificaciones.mailsArribo")
        print("Cargá al menos uno desde la pestaña Barcos antes de correr el test.")
        return 1
    print(f"Enviando mail de prueba a: {', '.join(destinatarios)}")

    arribos_falsos = [{
        "imo": "0000000",
        "nombre": "MAIL DE PRUEBA — TAGSA TRACKING",
        "puerto": "Campana, Argentina (PRUEBA)",
        "arribo": "2026-05-08T12:00:00Z",
    }]
    ok = enviar_mail_arribos(arribos_falsos, destinatarios)
    if ok:
        print("OK — mail enviado correctamente.")
        return 0
    print("ERROR — el envío falló. Revisá el log y los secrets en GitHub.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
