# Publicación y reversión de fiabilidad

La migración aditiva **0006_reliability** conserva los valores anteriores de todas las tablas públicas. Añade seis tablas para la cola de recepción, archivos incorporados, presencia y respaldos; añade `members.isTest` y `tickets.isTest`, ambos con valor predeterminado `false`. No reclasifica cuentas o tickets existentes ni crea trabajos, presencia, configuraciones, respaldos, avisos o historia a partir de ellos. Los respaldos automáticos quedan desactivados hasta la activación privada y la confirmación del propietario.

SHA-256 revisado de `0006_reliability.sql`: `aa06eded54a9c36ddc77a3ecb3018a1b8460bb1f5a617870b3e276f245ea6797`.

`scripts/migrate-reliability-production.mjs` fija los hashes y metadatos de 0000–0006 y crea una copia privada e inmutable para el migrador. Excluye migraciones futuras. Solo admite el journal exacto hasta 0005 o hasta 0006 para comprobar una aplicación anterior. Los operadores históricos siguen limitados a sus propias entregas; no utilizarlos para migrar 0006.

## Operador productivo

El CLI exige `DATABASE_URL` pooled y `DIRECT_DATABASE_URL` directo cargados por un canal privado. Solo acepta el destino fijo `ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket`, fuerza `sslmode=verify-full` y rechaza opciones que redirijan la conexión. No acepta secretos en argumentos ni imprime filas, cuerpos, usuarios o contraseñas.

```sh
node scripts/migrate-reliability-production.mjs --audit

DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET='daybook-ticket:ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket:0006' \
  node scripts/migrate-reliability-production.mjs --dry-run

# Solo en una publicación autorizada y con punto de recuperación revisado:
DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET='daybook-ticket:ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket:0006' \
DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY=0006 \
  node scripts/migrate-reliability-production.mjs --apply
```

La auditoría usa un snapshot consistente de solo lectura. Ensayo y aplicación utilizan una sola conexión, un bloqueo de operador y una transacción exterior; Drizzle actúa dentro de un savepoint. Se bloquean de forma determinista las tablas públicas, incluidas tablas desconocidas, y se comparan sus definiciones y huellas de cada columna original. Se verifican las seis tablas, los únicos dos campos añadidos, sus tipos/nulabilidad/defaults, ausencia de filas nuevas y marcadores `isTest=false` en toda fila anterior. Un error revierte DDL, datos y journal. El ensayo siempre revierte; las secuencias pueden dejar huecos inocuos. Ningún modo despliega, envía correos o modifica archivos Blob.

## Preparación y comprobación

1. Revisar CI, commit, Preview protegido, cuota real disponible y referencias actual/candidata. Registrar un punto de recuperación privado de base y archivos; no aumentar planes ni cambiar DNS para preparar esta entrega.
2. Ensayar 0006 en una base aislada que aún conserve 0005; no quitar el journal de un QA compartido. Coordinar las pruebas que escriben QA en serie. Ejecutar auditoría, ensayo revertido y aplicación mediante el operador específico cuando exista autorización productiva.
3. Preparar el mismo build productivo sin asignarle todavía dominios. Verificar con lecturas autorizadas: conversación existente, autores, nota interna para personal, exclusión de notas para cliente, búsqueda, descarga privada y representación literal de mensajes históricos. No crear tickets o correos de prueba sin una petición expresa.
4. Para el cambio, impedir nuevas invocaciones al build anterior y esperar su límite efectivo de ejecución más un margen. Revisar reservas en vuelo. Promover el build comprobado y reanudar el acceso. No permitir que workers antiguos y nuevos procesen simultáneamente la cola durante el relevo.
5. Verificar referencia productiva, acceso, estado del programador y errores agregados sin reiniciar estados, claves de idempotencia o cursores. El pinger existente mantiene su única cadencia; recepción y respaldos se invocan por separado para que un fallo no bloquee recordatorios.
6. Activar los respaldos únicamente después de la publicación siguiendo [AUTOMATIC_BACKUPS.md](AUTOMATIC_BACKUPS.md). Requieren una clave separada por ambiente, presupuestos explícitos, revisión del plan vigente y activación del propietario. No provisionar servicios ni copiar claves productivas a Preview/QA.

Una comprobación sin efectos puede usar las rutas protegidas con una petición sin firma y confirmar el rechazo antes de acceder a la base. Las rutas de estado y conversación son de lectura. El GET de espacio de personal puede drenar correos existentes; tenerlo en cuenta si la comprobación exige cero entregas externas. No invocar manualmente los endpoints de procesamiento para una prueba de solo lectura.

## Desactivación y recuperación

Preferir pausar la función afectada y corregir el build compatible. El propietario puede desactivar la programación sin perder archivos. La habilitación operativa, recepción y pinger tienen interruptores independientes; conservar las filas y motivos de los intentos. Nunca borrar tablas/columnas ni restaurar toda la base para corregir un problema únicamente de código.

Un build anterior desconoce los trabajos duraderos, referencias de archivos, presencia y respaldos automáticos. Antes de una reversión de emergencia, establecer una ventana sin escrituras, pausar entradas y ejecución de trabajos, esperar que finalicen o expiren todas las reservas y revisar los trabajos pendientes. Mantener un sender compatible con cualquier payload pendiente; no cambiar payloads congelados ni reiniciar envíos aceptados o inciertos. Si no puede garantizarse el relevo, mantener el build nuevo y corregir hacia delante.

La restauración completa sigue exigiendo un destino vacío y la confirmación privada del operador. Conserva y verifica hashes originales antes de invalidar credenciales temporales. Los archivos v1 anteriores a 0006 se admiten con su conjunto exacto de tablas; los campos `isTest` nuevos toman `false` en el esquema actual. Las tablas adicionales también deben estar vacías antes de restaurar. La recuperación elimina presencia efímera, pausa trabajos y programación y marca las referencias de respaldos anteriores como no portables, sin borrar objetos del almacén original. Las cuentas y los hashes de contraseña se conservan; se requiere iniciar sesión y reactivar deliberadamente las integraciones.
