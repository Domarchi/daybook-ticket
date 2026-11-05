# E4: automatizaciones internas y casos relacionados

Implementación aditiva sobre E3. No cambia estados, prioridades, `dueAt`, políticas SLA, mensajes, archivos ni hilos de correo. Reglas, tareas y vínculos son internos; los clientes reciben 403. No existe ejecución de código de usuario, respuesta pública automática ni cascada de eventos.

## Comportamiento

- Motor y programador independientes, apagados por defecto. Al reactivar el motor se fija `activatedAt`; la cola anterior se cancela sin ejecutar acciones. Cada evento conserva la versión de activación para evitar reejecución incluso con cambios en el mismo milisegundo.
- Primera regla habilitada que coincida, ordenada por `position` e ID. Condiciones combinadas por AND: evento, empresa, departamento, prioridad, estado, tipo y todas las etiquetas requeridas. Listas vacías significan cualquiera, salvo eventos (al menos uno). Estados iniciales: abierto y pendiente.
- Acciones permitidas: añadir etiquetas sin retirar las existentes, cambiar departamento, elegir responsable solo si el ticket sigue abierto/pendiente y sin responsable, crear tareas de hasta tres plantillas. Nunca sobreescribe una asignación existente. Revisa acceso, disponibilidad, capacidad y carga actuales bajo el mismo bloqueo que el reparto existente.
- Simular no escribe filas. Habilitar requiere una prueba HMAC de 15 minutos ligada al administrador, espacio, definición exacta y versiones de sus referencias. Reutiliza el secreto de Better Auth con separación de dominio; no requiere nuevas claves para simular. Cambios en plantillas/tipos/etiquetas obligan a simular y guardar de nuevo; no se ejecuta contenido nuevo sin revisión.
- Cada versión, incluida creación, edición, pausa y archivo, se conserva como snapshot inmutable en `automationRuleVersions`. Restaurar una regla archivada la deja pausada.
- Cada evento genuino tiene una recepción única `(ownerId, operationKey, eventKind)`. Acciones, registro y finalización se guardan en una sola transacción. Una interrupción antes del commit no deja acciones parciales. Un reintento de un evento ya terminado no crea tareas adicionales.
- Límite: 100 reglas activas, 20 habilitadas, 1.000 guardadas; 100 plantillas activas, 1.000 guardadas; diez tareas por plantilla, 1.000 tareas por ticket. Cola: 500 pendientes por espacio; al excederse se registra la omisión sin bloquear la solicitud del cliente. Worker: de uno a cinco eventos y máximo 45 s por llamada. Errores de referencia o permisos de la regla: hasta tres intentos con esperas de 60/300 s; nunca cambia otras acciones parcialmente.
- Vínculos relacionados: internos, hasta 200 entre los dos casos. Duplicado: solicitante de cuenta no vacío, mismo propietario y empresa; un único principal, sin cadenas ni ciclos. Se archivan vínculos; nunca se consolidan moviendo mensajes ni se borra el ticket. Los números, archivos, hilo y SLA siguen independientes.

## Interfaces

| Ruta | Uso |
| --- | --- |
| `GET/POST/PATCH /api/automation/rules` | Administrador. Listado paginado, nueva regla, versión/archivo con `expectedVersion`. Crear y cambiar reglas usa envoltorio `{rule, simulationProof?}`. |
| `GET /api/automation/rules/:id/versions` | Administrador. Snapshots paginados (`beforeVersion`, `limit`). |
| `POST /api/automation/simulate` | Administrador. `{ticketId,eventKind,rule? \| ruleId?}`; devuelve plan, contexto mínimo y `simulationProof`. Sin escrituras. |
| `GET/PATCH /api/automation/settings` | Administrador. Interruptor por espacio con versión optimista, salud de la cola y del ejecutor. |
| `GET /api/automation/executions` | Administrador. Historial paginado de aplicadas, omitidas y errores. |
| `GET/POST/PATCH /api/task-templates` | Equipo consulta activas; administrador administra/archiva con `expectedVersion`. |
| `POST /api/tickets/:id/task-templates` | Equipo. `{operationId,templateId,expectedTemplateVersion}`. Reintento devuelve el resultado original; contenido distinto, conflicto. |
| `GET/POST/PATCH /api/tickets/:id/relations` | Equipo. Alta `{operationId,targetTicketId,kind}`; archivo/restauración `{id,expectedVersion,archived}`. |
| `POST /api/internal/automation-tick` | Bearer >=32 caracteres, autenticado antes de importar DB. Apagado si `DAYBOOK_AUTOMATION_JOB_ENABLED` no es `true`. |

Los listados aceptan `cursor`, `limit` (máximo 100); reglas/plantillas también `includeArchived`. El historial usa cursor por fecha e ID. Todas las respuestas usan `private, no-store`. No hay exportaciones CSV nuevas ni SQL aportado por usuarios.

