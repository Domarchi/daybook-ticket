# Entrega 3: contexto privado del servicio

Implementa ficha ampliada de empresa, sedes, contactos responsables, inventario, servicios, contratos, documentos privados y vínculos de tickets. Todos los recursos son exclusivos del equipo activo del espacio: un cliente o encargado de empresa no obtiene acceso. Propietarios y administradores gestionan los registros; los agentes consultan, descargan documentos enviados y vinculan tickets.

## Integración de interfaz

`app/service-context.tsx` exporta:

- `ServiceContextPanel({ memberId, companies, members, administrator })`: vista interna con ficha, sedes, equipos, servicios, contratos y vencimientos. `companies` y `members` usan los tipos existentes.
- `TicketServiceContextPanel({ memberId, ticketId, companyId })`: vínculos de un ticket con equipos y contratos de su empresa. No renderizar en el portal del cliente.
- `ContractDocuments({ memberId, contractId, administrator })`: documentos privados; la carga solo se monta para administradores.

Las hojas de estilo respetan `data-color-scheme` además del tema del sistema. Los enlaces de correo abren `/?serviceContext=1&company=<id>`; el contenedor debe seleccionar esta vista interna y empresa. Los enlaces de incidencias conservan `/?ticket=<n>`.

## Interfaces

- `GET /api/service-context?resource=profiles|sites|assets|services|contracts&companyId=<uuid>&q=<texto>&includeArchived=true&limit=20&cursor=<uuid>`: página `{ items, nextCursor }`.
- `POST /api/service-context`: `{ resource, operationId, companyId, ...campos }`; idempotencia por contenido y usuario. La ficha se edita con PATCH.
- `PATCH /api/service-context/:resource/:id`: `{ expectedVersion, ...campos }`; conflicto 409 ante otra edición. Archivar conserva datos y documentos.
- `GET|PUT /api/tickets/:id/service-context`: lectura y reemplazo versionado `{ expectedVersion, assetIds, contractIds }`, máximo 20 de cada tipo. No cambia SLA, estado, prioridad ni responsable.
- `GET /api/service-context/assets/:id/tickets?cursor=<numero>`: historial paginado de incidencias, verificando empresa actual.
- `GET|POST /api/service-context/contracts/:id/documents`: descarga del listado o anexado `{ operationId, draftId, attachmentIds }`.
- `GET /api/service-context?resource=config`: configuración y salud del trabajo.
- `PATCH /api/service-context/config/current`: `{ expectedVersion, enabled }`.
- `GET /api/service-context?resource=reminders&companyId=<uuid>&cursor=<uuid>` y `PATCH /api/service-context/reminders/:id` con `{ read: true }`: avisos persistentes del destinatario actual.

Los esquemas Zod en `lib/service-context-model.ts` definen todos los campos. Las referencias cruzadas requieren la misma empresa y espacio; contactos y responsables deben seguir activos. Las escrituras bloquean y vuelven a validar la membresía, y registran antes/después en `serviceContextEvents`.

## Archivos

Se amplía el pipeline existente con destino exclusivo `{ kind: 'contract', contractId, draftId }`. Conserva los tipos, inspección de contenido, cuotas, caducidad y almacenamiento privado existentes. Cada lote admite cinco archivos; cada contrato admite hasta 100 documentos enviados. Las rutas de descarga vuelven a verificar una cuenta activa del equipo y responden sin caché compartida. Un adjunto contractual nunca puede convertirse en mensaje público. Archivar no borra documentos; impide nuevas cargas.

## Vencimientos

El endpoint `POST /api/internal/service-context-tick` está desactivado por defecto y comprueba autenticación antes de consultar la base. Requiere `DAYBOOK_SERVICE_CONTEXT_JOB_ENABLED=true` y un `DAYBOOK_SERVICE_CONTEXT_JOB_SECRET` privado de al menos 32 caracteres, más activación explícita en la configuración administrativa del espacio. Esta entrega no crea programadores ni secretos.

Un barrido procesa como máximo cinco espacios, 30 entidades por espacio y unos 35 segundos. Mantiene cursor, arrendamiento y salud; reserva cada etapa y su correo en la misma transacción. Usa la cola actual en lotes acotados. Los avisos corresponden a garantía del equipo o a renovación del contrato (fin de vigencia cuando no tiene renovación), a 30 días, 7 días y al vencer, usando fechas de Santiago.

