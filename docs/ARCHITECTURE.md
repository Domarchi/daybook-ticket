# Arquitectura de Daybook Ticket

Implementación de la rama `codex/daybook-ticket-improvements`, actualizada el 4 de noviembre de 2026. Describe la versión en preparación; no implica que esté publicada. Las comprobaciones y condiciones de publicación están en [RELEASE_TEAM.md](RELEASE_TEAM.md).

## Identidad, espacio y empresas

La aplicación sirve una organización Daybook. `organizations.ownerId` identifica el espacio y es distinto de la cuenta de autenticación. Las cuentas (`authUser`) y membresías (`members`) tienen identidades separadas; una membresía recibe `userId` al aceptar una invitación. El navegador no elige `ownerId` ni enlaza cuentas.

Las empresas clientes son registros `customerCompanies` del mismo espacio, no tenants independientes. Cada contacto pertenece como máximo a una empresa. Un encargado conserva `role='client'` y tiene `companyAccess='manager'`; el contacto normal usa `companyAccess='own'`. Los roles del equipo son `owner`, `admin` y `agent`, sin empresa cliente asociada.

Better Auth administra correo, contraseña y cookies propias. El registro requiere una invitación administrada por el equipo, con token aleatorio, hash almacenado y vencimiento de 72 horas. Renovarla invalida el enlace anterior. El enlace entregado al administrador y a la cola de correo es una credencial temporal. No hay registro público libre ni cambio de correo mediante la API de autenticación expuesta.

La sesión dura siete días; la API consulta la membresía activa en cada solicitud y no usa caché de sesión en cookie. `DAYBOOK_SITE_URL` fija la URL de autenticación y su origen permitido. El prefijo de cookie es `daybook`; no distingue por sí mismo QA de producción. El aislamiento requiere orígenes, bases de datos, secretos y sesiones separados. Revocar la membresía impide nuevas solicitudes aunque siga existiendo la cookie.

## Permisos y acceso por empresa

| Capacidad | Propietario | Administrador | Agente | Cliente | Encargado de empresa |
| --- | --- | --- | --- | --- | --- |
| Ver todos los tickets y notas del espacio | Sí | Sí | Sí | No | No |
| Crear tickets | Sí | Sí | Sí | Para sí mismo | Para sí mismo |
| Ver y comentar tickets propios autorizados | Sí | Sí | Sí | Sí | Sí |
| Ver y comentar tickets de su empresa | Sí | Sí | Sí | Solo propios | Sí |
| Tomar, asignar, cambiar estado o prioridad | Sí | Sí | Sí | No | No |
| Cambiar explícitamente la empresa de un ticket | Sí | Sí | No | No | No |
| Gestionar empresas, agentes y clientes | Sí | Sí | No | No | No |
| Gestionar administradores | Sí | No | No | No | No |
| Consultar respuestas guardadas | Sí | Sí | Sí | No | No |
| Crear, editar o borrar respuestas guardadas | Sí | Sí | No | No | No |
| Consultar historial de cambios del ticket | Sí | Sí | Sí | No | No |
| Configurar avisos y procesar correo | Sí | Sí | No | No | No |

No se permite modificar los permisos propios ni la membresía propietaria desde la gestión de accesos.

`canAccessTicket` y `ticketAccessSql`, en `lib/access.ts`, expresan la misma regla para un miembro activo del mismo espacio:

- El equipo ve los tickets del espacio.
- Un contacto ve sus tickets si `requesterMemberId` coincide y la empresa guardada en el ticket coincide con su empresa actual. Sus tickets antiguos con empresa nula siguen siendo visibles.
- Un encargado ve además todos los tickets de su empresa actual, siempre que esta no sea nula.

La empresa del ticket es una referencia histórica explícita. Trasladar un contacto a otra empresa no traslada sus tickets. El contacto y el encargado pierden acceso a la empresa anterior, salvo los tickets propios antiguos con empresa nula. Cambiar la empresa de un ticket requiere una acción administrativa explícita y queda registrado.

La regla compartida se aplica a consultas de tickets, mensajes, feed y alertas, descarga de adjuntos y revalidación de destinatarios de correo/push. Las notas se excluyen de las consultas para clientes, incluidos los encargados. Su workspace omite miembros y estado operativo de correo; devuelve solo su empresa, artículos publicados y configuración reducida. Las exportaciones de la interfaz parten del conjunto autorizado recibido, sin un endpoint de exportación que amplíe permisos.

Un solicitante vinculado puede estar activo o invitado, pero no revocado. Un ticket sin solicitante vinculado y sin empresa es visible solo para el equipo; coincidir en correo no concede acceso. Un ticket vinculado a una empresa sí puede ser visible para su encargado conforme a la regla anterior.

## Mutaciones, reparto e historial

Las escrituras de ticket, mensaje, adjuntos vinculados, historial y notificaciones usan transacciones PostgreSQL con un único cliente. Antes de mutar o devolver un resultado idempotente, se bloquea y relee la membresía del actor. La actualización de un ticket bloquea también su fila y comprueba de nuevo el acceso.

