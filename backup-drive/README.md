# Backup diario a Google Drive — setup

Todas las noches (03:00 hora Argentina) una tarea de GitHub arma un `.zip` con todos los datos
del sistema (`datos.json`, `vistas.json`, `plan.json`, `sbfa.json`, `barcos.json`, `tracking.json`)
y lo sube a una **carpeta de tu Google Drive** (la crea sola la primera vez: "Backups Aduana — Odfjell Tagsa").
Conserva los últimos 30 días y borra los más viejos. También se puede correr a mano desde
GitHub → Actions → "Backup diario a Drive" → "Run workflow".

Hay que configurarlo **una sola vez**. Después no se toca.

## Paso 1 — Crear el Apps Script (la "cajita" que recibe el backup y lo guarda en tu Drive)

1. Entrá a https://script.google.com → **Nuevo proyecto** (con tu cuenta de Google, la que tiene el Drive).
2. Borrá el código de ejemplo y pegá el contenido de [`Code.gs`](Code.gs) (el archivo de esta carpeta).
3. Engranaje **"Configuración del proyecto"** (a la izquierda) → bajá a **"Propiedades de la secuencia de comandos"** → **"Agregar propiedad de secuencia de comandos"**:
   - Propiedad: `TOKEN` · Valor: *(el token que te pasó Claude por chat)* → Guardar.
   - *(Opcional)* `CARPETA` = `Backups Aduana — Odfjell Tagsa` (si querés otro nombre de carpeta).
   - *(Opcional)* `DIAS_GUARDAR` = `30` (cuántos días de backups conservar; `0` = no borrar nunca).
4. **"Implementar"** (arriba a la derecha) → **"Nueva implementación"** → ícono de engranaje → tipo **"Aplicación web"**:
   - Descripción: `backup aduana`
   - **Ejecutar como: Yo (tu cuenta)**
   - **Quién tiene acceso: Cualquier usuario**
   - → **"Implementar"**. La primera vez te pide autorizar: **Permitir**. Si dice "Google no verificó esta app" → **"Configuración avanzada"** → **"Ir a … (no seguro)"** → **Permitir**. (Es tu propio script, es seguro.)
5. Te muestra una **URL** que termina en `/exec`. **Copiala** — la necesitás en el paso 2.

## Paso 2 — Cargar los 2 secrets en GitHub

En el repo `juliani85/odfjell-stock` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Nombre                  | Valor                                                      |
|-------------------------|------------------------------------------------------------|
| `GDRIVE_WEBAPP_URL`     | la URL `…/exec` del paso 1.5                                |
| `GDRIVE_WEBAPP_TOKEN`   | el mismo token que pusiste en `TOKEN` del Apps Script      |

## Paso 3 — Probar

GitHub → pestaña **Actions** → **"Backup diario a Drive"** (en la lista de la izquierda) → **"Run workflow"** → **Run**.
A los ~20 seg, en tu Google Drive tiene que aparecer la carpeta **"Backups Aduana — Odfjell Tagsa"** con
un archivo `backup_aduana_AAAA-MM-DD.zip` adentro. Si el log del workflow dice `Drive no confirmó OK`,
revisá que el `TOKEN` del Apps Script y el secret `GDRIVE_WEBAPP_TOKEN` sean idénticos, y que la URL termine en `/exec`.

## Notas

- El `.zip` te queda en **tu** Drive (lo crea tu propio Apps Script ejecutándose como vos), así que usa **tu** espacio de Google. No hay tokens que venzan ni cuentas de servicio.
- Si algún día editás `Code.gs`: "Implementar" → "Administrar implementaciones" → editás la implementación existente y subís la versión nueva → así la URL **no cambia** y no hay que tocar nada en GitHub.
- Para restaurar: descargás el `.zip` del día que quieras, lo descomprimís, y reemplazás los `.json` en el repo (o me pasás el zip y lo hago yo).
- El token nunca está en el repo: vive como secret de GitHub y como propiedad del Apps Script. Si lo querés rotar, cambialo en los dos lados.
