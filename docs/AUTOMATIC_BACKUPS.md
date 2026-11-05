# Respaldos automáticos cifrados

La programación queda **desactivada** al migrar. El propietario puede elegir una hora de media hora en `America/Santiago`, conservar entre 1 y 14 copias verificadas (7 por defecto) y fijar un presupuesto de almacenamiento. La pasada de treinta minutos existente llama por separado al endpoint autenticado `/api/internal/backup-tick`; no se crea otro cron ni se retrasa el procesamiento de recordatorios. La hora sigue el cambio estacional de Santiago. Una hora omitida se ejecuta en la primera pasada posterior; una hora repetida conserva una sola identidad diaria. No se reconstruyen copias de días perdidos.

Cada copia incluye la misma instantánea coherente de base y archivos privados que el respaldo manual `.daybook`: cuentas, hashes de contraseña, empresas, conversaciones, notas y ajustes. Conserva sus límites de 100.000 filas, 24 MiB de datos, 128 MiB de manifiesto y hasta 10 MiB por archivo. El archivo automático cifrado tiene un límite adicional de **32 MiB**. Un volumen mayor detiene el intento sin tocar los datos ni el último respaldo válido; requiere el procedimiento operativo de PostgreSQL y almacenamiento.

La clave AES-GCM se obtiene únicamente del entorno privado del ambiente. No se guarda en tablas, respuestas, navegador, logs ni archivos de repositorio. El archivo completo se carga en Blob privado, se vuelve a descargar, se descifra y se comprueban todas las huellas de tablas y archivos antes de marcarlo como completo. La comprobación no restaura sobre la base activa. El operador puede descargar el `.daybook` autenticado y probar su restauración en un destino vacío con el procedimiento existente. La descarga no revela URLs del almacén.

## Activación posterior a la publicación

No provisionar ni contratar servicios para habilitar esta entrega. Antes de activar, revisar las cuotas reales disponibles del plan, el uso de otros archivos y el coste de almacenamiento, lecturas, escrituras, transferencia y tiempo de función. La aplicación impone su propio presupuesto lógico; no consulta ni sustituye la facturación del proveedor y no garantiza la cuota libre de otras aplicaciones.

Configurar de forma privada y separada para QA y producción:

- `DAYBOOK_AUTOMATIC_BACKUP_ENABLED=true`: habilitación operativa; ausente pausa el servicio.
- `DAYBOOK_AUTOMATIC_BACKUP_KEY_QA` o `DAYBOOK_AUTOMATIC_BACKUP_KEY_PRODUCTION`: clave aleatoria base64url de 43–128 caracteres. Nunca copiar una clave productiva a QA/Preview. Conservar una copia de recuperación fuera del proyecto.
- El almacén privado existente exige `DAYBOOK_BLOB_ENV=qa|production` y su token propio `DAYBOOK_BLOB_QA_READ_WRITE_TOKEN` o `DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN`. Preview nunca toma el token productivo. No se admiten sustituciones de endpoint del SDK.
- `DAYBOOK_AUTOMATIC_BACKUP_STORAGE_BUDGET_MIB`: techo revisado de 64–1024 MiB; el ajuste del propietario puede ser menor. Reservar capacidad para las copias conservadas **más una nueva**.
- `DAYBOOK_AUTOMATIC_BACKUP_MONTHLY_TRANSFER_BUDGET_MIB`: techo revisado de 64–8192 MiB. Cada intento reserva conservadoramente 192 MiB (archivos de origen, carga y lectura de verificación). Cada descarga reserva dos veces su tamaño. Los intentos fallidos y los retiros no devuelven transferencia consumida. La cuenta cambia al comienzo del mes UTC.
- `DAYBOOK_AUTOMATIC_BACKUP_PLAN_CHECKED_AT`: instante ISO de la revisión operativa, con antigüedad máxima de 30 días. Una revisión vencida pausa los próximos intentos.
- El endpoint reutiliza `DAYBOOK_NOTIFICATION_JOB_SECRET` y `DAYBOOK_NOTIFICATION_JOB_ENABLED` del programador autenticado. El pinger debe llamar al respaldo de forma independiente después del tick corto de avisos.

