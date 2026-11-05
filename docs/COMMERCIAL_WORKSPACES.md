# Espacios independientes y pilotos invitados

Esta entrega prepara pilotos manuales. No registra negocios públicamente, no crea proveedores, no cambia DNS ni planes y no activa pilotos existentes. Requiere integrar primero las entregas 1 y 6, con sus migraciones; `0013_workspaces.sql` es aditiva salvo el reemplazo transaccional del índice único de suscripciones push, explicado abajo.

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

`lib/workspace-route-registry.ts` es una lista positiva de APIs del dominio. El router conserva la solicitud original, su URL, cuerpo, query, origen y cabecera de cuenta, y entrega únicamente los parámetros esperados al controlador. No admite autenticación global, cuentas, operador, proveedores/webhooks, activación, datos demo, trabajos internos o respaldos de plataforma.

Puntos precisos para integrar con los shells y entregas 1–5:

- Importar `workspaceFetch` en `desk.tsx` y `client-portal.tsx` y sustituir sus llamadas directas a `fetch`. Los demás componentes y helpers de esta base ya lo utilizan. Aplicarlo también a los componentes de las entregas 1–5.
- Usar `workspaceHome(currentWorkspaceId(), ticketId)` al abrir avisos en otra pestaña; conservar `window.location.pathname` al actualizar el ticket seleccionado.
- Montar los shells y paneles con `key={workspaceId}` para que una navegación de Next entre dos espacios no conserve el estado del anterior. Las páginas `/w/:id` ya lo aplican.
- Insertar `WorkspaceSwitcher` en navegación; muestra únicamente las membresías activas de la identidad. Abre una URL nueva, sin cambiar el contexto de otras pestañas.
- Incorporar `WorkspaceAdministrationPanel({workspaceId})` a los ajustes del negocio y `SecurityCenter` a su seguridad. Ocultar respaldos de plataforma a propietarios sin concesión de operador y ofrecer la exportación de negocio.
- Ampliar la lista positiva de controladores con las rutas de las entregas 1–5. Sus APIs deben seguir utilizando `requireAccess`/`lockAccess` y filtrar por `ownerId`.
- Mantener los campos adicionales de `AccessContext`, incluyendo `sessionId` y el permiso interno de preparación. Ese permiso únicamente se crea en el servidor para las rutas de incorporación; nunca habilita tickets.

Las peticiones legacy cuyo referente pertenece a `/w/...` se rechazan para detectar clientes aún no adaptados. Esta comprobación es defensiva: la autorización siempre depende de sesión, URL explícita y membresía, y no confía en el referente.

Borradores de respuestas, notas, adjuntos, nuevos tickets, operaciones idempotentes, filtros y sonido añaden el espacio a sus claves de navegador. Las claves anteriores de Daybook permanecen compatibles. Las notas antiguas sin audiencia solo se recuperan dentro de Daybook. No se almacenan conversaciones privadas en el service worker ni en una caché compartida.

## Correo, archivos, avisos y trabajos

La marca se guarda por espacio. El operador comprueba el dominio y el alcance de la clave existente con el proveedor antes de atestar un remitente mediante `DAYBOOK_VERIFIED_WORKSPACE_SENDERS_JSON`, un mapa privado de ID de espacio a remitente exacto. La administración del negocio puede solicitar un remitente, pero no verificarlo ni apropiarse del de otro. Sin atestación coincidente, envío y recepción permanecen desactivados. No se crean claves ni proveedores automáticamente.

Los nuevos correos incluyen el nombre escapado del negocio, el CID existente de Daybook y un enlace explícito a su portal. Los payloads congelados e idempotencias anteriores no se reconstruyen. Antes del envío se revisan de nuevo estado, remitente y destinatario. Un remitente revocado no modifica un payload congelado ni permite enviarlo desde otra identidad. Los correos de recuperación usan siempre la configuración global.

La recepción conserva las capacidades HMAC ligadas a negocio, contacto y evento. Comprueba de nuevo estado, habilitación y acceso antes de la ingesta; el proveedor no elige el negocio mediante un campo arbitrario. Los trabajos tienen dueño, recibo, cursor, lease, consumo y errores independientes. El programador multiplexa negocios activos de forma acotada y rota según última ejecución, manteniendo las garantías existentes. Los respaldos automáticos existentes siguen reservados a la operación de Daybook.

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

Después de integrar todos los dominios: ejecutar QA en serie, revisar rutas de búsqueda, descargas, archivos de contratos, informes, reglas, programación y conocimiento, y hacer el recorrido en dos pestañas, escritorio y móvil, temas claro y oscuro, sobre el mismo commit de la vista previa protegida. Revisar los contadores e inventarios anteriores y posteriores antes de autorizar producción. No activar pilotos durante la publicación del código.

La reversión segura, una vez existan pilotos o varias invitaciones para una identidad, mantiene la capa E7 de identidad y autorización y pausa los pilotos/funciones desde sus interruptores. No volver a un build que vincule automáticamente todas las invitaciones por email. El índice push anterior tampoco puede reconstruirse si ya hay vínculos múltiples sin perderlos: no eliminarlos para forzar una reversión. Antes del primer piloto, una reversión de esquema requiere comprobar inventarios y ausencia de esos vínculos y permanecer transaccional; el mecanismo preferido es desactivar la admisión comercial conservando datos y código compatible.

Validación local: `npm run check` superó lint, 266 pruebas unitarias, tipos y compilación. También pasaron `git diff --check` y el análisis sintáctico del script de QA. Las pruebas de base, concurrencia PostgreSQL y revisión visual protegida quedan preparadas para el coordinador; esta rama no ejecutó migraciones, no consultó QA/producción y no envió notificaciones reales.
