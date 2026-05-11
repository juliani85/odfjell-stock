/**
 * Backup diario del sistema de stock (Odfjell Terminals Tagsa) a Google Drive.
 *
 * Una tarea programada de GitHub (.github/workflows/backup-drive.yml) le manda todas las
 * noches un .zip (en base64) con datos.json, vistas.json, plan.json, sbfa.json, barcos.json
 * y tracking.json. Este script lo guarda en una CARPETA de tu Drive, con la fecha en el nombre,
 * y borra los backups de más de N días.
 *
 * ── CONFIGURAR (una sola vez) ─────────────────────────────────────────────
 * 1) Engranaje "Configuración del proyecto" (izquierda) → "Propiedades de la secuencia de comandos"
 *    → "Agregar propiedad de secuencia de comandos":
 *        TOKEN  = <el token que te pasó Claude>          ← OBLIGATORIO. Mismo valor que el
 *                                                          secret GDRIVE_WEBAPP_TOKEN de GitHub.
 *        CARPETA       = Backups Aduana — Odfjell Tagsa   ← opcional, nombre de la carpeta (default ese)
 *        DIAS_GUARDAR  = 30                               ← opcional, cuántos días conservar (0 = no borrar)
 * 2) "Implementar" → "Nueva implementación" → tipo "Aplicación web":
 *        Ejecutar como: Yo (tu cuenta)
 *        Quién tiene acceso: Cualquier usuario
 *    → "Implementar". La primera vez te pide autorizar (Permitir; si dice "app no verificada"
 *      → "Configuración avanzada" → "Ir a … (no seguro)" → Permitir — es tu propio script).
 * 3) Copiá la URL que termina en /exec → ese es el secret GDRIVE_WEBAPP_URL de GitHub.
 *
 * Si después editás este código: "Implementar" → "Administrar implementaciones" → editás la
 * implementación existente y subís la versión (así la URL no cambia).
 */

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var TOKEN = props.getProperty("TOKEN");
  if (!TOKEN) return _resp({ ok: false, error: "falta configurar el Script Property TOKEN" });
  if (!e || !e.parameter || e.parameter.token !== TOKEN) return _resp({ ok: false, error: "no autorizado" });

  var nombreCarpeta = props.getProperty("CARPETA") || "Backups Aduana — Odfjell Tagsa";
  var diasGuardar = parseInt(props.getProperty("DIAS_GUARDAR") || "30", 10);

  var it = DriveApp.getFoldersByName(nombreCarpeta);
  var carpeta = it.hasNext() ? it.next() : DriveApp.createFolder(nombreCarpeta);

  var hoy = Utilities.formatDate(new Date(), "America/Argentina/Buenos_Aires", "yyyy-MM-dd");
  var nombre = (e.parameter.name || ("backup_aduana_" + hoy + ".zip")).replace(/[^A-Za-z0-9._-]/g, "_");

  if (!e.postData || !e.postData.contents) return _resp({ ok: false, error: "cuerpo vacio" });
  var bytes;
  try { bytes = Utilities.base64Decode(String(e.postData.contents).trim()); }
  catch (err) { return _resp({ ok: false, error: "base64 invalido: " + err }); }
  var blob = Utilities.newBlob(bytes, "application/zip", nombre);

  // Si ya hay un backup con ese nombre (re-run del workflow el mismo dia), reemplazarlo.
  var prev = carpeta.getFilesByName(nombre);
  while (prev.hasNext()) prev.next().setTrashed(true);
  var archivo = carpeta.createFile(blob);

  // Podar backups viejos.
  var borrados = 0;
  if (diasGuardar > 0) {
    var limite = new Date();
    limite.setDate(limite.getDate() - diasGuardar);
    var fs = carpeta.getFiles();
    while (fs.hasNext()) {
      var f = fs.next();
      if (/^backup_aduana_/.test(f.getName()) && f.getDateCreated() < limite) { f.setTrashed(true); borrados++; }
    }
  }
  return _resp({ ok: true, name: nombre, id: archivo.getId(), size: bytes.length, borrados: borrados });
}

function doGet() {
  return _resp({ ok: true, msg: "backup endpoint vivo" });
}

function _resp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
