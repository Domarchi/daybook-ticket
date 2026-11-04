# Recordatorios y programador de Daybook Ticket

## Entrega preparada, activación separada

Esta rama incorpora el worker y el pinger. Se prepararon Preview, secretos y Function/trigger aislados de QA; producción y los envíos reales permanecen sin cambios. El trigger QA queda detenido. Ver NOTIFICATIONS_RELEASE.md para las evidencias y el acceso privado pendiente. La cadencia prevista es **cada 30 minutos, 24/7**, con `*/30 * * * *` en UTC. El correo inicial de un ticket/comentario conserva el recorrido inmediato existente. El programador procesa recordatorios y recupera envíos pendientes.

El código de negocio vive en `lib/reminders.ts`. La Function de `functions/notification-pinger/index.ts` únicamente autentica procedencia nativa Neon y hace una llamada HTTPS al worker de Vercel. No usa PostgreSQL, Resend ni credenciales de usuarios. No necesita dependencias nuevas.

## Reglas del equipo

- Aviso inicial: los eventos existentes `ticket_created` y `client_replied`; ningún correo adicional inmediato.
- Sin respuesta: dos horas desde el primer mensaje público cliente posterior a la última respuesta pública del equipo. Otros comentarios del cliente no retrasan el inicio; una nota interna no cierra la espera.
- Próximo a vencer: una hora antes del vencimiento, mientras no haya vencido.
- Vencido: una primera escalada al vencer. Los plazos continúan aunque el equipo ya haya respondido y terminan al resolver el ticket.
- Después de una primera etapa: una repetición como máximo cada **24 horas desde el último recordatorio encolado para ese destinatario**, incluida cualquier escalada. Los motivos vigentes se agrupan en un solo correo. No se recupera un correo por cada día perdido.
- Una nueva espera cliente tras una respuesta pública del equipo inicia un reloj nuevo. Cambiar una fecha de vencimiento y devolverla a su valor anterior no repite una etapa ya encolada dentro del mismo ciclo.

El responsable asignado recibe recordatorios si mantiene una cuenta activa del equipo. En su ausencia se usan únicamente los responsables configurados activos; no se amplía silenciosamente a todo el equipo. Invitados, revocados, cuentas sin activar y clientes quedan excluidos. Cambiar la asignación invalida el aviso pendiente para el responsable anterior; el nuevo puede recibir su etapa vigente en la siguiente corrida sin esperar 24 horas.

Al activar recordatorios, `remindersActivatedAt` establece el corte: los tickets históricos requieren una nueva intervención pública del cliente posterior al corte. Desactivar invalida los envíos; volver a activar fija un corte nuevo. Resolver y reabrir separa ciclos mediante los eventos reales de estado; no se inventa historia para datos importados.

## Transacciones y límites

Cada ticket se bloquea antes de evaluar su historia. La ocurrencia agrupada y todos sus eventos outbox se insertan en la misma transacción. La secuencia única protege cada ciclo; el historial se calcula por destinatario. Los reintentos del tick vuelven a evaluar esa historia y no duplican envíos. El outbox mantiene sus claves originales de idempotencia.

El worker procesa solo `organizations.id='daybook'`, hasta 100 tickets y 20 segundos por defecto (máximo configurable interno de 500 tickets/45 segundos). Una concesión por propietario de dos minutos impide corridas simultáneas; un cursor duradero permite continuar un barrido acotado. Reutiliza el drenaje existente, limitado además a 50 correos y al tiempo restante. Un fallo conserva el cursor y registra un código genérico sin secretos. Un volumen superior al límite puede requerir varias corridas; la frecuencia nominal no garantiza que toda cola arbitrariamente grande se atienda en treinta minutos.

Las ocurrencias sin enviar caducan a los treinta minutos. Inmediatamente antes de cada envío/reintento se comprueban configuración y corte, pertenencia activa al equipo, asignación actual, resolución, ciclo y vigencia de los motivos. Se cancela un payload congelado cuando sus razones dejaron de ser válidas o cambió el vencimiento que describía. Los archivos y el cuerpo de mensajes no se copian al recordatorio.

`notificationJobHealth` conserva inicio, éxito, fallo, cursor e identificación de la última invocación por propietario. Nunca se expone `leaseToken`. `getReminderHealth` devuelve estado vacío si no hubo corridas y considera atrasado un éxito con más de 65 minutos. La salud del tick es distinta del resultado final de entrega de cada correo.

