# E4: automatizaciones internas y casos relacionados

Implementación aditiva sobre E2. No cambia estados, prioridades, `dueAt`, políticas SLA, mensajes, archivos ni hilos de correo. Reglas, tareas y vínculos son internos; los clientes reciben 403. No existe ejecución de código de usuario, respuesta pública automática ni cascada de eventos.

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

## Integración que realizará el coordinador

1. Apilar E1–E4 y normalizar journal: `0010_automation`, índice 10, `1793912003000`. No se ha ejecutado esta migración desde esta entrega.
2. Aplicar `requireEvolutionFeature(access, 'automation')` de E1 en **todas** las rutas públicas nuevas. El gate es además obligatorio dentro de `enqueueAutomationEvent` y en cada transacción de `drainAutomationEvents`; un interruptor desactivado debe impedir reservar/ejecutar trabajo aunque el motor local permanezca habilitado. La base E2 de este worktree no tiene aún ese módulo; no se ha inventado un gate paralelo.
3. En los puntos genuinos de creación y cambio, ya bajo `acquireTicketWorkLock` y con acceso vigente: `await enqueueAutomationEvent(tx, fresh, ticket.id, stableOperationKey, eventKind)`. La recepción debe formar parte de la transacción original. Eventos: `ticket_created`, `ticket_updated`, `client_replied`, `agent_replied`; solo respuestas públicas. No reservar eventos para notas internas ni desde las propias acciones del worker.
4. Usar la clave persistente de la operación/mensaje/correo recibido, no una nueva UUID al reintentar. Tras commit, llamar `drainAutomationBestEffort(ownerId)`, manteniendo el procesamiento de notificaciones actual. El worker no envía correo ni altera claves o eventos de correo existentes.
5. El job selecciona hasta dos espacios habilitados por última ejecución más antigua y drena hasta dos eventos por espacio. Añadir el gate E1 al bucle de espacios. No activar infraestructura automáticamente: revisar cuota y configurar `DAYBOOK_AUTOMATION_JOB_ENABLED` / `DAYBOOK_AUTOMATION_JOB_SECRET` solo después de QA y aprobación de publicación.
6. Montar los componentes únicamente para roles correspondientes y feature habilitada. Revisar enlace `/?ticket=:id` si la navegación del padre utiliza otro formato; habrá compatibilidad con rutas de espacio en E7.
7. Añadir etiquetas de actividad: `automation_applied`, `task_template_applied`, `ticket_linked`, `ticket_unlinked`.
8. Ampliar respaldo y compatibilidad con **ocho** tablas, todas con `ownerId`: `automationSettings`, `taskTemplates`, `automationRules`, `automationRuleVersions`, `automationEvents`, `automationExecutions`, `automationJobHealth`, `ticketRelations`. Orden de restauración: reglas antes de versiones/eventos/ejecuciones; eventos antes de ejecuciones; tickets y miembros antes de todas sus referencias. Sin secretos nuevos almacenados en estos registros.

## Comprobaciones

- `node --import tsx --test scripts/check-automation.test.ts`: 13 pruebas de condiciones, orden/no retroactividad, acciones permitidas, límites, conservación de responsable/capacidad, plantillas versionadas, compatibilidad de duplicados, firma ligada al contexto/tamper/expiración y autenticación antes del worker.
- `scripts/check-automation-database.mjs`: preparado para ejecución **en serie por el coordinador**, solo `.env.test.local` QA permitida. Guarda fixtures ficticias, worker, salud y recibos dentro de una transacción, fuerza fetch externo a fallar y hace rollback más comprobación de limpieza. Prueba simulación sin filas, habilitación con firma, snapshots, recibos, acciones/rollback/reintentos, capacidad, revocación, duplicados, SLA intacto y exclusión de una segunda transacción mediante bloqueo. No se ha ejecutado aquí.
- Lint, tipos, compilación y pruebas de la rama se registran al cerrar la entrega. Revisión visual y QA integrada sobre el mismo commit quedan al coordinador, sin publicación productiva.

## Desactivación y reversión

La restauración pausa explícitamente el motor, borra `activatedAt`, cancela los eventos pendientes con `restore_paused` y limpia el marcador de inicio del ejecutor después de verificar las huellas originales. No depende del interruptor restaurado ni vuelve a ejecutar eventos históricos. Esta pausa se activa al incorporar las ocho tablas a `BACKUP_TABLES` de la entrega integrada.

Apagar primero el programador y luego el motor/gate del espacio detiene trabajo nuevo y existente. Los tickets, tareas, relaciones, snapshots y ejecuciones se conservan. Volver al despliegue anterior mantiene tablas aditivas y datos actuales; no revertir borrando tablas. Antes de producción, comparar inventario/huellas y comprobar descarga de archivos según el proceso de conservación del repositorio.

## Resultado local (2026-11-05)

- `npm run lint`: PASS; revisión adicional de los últimos cambios de automatización y del script QA sin incidencias.
- `npm run typecheck`: PASS.
- `npm run test:unit`: 271/271 PASS antes de añadir el borde de activación simultánea; la ejecución final específica de E4: 13/13 PASS. Subconjunto de automatización y compatibilidad de respaldos: 16/16 PASS antes de ese test adicional.
- `npm run build`: PASS sobre las fuentes finales, con rutas nuevas registradas.
- `node --check scripts/check-automation-database.mjs` y `git diff --check`: PASS.
- QA de base, gates E1, conservación/restauración con las ocho tablas registradas y revisión visual integrada: pendientes del coordinador. No se leyeron secretos ni se ejecutaron migraciones, QA mutante o infraestructura desde este worktree.
