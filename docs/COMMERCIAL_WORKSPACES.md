# Espacios independientes y pilotos invitados

Esta entrega prepara pilotos manuales. No registra negocios públicamente, no crea proveedores, no cambia DNS ni planes y no activa pilotos existentes. Integra las entregas 1–6 con sus migraciones; `0013_workspaces.sql` es aditiva salvo el reemplazo transaccional del índice único de suscripciones push, explicado abajo.

## Identidad y límites de confianza

Better Auth sigue siendo una identidad global con contraseña, sesiones, autenticador y recuperación globales. Los roles viven exclusivamente en `members`, por organización. Un usuario puede ser propietario en un negocio y cliente en otro, incluso en dos pestañas simultáneas.

`organizations.ownerId` sigue siendo la clave estable de aislamiento. Transferir el rol de propietario cambia dos membresías, exige verificación reciente y que el destinatario tenga MFA y recuperación; no cambia esa clave ni mueve tickets, empresas, documentos o archivos.

La aceptación consume exclusivamente el token presentado en `/api/workspaces/invitations/accept`, verifica su correo contra la identidad autenticada y bloquea invitación y membresía dentro de una transacción. Repetir la misma aceptación devuelve su resultado. No se vinculan otras invitaciones pendientes al ingresar o consultar una sesión. Las identidades existentes inician sesión para aceptar; las nuevas crean su contraseña con esa invitación. Los enlaces son capacidades privadas y deben entregarse al destinatario correspondiente.

La recuperación usa la identidad global y el remitente de plataforma configurado actualmente. No acepta un remitente elegido por el negocio ni vuelve a habilitar membresías revocadas. Un cliente sin acceso a negocios puede seguir gestionando su autenticador y sesiones desde `/account/security`, que no concede membresías.

## Operador y alta manual

Únicamente `DAYBOOK_PLATFORM_OPERATOR_USER_IDS`, una lista privada de IDs exactos de Better Auth, concede acceso al operador. No hay concesiones por email, dominio, invitaciones ni por tener el rol `owner`. El ID se configura después de comprobar personalmente la identidad correspondiente. La consola exige MFA comprobado y custodia de recuperación; las modificaciones exigen además verificación reciente de contraseña y segundo factor.

La consola `/operator` muestra nombres de negocios, estados, límites y consumos agregados. No entrega tickets, mensajes, contactos, archivos, contraseñas, sesiones, secretos o membresías automáticas. Las operaciones de alta y configuración se registran como acciones administrativas inmutables en el espacio afectado, sin atribuir al operador una membresía.

La consola puede renovar exclusivamente una invitación inicial pendiente de su propietario en un piloto en borrador; invalida el enlace anterior y no cambia cuentas activas ni sus factores. Crear un piloto devuelve una invitación privada para su propietario y deja `workspaceProfiles.state=draft`. El propietario puede preparar su autenticador, política y configuración. Para activar, el operador debe comprobar:

- Propietario activo con autenticador verificado y custodia de códigos confirmada.
- Política de MFA obligatoria para el equipo.
- Interruptores `security` y `workspaces` preparados explícitamente; comienzan en `false`.
- Límites acordados y capacidad disponible revisada, sin contratar servicios.

`DAYBOOK_PILOT_CAPACITY_JSON` reserva capacidad únicamente para pilotos, después de descontar el uso y compromisos de Daybook y otros usos de la infraestructura. Contiene `maxActiveWorkspaces` (máximo diez), `members`, `ticketsMonthly`, `messagesMonthly`, `storageBytes` y `mailMonthly`. No configurarlo impide la activación. El operador confirma la revisión en cada activación o cambio de límites de un piloto activo.

Un bloqueo transaccional global protege activaciones simultáneas. El presupuesto de archivos contempla también los bytes conservados por pilotos en pausa, y el mayor valor entre reserva y uso real de los activos. Reducir un límite no borra datos; impide nuevas reservas cuando ya se alcanzó.

Los estados son `draft` (preparación del propietario), `active` y `suspended` (acceso del negocio detenido, datos conservados). Pausar no desactiva MFA. Un piloto activo no puede retirar su política obligatoria de MFA; primero debe pausarse y revisarse su incorporación.

## Contexto explícito e integración de interfaz

Las rutas antiguas `/` y `/api/...` pertenecen exclusivamente a Daybook. Las nuevas son `/w/:workspaceId` y `/api/workspaces/:workspaceId/...`. La identidad proviene de la sesión; la URL selecciona espacio y la membresía actual determina el rol. No se usan cookies, cabeceras de selección ni almacenamiento global para decidir el negocio.

`resolveWorkspaceAccess` centraliza la autorización por sesión, organización, membresía, estado y MFA. `requireAccess` lo invoca después de autenticar y comprobar el origen de mutaciones. Los cambios vuelven a comprobar el acceso dentro de sus transacciones. Cambios de estado del piloto y de permisos no trasladan el historial.

