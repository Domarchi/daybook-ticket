# Validación de la entrega 1–6

Base publicada: `dfa3839d9a066631e8afd0ee5b5648369fd03fac`. Implementación revisada: `596dab7f67ca0422a45719602c0fda6ce6c3fb86`. La corrección posterior de contraste modifica únicamente la superficie de una tarjeta del portal; no cambia lógica ni migraciones.

PR: https://github.com/Domarchi/daybook-ticket/pull/6

Preview protegida: https://daybook-ticket-reliability-qa-domarchi.vercel.app/login

## Resultados

| Comprobación | Resultado |
|---|---|
| Node 24, lint, tipos y compilación | PASS |
| Pruebas unitarias sin red | 240/240 PASS |
| GitHub CI | PASS, ejecución 42066172105 |
| Recuperación cifrada en PostgreSQL de CI | PASS, ejecución 42066171617 |
| Migración 0006 en QA | PASS: 33 tablas/462 filas previas conservadas, mismas huellas de columnas originales |
| Auditoría real del operador 0006 en QA ya migrado | PASS: 39 tablas, sin COMMIT ni DDL |
| Marcas de prueba y métricas | PASS: exclusión/inclusión, carga, respuestas, SLA, satisfacción y reversión sin borrar historial |
| Presencia y progreso | PASS: aislamiento, roles, caducidad, pestañas, revocación y nombres públicos |
| Correo entrante duradero | 10 escenarios PASS: concurrencia, adjuntos, reintentos, permisos revocados, sexto intento interrumpido, COMMIT/carga ambiguos y limpieza |
| Respaldo automático con Blob privado real de QA | PASS: archivo fuente y archivo cifrado, carga, lectura, hashes, descifrado, descarga, límites, retención y limpieza de rutas propias |
| Regresión de recuperación completa | PASS: 36 tablas portables, dos archivos, claves de cuenta, credenciales temporales invalidadas, destino vacío y COMMIT incierto |
| Regresiones anteriores | PASS: recepción anterior, escalamiento/encuestas, búsqueda/paginación, métricas, carreras de permisos y vistas previas privadas |
| Recorrido HTTP integrado | PASS: 95 solicitudes, cuatro cuentas ficticias, dos tickets y cinco grupos de pruebas; configuración compartida intacta y limpieza completa |

Los scripts que escriben QA se ejecutaron en serie. No se usaron claves de envío/recepción reales ni push. La prueba real con Joaquín y Mario no se ejecutó.

## Presentación

Revisión del administrador y cliente en Preview protegido, conversaciones, marca de prueba, salud de recepción, programación de respaldos y contraste oscuro. El cliente muestra dos mensajes públicos de un caso que contiene también una nota interna; no recibe presencia ni controles administrativos. Revisión móvil a 390 × 844 sobre el mismo build compilado y la base QA. Capturas locales en `outputs/qa-admin-ticket.png`, `outputs/qa-settings.png`, `outputs/qa-backups.png`, `outputs/qa-client-desktop.png` y `outputs/qa-client-mobile.png`.

Se corrigió la lectura de Blob privado cuando GET carece de longitud: se consulta metadata autenticada y se conservan las validaciones estrictas de tamaño, flujo y hash. Se corrigió una tarjeta blanca que retenía texto claro en modo oscuro. Las pruebas no rebajan límites ni cambian permisos para pasar.

## Cuotas y separación

Cuota Hobby revisada en Vercel el 5 de noviembre: almacenamiento Blob 5,35 MB/1 GB; transferencia 12,68 MB/10 GB; operaciones simples 51/10.000 y avanzadas 128/2.000. QA tiene un presupuesto lógico independiente de 64 MiB y 512 MiB de transferencia, clave privada propia y programación inicialmente desactivada por propietario. La cuota deberá revisarse de nuevo antes de activar producción; no se cambió ni contrató ningún plan.

La rama usa únicamente servicios de QA. Se conservó la protección de Vercel. Se crearon deliberadamente dos cuentas y un caso de demostración ficticios para revisar el portal; sus accesos están en el archivo local ignorado `work/QA_REVIEW_ACCESS.md`. El cliente y su caso están marcados como prueba. El ticket ficticio anterior #41 también se marcó desde la interfaz para comprobar el control.

## Publicación pendiente

No se fusionó el PR ni se desplegó en producción. No se leyeron/copiaron claves productivas, ni se modificaron usuarios, tickets, archivos, servicios de Consorcio C17 o DNS productivos. El despliegue productivo permanece en `dfa3839`. La futura publicación usa el operador y el procedimiento de [RELIABILITY_RELEASE.md](RELIABILITY_RELEASE.md), conserva datos y activa deliberadamente los nuevos workers y respaldos con claves/cuotas productivas verificadas.
