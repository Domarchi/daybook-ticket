# Comprobaciones de operaciones y adjuntos en QA

Ejecutar desde el worktree `daybook-ticket-operations`, en Node 24 y exclusivamente con `.env.test.local`. Coordinar **una sola suite que escriba en QA a la vez**, incluyendo suites HTTP y migraciones. Los comandos no arrancan el servidor ni contratan servicios. No cargar archivos de entorno productivos ni copiar sus valores a QA.

## Operaciones

```sh
npm run db:migrate:operations:qa
npm run test:operations:qa
DAYBOOK_SITE_URL=http://127.0.0.1:5175 npm run test:operations:http
```

La migración ensaya `0004_service_operations` mediante la conexión directa derivada del hostname QA permitido y verifica que las columnas preexistentes conserven sus huellas. Es independiente de las pruebas: no se ejecuta implícitamente al lanzar una suite.

`test:operations:qa` ejecuta en serie políticas/SLA, asignación automática y métricas. Usa datos ficticios delimitados por ejecución y limpia o revierte sus escrituras; no necesita un servidor ni Blob real. El comando HTTP encadena el recorrido de tickets y la compatibilidad del editor SLA anterior. Esta última cambia temporalmente el acuerdo general ficticio y lo restaura exactamente bajo bloqueo y comparación; verifica que los tickets y avisos no cambien. No ejecutar ninguna otra escritura QA a la vez. La suite HTTP requiere el servidor QA separado en `127.0.0.1:5175`, sesiones ficticias propias y la migración ya aplicada. El script rechaza otros orígenes; sobrescribir la variable en el comando no cambia el destino de la base.

Antes de arrancar el servidor, el proceso debe usar el mismo origen local y el entorno QA seguro:

```sh
DAYBOOK_SITE_URL=http://127.0.0.1:5175 node scripts/start-qa.mjs
```

Las comprobaciones exigen `DAYBOOK_QA_ALLOW_TEST_DATABASE=1`, la base `daybook_ticket` en el hostname QA fijo `ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech` y, donde está comprobado por el script, `DAYBOOK_QA_DATABASE_HOST` con ese mismo hostname. El propietario HTTP debe usar `DAYBOOK_QA_OWNER_EMAIL` de `example.test` y una contraseña exclusivamente QA. Nunca imprimir la conexión, contraseñas, sesiones o cookies.

Mantener ausentes/vacíos `RESEND_API_KEY`, `DAYBOOK_EMAIL_FROM` y `VAPID_PRIVATE_KEY` durante estas pruebas. El lanzador normal elimina la clave VAPID privada; no usar `--push-api-fixtures` para este recorrido. Los avisos persistentes/colas se pueden comprobar en QA sin entregar correos o push externos.

## Qué comprueba cada prueba de adjuntos

| Suite | Almacenamiento | Alcance |
|---|---|---|
| `scripts/check-attachments.test.ts` | Bytes y estructuras locales | Formatos, límites, expansión de Office, configuración de entornos; sin escrituras remotas. |
| `scripts/check-attachments-db.mjs` | `Map` en memoria inyectado; `fetch` bloqueado | Reservas concurrentes, cuotas, transacciones/rollback, privacidad, revocación, caducidad y limpieza reintentable; escribe únicamente fixtures ficticios en QA. |
| `scripts/check-attachments-http.mjs` | **Vercel Blob privado QA real**, con el SDK cliente real | Dos TXT ficticios pequeños, reserva/token/carga/comprobación/enlace/descarga, aislamiento, nota interna, idempotencia y retirada de acceso. Consume operaciones y unos pocos bytes reales del almacén QA. |

La suite HTTP de adjuntos heredada necesita un fixture local retenido `work/team-release-qa.json`, creado por `scripts/check-team-release.mjs --keep`. Ese archivo contiene credenciales/cookies ficticias: mantenerlo ignorado, con permisos `600`, y no incluirlo en PR, informes o salidas de terminal. No sirve un fixture de otro puerto, servidor, rama o sesión caducada.

Para Blob real se necesitan `DAYBOOK_BLOB_ENV=qa` y el secreto **QA** `DAYBOOK_BLOB_QA_READ_WRITE_TOKEN` en el servidor y en el proceso de la prueba. Deben estar ausentes `DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN`, `VERCEL_BLOB_API_URL` y `NEXT_PUBLIC_VERCEL_BLOB_API_URL`; `VERCEL_ENV` no puede ser `production`. No hay fallback al token genérico `BLOB_READ_WRITE_TOKEN`. Comprobar cuota disponible antes de ejecutar el recorrido real, sin crear almacenes ni aumentar planes.

## Revisión de los scripts heredados antes de volver a ejecutarlos

Esta revisión no ejecutó las suites, leyó secretos ni consultó proveedores. El test de BD simulado ya admite exclusivamente los orígenes locales `5173` y `5175` y limpia los resultados SLA de su propietario ficticio antes de los tickets. No se modifica el test HTTP retenido: esta entrega no cambia el mecanismo de carga y su regresión puede ejecutarse con almacenamiento inyectado. No se necesita activar Blob real para estas comprobaciones.

Se registran requisitos que deben resolverse antes de una futura ejecución HTTP:

- `check-attachments-http.mjs` aún exige el origen `5173`. Debe aceptar el servidor QA aislado `5175` y comprobar que el origen del fixture coincide exactamente con el entorno local autorizado antes de usar sus cookies o iniciar una carga.
- El productor `check-team-release.mjs` también exige `5173`; necesita el mismo tratamiento para crear un fixture válido en `5175`. No reutilizar un fixture de otro proceso para saltar esa comprobación.
- La suite HTTP debe reforzar las comprobaciones de `DAYBOOK_QA_DATABASE_HOST`, base `daybook_ticket`, ausencia de correo/push reales y entorno no productivo, además de verificar cuentas `example.test` y sesiones válidas antes de subir. Es recomendable exigir un permiso explícito de ejecución, como `DAYBOOK_QA_ALLOW_REAL_BLOB=1`, para distinguirla de la suite simulada; **ese flag aún no está implementado**.
- El script HTTP actual conserva el ticket y los dos archivos enviados; no dispone de limpieza automática. Antes de ejecutarlo, acordar y registrar la retirada de esos objetos y fixtures QA al finalizar. Borrar únicamente los paths e identificadores creados por esa ejecución, nunca listas completas del almacén.
- La suite de BD no resuelve tickets ni llama al registro de SLA: normalmente no crea `ticketSlaOutcomes`. La limpieza defensiva ya elimina primero cualquier resultado de SLA del `ownerId` ficticio antes de borrar tickets; nunca toca otros propietarios.
- La limpieza del productor HTTP debe incluir asimismo resultados SLA y referencias nuevas del esquema `0004` si se utiliza para regresiones ampliadas. No borrar resultados ni usuarios compartidos de QA por nombre, fechas o coincidencias parciales.

Estos puntos son pendientes de adaptación, no pruebas aprobadas ni motivos para retirar las protecciones de destino. La suite de operaciones y los comandos nuevos no activan Blob real automáticamente.
