# Entrega 5: conocimiento e informes privados

## Integración

Esta rama parte de la entrega 3. La migración `0011_knowledge.sql` debe aplicarse después de las migraciones acumuladas 0008 y 0009: los informes leen los tipos versionados de la entrega 2 y los vínculos de equipos de la entrega 3. No se ejecutaron migraciones ni consultas contra QA o producción durante la implementación.

El contenedor integra el interruptor `knowledge` en las rutas nuevas y vistas, además de la autorización propia de cada operación. Los componentes exportados son:

- `KnowledgePanel({ memberId, companies, staff, administrator })`, desde `app/knowledge.tsx`. Biblioteca completa para el equipo; biblioteca publicada para clientes, con `staff=false`. Los agentes pueden redactar y pedir revisión; administradores y propietario pueden aprobar, archivar y elegir empresas autorizadas.
- `KnowledgeSuggestions({ memberId, query })`, en el formulario de nueva solicitud. Busca después de tres caracteres, con espera breve, y abre el artículo sin copiar su contenido ni enviar automáticamente una solicitud.
- `CompanyReportsPanel({ memberId, companies })`, desde `app/company-reports.tsx`. Solo equipo; panel operativo, tendencias y capturas mensuales descargables.

Montar las vistas con una clave que incluya la membresía y su rol. Las consultas, borradores y operaciones incluyen el identificador de la membresía; el contenedor comercial añadirá el contexto de espacio a navegación y APIs. Las hojas de estilo respetan `data-color-scheme=light|dark` y el tema automático, con controles adaptables y tipografía legible en móvil.

El editor antiguo `POST/PATCH /api/articles` queda cerrado con un 409 explicativo, para que no pueda omitir revisión, control de versiones o empresas autorizadas. Cuando el interruptor esté desactivado, conservar la biblioteca interna existente como consulta, sin habilitar ese editor. El helper `knowledgeWorkspaceArticles(access, database?)` entrega un primer lote compatible con `Article[]`, usando las publicaciones autorizadas y permisos actuales. El contenedor debe sustituir la consulta global antigua de `workspace`; nunca debe devolver `published=true` de la tabla original como permiso para clientes. Con `knowledge` desactivado puede devolver `[]` a clientes y conservar la lectura interna para el equipo.

## Artículos, revisión y publicación

La migración añade `version`, `contentRevision`, `reviewState` y `archived` a artículos existentes, sin cambiar título, cuerpo, categoría, fechas ni el indicador antiguo de publicación. Ese indicador deja de ser una autorización. Los artículos existentes se conservan para el equipo y requieren aprobación y selección explícita de empresas para compartirse.

Cada edición crea una revisión inmutable. El primer cambio o solicitud de revisión de un artículo antiguo conserva su estado original con `origin=legacy`, autor desconocido y la fecha real de conservación; no se inventa quién lo editó ni cuándo ocurrió un cambio antiguo. El número de versión optimista aumenta también al revisar, publicar y archivar. Una edición simultánea recibe 409 y conserva el borrador local.

El equipo solicita revisión; un administrador aprueba o solicita cambios. Editar mientras hay una revisión pendiente la marca como sustituida, conservando el registro. Una versión aprobada no se reabre: un nuevo contenido requiere otra versión y aprobación. Las publicaciones apuntan a una revisión aprobada concreta. Editar un borrador no altera lo publicado, y pueden mantenerse las empresas sobre una revisión aprobada anterior mientras se prepara otra.

Retirar una empresa desactiva su publicación y conserva el historial. Archivar oculta el artículo a clientes sin borrar contenido ni publicaciones; reactivar conserva la configuración. La pertenencia actual del contacto decide qué publicación puede consultar, incluso para encargados de empresa. Clientes sin empresa asignada no reciben artículos. Los clientes nunca reciben borradores, historial editorial, notas de revisión ni empresas destinatarias.

Las nuevas tablas son `knowledgeArticleRevisions`, `knowledgeArticleReviews`, `knowledgeArticlePublications` y `knowledgeEvents`. Las escrituras son transaccionales. Crear, solicitar/revisar y publicar usan `operationId`, hash de contenido y comprobación de permisos antes de devolver resultados repetidos.

## Interfaces de conocimiento

- `GET /api/knowledge?q=&category=&state=all|draft|review|approved|changes&includeArchived=false&cursor=<id>&limit=20` devuelve `{ items, nextCursor }`. Los listados limitan los cuerpos a 320 caracteres; la lectura completa requiere otra autorización.
- `POST /api/knowledge`: `{ operationId, title, category, body, changeNote? }`.
- `GET /api/knowledge/:id?historyCursor=<revision>` devuelve artículo y, exclusivamente al equipo, hasta 20 versiones, revisión editorial y publicaciones. Los comentarios editoriales recientes y las publicaciones activas/históricas están acotados.
- `PATCH /api/knowledge/:id`: `{ expectedVersion, title, category, body, changeNote?, archived? }`. Archivar requiere administración.
- `POST /api/knowledge/:id/review`: `{ operationId, expectedVersion, action: "request"|"approve"|"changes", note? }`.
- `PUT /api/knowledge/:id/publications`: `{ operationId, expectedVersion, revisionId, companyIds }`, máximo 100 empresas distintas del espacio. Un array vacío retira las publicaciones activas.
- `GET /api/knowledge/suggestions?q=` devuelve hasta cinco artículos sobre el mismo conjunto autorizado.

