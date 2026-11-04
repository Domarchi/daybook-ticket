# Daybook Ticket: plan aceptado y estado

Inicio: 3 de noviembre de 2026. Actualización: 4 de noviembre de 2026, America/Santiago. Rama: `codex/daybook-ticket-improvements`, creada desde `5fc1d9828e1ff78b12aadec379502fb39f6a067f`.

## Alcance aceptado

La prioridad es el trabajo del equipo: empresas con contactos, clientes que ven sus propios tickets, un encargado que ve y comenta los de su empresa, bandeja común con «Tomar ticket» y accesos administrados por el equipo. Incluye respuestas guardadas, filtros persistentes, historial operativo, adjuntos privados e idempotencia de los envíos. Conserva la identidad de Daybook Ticket y los responsables configurados para los avisos.

El trabajo se limita a este repositorio/proyecto. Los demás Daybook y la web, repositorios y DNS de Consorcio C17 quedan fuera. La implementación y pruebas usan la rama y base QA con datos ficticios, sin correos ni push reales. El almacenamiento real se valida solo en el almacén privado QA autorizado. El almacén privado de producción y su configuración están preparados; la aplicación nueva se publicó solo en Preview QA, sin publicar ni migrar producción.

Las comprobaciones locales, QA, CI y la prueba remota del [Preview](https://daybook-ticket-qa-domarchi.vercel.app) pasaron. El candidato está listo para la siguiente decisión de publicación; producción conserva su versión anterior. [RELEASE_TEAM.md](RELEASE_TEAM.md) recoge la evidencia y el procedimiento de publicación/rollback.

## Paquetes y aceptación

| Paquete | Resultado esperado | Estado actual |
| --- | --- | --- |
| M1. Borradores y acciones | Separar cuenta/ticket/audiencia; conservar modo de nota; limpiar solo lo enviado; selección masiva limitada a visibles. | Desarrollado; pruebas unitarias integradas. Recorrido visual desktop y móvil comprobado; corregida la navegación estrecha del portal. |
| M2. Correo después de guardar | Drenaje acotado después de responder, sin duplicados ni consumo masivo de intentos ante `429`; preservar evento exacto y revalidación. | Desarrollado; suites QA de drenaje/evento dirigido PASS con proveedor simulado. No añade scheduler. |
| M3. Comprobaciones automáticas | Comando para lint, unitarias, tipos y build; CI sin secretos, base real ni envíos. | Scripts/workflow desarrollados. `npm run check` completo PASS con 52 pruebas; build repetido tras el último CSS móvil PASS. Huellas de archivos runtime/QA del snapshot coinciden con el worktree. CI remoto del código `a5cf3b9` PASS: [run 41829072109](https://github.com/Domarchi/daybook-ticket/actions/runs/41829072109). |
| E1. Empresas y acceso | Contacto de una empresa; encargado ve/comenta sus tickets; transferencia retira acceso sin mover historia; ACL consistente. | Desarrollado; 16 grupos QA PASS. Migración aplicada solo a QA. |
| E2. Reparto y colaboración | Tomar/reasignar con versión; historial; respuestas guardadas; filtros; crear/responder con `operationId`. | Desarrollado; 11 grupos HTTP PASS. Replay de nota tras bajar rol: tres comprobaciones PASS. Cinco actores creando y respondiendo simultáneamente: PASS en 13,6 s. Búsqueda visual de respuestas guardadas e inserción manual PASS; todos los filtros conservan su selección tras recargar. |
| E3. Adjuntos privados | Carga/validación/vinculación transaccional; descarga con ACL; notas privadas; límites y limpieza diferida. | Desarrollado; cinco grupos BD simulados y diez comprobaciones HTTP usando el SDK cliente real contra Blob privado QA PASS. Carga desde el selector real del cliente y envío de respuesta con TXT comprobados en la interfaz. |

## Evidencia registrada

Los identificadores de CI y Preview registran la validación del código `a5cf3b9`. El cierre posterior añade solo documentación; el PR conserva el SHA final y el deployment vigente.

Resultados confirmados del código candidato y de su Preview:

| Comprobación | Resultado registrado | Entorno |
| --- | --- | --- |
| `npm run test:unit` | PASS, 52 casos | Sin BD ni entregas externas |
| Lint global | PASS, cero errores/cero advertencias | Local |
| `tsc --noEmit` | PASS | Local |
| `scripts/check-company-access.mjs` | PASS, 16 grupos; fixtures limpiados | BD QA; correo/push simulados |
| `scripts/check-team-release.mjs` | PASS, 11 grupos | HTTP local/BD QA; sin correo/push reales |
| Replay de nota tras bajar a cliente | PASS, tres comprobaciones | HTTP QA; sin fuga de nota ni escritura nueva |
| `scripts/check-attachments-db.mjs` | PASS, cinco grupos | BD QA; almacenamiento inyectado |
| `scripts/check-attachments-http.mjs` | PASS, diez comprobaciones con `@vercel/blob/client`; ticket QA #21 y dos TXT ficticios | SDK cliente y Blob privado QA reales |
| `scripts/check-concurrent-submissions.mjs` | PASS, cinco actores crean y responden simultáneamente en 13,6 s | HTTP local/BD QA; sin entregas externas |
| Búsqueda de respuestas guardadas | PASS visual: búsqueda `CONFIRMACION` sin tilde, sin coincidencias deshabilita inserción y una coincidencia se inserta en borrador sin enviar | Navegador QA; envío manual posterior comprobado |
| Filtros persistidos | PASS: los cinco filtros conservan su selección tras recargar, comprobada en DOM | Navegador QA |
| Selector real de archivos | PASS: cliente carga `qa-ui-attachment.txt` y envía respuesta con el archivo en ticket #21 | Navegador QA y Blob privado QA |
| `scripts/check-access.mjs` | PASS, regresión completa | QA |
| `scripts/check-notification-responsibles.mjs` | PASS, 17 comprobaciones y cero entregas externas | QA |
| `scripts/check-mail-drain.mjs` | PASS, 16 grupos | BD QA; Resend simulado |
| `scripts/check-targeted-mail.mjs` | PASS, siete grupos | BD QA; Resend simulado |
| Migración `0002_companies_team_workflow` | Aplicada | Solo QA |
| Interfaz desktop/móvil | PASS: cliente carga archivo y comenta, equipo responde y encargado con rol cliente comenta desde móvil; ticket #21 sin nota interna para clientes. Navegación estrecha corregida y comprobada a viewport 312 CSS px | Navegador QA; evidencia `/tmp/daybook-ticket-release-review.png` |
| `npm run check` anterior | PASS en `bfd2d72`: lint, 51 unitarias, tipos y build | Local, configuración ficticia |
| `npm run check` con locks, búsqueda y filtros | PASS: lint, 52 unitarias, tipos y build; snapshot `/tmp/daybook-ticket-final-ptns9ai6`, proceso 96926, exit 0 | Local, configuración ficticia |
| Build tras el último CSS móvil | PASS, proceso 4887, exit 0, mismo snapshot. Comparación de huellas runtime/QA contra worktree sin diferencias | Local, configuración ficticia |
| CI remoto del candidato `a5cf3b9` | PASS, runs [41829072109](https://github.com/Domarchi/daybook-ticket/actions/runs/41829072109) y [41829071014](https://github.com/Domarchi/daybook-ticket/actions/runs/41829071014): `npm ci`, lint, unitarias, tipos y build | GitHub Actions |
| Código candidato | `a5cf3b9b2c333c8cdf7ac095a1a4090f554386e2` integrado y enviado a la rama; [PR #1](https://github.com/Domarchi/daybook-ticket/pull/1) | GitHub |
| Preview de la rama | READY, deployment `dpl_FfdbyWGDXG49XLdFdeYq4zbt6wGN` del código candidato; build Vercel con `npm run check` PASS | [Preview revisable](https://daybook-ticket-qa-domarchi.vercel.app) |
| Recorrido remoto desktop/móvil | PASS: cliente crea ticket #41 con TXT desde selector real y descarga autenticada; equipo toma ticket y consulta actividad, inserta respuesta guardada y responde manualmente; encargado con rol cliente ve archivo/respuesta y comenta desde móvil de 390 px, sin ver la nota interna | Chrome autenticado en Vercel; QA ficticia |
| Estado del PR | Todos los checks SUCCESS y mergeState CLEAN | [PR #1](https://github.com/Domarchi/daybook-ticket/pull/1) |

Las suites de BD se coordinan de una en una. Las cuatro regresiones actuales de acceso, responsables, drenaje y evento dirigido terminaron PASS, con cero entregas externas; sus fixtures quedaron limpios. Los fixtures ficticios `team-release-qa` y los archivos Blob QA se retienen para la revisión del usuario, incluido el ticket remoto #41; la prueba remota ya terminó. Retirarlos cuando finalice esa revisión. Credenciales y cookies temporales permanecen en archivos locales ignorados, no en Git ni en este documento.

El código candidato `a5cf3b9b2c333c8cdf7ac095a1a4090f554386e2` está integrado y enviado en la rama, con [PR #1](https://github.com/Domarchi/daybook-ticket/pull/1) y CI remoto PASS. El run histórico `41766980174` no arrancó por facturación/límite de gasto; ese resultado no describe el run actual. La prueba de concurrencia tuvo un primer intento interrumpido por DNS transitorio (`EAI_AGAIN`); la ejecución posterior PASS no mostró bloqueo de filas ni agotamiento del pool.

El rechazo automático inicial de secretos Preview quedó resuelto mediante autorización específica posterior del usuario. Los tres secretos QA (`DATABASE_URL`, `BETTER_AUTH_SECRET` y `DAYBOOK_BLOB_QA_READ_WRITE_TOKEN`) se guardaron como Sensitive, limitados a Preview y a esta rama; no se incluyen valores en Git. El Preview quedó READY y el recorrido remoto completo se comprobó en Chrome, ya autenticado en Vercel. Se conservaron las protecciones existentes: no se crearon share links ni se modificó Deployment Protection. Un intento de enlace temporal fue rechazado por revisión automática y se descartó; la prueba se completó con el acceso autenticado existente. No se cambió facturación ni se eludió la revisión por otro canal.

## Límites y trabajo posterior

- La cola mejora su procesamiento inicial, pero no garantiza reintentos futuros sin actividad. Scheduler o cola externa requieren una decisión separada.
- Aceptación del proveedor no confirma entrega/lectura. Web Push con pestañas cerradas sigue pendiente de una prueba observada por el usuario.
- La prueba real para Joaquín y Mario queda separada de QA y requiere que Mario haya activado su cuenta. No crear ni enviar esa prueba automáticamente desde este plan.
- El dominio `daybook.cl` y correo entrante quedan fuera de esta entrega.
- Empresas no implica múltiples tenants ni auditoría completa. Véase [ARCHITECTURE.md](ARCHITECTURE.md).

## Cierre

La validación local, QA, CI y Preview del código candidato quedó completada y en verde. El recorrido remoto cliente con archivo → respuesta del equipo → comentario móvil del encargado pasó, con nota interna oculta y archivo descargado mediante autenticación. La publicación productiva es una fase posterior que requiere su autorización; no forma parte del gate de entrega lista para desplegar. Producción fue revalidada sin cambios: deployment `dpl_5PZkPffLHhyLvQUWAkgkE32TUR52`, código `5fc1d9828e1ff78b12aadec379502fb39f6a067f`, migración `0002` aplicada solo en QA. No fusionar, migrar producción, rotar secretos ni publicar automáticamente a partir de este documento. El runbook conserva los pasos y límites del rollback, incluida la incompatibilidad de la ACL anterior después de trasladar clientes entre empresas.
