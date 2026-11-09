# Presencia del equipo y seguimiento público

La presencia informa quién está mirando un ticket o preparando una respuesta o nota. Es orientativa: no bloquea el envío ni reserva el caso. Solo personal activo (`owner`, `admin`, `agent`) puede consultar, actualizar o retirar presencia. Cada petición vuelve a comprobar la cuenta, membresía y acceso al ticket dentro de la transacción; los clientes no pueden consultar estos endpoints.

La tabla aditiva `ticketPresence` guarda únicamente espacio, ticket, integrante, UUID de pestaña, clase de actividad y vencimiento. No almacena texto del borrador, contenido de notas, correos ni tokens de autenticación. El navegador genera un UUID independiente en memoria para su documento; no reutiliza cookies, sesiones ni identificadores guardados. La respuesta pública al equipo agrupa las pestañas por persona y omite la pestaña y el vencimiento individuales.

Mientras la página está visible y hubo interacción en los últimos dos minutos, el navegador renueva cada veinte segundos y consulta cada diez. Al escribir actualiza la clase de actividad con un máximo de una actualización cada cinco segundos, además de un cambio inmediato entre respuesta y nota. Después de diez segundos sin escribir las consultas vuelven a indicar visualización. El servidor fija un vencimiento de cuarenta y cinco segundos, independientemente del reloj del navegador. No se muestran filas vencidas ni integrantes revocados o que dejaron de pertenecer al equipo. Un máximo de ocho pestañas activas por integrante limita las filas.

Ocultar, cerrar o cambiar el ticket cancela consultas y envía una retirada de mejor esfuerzo. Un fallo de red puede retrasar esa retirada hasta el vencimiento; no existe garantía de presencia instantánea. Ante errores se vacía la lista y se aplica una pausa de treinta segundos; 401, 403 y 404 detienen la sesión de presencia hasta volver a montar la vista. Las filas vencidas se limpian de forma acotada durante renovaciones; no se añade otro programador ni infraestructura.

## Integración del editor del equipo

La vista de detalle del equipo usa `TicketPresence` con `ticketId` y `memberId`, con clave por integrante/ticket. El `onChange` del editor ejecuta primero `edit(value)` y después `notifyTicketPresenceActivity(ticket.id, message.kind)`. La inserción de una respuesta guardada puede emitir el mismo aviso. No se necesita enviar el contenido escrito.

## Portal de clientes

`GET /api/tickets/:id/progress` sirve únicamente el nombre actual del responsable activo, estado, hitos derivados de mensajes públicos, plazo y siguiente paso. Comprueba nuevamente la membresía y `canAccessTicket` mediante el bloqueo normal del ticket. No devuelve directorio, correos del equipo, presencia, roles de autores ni notas internas. La primera respuesta cuenta solo mensajes públicos de respuesta del equipo. Un cierre histórico sin medición conserva su estado sin inventar una fecha de resolución.

El portal muestra los hitos, responsable y siguiente paso por encima de la conversación. El plazo se oculta después del cierre. La apariencia conserva negro/dorado, reduce espacio en teléfonos y respeta el modo oscuro del sistema. La carga de seguimiento se cancela al cambiar ticket/cuenta; un fallo no impide consultar ni responder la conversación.

## Comprobación

```sh
node --import tsx --test scripts/check-ticket-presence.test.ts
# Solo por el coordinador, EN SERIE, tras aplicar 0006 en QA:
node --env-file=.env.test.local --import tsx scripts/check-ticket-presence-database.mjs
```

La suite unitaria usa dependencias simuladas sin red. La suite de base fija el host QA, usa personas ficticias, prohíbe proveedores y revierte todo el espacio de prueba. No ejecutar esta última sobre producción ni en paralelo con otras pruebas que escriben QA.

## Decisión de publicación (6 nov 2026)

La presencia pertenece a la entrega de fiabilidad (migración 0006) y **no depende de ninguna función de la evolución**: está activa para el personal en cuanto se aplica 0006 y se publica este código. Se decidió mantenerla así: es orientativa, solo la ve el equipo, no guarda texto ni correos, caduca a los 45 segundos y no envía avisos externos. Si algún día se quisiera pausarla, hay que añadir un interruptor propio; los interruptores de la evolución (`collaboration` y los demás) no la controlan.