Los cuerpos son texto, no HTML ejecutable. Las búsquedas usan parámetros SQL y tokens acotados; nunca buscan primero en material privado para después filtrarlo. Cada lectura y modificación bloquea la membresía actual hasta terminar la transacción.

## Panel e informes

`GET /api/reports/company?companyId=<uuid>&from=AAAA-MM-DD&to=AAAA-MM-DD&includeTests=false` admite períodos de hasta 366 días, usando Santiago y sus cambios de hora. Exige una empresa del espacio y una membresía activa del equipo.

Una consulta SQL produce únicamente agregados: entradas, carga abierta/pendiente/vencida actual, respuestas públicas del equipo, resoluciones registradas, SLA y tendencias diarias, por tipo y por equipo. El SLA usa los registros originales de `ticketSlaOutcomes`; no se reconstruyen resultados de tickets antiguos. Los tipos usan su nombre conservado en el ticket. Los equipos usan los vínculos actuales, identificados por nombre y un fragmento de ID; un ticket puede contar en varios equipos. La interfaz y las exportaciones explican esta cobertura. Cada tabla muestra hasta 50 grupos y un grupo adicional para el resto; las fechas se limitan a 366.

`POST /api/reports/monthly` recibe `{ operationId, companyId, month: "AAAA-MM", includeTests? }` y conserva una captura inmutable en `companyMonthlyReports`, con SHA-256. El mes actual se corta en la fecha de hoy; se rechazan meses futuros. Repetir la misma operación devuelve la captura original; una nueva captura explícita se conserva separadamente, aunque corresponda al mismo mes. No se crean trabajos automáticos ni envíos de informes.

- `GET /api/reports/monthly?companyId=<uuid>&cursor=<uuid>` lista 20 capturas por página.
- `GET /api/reports/monthly/:id` consulta una captura y verifica su hash, empresa y período.
- `GET /api/reports/monthly/:id/download?format=pdf|csv` descarga tras comprobar la membresía actual antes y después de renderizar. Responde con caché privada desactivada, sin enlaces públicos ni solicitudes a Blob.

Los informes excluyen solicitantes, direcciones, asuntos, cuerpos de mensajes, notas, contratos y archivos. Los nombres de empresa, tipos y equipos son visibles únicamente al equipo autorizado. El CSV protege celdas con fórmulas y conserva Unicode. El PDF usa `pdf-lib`, el mismo logo PNG de Daybook incrustado, negro y dorado, tablas medidas, continuación de secciones y numeración. La fuente estándar admite español; caracteres fuera de su repertorio aparecen como `?`, indicado en el documento, y el CSV conserva los originales.

## Conservación, comprobaciones y reversión

El formato de respaldo añade las cinco tablas manteniendo perfiles históricos por conjuntos exactos de nombres. Las versiones se restauran después de los artículos; publicaciones después de versiones y empresas. La comprobación de columnas solo permite ausencias aditivas expresamente nombradas, manteniendo el orden y las demás columnas obligatorias. Las consultas de respaldo mantienen `ownerId` y una lista cerrada de tablas; no se exportan credenciales nuevas ni sesiones.

Validación local: lint, tipos, 265 pruebas unitarias y compilación. Las nueve pruebas nuevas cubren esquemas, filtros/tokens, meses y DST de Santiago, borradores aislados y conflicto de versión, CSV, PDF paginado sin red, perfiles de respaldo y compatibilidad de columnas. El ejemplo ficticio `work/e5-pdf/informe-ficticio.pdf` se renderizó a PNG y se inspeccionaron todas sus páginas; es evidencia local, sin datos reales.

La prueba `scripts/check-knowledge-database.mjs` está preparada para ejecutar por el coordinador, en serie y después de migrar QA: `node --env-file=.env.test.local --import tsx scripts/check-knowledge-database.mjs`. Exige el host QA permitido y `DAYBOOK_QA_ALLOW_TEST_DATABASE=1`, rechaza claves de proveedores, usa empresas y cuentas ficticias y revierte todo al terminar. Cubre aprobación/publicación explícita, aislamiento, borradores privados, versiones, reintentos, permisos revocados, agregados, SLA congelado, capturas inmutables y PDF/CSV. No se ejecutó durante esta implementación.

Antes de publicar: integrar el interruptor y las vistas, cerrar el feed global antiguo, ejecutar QA y revisar escritorio/móvil/claro/oscuro sobre el commit acumulado; comprobar respaldo y huellas de datos existentes. No se modificaron proveedores, planes, DNS, correo ni producción. Para revertir: desactivar `knowledge` y volver al despliegue anterior conservando las tablas, columnas, revisiones e informes. La biblioteca de clientes del despliegue de reversión debe mantener el cierre del permiso global antiguo; conservar ese parche de seguridad en la versión anterior antes de habilitar acceso público.