Componentes: `AutomationPanel({memberId,companies,members,departments})` para administración y `TicketRelationsPanel({memberId,ticketId,refreshKey?,onChanged?})` para el panel interno del ticket. Reutilizan el miembro explícito en cada petición, estados de error/carga, controles de teclado y estilos claro/oscuro y móvil. Se exportaron `orgRequest` y `useOrgResource` del componente E2 para compartir la protección contra respuestas de otra cuenta.

## Integración acumulada E1–E4

La rama incorpora `codex/daybook-evolution-03` en `9d8375c`, incluido el arreglo de borradores de E1 y los formularios durables E2. El diario contiene el prefijo contiguo 0–10: `0010_automation`, índice 10 y fecha `1793912003000`. El coordinador ensayó y aplicó 0010 exclusivamente en QA mediante el operador revisado y fijó su hash; el prefijo 0–10 conservó todas las tablas, columnas y filas originales. No se aplicó a producción.

- Todas las rutas públicas E4 pasan por `requireAutomationAccess` y el gate E1. Los mutadores administrativos vuelven a comprobar el gate dentro de la transacción. `enqueueAutomationEvent` y cada transacción del worker lo comprueban con su conexión; un gate apagado conserva la cola e historial, sin reservar ni ejecutar trabajo. El cambio administrativo de flags toma el owner work lock antes de la pertenencia para serializarlo con los eventos y acciones.
- Portal: creación usa `ticket:<operationId>`; mensajes públicos usan `message:<operationId>` y distinguen cliente/equipo. `patchTicket` usa `ticket:<id>:version:<version>` solo cuando realmente hay cambios; la organización usa esa misma clave de versión al cambiar metadatos, etiquetas o motivo de espera. Todas las reservas se realizan dentro de la transacción original. No hay eventos para notas, importaciones, tareas, vínculos ni acciones del worker.
- Correo: `ingestInboundEmail` reserva con `inbound:<environment>:<providerId>` en la misma transacción del recibo, mensaje, archivos y avisos. Un recibo ya procesado vuelve antes de reservar; no reconstruye eventos antiguos. Los drains ocurren después del commit en las rutas de portal, cambios/organización, webhook de recepción, reintento administrativo y ejecutor de recepción. El worker E4 solo hace acciones internas y no envía correo o push.
- El ejecutor privado filtra espacios con gate y motor habilitados, elige hasta dos por última ejecución más antigua y drena dos eventos por espacio. Sigue desactivado por defecto. Revisar cuota y configurar `DAYBOOK_AUTOMATION_JOB_ENABLED` / `DAYBOOK_AUTOMATION_JOB_SECRET` solo después de QA y autorización productiva.
- `AutomationPanel` está montado para administradores en «Atención y reparto». `TicketRelationsPanel` y aplicación de plantillas están en el detalle interno del ticket. Ambos requieren el gate; las etiquetas de actividad E4 están registradas. Los enlaces `/?ticket=:id` conservan el formato actual. El control de flags actualiza el espacio después de guardar, y los estilos respetan el tema claro/oscuro/automático.
- Respaldo: se añaden ocho tablas a las 57 de E3, **65 en total**, preservando cada perfil anterior exacto. Tablas E4: `automationSettings`, `taskTemplates`, `automationRules`, `automationRuleVersions`, `automationEvents`, `automationExecutions`, `automationJobHealth`, `ticketRelations`. Se restauran reglas antes de versiones/eventos/ejecuciones y eventos antes de ejecuciones. Todas tienen `ownerId`; no contienen secretos.

## Programación con la Function existente

`functions/notification-pinger` amplía el fanout existente sin crear nuevas Functions ni disparadores. Conserva recordatorios primero, luego recepción, vencimientos de equipos/contratos, automatizaciones y finalmente respaldos. Los límites por solicitud son 25 s, 55 s, 45 s, 45 s y 280 s respectivamente. Cada destino habilitado recibe una sola solicitud: una respuesta fallida, redirección o interrupción no provoca reintentos del pinger ni impide los siguientes trabajos.

Los dos destinos nuevos están apagados por defecto y tienen credenciales independientes:

| Configuración privada en Vercel y en la Function del mismo entorno | Destino |
| --- | --- |
| `DAYBOOK_SERVICE_CONTEXT_JOB_ENABLED=true` + `DAYBOOK_SERVICE_CONTEXT_JOB_SECRET` | `/api/internal/service-context-tick` |
| `DAYBOOK_AUTOMATION_JOB_ENABLED=true` + `DAYBOOK_AUTOMATION_JOB_SECRET` | `/api/internal/automation-tick` |

El pinger valida antes de cualquier llamada los secretos de todos los trabajos habilitados. Los dos destinos nuevos desactivados no necesitan su secreto. El bypass de protección se conserva únicamente en QA y solo se envía al origen Vercel fijado en `DAYBOOK_NOTIFICATION_TARGET_ORIGIN`; producción lo rechaza y ninguna redirección se sigue.

Después de revisar QA, el operador actualizará **la Function ya existente** con el artefacto generado por `npm run build:notification-pinger`, guardará los secretos correspondientes como privados y comprobará una invocación del disparador existente. QA y producción usan configuración y secretos diferentes; no se han creado claves ni cambiado entornos remotos en esta entrega. Para detener cada destino basta con apagar su flag conservando datos e historial; el gate y motor del espacio siguen siendo controles independientes de los eventos inmediatos.

