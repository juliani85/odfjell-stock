# Backup diario a Google Drive (con rclone) — setup

Todas las noches (03:00 hora Argentina) una tarea de GitHub arma un `.zip` con todos los datos
del sistema (`datos.json`, `vistas.json`, `plan.json`, `sbfa.json`, `barcos.json`, `tracking.json`)
y lo sube a una **carpeta de Google Drive** usando **rclone**. Conserva los últimos 30 días.
También se puede correr a mano: GitHub → pestaña **Actions** → **"Backup diario a Drive"** → **"Run workflow"**.

Workflow: [`.github/workflows/backup-drive.yml`](../.github/workflows/backup-drive.yml).

Configuración **una sola vez**. Necesitás un remoto de Google Drive configurado en rclone en tu
máquina (si ya lo usás en otro proyecto, podés reusar ese mismo).

## Paso 1 — Tener un remoto de Drive en rclone (si no lo tenés)

En tu PC: `rclone config` → `n` (new remote) → nombre, ej. `gdrive` → tipo `drive` → seguí el asistente
(abre el navegador para autorizar tu cuenta de Google) → al final queda el remoto `gdrive:`.
Para ver dónde quedó el archivo de config: `rclone config file`.

## Paso 2 — Copiar la config de rclone a un secret de GitHub

1. Abrí el archivo de config de rclone (el que dice `rclone config file`) en un editor de texto.
2. Copiá **el bloque del remoto de Drive** — desde `[gdrive]` (o como lo hayas llamado) hasta antes del próximo `[...]` o el final. Algo así:
   ```
   [gdrive]
   type = drive
   scope = drive
   token = {"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}
   ```
   (Si querés, podés pegar el archivo entero, no molesta.)
3. En el repo `juliani85/odfjell-stock` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - Nombre: `RCLONE_CONF` · Valor: lo que copiaste en el punto 2 (pegalo tal cual, con saltos de línea).
   - Nombre: `RCLONE_DEST` · Valor: el remoto + la carpeta destino, ej. `gdrive:Backups/Aduana` o `gdrive:Backups Aduana Odfjell Tagsa`. (Usá el nombre de TU remoto. Si la carpeta no existe, rclone la crea.)

## Paso 3 — Probar

GitHub → **Actions** → **"Backup diario a Drive"** → **"Run workflow"** → **Run**.
A los ~30 seg, en tu Drive (en la carpeta de `RCLONE_DEST`) tiene que aparecer `backup_aduana_AAAA-MM-DD.zip`.
Si falla, mirá el log del paso "Subir a Google Drive con rclone": casi siempre es que `RCLONE_DEST` usa un
nombre de remoto que no está en `RCLONE_CONF`, o que el bloque pegado en `RCLONE_CONF` quedó incompleto.

## Notas

- El backup queda en **tu** Drive (usa **tu** espacio de Google). El token de rclone se auto-renueva solo, no vence.
- Restaurar: descargás el `.zip` del día que quieras, lo descomprimís y reemplazás los `.json` del repo (o me pasás el zip y lo hago yo).
- El `RCLONE_CONF` (que tiene el token) vive solo como secret de GitHub, nunca en el repo. Si lo rotás (re-autorizás rclone), actualizá el secret.
- Para cambiar qué archivos entran al backup, editá la lista del `for f in ...` en el workflow. Para cambiar cuántos días se conservan, el `--min-age 30d` del paso de subida.
