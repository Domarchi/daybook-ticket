# Daybook Ticket: plan aceptado y estado

Inicio: 3 de noviembre de 2026. Actualización: 4 de noviembre de 2026, America/Santiago. Rama: `codex/daybook-ticket-improvements`, creada desde `5fc1d9828e1ff78b12aadec379502fb39f6a067f`.

## Alcance aceptado

La prioridad es el trabajo del equipo: empresas con contactos, clientes que ven sus propios tickets, un encargado que ve y comenta los de su empresa, bandeja común con «Tomar ticket» y accesos administrados por el equipo. Incluye respuestas guardadas, filtros persistentes, historial operativo, adjuntos privados e idempotencia de los envíos. Conserva la identidad de Daybook Ticket y los responsables configurados para los avisos.

El trabajo se limita a este repositorio/proyecto. Los demás Daybook y la web, repositorios y DNS de Consorcio C17 quedan fuera. La implementación y pruebas usan la rama y base QA con datos ficticios, sin correos ni push reales. El almacenamiento real se valida solo en el almacén privado QA autorizado. El almacén privado de producción y su configuración están preparados; esto no significa que se haya desplegado la aplicación o migrado la base productiva.

Completar pruebas locales no significa que CI o producción estén aprobados. [RELEASE_TEAM.md](RELEASE_TEAM.md) recoge condiciones pendientes y procedimiento de publicación/rollback.

## Paquetes y aceptación

| Paquete | Resultado esperado | Estado actual |
| --- | --- | --- |
| M1. Borradores y acciones | Separar cuenta/ticket/audiencia; conservar modo de nota; limpiar solo lo enviado; selección masiva limitada a visibles. | Desarrollado; pruebas unitarias integradas. Recorrido visual desktop y móvil comprobado; corregida la navegación estrecha del portal. |
| M2. Correo después de guardar | Drenaje acotado después de responder, sin duplicados ni consumo masivo de intentos ante `429`; preservar evento exacto y revalidación. | Desarrollado; suites QA de drenaje/evento dirigido PASS con proveedor simulado. No añade scheduler. |
| M3. Comprobaciones automáticas | Comando para lint, unitarias, tipos y build; CI sin secretos, base real ni envíos. | Scripts/workflow desarrollados. `npm run check` completo PASS con 52 pruebas; build repetido tras el último CSS móvil PASS. Huellas de archivos runtime/QA del snapshot coinciden con el worktree. CI no inició por un bloqueo de facturación/límite de gasto de GitHub. |
| E1. Empresas y acceso | Contacto de una empresa; encargado ve/comenta sus tickets; transferencia retira acceso sin mover historia; ACL consistente. | Desarrollado; 16 grupos QA PASS. Migración aplicada solo a QA. |
| E2. Reparto y colaboración | Tomar/reasignar con versión; historial; respuestas guardadas; filtros; crear/responder con `operationId`. | Desarrollado; 11 grupos HTTP PASS. Replay de nota tras bajar rol: tres comprobaciones PASS. Cinco actores creando y respondiendo simultáneamente: PASS en 13,6 s. Búsqueda visual de respuestas guardadas e inserción manual PASS; todos los filtros conservan su selección tras recargar. |
| E3. Adjuntos privados | Carga/validación/vinculación transaccional; descarga con ACL; notas privadas; límites y limpieza diferida. | Desarrollado; cinco grupos BD simulados y diez comprobaciones HTTP usando el SDK cliente real contra Blob privado QA PASS. Carga desde el selector real del cliente y envío de respuesta con TXT comprobados en la interfaz. |

## Evidencia registrada

Resultados confirmados durante esta entrega; no sustituyen la revisión del candidato final:

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
| CI remoto, run `41766980174` | `startup_failure`, sin jobs: pagos recientes fallidos o límite de gasto de la cuenta | GitHub; no es PASS ni fallo de tests |
| Preview de la rama | Bloqueado por rechazo automático de secretos Preview sin autorización específica | No desplegado/verificado |

Las suites de BD se coordinan de una en una. Las cuatro regresiones actuales de acceso, responsables, drenaje y evento dirigido terminaron PASS, con cero entregas externas; sus fixtures quedaron limpios. Los fixtures ficticios `team-release-qa` y los archivos Blob QA se retienen únicamente para la revisión Preview pendiente; retirarlos al cerrar esa revisión. Credenciales y cookies temporales permanecen en archivos locales ignorados, no en Git ni en este documento.

La rama fue enviada hasta `4c26726`; los cambios posteriores ya tienen validación local y QA registrada; falta integrarlos en el commit final y completar los gates externos. La prueba de concurrencia tuvo un primer intento interrumpido por DNS transitorio (`EAI_AGAIN`); la ejecución posterior PASS no mostró bloqueo de filas ni agotamiento del pool. El bloqueo remoto no impide completar comprobaciones locales y preparar la revisión. No cambiar Billing & plans ni eludir el rechazo de Preview por otro canal. La autorización concreta para guardar secretos privados en Preview se solicita después de terminar el trabajo independiente; la autorización productiva previa no se extiende automáticamente a ese entorno.

## Límites y trabajo posterior

- La cola mejora su procesamiento inicial, pero no garantiza reintentos futuros sin actividad. Scheduler o cola externa requieren una decisión separada.
- Aceptación del proveedor no confirma entrega/lectura. Web Push con pestañas cerradas sigue pendiente de una prueba observada por el usuario.
- La prueba real para Joaquín y Mario queda separada de QA y requiere que Mario haya activado su cuenta. No crear ni enviar esa prueba automáticamente desde este plan.
- El dominio `daybook.cl` y correo entrante quedan fuera de esta entrega.
- Empresas no implica múltiples tenants ni auditoría completa. Véase [ARCHITECTURE.md](ARCHITECTURE.md).

## Cierre

La validación local y QA del candidato quedó registrada. Falta registrar el commit final y resolver CI remoto y la autorización de Preview para completar la entrega revisable; no se declara verde global ni publicación productiva. No fusionar, migrar producción, rotar secretos ni publicar automáticamente a partir de este documento. El coordinador confirma el candidato final; el runbook mantiene los pasos y límites del rollback, incluida la incompatibilidad de la ACL anterior después de trasladar clientes entre empresas.