## Autenticación de ambos saltos

### Neon Trigger → Function

La Function tiene URL pública. El parser **no verifica una firma criptográfica**. La protección proviene del proxy nativo de Neon, que elimina encabezados `X-Neon-*` enviados por clientes públicos y añade el identificador reservado en entregas de su propio sistema. El código también comprueba versión, igualdad del ID, tipo `schedule`, trigger esperado y fecha válida. `invocation_id` es correlación, nunca contraseña.

Este contrato está documentado en [procedencia de triggers](https://neon.com/docs/compute/functions/triggers/overview#confirming-a-request-came-from-neon) y en el [SDK oficial](https://github.com/neondatabase/neon-pkgs/blob/main/packages/functions/src/lib/parse-trigger-invocation.ts). El código local reproduce sus comprobaciones sin instalar una dependencia compartida. No se debe alojar este mismo handler en otro proveedor confiando en el encabezado, ni exponerlo mediante un proxy que lo preserve sin la garantía Neon.

El [esquema publicado de creación del trigger](https://neon.com/docs/reference/api/functions/create-project-branch-trigger) no ofrece un Authorization/secret de entrega configurable. El endpoint del proveedor está en beta.

### Function → Vercel

El worker requiere `Authorization: Bearer <DAYBOOK_NOTIFICATION_JOB_SECRET>`, compara bytes con tiempo constante y rechaza antes de importar el módulo de base de datos. La clave debe tener al menos 32 caracteres aleatorios y ser independiente de Better Auth, Resend y las claves de producción de otros servicios. No va en URLs, JavaScript del navegador ni registros.

El pinger usa un origen fijo del proyecto y ruta fija, nunca reenvía cookies/credenciales de la petición entrante, no sigue redirecciones y limita el HTTP a 25 segundos. Un resultado distinto de 2xx o un fallo produce 503 con Retry-After:60. Neon puede repetir entregas y desordenarlas hasta 72 horas: [entrega y reintentos](https://neon.com/docs/compute/functions/triggers/overview#delivery-and-retries).

## Configuración privada prevista

Vercel, por ambiente:

- `DAYBOOK_NOTIFICATION_JOB_ENABLED=true` para activar el endpoint, tras completar las comprobaciones.
- `DAYBOOK_NOTIFICATION_JOB_SECRET`: secreto de este salto, distinto en QA y producción.

Neon Function, por rama/ambiente:

- `DAYBOOK_PINGER_ENABLED`: ausente/false hasta completar validación.
- `DAYBOOK_PINGER_ENVIRONMENT=qa|production`.
- `DAYBOOK_NOTIFICATION_TARGET_ORIGIN`: origen exacto del Preview QA o `https://daybook-ticket.vercel.app` en producción, sin ruta/query/credenciales.
- `DAYBOOK_EXPECTED_TRIGGER_ID`: ID real del trigger de esa rama, no su nombre.
- `DAYBOOK_NOTIFICATION_JOB_SECRET`: el secreto del worker correspondiente.
- Solo QA protegido: `VERCEL_AUTOMATION_BYPASS_SECRET`, por encabezado `x-vercel-protection-bypass`. Nunca se copia a producción ni se desprotege Preview.

Estos valores aún requieren aprovisionamiento autorizado. El pinger no necesita `DATABASE_URL`; Neon puede inyectarla, pero el código no la utiliza. No se deben subir archivos de entorno al repositorio ni pasar secretos en argumentos visibles de shell. El aprovisionamiento posterior debe emplear campos privados del proveedor.

## Cuota y despliegue futuro

La consulta de lectura del 4 de noviembre encontró el proyecto existente Free en `aws-us-east-1`, PostgreSQL fijo en 0,25 CU y aproximadamente 4,947 CU-h usadas en el período 1 noviembre–1 diciembre. Antes de activar hay que volver a revisar la cuota. No se aumenta el plan automáticamente.

Con suspensión Free a cinco minutos, tocar PostgreSQL cada treinta minutos supone aproximadamente 30 CU-h/mes, frente a 60 cada quince minutos y hasta 180 cada cinco. Son estimaciones para treinta días, excluyendo tiempo de trabajo y actividad interactiva. Las 100 CU-h gratuitas se comparten entre las ramas del proyecto. Functions tiene una cuota independiente; no cobra tiempo entre solicitudes. Fuentes: [planes](https://neon.com/pricing), [facturación de Functions](https://neon.com/docs/introduction/plans#functions), [cron soportado](https://neon.com/docs/compute/functions/triggers/schedule).

Secuencia de aprovisionamiento, cuando sea autorizada:

1. Aplicar migración aditiva en QA, verificar limpieza y publicar Preview con correo/push reales desactivados.
2. Crear Function QA deshabilitada y trigger QA **deshabilitado** con `/tick`; recuperar su ID y completar la configuración privada. La rama QA nunca recibe destino ni secreto de producción.
3. Habilitar solo el handler QA y ejecutar la prueba de falsificación pública siguiente. El trigger sigue detenido.
4. Probar una entrega nativa QA real y revisar salud, permisos y ocurrencias con datos ficticios. Volver a dejar el trigger QA detenido al concluir. La prueba nativa demuestra una garantía que una prueba local no puede demostrar.
5. En la publicación aprobada, revisar nuevamente cuota y aislamiento; aplicar migración sin reemplazar usuarios/tickets, provisionar Function/trigger de producción con identidad propia y habilitar `*/30 * * * *`. Conservar la posibilidad de detener el trigger y desactivar recordatorios sin borrar historial.

Los triggers heredados de Neon aparecen deshabilitados en ramas hijas. Aun así, una declaración de infraestructura que los habilite puede activarlos; no se declara activación automática en este código.

## Comprobaciones

Empaquetado local, sin instalar dependencias ni acceder a secretos:

```sh
node scripts/build-notification-pinger.mjs
python3 -m zipfile -t outputs/notification-pinger/function.zip
```

El script emite metadatos y deja el ZIP/base64 en `outputs/notification-pinger`, ignorado por Git. Compila con el esbuild ya instalado y Node 24, importa el módulo para comprobar `default.fetch` y fija fecha/permisos del ZIP. Dos corridas deben producir el mismo SHA-256. La raíz contiene solo `index.mjs`, conforme al [bundler oficial](https://github.com/neondatabase/neon-pkgs/blob/main/packages/config-runtime/src/lib/function-bundle.ts).

El MCP `deploy_function` recibe `zip` como base64, `runtime='nodejs24'` y `environment` como **cadena JSON de un mapa string→string**, no como un objeto JSON directo. Se comprobó contra la [implementación de la API CLI](https://github.com/neondatabase/neon-pkgs/blob/main/packages/cli/src/functions_api.ts). Los valores de secretos no se imprimen junto a metadatos o contenido base64. Un slug como `dkticketnotifyqa` cumple el límite de veinte caracteres alfanuméricos minúsculos.

Sin red ni datos:

```sh
node --import tsx scripts/check-reminders.test.ts
```

Integración PostgreSQL **en serie**, únicamente con el archivo QA y correo desactivado:

```sh
node --env-file=.env.test.local --import tsx scripts/check-reminders-database.mjs
```

La integración crea una organización y cuentas `@example.test`, comprueba concurrencia/rollback, destinatarios, clocks, reasignación, revocación, vencimiento, reactivación y limpieza; no hace llamadas al proveedor de correo. También ejecuta el worker real contra esa organización ficticia: un adaptador exclusivo del test cambia únicamente el parámetro del lookup fijo de organización, conservando el resto del SQL real. Verifica concesiones simultáneas y vencidas, recorrido con límite de un ticket, recuperación del cursor, rollback por fallo del outbox, salud de fallo/éxito y ausencia de una tormenta de recuperación. No cambia el registro compartido `organizations.daybook`.

Contra la Function QA ya provisionada, tras verificar el host nativo y trigger mediante metadatos Neon:

```sh
DAYBOOK_QA_ALLOW_PINGER_EDGE_TEST=1 DAYBOOK_PINGER_QA_NATIVE_URL=https://QA-NATIVE-HOST/tick DAYBOOK_PINGER_QA_EXPECTED_TRIGGER_ID=QA-ID node scripts/check-pinger-edge.mjs
```

El script manda un cuerpo válido y el ID QA real con un encabezado reservado falsificado: debe recibir 401/403, sin llegar al worker. Esta comprobación remota pasó el 4 de noviembre contra la Function nativa QA, con el trigger real detenido. Falta completar la invocación nativa hacia Preview protegido con acceso privado de automatización; la conexión Vercel actual rechazó crearlo. No desproteger la vista previa para completar la prueba.