## Comprobaciones

- `node --import tsx --test scripts/check-automation.test.ts`: 13 pruebas de condiciones, orden/no retroactividad, acciones permitidas, límites, conservación de responsable/capacidad, incluidos responsables históricos sin cuenta enlazada, plantillas versionadas, compatibilidad de duplicados, firma ligada al contexto/tamper/expiración y autenticación antes del worker.
- `scripts/check-automation-database.mjs`: preparado para ejecución **en serie por el coordinador**, solo `.env.test.local` QA permitida. Guarda fixtures ficticias, worker, salud y recibos dentro de una transacción, fuerza fetch externo a fallar y hace rollback más comprobación de limpieza. Prueba simulación sin filas, habilitación con firma, snapshots, recibos, acciones/rollback/reintentos, capacidad, revocación, duplicados, SLA intacto y exclusión de una segunda transacción mediante bloqueo. No se ha ejecutado aquí.
- `scripts/check-evolution-pinger.test.ts`: orden de destinos, credenciales por destino, fallo independiente, ausencia de reintentos y secretos en respuestas, bypass solo QA y configuración apagada.
- `scripts/check-automation-integration.test.ts`: gate apagado/malformado, ausencia de escrituras al pausar y compatibilidad de todos los perfiles históricos exactos.
- Lint, tipos, compilación y pruebas de la rama se registran al cerrar la entrega. Revisión visual y QA integrada sobre el mismo commit quedan al coordinador, sin publicación productiva.

## Desactivación y reversión

La restauración pausa explícitamente el motor, borra `activatedAt`, cancela los eventos pendientes con `restore_paused` y limpia el marcador de inicio del ejecutor después de verificar las huellas originales. No depende del interruptor restaurado ni vuelve a ejecutar eventos históricos. Las ocho tablas ya están registradas en `BACKUP_TABLES`; la pausa también se aplica al recuperar archivos históricos en el esquema actual.

Apagar primero el programador y luego el motor/gate del espacio detiene trabajo nuevo y existente. Los tickets, tareas, relaciones, snapshots y ejecuciones se conservan. Volver al despliegue anterior mantiene tablas aditivas y datos actuales; no revertir borrando tablas. Antes de producción, comparar inventario/huellas y comprobar descarga de archivos según el proceso de conservación del repositorio.

## Recuperación acumulada de 65 tablas

El ensayo de recuperación conserva las fixtures E3 de sede, equipo, contrato y documento privado (tres archivos). Añade filas ficticias a las ocho tablas E4, versiones y ejecución histórica, un evento terminado y otro pendiente, y una relación de duplicado con un segundo caso. Verifica huellas originales antes de pausar el motor, cancelar solo el pendiente y limpiar el marcador del ejecutor; conserva versiones, plantillas, ejecución y vínculo. El ensayo pasó en QA con 65 tablas y tres archivos; las cuentas ficticias y los esquemas aislados se limpiaron al terminar.

## Evidencia de revisión acumulada

Código integrado `87c5a3f`: lint, tipos, **323 pruebas unitarias** y compilación aprobados. QA pasó 15 grupos de automatización con rollback y limpieza, exclusión de una segunda transacción, acciones/recibo atómicos, revocación, reintentos y SLA intacto. El ensayo y la aplicación de 0010 conservaron **60 tablas y 638 filas** anteriores.

El recorrido HTTP ficticio creó el ticket #398: simulación, alta idempotente, una ejecución y una tarea, etiqueta interna, acceso de cliente denegado y vínculo de duplicado. El motor quedó pausado al terminar. La revisión visual en escritorio y móvil, claro y negro, comprobó editor, simulación sin cambios y controles táctiles, sin desbordamiento horizontal.

La recuperación de **65 tablas y tres archivos** pasó con huellas, claves foráneas, compatibilidad del archivo histórico y limpieza completa. Los trabajos quedaron pausados conservando reglas, versiones e historial. No hubo correo, push ni Blob externos.

Pinger existente: fanout simulado y compilación aprobados. No se crearon ni actualizaron Functions, programaciones, proveedores, DNS o planes. Los destinos nuevos siguen desactivados. Vista previa protegida de QA: https://daybook-ticket-evolution-04-qa-domarchi.vercel.app/ . No hay publicación productiva.


## Estabilidad de la revisión y almacenamiento QA

El código `f4f666e1d88928bce1ebba47d4a76df1b1ced84d` superó lint, 323 pruebas unitarias, tipos y compilación. Los paneles hermanos de organización y relaciones y el chat del cliente usan claves React con prefijos distintos para impedir que cada actualización acumule paneles anteriores. La comparación del árbol sintáctico confirmó cambios exclusivamente en claves: no se alteraron mensajes, propiedades ni operaciones. El almacenamiento de esta rama Preview está fijado en QA, con su credencial aislada y protección Vercel.
