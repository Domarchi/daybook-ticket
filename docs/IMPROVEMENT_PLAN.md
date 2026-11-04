# Daybook Ticket: plan de mejoras

Fecha de inicio: 3 de noviembre de 2026. Zona horaria: America/Santiago.

## Objetivo y alcance

Preparar una versión revisable que reduzca errores del equipo y haga más fiable el envío de avisos. El trabajo se limita a Daybook Ticket y a la rama `codex/daybook-ticket-improvements`, creada desde producción `5fc1d9828e1ff78b12aadec379502fb39f6a067f`.

La entrega inicial se desarrolla y valida con datos ficticios en QA. La web, repositorios, DNS y claves de Consorcio C17 y los demás Daybook quedan fuera de este trabajo. Las pruebas de esta entrega no envían correo ni push a personas reales. No se contratan servicios ni se cambian planes. Publicación en producción, cambios de credenciales y migraciones remotas quedan fuera de la ejecución desatendida inicial.

## Primera entrega: trabajo iniciado

| Paquete | Problema observado | Resultado y aceptación | Estado |
| --- | --- | --- | --- |
| M1. Borradores y acciones del equipo | Un borrador de nota interna conserva texto pero al reabrir fuerza el modo respuesta. La selección masiva conserva tickets que los filtros pueden ocultar. El cliente pierde borradores al reabrir una conversación. | Separar notas internas y respuestas por cuenta y ticket; conservar el modo; no trasladar texto privado a una respuesta pública; limpiar solo el borrador enviado. Las acciones masivas afectan únicamente a la selección visible. Pruebas de aislamiento de borradores, cambio de modo, reapertura y filtrado. | En implementación |
| M2. Correo después de guardar el ticket | El procesamiento automático toma solo dos filas y espera al proveedor durante la petición. Una cola mayor puede requerir otra actividad del usuario. | Drenaje de lotes limitado por cantidad y tiempo, ejecutado después de responder. Mantener exclusión por evento, idempotencia, bloqueo temporal y permisos actuales. Probar 21 avisos ficticios, concurrencia, 429, timeout, destinatario revocado y envíos ya aceptados. | En implementación |
| M3. Comprobaciones automáticas | Las pruebas existen pero se ejecutan por separado; el análisis de código tiene errores y no hay integración continua. | Comando de pruebas sin base de datos ni red para alertas/push y nuevos helpers; análisis de código, TypeScript y compilación en CI con Node 24 y valores ficticios. Corregir los errores existentes sin desactivar las reglas globalmente. | En implementación |

Se consideran terminados cuando los cambios están revisados, las comprobaciones correspondientes pasan y los resultados están registrados. Un hallazgo sin reproducir o una comprobación no ejecutada no cuenta como validación.

## Siguiente entrega: propuesta para priorizar

1. **Estado de avisos comprensible.** Mostrar errores, próxima tentativa y pendientes atascados. Conservar los avisos sin leer por cuenta. Distinguir aceptación del proveedor, entrega y lectura.
2. **Recuperación sin visitas al portal.** Diseñar procesamiento programado autenticado y recuperación de fallos temporales de Web Push. Preparar código y pruebas sin activar servicios ni secretos remotos automáticamente.
3. **Acceso y uso móvil.** Mostrar vencimiento de invitaciones y explicar que renovar invalida el enlace anterior; mejorar foco, Escape y navegación del menú móvil.
4. **Trabajo diario del equipo.** Evaluar respuestas guardadas, filtros persistentes, historial de asignación y métricas de primera respuesta/resolución, según el uso real de Joaquín y Mario.
5. **Evolución de producto.** Adjuntos privados y correo entrante requieren un diseño separado de almacenamiento, permisos, límites y costes. El dominio daybook.cl se conectará cuando el propietario lo adquiera.

## Límites que no deben ocultarse

- El drenaje posterior a la respuesta mejora el procesamiento inicial, pero por sí solo no garantiza reintentos permanentes cuando no hay actividad.
- Vercel Hobby permite cron diario y no reintenta automáticamente las ejecuciones fallidas. No debe presentarse como un programador puntual de pocos minutos.
- Resend conserva la idempotencia durante 24 horas. Un envío de resultado incierto fuera de ese plazo necesita revisión antes de reintentarse.
- La prueba real de nuevo ticket para Joaquín y Mario queda para el **4 de noviembre**, después de que Mario active su cuenta. No crear tickets ni enviar esa prueba durante el trabajo nocturno.
- La prueba de Web Push con todas las pestañas cerradas aún necesita confirmación del usuario. La notificación local y el correo sí se comprobaron; no equivalen a validar ese caso.

## Continuación y entrega

Continuar en este mismo chat cada 30 minutos, usando esta rama y respetando el trabajo de los agentes que ya estén activos. Revisar sus resultados antes de asignar trabajo duplicado. Ejecutar las pruebas de base de datos de una en una sobre QA; nunca apuntarlas a producción. No instalar dependencias sobre un `node_modules` compartido mediante enlace simbólico.

La primera entrega termina al completar M1–M3. Preparar commits y una revisión en la rama de mejoras; no fusionar ni publicar automáticamente en producción. Guardar aquí los resultados verificables. La continuación nocturna finalizará a las **09:00 del 4 de noviembre de 2026 (America/Santiago)** o antes si la primera entrega queda terminada. Si falta una decisión externa, registrar el bloqueo y continuar las partes independientes.

## Registro de validación

- Base inicial: producción `5fc1d98`, correo configurado y comprobado con una invitación a Mario y un aviso del ticket #2 al propietario.
- Auditoría inicial: errores de lint confirmados; defectos de borradores/selección identificados mediante lectura de código, pendientes de prueba de regresión.
- Próximo registro: resultados de M1–M3, riesgos pendientes y pasos para la revisión.

## Fuentes de las restricciones de infraestructura

- [Límites de Vercel Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Gestión de Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Idempotencia de Resend](https://resend.com/docs/dashboard/emails/idempotency-keys)
