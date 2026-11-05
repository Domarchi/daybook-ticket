# Entrega 2: organización de solicitudes

La migración `0008_organization` es aditiva: catálogo y revisiones, organización de tickets, tareas internas y vistas personales. No recrea tickets ni recalcula estados, plazos o SLA.

## Integración

Componentes de `app/work-organization.tsx`:

- `OrganizationManager({ memberId, companies })`: pantalla administrativa de etiquetas, tipos, campos y formularios; edición, publicación y archivo sin borrar versiones.
- `RequestOrganizationFields({ memberId, companyId, staff, value, onChange, disabled })`: agregar al formulario de alta. `value` contiene `requestTypeId?` y `fieldValues?`. Usar `staff={false}` para el cliente y pasar su empresa actual para separar solicitudes/caché.
- `TicketOrganizationPanel({ ticketId, memberId, staff, members, refreshKey, onChanged })`: muestra información publicada al cliente y edición/tareas solo al equipo. Usar una `key` de cuenta, permisos y ticket; `refreshKey={ticket.version}` refresca sin reiniciar un editor abierto. `onChanged` actualiza la vista del ticket.
- `SavedViewPicker({ memberId, filters, onApply })`: vistas privadas de cada cuenta, guardadas en la base. Aplicar filtros no concede permisos.

En el schema existente de creación: extender con `organizationSubmissionSchema.shape`, exportado desde `lib/work-organization-model.ts`. Ambos campos nuevos son opcionales y **no añaden defaults al payload histórico de idempotencia**. El componente cliente debe omitirlos si no hay tipo ni valores.

Dentro de la misma transacción de creación, después de resolver el solicitante y su empresa:

```ts
const organization = await prepareTicketOrganization(tx, fresh, {
  customerCompanyId: requester.customerCompanyId,
  requestTypeId: data.requestTypeId,
  fieldValues: data.fieldValues,
});
// Después de insertar el ticket y antes de devolver el resultado idempotente:
await saveTicketOrganization(tx, fresh, ticket.id, organization);
```

No guardar información de organización mediante una segunda solicitud después de crear el ticket. Las rutas PATCH de organización y tareas ya registran actividad e incrementan `ticket.version`/`updatedAt`; conservan el estado y todos los campos de SLA.

Añadir etiquetas a `TicketActivity`: `organization` → «Organización del ticket actualizada», `task_created` → «Tarea interna creada», `task_updated` → «Tarea interna actualizada».

Añadir al inventario de respaldo, después de sus tablas referenciadas: `workOrganizationCatalog`, `workOrganizationRevisions`, `ticketOrganization`, `ticketTasks`, `savedTicketViews`. Todas incluyen `ownerId`. Integrar el interruptor de entrega 2 en el sistema de funciones de la entrega 1 antes de activar la UI.

## API y permisos

- `GET/POST/PATCH /api/organization/catalog`: catálogo activo para el formulario; `items`, `total` y `nextCursor` para gestión paginada. GET admite `kind`, `q`, `cursor`, `limit` (1–100), `includeArchived`, `customerCompanyId`. Solo administradores mutan; PATCH exige `id` y `expectedVersion`.
- `GET/PATCH /api/tickets/:id/organization`: tipos y campos congelados. Solo equipo edita etiquetas, tipo, valores y motivo de espera; PATCH exige la versión propia de organización.
- `GET/POST /api/tickets/:id/tasks` y `PATCH /api/ticket-tasks/:id`: solo equipo con acceso vigente. Creación con `operationId`; repetir el mismo contenido devuelve la tarea original y reutilizar la operación con otro contenido da conflicto. Listado paginado hasta 100 por página; edición con versión.
- `GET/POST /api/saved-views` y `PATCH/DELETE /api/saved-views/:id`: solo la cuenta propietaria. Hasta 50 vistas; PATCH/DELETE comprueban versión. Los clientes guardan únicamente búsqueda y estado.

Los clientes no reciben etiquetas, motivos de espera, tareas, campos internos ni formularios de otra empresa. Un campo nuevo es interno; un formulario nuevo es borrador. Publicar un formulario toma versiones concretas de sus campos. Cambiar o archivar un campo no reinterpreta formularios ni tickets previos: para cambiar futuros envíos, editar y guardar el formulario. Se conservan snapshots internos vacíos al crear desde cliente para que el equipo pueda completarlos sin exponerlos.

Límites iniciales: 100 entradas activas por tipo de catálogo y 1.000 incluyendo archivadas; 20 campos por formulario; 20 opciones por selección; 20 etiquetas y 1.000 tareas por ticket. Todas las lecturas están acotadas y el catálogo archivado se pagina. CSV expuesto mediante helper escapa fórmulas y comillas.

## Verificación

- `node --import tsx --test scripts/check-work-organization.test.ts`: 12 pruebas de privacidad, tipos, calendarios, snapshots, selección de empresa, reglas de tarea, filtros y CSV.
- `scripts/check-work-organization-database.mjs`: integración QA serial, con fixtures dentro de una transacción revertida y comprobación de limpieza. Cubre ACL, revocación, snapshots, tipos, archivo, tareas idempotentes/versionadas, preservación de SLA y vistas por cuenta. Requiere 0008 aplicada; no migra ni envía correo/push.
- El coordinador aplica migraciones y ejecuta QA; este paquete no consulta ni modifica bases remotas.

Al revertir código, conservar las cinco tablas nuevas y sus revisiones. Desactivar la interfaz/función conserva tareas, formularios y contexto histórico.

## Integración y QA acumulada

La interfaz ya está conectada a los formularios de cliente/equipo, detalle y vistas de bandeja. El interruptor `organization` gobierna las rutas; las referencias y valores del formulario se guardan por cuenta en el borrador y conservan el reintento tras una respuesta de red perdida. Los bloqueos de lectura y escritura respetan el orden de trabajo del espacio, miembros y ticket.

QA: ocho grupos de integración revertidos, alta HTTP ficticia #384 (campos obligatorios, intento repetido sin duplicar, conflicto de versión, tareas/vistas privadas), revisión de escritorio y móvil 390×844, claro/oscuro y cliente sin campos internos. La migración conservó 43 tablas y 587 filas originales. Recuperación ampliada de 45 tablas y dos archivos, incluidas tareas/catálogo/vistas, así como archivo histórico real de 36 tablas sin las columnas aditivas: huellas y limpieza completas. Sin solicitudes externas de correo/push/Blob. El operador de publicación fija el hash de 0008 y fecha 1793912001000.

## Evidencia para revisión

El código integrado `11962f2d4d038631c2e9b4ebe5622c95b4a54ffe` supera lint, tipos, 292 pruebas unitarias y compilación. Los casos HTTP de QA y la revisión visual usan únicamente datos ficticios; no se enviaron avisos externos. La vista previa de esta entrega mantiene la protección de Vercel y los trabajos automáticos apagados. La recuperación de borradores conserva el formulario y su operación original sin repetir envíos automáticamente.


## Estabilidad del panel y almacenamiento de revisión

El código `41b37de27e06fb7eb3dfc787ef9c4c22fc536d21` superó lint, 292 pruebas unitarias, tipos y compilación. El chat y la organización de la solicitud usan claves React distintas entre hermanos: actualizar la conversación ya no debe acumular paneles anteriores. La comparación del árbol sintáctico confirmó que esta corrección solo modifica claves, sin cambiar propiedades, mensajes ni operaciones. La variable de almacenamiento de esta rama Preview está fijada explícitamente en `qa`, con su clave privada de QA y sin credenciales de producción. La vista previa conserva su protección Vercel y no realiza entregas externas.
