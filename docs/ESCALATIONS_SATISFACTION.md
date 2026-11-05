# Escalamiento y satisfacción

## Escalamiento

En Atención y reparto, un administrador selecciona los encargados de apoyo y los umbrales en minutos corridos. El valor inicial es cuatro horas sin respuesta pública y una hora después del vencimiento. La función comienza en pausa y no cambia responsables ni los recordatorios existentes de dos horas.

Con un ticket asignado a Joaquín y ambos encargados seleccionados, la escalación llega a Mario; si el responsable es Mario, llega a Joaquín. Solo se consideran cuentas del equipo activas, con acceso y distintas del responsable. Si no hay responsable, reciben los encargados seleccionados que sigan activos. La capacidad del reparto automático no limita las escalaciones, porque no asignan tickets.

El programador actual revisa ambas funciones en su tick de treinta minutos. Cada destinatario recibe la etapa de vencimiento una vez por ciclo, y la de falta de respuesta una vez por episodio pendiente del cliente. Las notas internas no detienen el reloj; una respuesta pública del equipo detiene la condición sin respuesta. Comentarios adicionales del cliente no retrasan el inicio. El vencimiento continúa mientras el ticket siga abierto o en espera.

La activación no recupera atrasos históricos: exige una intervención pública posterior del cliente. Las ocurrencias y sus correos se guardan en una misma transacción, con una clave única por etapa. Las ejecuciones concurrentes y los cambios repetidos del plazo no duplican el aviso. Antes de enviar o reintentar se revisan condición, activación, responsable y destinatario actuales. Desactivar la función conserva su historial y cancela la elegibilidad de lo pendiente. No hay repetición diaria del escalamiento; los recordatorios normales conservan esa función.

API administrativa: `GET/PATCH /api/escalations`. La edición usa `version`; un editor desactualizado recibe 409. Los valores permitidos son 120–43.200 minutos sin respuesta y 0–43.200 minutos después del vencimiento.

## Encuestas de satisfacción

Una transición real del equipo a Resuelto crea una evaluación por ciclo, dentro de la misma transacción que el resultado del SLA. La empresa, el agente que resolvió y la fecha se conservan como instantáneas. Los cierres históricos no se reconstruyen ni reciben invitaciones nuevas.

Solo el solicitante actual, con cuenta de cliente activa y acceso al ticket, puede evaluar ese cierre. Un encargado de empresa puede comentar sus tickets, pero no evaluar los de otra persona. El correo invita a entrar al portal; no contiene la conversación ni un enlace que omita el inicio de sesión.

La evaluación admite de una a cinco estrellas y un comentario opcional de hasta 2.000 caracteres. Solo se acepta una respuesta por cierre. Los reintentos con el mismo `operationId` conservan la respuesta original; reutilizarlo con otros datos produce conflicto. Si el ticket se reabre, la evaluación anterior deja de estar disponible; un nuevo cierre crea otro ciclo. Cambiar o retirar acceso a la empresa también se aplica a la evaluación y al correo pendiente.

La administración consulta resumen por agente y empresa, fecha del cierre en Santiago, filtros y CSV. Los comentarios recientes se limitan a cincuenta; los totales del período incluyen todas las evaluaciones autorizadas. Las calificaciones históricas conservan la atribución original aunque el ticket se reasigne o cambie de empresa.

La variable privada `DAYBOOK_SATISFACTION_ENABLED=false` pausa las nuevas invitaciones y evaluaciones sin revertir el build ni borrar datos. Los correos pendientes pierden elegibilidad; los formularios dejan de estar disponibles y los nuevos envíos reciben 503. La lectura del historial y los reportes permanecen disponibles. Sin esa variable, la función está activada. Al reactivar no se reconstruyen encuestas de cierres pasados.

APIs: `GET/POST /api/tickets/:id/satisfaction` y `GET /api/satisfaction`. El reporte global requiere propietario o administrador. El texto del comentario se muestra escapado; nunca se interpreta como HTML.

## Verificación

Pruebas puras: `scripts/check-escalation-policy.test.ts` y `scripts/check-satisfaction-model.test.ts`.

Integración en serie, después de aplicar la migración aditiva en QA:

```sh
node --env-file=.env.test.local --import tsx scripts/check-service-plus-automation-database.mjs
# Con el servidor QA compilado en 127.0.0.1:5175, también en serie:
node --env-file=.env.test.local --import tsx scripts/check-service-plus-automation-http.mjs
```

El script exige el host QA fijo, rechaza proveedores de envío reales y utiliza únicamente cuentas `@example.test`. Comprueba concurrencia, cancelaciones, retirada de permisos, idempotencia de etapas, evaluación única por ciclo, atribución y limpieza de todas las filas ficticias. No enviar pruebas reales ni activar escalamiento productivo a partir de esta guía.

El 5 de noviembre de 2026, la integración de base aprobó catorce grupos con cero solicitudes a proveedores y limpieza completa de sus filas, incluido el interruptor independiente de CSAT. La prueba HTTP también aprobó sus cuatro bloques: sesiones ficticias reales, cierre por agente, invitación persistente, reintentos de evaluación, nuevas resoluciones, permisos por empresa y atribución congelada. Sus cuatro cuentas, dos empresas, un ticket y todas las dependencias quedaron eliminados al finalizar.
