# Service Plus: publicación, conservación y recuperación

Esta entrega parte de la versión publicada `main@122b83f815b51b37756b625af7e8b8e5e8ea99a6` y se prepara en `codex/daybook-ticket-service-plus`. El PR, CI y despliegue revisable deben corresponder al mismo commit. Esta guía no autoriza publicar, migrar o activar producción automáticamente.

Incluye correo entrante, escalamiento, satisfacción, formato de respuestas y vista previa de adjuntos, búsqueda paginada en conversaciones y respaldo cifrado con restauración comprobada. El remitente existente de Consorcio C17, los usuarios, contraseñas, sesiones, empresas, tickets, archivos y claves de idempotencia se conservan. No cambiar DNS, claves de envío, planes ni otros proyectos para preparar esta entrega.

## Esquema aditivo y operador

`0005_service_plus` añade cuatro tablas (`escalationSettings`, `escalationOccurrences`, `ticketSatisfaction`, `inboundMailReceipts`), dos referencias anulables de correo (`escalationId`, `satisfactionId`), índices de lectura y `messages.bodyFormat`. Los mensajes existentes reciben la etiqueta segura `plain`; sus cuerpos no se reescriben ni se interpretan como Markdown. No se crean encuestas, escalaciones, recepciones, configuraciones ni historia a partir de datos anteriores.

SHA-256 revisado de `0005_service_plus.sql`: `34834ec6946844394916d06bedf3e5089dbf615c552e5e8ad541956f66eeffba`.

El operador nuevo `scripts/migrate-service-plus-production.mjs` fija los hashes y metadatos de **0000–0005**. Las futuras migraciones del repositorio quedan fuera de su snapshot. Solo acepta una base con el journal exacto hasta 0004, o hasta 0005 para verificar una ejecución anterior. No usar los operadores históricos para esta entrega.

El CLI exige simultáneamente la conexión pooled productiva y una conexión directa privada al destino fijo `ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket`. Rechaza hosts alternativos, bases distintas y opciones que puedan redirigir la conexión; fuerza `sslmode=verify-full`. Las credenciales se proporcionan por entorno privado, nunca mediante argumentos, comentarios, logs o archivos versionados.

- `--audit`: una transacción de solo lectura y snapshot consistente; informa únicamente recuentos, huellas y estado del esquema.
- `--dry-run`: el mismo migrador y comprobaciones de aplicación, dentro de una transacción externa que siempre termina en rollback.
- `--apply`: exige la confirmación exacta del destino y el token separado `0005`. Confirma una sola vez, después de todas las comprobaciones.

Drizzle se ejecuta sobre la misma conexión mediante un savepoint; su COMMIT no confirma la transacción externa. Se fijan tiempos de espera y bloqueos breves. Se comparan las definiciones y SHA-256 de todas las columnas originales de todas las tablas públicas, incluidas tablas desconocidas. Se verifican tipos, nulabilidad y valores por defecto nuevos, las únicas columnas añadidas previstas y ausencia de backfill. Un fallo revierte DDL, filas y journal. Como en PostgreSQL, los contadores de secuencias pueden dejar huecos inocuos después de un ensayo revertido.

Con las conexiones ya cargadas de forma privada en el entorno del operador:

```sh
node scripts/migrate-service-plus-production.mjs --audit

DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET='daybook-ticket:ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket:0005' \
  node scripts/migrate-service-plus-production.mjs --dry-run

# Únicamente en la publicación posterior autorizada, con punto de recuperación revisado:
DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET='daybook-ticket:ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket:0005' \
DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY=0005 \
  node scripts/migrate-service-plus-production.mjs --apply
```

No ejecutar un provisionado, seed, restauración de QA ni recreación de usuarios al migrar producción. El operador no despliega aplicaciones, descarga archivos ni envía avisos.

## QA y Preview protegido

La base de QA y su almacenamiento privado son independientes. Las suites usan personas ficticias `@example.test`; las integraciones que escriben QA se coordinan **en serie** y verifican su limpieza. Los proveedores de envío reales y el worker permanecen desactivados. No copiar secretos de producción a `.env.test.local`, Preview o CI.

```sh
npm run check
node --test scripts/check-service-plus-migration-operator.test.mjs
npm run test:service-plus:qa
# Con el build compilado y servidor QA en 127.0.0.1:5175:
npm run test:service-plus:http
```

El operador de producción no acepta URLs de QA en su CLI. Para verificar el catálogo ya migrado de QA sin escrituras, usar exclusivamente su entrada de biblioteca con un cliente independiente, guardado al host QA fijo:

