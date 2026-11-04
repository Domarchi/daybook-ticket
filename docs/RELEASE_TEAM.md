# Publicación de empresas y trabajo del equipo

Runbook de Daybook Ticket, actualizado el 4 de noviembre de 2026. Rama candidata: `codex/daybook-ticket-improvements`. Base: `5fc1d9828e1ff78b12aadec379502fb39f6a067f`. No afirma que la entrega esté publicada ni autoriza por sí mismo acciones productivas.

## Estado antes de publicar

| Condición | Evidencia o pendiente |
| --- | --- |
| Pruebas puras | 51 casos PASS. |
| Lint global y TypeScript | Lint PASS con cero errores/advertencias; `tsc --noEmit` PASS. |
| ACL de empresas | 16 grupos QA PASS; limpieza de fixtures comprobada. |
| Flujos HTTP del equipo | 11 grupos PASS: aislamiento, comentarios, notas, roles, claim concurrente, versión antigua, respuestas guardadas, idempotencia, avisos, historial y retirada de acceso. |
| Replay de nota tras bajar rol a cliente | Tres comprobaciones HTTP PASS; denegación sin fuga ni nueva escritura. |
| Adjuntos con almacenamiento simulado | Cinco grupos de BD QA PASS. |
| Blob privado real mediante HTTP | Diez comprobaciones PASS; ticket QA #20, dos archivos TXT ficticios. |
| Drenaje de correo y evento exacto | 16 y siete grupos PASS, respectivamente, con Resend simulado. |
| Migración `0002` | Aplicada solo a QA. Producción pendiente. |
| Concurrencia revisada | Corregidos los lookups bloqueantes de asignado/solicitante que podían formar ciclos con el actor y el ticket. |
| Revisión desktop/móvil | En proceso; resultado pendiente. |
| Build final local | En proceso; resultado pendiente. Registrar comando, commit y resultado. |
| CI remoto | Run `41766980174`: `startup_failure`, sin jobs. GitHub no inició la ejecución por pagos recientes fallidos o límite de gasto de la cuenta. No es una ejecución verde ni un fallo de tests. |
| Preview aislado de la rama | Bloqueado: la revisión automática rechazó guardar secretos privados en Preview por falta de autorización específica para ese entorno. Hostname previsto `daybook-ticket-qa-domarchi.vercel.app`; deployment/acceso no confirmados. |
| Configuración Blob | Almacenes privados separados QA/producción preparados; token productivo privado/sensible y selector `production` configurados. La app nueva aún no está desplegada. |
| Publicación | Rama enviada con `bfd2d72`; existen cambios posteriores pendientes de integrar. Commit final, decisión de publicar, migración productiva y deployment pendientes. |

No promover con fallos de aislamiento, notas privadas, idempotencia o integridad de adjuntos. Código y workflow existentes no convierten comprobaciones pendientes en PASS.

Los dos bloqueos externos se mantienen separados del resultado local. La anotación de GitHub indica: “The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check Billing & plans”. No cambiar facturación, límites o planes desde este trabajo. Continuar las comprobaciones locales y preparar la revisión de código; registrar sus resultados sin atribuirlos a CI remoto.

La autorización anterior de secretos en producción no cubre por sí sola Preview. No intentar otro canal para eludir el rechazo automático. Tras completar el trabajo independiente, solicitar la autorización concreta para los secretos privados del Preview de esta rama/proyecto; hasta entonces, conservar la revisión local y no afirmar que el Preview está disponible.

## Aislamiento y secretos

Toda operación se limita al proyecto Vercel `daybook-ticket`. No modificar otros proyectos/repositorios/DNS. QA usa la rama Neon `br-wandering-breeze-bb9ow8vn` del proyecto `purple-silence-58888058`; el hostname permitido por las suites es `ep-falling-water-bbfa4ijl-pooler.c-15.us-east-1.aws.neon.tech`. Validar el destino antes de cualquier operación; estos identificadores no sustituyen esa comprobación.

El servidor QA usa `http://127.0.0.1:5173` y `.env.test.local`, con `DAYBOOK_QA_ALLOW_TEST_DATABASE=1`. `scripts/start-qa.mjs` comprueba hostname/origen, rechaza Resend/remitente configurados y vacía VAPID privado por defecto. Su opción explícita `--push-api-fixtures` solo admite las claves del archivo QA y exige cero dispositivos activos al arrancar; se reserva para la regresión que inyecta el sender simulado, durante una ventana exclusiva sin otra actividad. Volver al arranque normal al terminar. Las suites también comprueban su destino. No quitar guards para apuntar a otra base.

La base/URL productiva no se copia a QA. Mantener secretos de autenticación y cookies separados por entorno; no copiar sesiones productivas a fixtures ni usar `daybook-ticket.vercel.app` como origen QA. El prefijo `daybook` es común: no constituye aislamiento. Cada actor de prueba conserva sus propias cookies y solo se usa el origen QA.

`.env*`, `.vercel/` y `work/` están ignorados. `work/team-release-qa.json` puede contener contraseñas/cookies de pruebas y debe permanecer ignorado y con permisos locales restringidos. No imprimir valores de conexión, autenticación, Resend, VAPID o Blob. Revisar el diff antes de versionar; un ejemplo no debe contener secretos reales.

Desarrollo/preview solo selecciona `DAYBOOK_BLOB_ENV=qa` y `DAYBOOK_BLOB_QA_READ_WRITE_TOKEN`; únicamente `VERCEL_ENV=production` permite `DAYBOOK_BLOB_ENV=production` y `DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN`. Los almacenes son privados y distintos; no usar el token QA en producción. No hay fallback a credenciales Blob ambientales ni a endpoints de emulador.

