# Proxy de GitHub (Cloudflare Worker) — setup

Esto reemplaza al token de GitHub que estaba "pegado" en el JS de la app (y que GitHub
revocó solo, porque detecta tokens en repos públicos). Ahora el token vive escondido en
Cloudflare y nunca más se rompe solo.

Hay que hacerlo **una sola vez**. Después no se toca nunca.

## Paso 1 — Crear el token de GitHub

1. Entrá a https://github.com/settings/tokens?type=beta (fine-grained) **o** el clásico:
   https://github.com/settings/tokens (clásico es más simple).
2. **Clásico** (recomendado por "set and forget"):
   - "Generate new token (classic)".
   - Nombre: `odfjell-stock-worker`.
   - **Expiration: No expiration**.
   - Scope: marcá solo **`repo`**.
   - "Generate token". **Copialo** (empieza con `ghp_…`). Lo vas a pegar en el Paso 3.
   - *(Alternativa fine-grained: Repository access → Only select repositories → `juliani85/odfjell-stock`; Permissions → Repository permissions → Contents → **Read and write**. Caduca máximo en 1 año.)*

## Paso 2 — Crear el Worker en Cloudflare

1. Creá una cuenta gratis en https://dash.cloudflare.com/sign-up (no pide tarjeta).
2. En el panel, menú izquierdo → **Workers & Pages** → **Create** → **Create Worker**.
3. Ponele un nombre, ej. `odfjell-stock-proxy`. → **Deploy** (crea uno de ejemplo).
4. Entrá al Worker → **Edit code** → borrá todo lo que hay y pegá el contenido de
   [`worker.js`](worker.js) (el archivo que está en esta carpeta) → **Deploy** (arriba a la derecha).

## Paso 3 — Cargar los secrets

En el Worker → **Settings** → **Variables and Secrets** → **Add**:

| Tipo   | Nombre         | Valor                                                        |
|--------|----------------|--------------------------------------------------------------|
| Secret | `GITHUB_TOKEN` | el token `ghp_…` del Paso 1                                   |
| Secret | `APP_SECRET`   | `w_RQ_vQeHrd1NTn6rtFuMR3MEMRzuzGJt98mL6Dk1Rk3hFty`           |

(Opcional, tipo Text — solo si algún día cambia el repo o el dominio:
`REPO` = `juliani85/odfjell-stock`, `ORIGEN` = `https://juliani85.github.io`.)

→ **Deploy** de nuevo para que tome los secrets.

## Paso 4 — Pasar la URL

El Worker queda en una URL tipo `https://odfjell-stock-proxy.TU-SUBDOMINIO.workers.dev`.
La ves en la página del Worker (arriba). **Pasámela** y yo conecto la app a esa URL.

## Verificar

Abrí en el navegador `https://…workers.dev/` → tiene que decir `ok`.
Abrí `https://…workers.dev/gh/sbfa.json` → tiene que devolver un JSON con `sha` y `content`.
Si dice `GitHub 401` → el token está mal. Si dice `archivo no permitido` → escribiste mal el nombre.

## Notas

- **El token nunca más se va a auto-revocar** porque no está en código público.
- Si usaste el clásico sin expiración: no lo tocás nunca. Si usaste fine-grained: renovalo
  una vez al año (te avisa GitHub por mail).
- Para rotar `APP_SECRET`: cambialo en el Worker y avisame para cambiarlo en la app.
- Plan gratis de Cloudflare: 100.000 requests/día. La app hace decenas. No lo vas a tocar.
- El código del Worker está versionado acá. Si hay que tocarlo, se edita `worker.js` y se
  vuelve a pegar en Cloudflare (o se usa `wrangler` si querés CLI).