```sh
node --env-file=.env.test.local --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import pg from 'pg';
import { runServicePlusMigrationOperator, servicePlusFailureReport } from './scripts/migrate-service-plus-production.mjs';
let client;
try {
  assert.equal(process.env.DAYBOOK_QA_ALLOW_TEST_DATABASE, '1');
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, 'ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech');
  assert.equal(process.env.DAYBOOK_QA_DATABASE_HOST, url.hostname);
  assert.equal(url.pathname, '/daybook_ticket');
  assert.ok((!url.port || url.port === '5432') && url.username && url.password && !url.hash);
  const keys = [...url.searchParams.keys()];
  assert.ok(keys.every(key => ['sslmode', 'channel_binding'].includes(key)) && new Set(keys).size === keys.length);
  assert.ok(!process.env.RESEND_API_KEY && !process.env.RESEND_INBOUND_API_KEY && !process.env.VAPID_PRIVATE_KEY);
  url.hostname = 'ep-falling-water-bbfa4ijl.c-15.us-east-1.aws.neon.tech';
  url.searchParams.set('sslmode', 'verify-full');
  client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000 });
  await client.connect();
  console.log(JSON.stringify(await runServicePlusMigrationOperator(client, { mode: 'audit' })));
} catch (error) {
  console.error(JSON.stringify(servicePlusFailureReport(error))); process.exitCode = 1;
} finally { await client?.end().catch(() => undefined); }
JS
```

La entrada de biblioteca no sustituye las guardas del CLI para operaciones productivas. Un ensayo de primera aplicación necesita una base aislada que todavía conserve 0004 y un punto de recuperación conocido; no eliminar 0005 de un QA en uso para simularlo.

Preview debe mantener Vercel Authentication y la autenticación de Daybook. Sus variables se limitan a la rama y a servicios QA. La revisión automatizada utiliza acceso privado autorizado; no desactivar protección ni crear enlaces públicos para facilitar las pruebas. Capturas e informes locales permanecen en `outputs/` y `work/`, ignorados por Git.

## Orden de publicación posterior

1. Revisar CI, evidencia, Preview y el mismo commit candidato. Confirmar cuotas disponibles, recuperar la referencia productiva actual y registrar un punto de recuperación de base y archivos. No contratar ni aumentar planes automáticamente.
2. Mantener correo entrante y escalamiento pausados inicialmente. Si se necesita una publicación sin nuevas invitaciones de satisfacción, configurar `DAYBOOK_SATISFACTION_ENABLED=false` antes del build; el valor por defecto conserva las encuestas de cierres futuros.
3. Ejecutar auditoría, ensayo con rollback y aplicación de **0005 únicamente** mediante el operador revisado. Guardar el informe agregado privado y su comprobación atómica de conservación. Los archivos Blob no se modifican al aplicar esta migración.
4. Preparar un build productivo sin asignarle dominios. Comprobar inicio de sesión, lectura de tickets existentes, autores, notas privadas, descarga de un archivo existente y representación literal de mensajes históricos. Promover ese mismo build revisado.
5. Verificar contador de avisos, estado del programador existente y seguimiento de correo sin reiniciar estados ni claves de idempotencia. La búsqueda debe cargar páginas autorizadas y conversaciones completas; un cliente nunca recibe notas internas ni coincidencias de ellas.
6. Activar las integraciones nuevas por separado, una vez comprobadas sus cuentas y configuración. Usar una prueba real coordinada solo cuando esté expresamente solicitada, con un ticket identificado y sin alterar los actuales.

### Activaciones independientes

- **Escalamiento:** administración configura destinatarios y umbrales en Atención y reparto. La migración lo deja sin configuración activa. El tick actual de treinta minutos incorpora esta comprobación; no crear otro cron ni duplicar el worker. La activación exige una nueva intervención pública del cliente y conserva los recordatorios normales de dos horas.
- **Satisfacción:** se solicita al cliente tras una nueva resolución real. `DAYBOOK_SATISFACTION_ENABLED=false` impide nuevas invitaciones y cancela la elegibilidad de envíos pendientes; conserva las respuestas e informes existentes. No se envían encuestas retrospectivas.
- **Correo entrante:** seguir [INBOUND_EMAIL.md](INBOUND_EMAIL.md). Se necesitan dominio receptor, clave de lectura y firma independientes. El dominio administrado `.resend.app` permite conectarlo sin modificar los MX de Consorcio C17. Activar `DAYBOOK_INBOUND_ENABLED=true` como último paso; no reutilizar la clave restringida de envío ni la firma del seguimiento de entregas.

## Respaldo y restauración

El propietario puede descargar un archivo `.daybook` cifrado con una clave propia de 16–256 caracteres. Incluye cuentas, hashes de contraseña, conversaciones, notas, configuración e historial, junto con los archivos enviados. Las credenciales de invitación y los tokens OAuth no se exportan como accesos portables: se conserva el integrante invitado, la tabla de invitaciones queda vacía y los campos de tokens de cuenta se proyectan como NULL antes de leerlos. La clave no se almacena y no debe compartirse en el chat. Mantener el archivo y su clave en ubicaciones privadas separadas. El límite de esta vía es 128 MiB; para volúmenes mayores se necesita un respaldo operativo de PostgreSQL y almacenamiento.

El operador `scripts/daybook-backup.mjs` admite `create`, `verify` y `restore`. Recibe `DAYBOOK_BACKUP_PASSWORD` exclusivamente por entorno privado. `verify` comprueba autenticidad, descifrado y huellas sin consultar una base. `restore` exige un destino vacío, ambiente explícito y confirmación privada de la identidad del espacio; no sobrescribe una instalación existente.