`lib/workspace-route-registry.ts` es una lista positiva de APIs del dominio. Ordena primero los controladores con menos segmentos dinámicos, de modo que rutas como `attachments/reserve` y `tickets/updates` no se interpreten como identificadores. El router conserva la solicitud original, su URL, cuerpo, query, origen y cabecera de cuenta, y entrega únicamente los parámetros esperados al controlador. No admite autenticación global, cuentas, operador, proveedores/webhooks, activación, datos demo, trabajos internos o respaldos de plataforma.

Integración de los shells y entregas 1–5:

- `daybookFetch` conserva los errores de transporte, los recibos y el manejo de verificación, y delega en `workspaceFetch`. Este último reescribe strings, URL y Request del mismo origen por llamada y pestaña, sin selección global mutable ni reintentos. Auth, account, operador y preferencias personales permanecen globales.
- Listados, citas, búsqueda, archivos, seguimiento, organización, tareas, reglas, contexto técnico, conocimiento e informes utilizan el registro positivo. Sus lectores y mutaciones conservan la cabecera de membresía actual. Las descargas de informes y el handle de carga Blob mantienen el mismo contexto.
- Los avisos, relaciones, ejecuciones y antecedentes de equipos abren `workspaceHome(currentWorkspaceId(), ticketId)`. Cada página de negocio monta el shell con su ID como clave y el selector navega de forma independiente mediante URL.
- Borradores de respuesta y nota, citas por ID, menciones, metadatos del formulario, recibos inciertos, archivos pendientes, conocimiento, filtros y deduplicación de avisos se separan por espacio y cuenta. Los borradores legacy de Daybook conservan sus claves originales.
- Las mutaciones interactivas E1–4 y de incorporación leen JSON una sola vez y validan un contrato mínimo real antes de confirmar. Un 2xx truncado, vacío o con DTO incompleto conserva el borrador y operationId; una plantilla que añade cero tareas sigue siendo un resultado válido.
- `WorkspaceAdministrationPanel` está montado en ajustes de pilotos; la incorporación permite preparar seguridad y remitente. La exportación privada del negocio se ofrece desde Seguridad. El respaldo de plataforma solo aparece para el propietario Daybook con concesión de operador explícita.
- La preferencia de tema pertenece a la identidad global, mediante `/api/preferences`; no se transforma en una preferencia de tenant ni requiere pertenecer a Daybook.

## Correo, archivos, avisos y trabajos

La marca se guarda por espacio. El operador comprueba el dominio y el alcance de la clave existente con el proveedor antes de atestar un remitente mediante `DAYBOOK_VERIFIED_WORKSPACE_SENDERS_JSON`, un mapa privado de ID de espacio a remitente exacto. La administración del negocio puede solicitar un remitente, pero no verificarlo ni apropiarse del de otro. Sin atestación coincidente, envío y recepción permanecen desactivados. No se crean claves ni proveedores automáticamente.

Los nuevos correos incluyen el nombre escapado del negocio, el CID existente de Daybook y un enlace explícito a su portal. Los payloads congelados e idempotencias anteriores no se reconstruyen. Antes del envío se revisan de nuevo estado, remitente y destinatario. Un remitente revocado no modifica un payload congelado ni permite enviarlo desde otra identidad. Los correos de recuperación usan siempre la configuración global.

La recepción conserva las capacidades HMAC ligadas a negocio, contacto y evento. Comprueba de nuevo estado, habilitación y acceso antes de la ingesta; el proveedor no elige el negocio mediante un campo arbitrario. Los trabajos tienen dueño, recibo, cursor, lease, consumo y errores independientes. El programador multiplexa negocios activos de forma acotada y rota según última ejecución, manteniendo las garantías existentes. Los respaldos automáticos existentes siguen reservados a la operación de Daybook. Los workers de automatizaciones y garantías/renovaciones comprueban el estado operativo dentro de sus transacciones, incluyendo los drenes posteriores a mutaciones. La pausa comercial usa el mismo bloqueo del negocio antes del perfil y conserva colas, etapas e historial; no consume intentos. Los correos de garantías/renovaciones conservan el enlace y filtro de empresa del negocio correspondiente.

Una suscripción nativa del navegador puede recibir avisos de varios espacios. `0013` reemplaza únicamente el índice `push_subscription_endpoint` por `(ownerId, memberId, endpoint)` sin modificar ninguna fila. El upsert y las consultas usan esa clave; desactivar un espacio no cancela la suscripción nativa compartida de los demás. Los payloads transportan `workspaceId`; el worker consulta el receipt de esa URL y solo muestra información después de comprobar sesión, MFA y permisos actuales. Acepta enlaces seguros `/w/:id?ticket=...`; la deduplicación y los tags separan eventos y vínculos.