La fecha de importación/edición y la activación deben preceder estrictamente al día de entrada de la etapa. No se crean avisos de etapas ya iniciadas al importar o activar. Las reactivaciones no repiten una etapa ya registrada. Antes de enviar se comprueban responsable, estado, fecha, etapa y destinatario actuales. Se envía al responsable activo, o a los encargados configurados activos, y si no hay configuración al equipo activo. Los correos solo contienen una indicación genérica y enlace al portal; no copian documentos, notas ni datos contractuales.

Desactivar el interruptor o el endpoint conserva registros, lectura e historial y cancela correos pendientes que dejaron de estar vigentes.

## Datos, pruebas y reversión

La migración aditiva `0009_service_context.sql` añade doce tablas, un destino privado de adjuntos y una referencia nullable de correo. No reconstruye historial ni recalcula SLA. Debe apilarse después de las entregas 1 y 2 y probarse en QA antes de producción. La biblioteca de respaldo incorpora las nuevas tablas respetando sus dependencias y acepta conjuntos exactos de los formatos anteriores.

Validación local integrada: 301 pruebas unitarias, compilación Next, tipos y lint. La prueba `scripts/check-service-context-database.mjs` se prepara para la coordinación de QA en serie: cuenta y empresas ficticias, datos dentro de una transacción revertida, almacenamiento simulado y cero solicitudes a proveedores. Ejecutar después de migrar QA, únicamente con `.env.test.local` y `DAYBOOK_QA_ALLOW_TEST_DATABASE=1`, mediante `node --env-file=.env.test.local --import tsx scripts/check-service-context-database.mjs`. No se ha ejecutado desde esta rama de implementación.

Antes de publicar: integrar paneles, comprobar escenarios de QA y revisar escritorio/móvil en el mismo commit, probar restauración con los perfiles acumulados y comparar inventario/huellas de datos existentes. Para revertir, desactivar el nuevo programador, pausar los avisos de contexto y volver al despliegue anterior sin eliminar tablas, documentos ni columnas. Mantener la migración aditiva permite recuperar esta versión sin perder datos nuevos.

## Coordinación de integración

Integrada la navegación interna, el panel de vínculos del ticket, los enlaces por empresa, el interruptor `serviceContext` y su comprobación en cada reserva/entrega de avisos. Los adjuntos contractuales nuevos también respetan la pausa. La recuperación deja apagados los avisos y elimina arrendamientos temporales, conservando documentos e historial.

La migración 0009, fecha 1793912002000, se ensayó y aplicó serialmente en QA: 48 tablas y 612 filas preexistentes conservaron todas sus columnas originales. La suite integrada pasó 301 pruebas, lint, tipos y build. El recorrido QA pasó 13 escenarios de empresas, roles, contratos, adjuntos privados, reintentos, SLA y etapas de avisos; fixtures totalmente revertidos, cero solicitudes de Blob/correo externas. La revisión visual y el CI del candidato definitivo se completan después de incorporar la corrección compartida de borradores.

La recuperación ampliada pasó con 57 tablas y 3 archivos, incluido documento contractual privado, equipo/sede y vínculos del ticket. Se verificaron claves foráneas reales, huellas y recuperación del archivo histórico de 36 tablas; la configuración de avisos quedó apagada y el arrendamiento temporal vacío. Limpieza QA completa. El operador revisado reconoció el prefijo 0009 aplicado tanto en auditoría como en simulación sin confirmar cambios.

## Recorrido de revisión

El recorrido HTTP sobre datos ficticios comprobó sedes, equipos, servicios y contratos; denegó el acceso de cliente a recursos y vínculos internos y conservó estado, responsable y vencimiento del ticket #384. La ficha del equipo muestra ese ticket en su historial. La revisión visual en escritorio 1440×1000 y móvil 390×844 confirmó navegación, documentos privados y temas claro y negro. Las capturas quedan en `outputs/evolution-03/`. No hubo envíos ni cargas externas. Los errores de red se presentan en español y preservan la operación para reintentar manualmente.

## Candidato revisable

Código `8ce2f01`: lint, tipos y compilación aprobados después de la revisión visual; 301 pruebas unitarias de la integración aprobadas. La vista previa protegida de esta entrega usará la base aislada de QA y los mismos controles de acceso comprobados por HTTP. Los programadores, correo y push permanecen apagados; activar garantías y renovaciones requiere revisar la configuración del pinger existente, según las instrucciones de publicación.
