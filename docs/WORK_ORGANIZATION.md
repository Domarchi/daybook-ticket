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