Para `restore`, el entorno privado debe incluir `DAYBOOK_BACKUP_RESTORE_CONFIRM` con el `ownerId` exacto del respaldo, `DATABASE_URL` del destino vacío y `DAYBOOK_BLOB_ENV=qa` o `production`, junto con el token privado de ese almacén. Deben faltar `RESEND_API_KEY`, `RESEND_INBOUND_API_KEY` y `VAPID_PRIVATE_KEY`; el worker y el correo entrante deben estar desactivados y `DAYBOOK_SATISFACTION_ENABLED=false`. Una recuperación productiva deliberada requiere además `DAYBOOK_BACKUP_ALLOW_PRODUCTION_RESTORE=I_HAVE_AN_EMPTY_RECOVERY_DATABASE`; esa guarda no permite sobrescribir un destino con datos.

```sh
# Entorno privado de origen y clave cargados previamente, sin imprimirlos:
node --import tsx scripts/daybook-backup.mjs create /ruta/privada/daybook.daybook
node --import tsx scripts/daybook-backup.mjs verify /ruta/privada/daybook.daybook

# Solo en un destino vacío de recuperación, con conexiones/clave/confirmación privadas:
node --import tsx scripts/daybook-backup.mjs restore /ruta/privada/daybook.daybook
```

Antes de restaurar, desactivar todos los envíos, el worker y las integraciones automáticas, incluida `DAYBOOK_SATISFACTION_ENABLED=false`. La recuperación conserva cuentas y contenido, fuerza un nuevo inicio de sesión y deja reglas/trabajos automáticos pausados; comprobar sus ajustes antes de reactivarlos. Después de verificar todas las huellas, también invalida invitaciones y tokens OAuth de archivos v1 anteriores que todavía los incluyan. Los hashes de contraseña y las identidades de cuenta se conservan. Emitir invitaciones nuevas para los integrantes que aún no habían activado su cuenta y reconectar cualquier proveedor OAuth. El historial de correo congelado permanece íntegro; sus enlaces de invitación anteriores no activan cuentas recuperadas. Nunca restaurar un respaldo de QA sobre producción ni usar este operador para deshacer una migración sobre datos actuales.

El workflow `recovery-drill.yml` realiza un ensayo periódico con PostgreSQL desechable, datos y archivos ficticios y transporte privado simulado. No lleva credenciales productivas. Ese ensayo valida el mecanismo de recuperación; no constituye una copia periódica de los datos reales. La copia real debe conservarse según la política operativa elegida por el propietario.

## Desactivación y reversión

La opción preferida es mantener un build compatible y corregir hacia delante: pausar correo entrante, desactivar escalamiento y, si corresponde, desactivar satisfacción mediante su variable. Las políticas, empresas, responsables, comentarios, archivos, avisos y evaluaciones permanecen guardados.

**No eliminar tablas ni columnas ni devolver `bodyFormat` a NULL para revertir.** Un build anterior no entiende el formato de mensajes ni el nuevo contrato paginado del feed. También desconoce los eventos de escalamiento/satisfacción, sus comprobaciones de vigencia y los payloads v3 pendientes de congelar. Por ello, volver al build anterior no es una reversión transparente.

Si una emergencia exige cambiar a un build antiguo, preparar primero una ventana controlada sin escrituras: pausar recepción/programación, detener nuevas automatizaciones, esperar a que terminen o expiren los leases y revisar los eventos pendientes. Cancelar únicamente los avisos de automatización que no puedan entregarse de forma compatible, conservando sus filas y motivo. Los envíos estándar v3 todavía sin payload congelado deben resolverse con el sender compatible antes del cambio; no modificar un payload congelado ni reiniciar un envío aceptado o incierto para adaptarlo al sender antiguo. Si esto no puede garantizarse, conservar el sender/build nuevo y realizar una corrección acotada.

Registrar la referencia anterior y la candidata, momento del cambio y sus limitaciones. Los mensajes Markdown podrán verse como texto sin formato en una versión antigua; nunca reinterpretar ni reescribir las conversaciones históricas para ocultar esa diferencia. Comprobar usuarios, tickets, empresas y archivos antes y después del incidente. No restaurar toda la base para resolver únicamente un problema de código.

## Vista previa de documentos

Las imágenes y PDF se obtienen mediante una ruta autenticada que vuelve a comprobar los permisos actuales y devuelve bytes privados sin caché compartida. El cliente comprueba MIME y tamaño antes de crear una URL Blob temporal; nunca muestra enlaces públicos del almacén. El visor PDF utiliza el visor nativo del navegador, sin `sandbox` en su iframe porque impediría cargar el plugin PDF ([MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content/General_embedding_technologies#embedding_pdfs)). No se incrustan páginas HTML, imágenes remotas ni URLs proporcionadas por el cliente. El visor tiene política de referencia `no-referrer`, permisos de dispositivos restringidos y descarga autenticada alternativa. Las URLs temporales se liberan al cerrar.