La bandeja común contiene los tickets sin responsable. «Tomar ticket» y la reasignación envían `expectedVersion`; un cambio concurrente devuelve `409` y no sobrescribe al responsable. Cada cambio de ticket o mensaje incrementa `version`. Este control de versión se exige para asignaciones; no es un control optimista general para todos los campos.

Crear un ticket o mensaje requiere `operationId` UUID. `operations` conserva actor, espacio, tipo, hash del contenido y resultado en la misma transacción. Repetir la misma operación devuelve el resultado guardado; reutilizar el identificador con otros datos devuelve `409`. La repetición revalida el acceso al ticket. Un actor que ahora sea cliente no puede recuperar una nota interna mediante la repetición de una operación anterior del equipo.

`ticketEvents` registra creación, cambios de campos del ticket y reapertura por respuesta del cliente, con actor, valores anterior/nuevo y fecha. Es un historial operativo visible al equipo, no una auditoría inmutable de todas las acciones administrativas. Los mensajes nuevos conservan `authorMemberId` y `authorRole`; los antiguos pueden tener valores nulos.

Las respuestas guardadas contienen título, categoría y texto. El equipo las inserta como borrador y decide cuándo enviar. Los filtros y borradores locales se separan por cuenta, ticket y audiencia; una nota interna no se reutiliza como respuesta pública.

## Destinatarios y entrega de avisos

`settings.notificationMemberIds` selecciona responsables del equipo por ID, sin direcciones fijadas en código. Los invitados pueden seleccionarse, pero solo reciben avisos cuando están activos. Se añaden los asignados activos. Sin responsables configurados se conserva la selección anterior del equipo.

Los destinatarios se deduplican, excluyen al actor y deben conservar acceso:

- Ticket nuevo: responsables del equipo y asignado elegibles.
- Respuesta pública de cliente o encargado: responsables, asignado y solicitante del ticket si es otra persona y conserva acceso.
- Respuesta pública del equipo: solicitante y encargados que ya participaron con mensajes públicos en ese ticket y siguen siendo elegibles.
- Nota interna: no crea avisos de conversación al cliente.

No se avisa a todos los contactos de una empresa. Los responsables configurados para el trabajo conjunto permanecen incluidos aunque solo uno tenga asignado el ticket. Correo y push revalidan membresía y acceso antes del envío; el feed aplica el acceso actual al mostrar alertas.

`mailOutbox` conserva una clave única por evento/destinatario. Sin configuración válida queda en `awaiting_configuration`. Al intentar un envío se fija su payload; los reintentos conservan esa carga y su clave de idempotencia. Un resultado incierto fuera de la ventana de 24 horas del código no se reenvía automáticamente.

Las rutas programan drenaje después de responder, con límites predeterminados de 100 eventos y 60 segundos. Un `429` respeta la próxima tentativa y corta el drenaje para no consumir intentos en el resto de la cola. Se conserva el procesamiento por `eventId` exacto. No hay scheduler permanente: los reintentos futuros requieren actividad o procesamiento administrativo.

`accepted` significa aceptación de Resend, no entrega ni lectura confirmadas. No hay webhooks de rebote, entrega o quejas. Los correos no copian el cuerpo de la conversación. Web Push depende de permisos, suscripción y disponibilidad del navegador/sistema; la prueba local no verifica por sí sola la llegada con todas las pestañas cerradas. No hay recepción de respuestas por correo.

## Adjuntos privados

El flujo reserva un archivo, emite un token acotado, carga a Vercel Blob privado, valida el contenido y lo vincula dentro de la transacción del mensaje. El feed expone solo ID, nombre, tamaño y tipo; la descarga autenticada comprueba el ticket y la audiencia. Un archivo de nota no puede convertirse en adjunto de una respuesta pública.

Los almacenes y tokens de QA y producción se separan. Sin configuración válida se deshabilitan cargas y los tickets de texto siguen funcionando. Se permiten cinco archivos de hasta 10 MiB por mensaje y diez archivos/100 MiB pendientes por miembro. Los pendientes vencen a las 24 horas, con eliminación física diferida. Los enviados se conservan con el historial. Los detalles están en [ATTACHMENTS.md](ATTACHMENTS.md).

## Persistencia y límites

`0002_companies_team_workflow.sql` añade empresas, respuestas guardadas, operaciones, historial y adjuntos; añade empresa/permisos a membresías, empresa/versión a tickets y autoría a mensajes. No elimina datos ni transfiere tickets históricos. Fue aplicada a QA; producción sigue pendiente de publicación.

La aplicación conserva estas limitaciones: un espacio sin facturación por tenant; consultas completas del conjunto autorizado sin paginación del servidor; SLA en horas corridas sin calendario laboral; sin correo entrante ni automatizaciones permanentes. Las pruebas de esta entrega usan datos ficticios y no envían correo ni push a personas reales. El almacenamiento real se verifica exclusivamente en el almacén privado QA autorizado.