Los archivos nuevos de pilotos incorporan un prefijo con la huella del `ownerId`; los archivos existentes conservan sus rutas y bytes. Las descargas y vistas previas usan las rutas privadas existentes con contexto del negocio. Nunca se convierten en enlaces públicos.

## Cuotas y conservación

Los límites se aplican mediante triggers dentro de las mismas transacciones que crean miembros, tickets, mensajes, reservas de archivos y avisos de correo. Reservan la fila del perfil y actualizan una época de cuota para impedir sobrepasar límites incluso entre transacciones concurrentes con snapshots. Un fallo revierte la operación completa, conservando idempotencia. Las repeticiones de un evento existente no gastan cuota adicional. La recuperación de contraseña global queda fuera de la cuota comercial y funciona también con una membresía revocada.

No se añade un perfil a Daybook ni se imponen límites nuevos a datos heredados. Las contraseñas, sesiones, MFA, claves de aislamiento y registros actuales no se recrean. La nueva migración añade campos de aceptación a invitaciones y conserva todas sus filas; el uso posterior es específico por token.

El exportador de negocio incluye su perfil, límites y configuración de dominio, y continúa excluyendo identidades globales, contraseñas, sesiones y credenciales. El respaldo operativo de Daybook exige además la concesión explícita del operador; no se convierte en una exportación de tenant. Las credenciales externas y concesiones privadas nunca van dentro de un archivo.

La restauración verifica primero las huellas originales y después deja perfiles comerciales en `draft`, con correo y recepción desactivados y última ejecución vacía. Conserva MFA e historial. La integración también debe retirar la preparación `workspaces` restaurada y exigir revisión de propietario, seguridad, correo y capacidad. Un archivo no concede permisos de operador.

## Comprobación y publicación

`scripts/check-commercial-workspaces.test.ts` cubre rutas explícitas/legacy, URLs seguras, concesiones por ID, remitentes separados, presupuestos, dos contextos de borrador, límites de la lista positiva y escape de marca en correos.

`test:workspaces:qa` está preparado para ejecución coordinada y serial, exclusivamente con `.env.test.local` y el host aislado de QA. La primera fase usa fixtures ficticios en una transacción con rollback y compara inventarios. Comprueba roles distintos para la misma sesión, aislamiento de tickets, revocación, MFA, aceptación exclusiva e idempotente de invitaciones, transferencia sin mover datos, activación y cuotas. La segunda fase prueba dos transacciones reales contra la función exacta de cuotas en un esquema `qa_commercial_<UUID>`; exige un solo ganador y elimina únicamente ese esquema de prueba. No envía correos/push ni consulta almacenamiento externo. No se ha ejecutado desde esta rama sin coordinación.

Después de validar el commit integrado: ejecutar QA en serie, revisar rutas de búsqueda, descargas, archivos de contratos, informes, reglas, programación y conocimiento, y hacer el recorrido en dos pestañas, escritorio y móvil, temas claro y oscuro, sobre el mismo commit de la vista previa protegida. Revisar los contadores e inventarios anteriores y posteriores antes de autorizar producción. No activar pilotos durante la publicación del código.

La reversión segura, una vez existan pilotos o varias invitaciones para una identidad, mantiene la capa E7 de identidad y autorización y pausa los pilotos/funciones desde sus interruptores. No volver a un build que vincule automáticamente todas las invitaciones por email. El índice push anterior tampoco puede reconstruirse si ya hay vínculos múltiples sin perderlos: no eliminarlos para forzar una reversión. Antes del primer piloto, una reversión de esquema requiere comprobar inventarios y ausencia de esos vínculos y permanecer transaccional; el mecanismo preferido es desactivar la admisión comercial conservando datos y código compatible.

Comprobaciones de esta integración: las pruebas puras de dos pestañas cubren citas, menciones, metadatos de empresa, archivos del envío y recuperaciones con la misma clave de operación, además de los contratos JSON incompletos. Los scripts de QA de E3/E4 incorporan perfiles ficticios activos y continúan terminando en rollback. El coordinador debe ejecutar las pruebas de base y concurrencia en serie, revisar escritorio/móvil y registrar el resultado sobre el SHA final.

El acceso QA de migraciones reutiliza el operador revisado, sin una excepción genérica de DDL destructivo:

```sh
npm run db:migrate:evolution:qa -- --through=0013
npm run db:migrate:evolution:qa -- --through=0013 --apply
```

La primera llamada ensaya y revierte; solo el coordinador ejecutará la segunda después de comprobar el resultado. Ambas exigen el host aislado exacto, `DAYBOOK_QA_ALLOW_TEST_DATABASE=1`, TLS verificado, ausencia de credenciales de entrega y hashes/journal aprobados. No aceptan un destino productivo. El reemplazo del índice push es únicamente el autorizado por el operador y el pin de SQL13; no se modifica ninguna fila para realizarlo.