Después de verificar esos ajustes, el propietario confirma la revisión de cuotas y activa la programación desde su panel. No se piden claves en la interfaz. Falta de configuración, revisión vencida o presupuesto agotado deja el servicio en pausa y conserva las copias existentes. El panel muestra el motivo y los intentos recientes sin datos de clientes ni errores del proveedor. Desactivar la programación conserva las copias; la limpieza automática también queda pausada.

Una clave nueva no descifra las copias anteriores. No rotar ni retirar una clave mientras existan archivos que se necesiten recuperar con ella; conservarla por separado durante toda su retención. El panel rechaza la descarga que no pueda verificar con la clave presente. Una recuperación operativa deliberada puede utilizar el archivo privado y su clave histórica.

## Reservas, recuperación y retención

Una fila única por propietario, ambiente y fecha local impide duplicados. Una reserva cercada de diez minutos impide ejecuciones concurrentes; el endpoint dura como máximo 300 segundos y su presupuesto interno es 270 segundos. La instantánea usa una ventana menor y limita cada SQL al tiempo restante. Un proceso nuevo solo recupera un intento cuando venció su reserva; cada fecha tiene como máximo tres intentos. Una respuesta perdida al cargar el archivo se resuelve leyendo su ruta determinista antes de generar otra copia. Nunca se sobrescribe un archivo cifrado existente.

Las reservas físicas incluyen cargas inciertas. La limpieza conserva siempre el respaldo verificado más reciente y los últimos N verificados. Solo elimina rutas propias derivadas de propietario, ambiente e identidad, después de registrar una intención duradera. Un fallo de borrado queda pendiente para la próxima pasada y sigue consumiendo presupuesto físico. Los intentos fallidos agotados o de días anteriores también se limpian, sin modificar archivos de origen. La retención libera presupuesto físico únicamente después de confirmar la eliminación; la transferencia mensual permanece contabilizada.

La restauración conserva el historial pero pausa la programación, borra sus reservas de ejecución y marca las referencias de copias anteriores como no portables: el destino recuperado no debe administrar archivos del almacén original. No se envían avisos por correo por un fallo del respaldo, para evitar acoplar recuperación y entrega; el estado permanece disponible al propietario. No se crea un evento nuevo en el contrato existente del outbox.

## Comprobaciones

Sin conexión a servicios:

```sh
node --import tsx --test scripts/check-automatic-backup.test.ts
```

Prueba QA coordinada **en serie**, tras aplicar 0006, con proveedor/almacén en memoria y cuentas ficticias `@example.test`; nunca ejecutar contra producción:

```sh
node --env-file=.env.test.local --import tsx scripts/check-automatic-backup-database.mjs
```

La prueba comprueba permisos de propietario, revisión antes de activar, reserva concurrente, instantánea y archivo privado reales, cifrado/descifrado, descarga autenticada, identidad diaria, cerco de una reserva antigua y rollback por presupuesto. Limpia solamente su espacio ficticio. La verificación de restauración completa en destino vacío continúa cubierta por el ensayo existente `check-backup-recovery-database.mjs`.

El operador QA puede ejecutar el mismo escenario con `--real-qa-storage` después de preparar exclusivamente su configuración privada QA. Esta variante carga un archivo fuente ficticio y el archivo cifrado en Blob privado, usa lecturas reales para comprobar todas las huellas y la descarga, y retira solo las rutas propias creadas por el ensayo. Rechaza ambientes o claves productivas. No envía correos ni invoca integraciones externas ajenas al almacén QA.

```sh
node --env-file=.env.test.local --import tsx scripts/check-automatic-backup-database.mjs --real-qa-storage
```