Almacenes verificados durante la preparación: QA `store_jZdpTcfXmyijP3jw`, producción `store_oURLI2zRfMFPfo8P`. La cuota observada el 4 de noviembre fue 3,48 MB/1 GB, 113/2000 operaciones avanzadas y 9/10000 simples; es una observación de preparación, no una garantía de consumo futuro. El almacén productivo preparado no equivale a una prueba de la app productiva.

## Validación del candidato

1. Registrar el commit candidato y revisar el diff. No instalar dependencias sobre un `node_modules` compartido mediante symlink; usar instalación aislada si hace falta.
2. En Node 24, ejecutar `npm run check`: lint, unitarias, tipos y build. Para compilar usar valores ficticios como los de `.github/workflows/ci.yml`. El workflow no ejecuta migraciones, suites de BD ni despliegues. Registrar la ejecución remota aparte; PASS local no es PASS de CI.
3. Coordinar una suite de BD a la vez. Las suites directas usan `node --env-file=.env.test.local --import tsx scripts/check-company-access.mjs`, y de forma equivalente `check-mail-drain.mjs`, `check-targeted-mail.mjs` y `check-attachments-db.mjs`. Conservar guards y proveedores simulados.
4. Iniciar QA con `node scripts/start-qa.mjs`. Ejecutar `node --env-file=.env.test.local scripts/check-team-release.mjs`. Usar `--keep` solo para continuar la revisión con sus fixtures; registrar retención/limpieza. Sin `--keep`, el script elimina tickets/respuestas de prueba y revoca miembros creados: no limpia todo el historial de cuentas QA.
5. `scripts/check-attachments-http.mjs` usa los fixtures retenidos y el almacén QA autorizado. Verifica reserva/token/carga/validación/enlace/descarga, actores autorizados, empresa ajena, notas privadas, repetición y retirada de acceso. Registrar y retirar sus objetos/fixtures al cerrar; el script no los borra automáticamente.
6. Comprobar desktop/móvil: empresas/accesos, bandeja común, conflictos de asignación, respuestas guardadas, filtros, borradores separados y adjuntos. Conservar la regresión de replay de nota tras bajar el rol y registrar cualquier límite observado.

## Orden de publicación

Ejecutar solo dentro del alcance de publicación confirmado para Daybook Ticket y registrar el resultado de cada paso.

1. Identificar versión/deployment productivo previo y el candidato. Verificar el punto de restauración disponible de la base antes de cambiar el esquema; no asumir que existe una copia comprobada.
2. Revisar `0002_companies_team_workflow.sql` y el journal. Es aditiva: tablas nuevas y columnas con nulos/defaults compatibles. No backfillea empresas ni transfiere tickets. No alterar migraciones ya aplicadas.
3. Resolver `DIRECT_DATABASE_URL` productiva por el canal privado autorizado y ejecutar `npm run db:migrate` desde el candidato. El script exige esa variable, pero **no tiene guard de hostname**: comprobar destino antes de ejecutar. Registrar resultado/migraciones sin mostrar URL. Si falla, detener promoción y revisar journal/esquema; no aplicar SQL inverso improvisado.
4. Confirmar configuración productiva existente de auth/correo/push y la configuración privada Blob preparada. La ausencia o discrepancia del selector/token deshabilita cargas; los tickets de texto siguen funcionando. Si se entrega así, comunicar que adjuntos no está activo.
5. Desplegar el commit validado solo después de terminar la migración. Registrar commit, deployment y resultado observado. La app nueva consulta tablas/columnas nuevas al abrir workspace/feed; desplegar antes de migrar causaría errores.
6. Comprobar entrada, sesión y workspace por roles autorizados sin crear envíos reales por defecto. Verificar estado de correo y responsables. La prueba para Joaquín y Mario se realiza aparte dentro de su autorización y solo con ambos activos.

## Rollback

Si falla el despliegue nuevo, detener promoción o evaluar retorno al deployment identificado sin migración destructiva. Conservar las tablas/columnas de `0002`: pueden contener empresas, permisos, historial, resultados idempotentes y referencias a archivos. No borrar adjuntos para revertir código.

Antes de utilizar empresas, se puede volver al deployment anterior comprobado conservando `0002`. Después de crear asociaciones o realizar traslados, **no volver a la ACL anterior a empresas**. Su regla de cliente por solicitante puede volver a mostrar tickets de una empresa anterior que la nueva regla ya retiró tras un traslado. Conservar tanto `0002` como la política nueva de acceso; aplicar una corrección hacia delante o volver a una release compatible y comprobada. No se exige disponer de un rollback antiguo inseguro para publicar.

Después de cualquier recuperación, validar dos empresas distintas: cada contacto ve solo lo permitido, cada encargado ve su empresa, un traslado retira el acceso anterior y las notas/adjuntos privados siguen ocultos. Comprobar feed, respuesta y descarga además de la pantalla principal. Nunca ejecutar un down destructivo para recuperar la aplicación.

La versión anterior tampoco muestra los adjuntos/historial nuevos aunque los datos se conserven, y no usa la nueva tabla de idempotencia. No borrar avisos aceptados, reiniciar intentos ni vaciar `operations`: podría duplicar envíos/escrituras. Revisar correo incierto antes de reintentar; `accepted` no prueba entrega.

Restaurar la base a un punto anterior es una recuperación distinta y puede perder escrituras posteriores. Requiere una decisión explícita basada en el incidente y punto verificado. Registrar versión final, impacto y comprobaciones posteriores.

## Registro de cierre pendiente

Completar: commit candidato; resultado de build y enlace a CI; revisión UI/regresiones; fixtures/objetos QA retirados; migración productiva aplicada o pendiente; configuración efectiva de adjuntos; deployment observado; límites comunicados; versión de recuperación y compatibilidad de su ACL. No incluir secretos, enlaces de invitación ni cookies.
