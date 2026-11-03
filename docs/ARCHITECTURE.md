# Arquitectura y límites de Daybook Ticket

## Identidad y organización

Daybook Ticket tiene una sola organización, `daybook`. `organizations.ownerId` es un UUID privado del espacio, separado de la cuenta de autenticación. Las cuentas de autenticación (`authUser`) y las membresías (`members`) tienen identidades distintas. La membresía enlaza un `userId` cuando se acepta una invitación; el navegador no puede establecer ese enlace ni escoger `ownerId`.

El propietario se aprovisiona mediante `scripts/provision-owner.mjs`, un proceso privilegiado con conexión a la base de datos que genera una invitación privada de un solo uso. `/api/setup` no admite activaciones públicas y no se confía en cabeceras de ChatGPT. Better Auth 1.7.15 administra correo, contraseña y cookies propias. La API del producto resuelve la sesión, exige una membresía activa y aplica el rol desde la base de datos en cada solicitud. Revocar una membresía corta su acceso aunque la cookie de autenticación todavía exista.

El registro está limitado a invitaciones con token aleatorio de 256 bits, hash SHA-256 almacenado y vencimiento de 72 horas. La cuenta utiliza el correo y nombre establecidos por el administrador. Renovar una invitación reemplaza su hash. El enlace sin hash solo se entrega al administrador y a la cola de correo para poder compartirlo con la persona invitada; debe tratarse como credencial temporal. No existe un registro libre ni cambio de correo mediante la API expuesta de autenticación.

Las contraseñas y sesiones se almacenan según el esquema y mecanismo de Better Auth. `BETTER_AUTH_SECRET` es una credencial de despliegue y debe mantenerse fuera del repositorio. La autenticación limita los intentos de inicio de sesión, registro y recuperación; esto no equivale a un sistema general de protección contra abuso de todas las funciones del producto.

## Permisos

| Acción | Propietario | Administrador | Agente | Cliente |
| --- | --- | --- | --- | --- |
| Ver tickets del espacio y notas internas | Sí | Sí | Sí | No |
| Crear y responder tickets propios | Sí | Sí | Sí | Sí |
| Ver tickets vinculados a su cuenta | Sí | Sí | Sí | Sí |
| Asignar, cambiar prioridad/estado y vincular solicitantes | Sí | Sí | Sí | No |
| Invitar y gestionar agentes/clientes | Sí | Sí | No | No |
| Invitar y gestionar administradores | Sí | No | No | No |
| Modificar la membresía propietaria o los permisos propios | No | No | No | No |
| Configuración, artículos y ejemplos | Sí | Sí | No | No |
| Ver el estado operativo de correos y procesar la cola | Sí | Sí | No | No |

El cliente consulta exclusivamente tickets cuyo `requesterMemberId` coincide con su UUID de membresía. Sus consultas de mensajes excluyen notas internas en SQL. Solo recibe artículos publicados y configuración reducida; no recibe la lista de miembros ni estados operativos de correo. El equipo recibe el directorio necesario para asignar tickets y elegir solicitantes, sin IDs de autenticación ni secretos.

La asignación exige una membresía activa del equipo. Un solicitante vinculado puede ser un cliente activo o invitado; una cuenta revocada no puede seleccionarse. Los tickets históricos sin vínculo permanecen visibles solo para el equipo, incluso si su correo coincide con una cuenta de cliente. Vincular uno es una decisión explícita del equipo y concede acceso a sus mensajes públicos históricos.

## Persistencia y correo

Las escrituras relacionadas de ticket, mensaje y evento de notificación comparten una transacción PostgreSQL ejecutada con un único cliente (`BEGIN`, `COMMIT`, `ROLLBACK`). La cola `mailOutbox` almacena una clave única por evento y destinatario. El destinatario se comprueba contra la membresía actual y el acceso al ticket al procesar el envío; un cliente no recibe eventos de otro cliente.

Sin proveedor, remitente y URL válidos, el estado es `awaiting_configuration`. Con Resend configurado, el proceso adquiere un bloqueo temporal y conserva un payload inmutable al primer intento. Los reintentos utilizan la misma clave de idempotencia dentro del plazo seguro de 24 horas. Los resultados inciertos fuera de ese plazo no se reenvían automáticamente. Una nota interna no genera notificación al cliente y el cuerpo de conversación no se copia a correos.

`accepted` significa que Resend aceptó la petición, no entrega confirmada. No hay webhooks de entrega, rebote ni quejas. Tampoco existe un scheduler permanente: la cola se procesa con actividad del equipo, después de escrituras y bajo solicitud administrativa. Un despliegue que necesite reintentos sin visitas requiere configurar un programador compatible o una cola dedicada. No hay recepción de mensajes de correo; las respuestas se escriben en el portal.

## Límites de esta versión

- Una organización; sin multiempresa ni facturación por tenant.
- Sin adjuntos, correo entrante, integraciones externas de tickets ni automatizaciones.
- Consultas del espacio completo autorizado, sin paginación o búsqueda del servidor.
- Plazos en horas corridas, sin calendario laboral, escalamiento ni pausa automática.
- Historial de cambios de tickets, sin auditoría completa e inmutable de todas las acciones administrativas.
- Recuperación de contraseña dependiente del correo configurado; no existe una vía paralela para que un administrador vea contraseñas.
- La activación inicial requiere entregar al propietario su enlace privado; no hay registro público de propietarios.

El esquema de esta migración se crea vacío en un proyecto Neon exclusivo. `drizzle-postgres/` contiene las migraciones para PostgreSQL. Las pruebas usan una rama independiente con datos ficticios y Resend desconfigurado. No se importaron datos de otros Daybook.
