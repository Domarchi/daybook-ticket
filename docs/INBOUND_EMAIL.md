# Correo entrante de Daybook Ticket

## Comportamiento

Un cliente activo invitado puede crear un ticket escribiendo desde su correo registrado a su dirección privada, disponible en su portal. No se crean cuentas a partir del correo. El ticket usa su empresa actual, prioridad normal, primer departamento configurado, calendario/SLA vigente y reparto automático normal. Los encargados reciben el aviso habitual.

Las nuevas respuestas públicas del equipo pueden incluir `Reply-To` por destinatario. La respuesta del cliente se incorpora al ticket correcto como comentario público y notifica al equipo. Si estaba resuelto, abre un ciclo nuevo usando el SLA vigente. El asunto nunca decide qué ticket o empresa puede consultar una persona. El equipo sigue respondiendo desde el portal; ningún correo entrante crea notas internas.

La recepción incorpora **texto nuevo y hasta cinco archivos de 10 MiB cada uno**. Usa la misma validación real de contenido y almacenamiento privado del portal: PNG, JPEG, WebP, PDF, TXT, CSV, DOCX y XLSX sin macros, contenido ejecutable ni documentos cifrados. El archivo no se acepta por su nombre o MIME solamente. Si falla un archivo, no se guarda parcialmente el mensaje. Los recibos antiguos `attachments_use_portal` se conservan sin reinterpretarlos. No se envían respuestas automáticas a remitentes rechazados.

Algunos clientes de correo citan la marca CID de Daybook al responder. Se omite exclusivamente esa imagen pública si sus bytes coinciden exactamente con el SHA-256 del logo existente, también cuando viene junto a archivos del cliente. Se consulta la API de adjuntos y únicamente las dos combinaciones exactas de CDN/ruta admitidas, sin redirecciones; el nombre o tamaño por sí solos no autorizan omitir archivos. Una imagen modificada sigue siendo un archivo sujeto a validación e importación.

## Procesamiento duradero y salud

Después de verificar la firma y la dirección privada contra su cuenta actual, el webhook guarda un trabajo `pending` con el sobre normalizado mínimo. Nunca guarda otra copia del cuerpo/HTML/MIME ni URLs de descarga. Responde al proveedor después de esa confirmación; la descarga y la incorporación continúan mediante `after()` y el tick privado existente de recepción.

`inboundMailJobs` refleja `pending`, `processing`, `retry`, `processed`, `rejected` o `failed`. Los errores se clasifican con códigos cerrados, sin mensajes del proveedor, correos, cuerpo, tokens ni URLs en los logs. La interfaz administrativa muestra contadores, antigüedad pendiente, última incorporación, motivos y los últimos 25 trabajos; el historial anterior permanece en sus recibos. No expone sobres privados. Su lectura y el reintento revalidan la membresía administrativa bajo bloqueo y separan QA/producción.

El worker reclama con lease de cinco minutos y token único, hasta dos trabajos y 45 segundos por tick (máximo cinco por llamada). Hace hasta seis intentos con espera mínima de 1, 5, 30, 120 y 480 minutos. Son tiempos de elegibilidad; la ejecución depende del siguiente tick o actividad. Un lease agotado se recupera; su sexto intento vencido queda `failed`. La pausa conserva trabajos y archivos. Se comprueban otra vez cuenta, rol, dirección, remitente, acceso y autenticación antes de incorporar.

Administración puede reintentar hasta tres veces un trabajo fallido/rechazado, mediante `POST /api/email-inbound/<providerId>/retry` y un `operationId` UUID. La operación es idempotente por cuenta, trabajo y contenido; un trabajo procesado nunca vuelve a pendiente. Un recibo antiguo de rechazo conserva su decisión original. Reintentar no envía otro correo ni altera mensajes actuales.

Los archivos se descargan secuencialmente desde la API fija y CDN exacto, con límites de bytes y tiempo. Se validan antes de reservar; las reservas usan el mismo cupo de 10 archivos/100 MiB pendientes por cliente. `inboundMailJobFiles` conserva IDs y SHA estables antes de cargar objetos privados sin sobrescribir. Un timeout ambiguo se resuelve comprobando los bytes existentes. El enlace de los archivos, mensaje, ticket, recibo, notificaciones y estado terminal del trabajo se confirma en la misma transacción. Un COMMIT ambiguo se reconcilia con su recibo y nunca autoriza borrar archivos vinculados.

Las reservas rechazadas se marcan para limpieza y el limpiador existente elimina únicamente objetos sin vincular, después del margen de seguridad. Los objetos de intentos anteriores conservan su alcance por `draftId`; un reintento crea una reserva nueva si la anterior ya está eliminándose. Los archivos enviados siguen siendo inmutables y usan las descargas/vistas previas autenticadas del portal.

## Identidad, permisos y reintentos

- Direcciones opacas con HMAC de 96 bits, vinculadas a cuenta, correo, espacio, ambiente y clase de operación. El secreto nunca llega al navegador. Cambiar el correo o retirar la cuenta invalida la dirección anterior.
- Para respuestas, el identificador opaco referencia un aviso realmente congelado y su destinatario. Se comprueba el `Reply-To` original, el ambiente y una antigüedad máxima de 90 días. Las direcciones de creación no sirven para responder a un ticket.
- Además de la firma del webhook, la dirección opaca y la coincidencia exacta del remitente, se exige autenticación recuperada mediante la API de Resend: `authentication.dmarc = pass`, o `dmarc = gray` únicamente si `dkim = pass`. Según el contrato del proveedor, ese DKIM debe coincidir con el dominio From; el caso gray permite dominios con política DMARC `p=none`. SPF por sí solo no basta. No se confía en `Authentication-Results` enviado dentro del mensaje. Los resultados ausentes, fallidos o indeterminados se rechazan.
- Membresía, cuenta activa, rol cliente y acceso actual al ticket se vuelven a comprobar bajo bloqueo dentro de la transacción. Cambiar de empresa no traslada los tickets históricos.
- Un recibo por `email_id` guarda un resumen hash, estado y referencias, sin conservar otra copia del correo. El recibo, ticket/comentario y avisos se confirman juntos. Repeticiones concurrentes devuelven el resultado anterior; reutilizar un identificador con contenido distinto se rechaza.
- Las entradas ajenas a las direcciones Daybook se reconocen sin consultar su cuerpo. La API del proveedor utiliza una URL fija, sin redirecciones ni descargas de enlaces suministrados por el remitente.

Límites: webhook de 256 KiB, respuesta del proveedor de 2 MiB, texto nuevo de 20.000 caracteres y 60 incorporaciones por cliente en una hora. Se reconocen atribuciones multilínea de Gmail en español/inglés, cabeceras citadas de Outlook y contenedores HTML específicos de correo. Las citas genéricas del cliente se conservan; HTML se convierte en texto inerte y no se ejecuta. Se descartan respuestas automáticas y listas. Un correo solo con archivos válidos puede incorporarse sin inventar texto.

## Configuración por ambiente

La función queda desactivada mientras falte una conexión completa. QA y producción requieren secretos diferentes; QA conserva únicamente personas ficticias y transporte simulado durante las pruebas automatizadas.

| Variable privada de servidor | Uso |
| --- | --- |
| `DAYBOOK_INBOUND_ENABLED` | `true` como último paso de activación; ausente conserva la recepción pausada. |
| `DAYBOOK_INBOUND_WEBHOOK_MODE` | `independent` por defecto; `shared` habilita expresamente recepción en el endpoint existente de entregas. Otros valores desactivan la recepción y devuelven 503 para eventos entrantes. |
| `DAYBOOK_INBOUND_DOMAIN` | Dominio de recepción exacto, por ejemplo el `<id>.resend.app` proporcionado por Resend. |
| `DAYBOOK_INBOUND_TOKEN_SECRET` | Secreto aleatorio independiente de al menos 32 caracteres para direcciones privadas. |
| `RESEND_INBOUND_API_KEY` | Clave independiente para recuperar correo recibido. Resend ofrece actualmente `Full access`, sin permiso de solo lectura ni restricción receptora por dominio/inbox; no sustituye la clave restringida de envío existente. |
| `RESEND_INBOUND_WEBHOOK_SECRET` | En modo `independent`, firma propia del webhook entrante, diferente de la firma del seguimiento de entregas. |
| `RESEND_WEBHOOK_SECRET` | Firma existente del seguimiento de entregas. Solo el modo explícito `shared` la utiliza también para autenticar eventos entrantes del mismo webhook. |

La recepción directa de Resend permite usar su dominio `.resend.app` sin cambiar DNS. No reemplazar los MX de Consorcio C17. Si posteriormente se utiliza un dominio propio, dedicar un subdominio y comprobar sus registros por separado antes de activarlo.

1. Aplicar la migración aditiva de esta entrega y comprobar conservación de datos.
2. Consultar cuota disponible; no aumentar planes automáticamente. Obtener la dirección de recepción del proyecto/cuenta del proveedor.
3. Elegir el modo según la capacidad disponible. En `independent`, registrar un webhook para `email.received` hacia `https://<host-de-daybook>/api/webhooks/resend/inbound` y guardar su firma propia. En `shared`, seguir el procedimiento siguiente sin crear otro webhook. Guardar las demás variables como secretos privados del ambiente correspondiente.
4. Conectar y probar en QA con clientes ficticios, manteniendo los avisos de prueba sin entregas externas. Antes de activar producción, comprobar el remitente, la cuenta invitada, el acceso a la empresa y los registros de rechazo.
5. Activar `DAYBOOK_INBOUND_ENABLED=true`. Los clientes obtienen su dirección desde `GET /api/email-inbound`; sus respuestas usarán el `Reply-To` de los avisos nuevos.

### Un único webhook en el plan Free

La [tabla actual de Resend](https://resend.com/pricing) incluye un endpoint de webhook en Free. Los [límites de correo](https://resend.com/docs/knowledge-base/account-quotas-and-limits) son compartidos entre envíos y recepciones: 100 al día y 3.000 al mes. No aumentar el plan ni activar sobreconsumo automáticamente. El dominio administrado de recepción no necesita un Inbox adicional.

Para conservar el webhook de entregas y evitar otro endpoint:

1. Desplegar la aplicación con `DAYBOOK_INBOUND_WEBHOOK_MODE=shared` y recepción todavía pausada. Mantener el endpoint existente `https://<host-de-daybook>/api/webhooks/resend`, su firma `RESEND_WEBHOOK_SECRET` y todos sus eventos de entrega.
2. Añadir exclusivamente `email.received` a la suscripción de ese mismo webhook. No sustituir la URL ni retirar eventos de seguimiento. Mientras la recepción está pausada, los eventos entrantes reciben 503 para reintento; las entregas siguen registrándose.
3. Configurar el dominio receptor, `RESEND_INBOUND_API_KEY` independiente y secreto de direcciones. El modo compartido usa la firma del webhook existente; no requiere `RESEND_INBOUND_WEBHOOK_SECRET` ni acepta esa firma alternativa.
4. Activar `DAYBOOK_INBOUND_ENABLED=true` como último paso y desplegar la configuración. El endpoint independiente `/api/webhooks/resend/inbound` devuelve 503 en modo compartido para evitar dos vías activas.

Ambos modos verifican la firma sobre los bytes originales antes de interpretar eventos o acceder a la base/proveedor. Comparten exactamente el mismo procesamiento transaccional, permisos y claves de idempotencia. Cambiar de modo no modifica las direcciones privadas si se conservan dominio, ambiente y secreto de direcciones. La clave de API receptora sigue siendo independiente de la de envío en ambos modos. Para volver al modo independiente, preparar primero su webhook y firma propios y cambiar la suscripción de forma coordinada, manteniendo la recepción pausada durante el cambio.

Los correos antiguos y sus claves de idempotencia se conservan. Solo las notificaciones nuevas se crean con versión 3; los payloads ya congelados de cualquier versión se reenvían con sus bytes originales. No añadir `Reply-To` a un envío previamente congelado.

Para pausar, desactivar `DAYBOOK_INBOUND_ENABLED`, manteniendo datos, dominio y secretos. El portal conserva sus solicitudes y conversaciones. Rotar el secreto de direcciones invalida las direcciones de creación y respuesta anteriores; hacerlo únicamente como acción administrativa deliberada.

## Comprobaciones

```sh
node --import tsx --test scripts/check-inbound-email.test.ts scripts/check-inbound-reliability.test.ts scripts/check-resend-webhook-handlers.test.ts scripts/check-mail-delivery.test.ts
node --env-file=.env.test.local --import tsx scripts/check-inbound-email-database.mjs
# Solo con lease QA coordinado, después de 0006 y en serie:
node --env-file=.env.test.local --import tsx scripts/check-inbound-reliability-database.mjs
```

Las pruebas de base se ejecutan en serie después de migrar QA. La original conserva sus casos de recibos heredados; la nueva crea cuentas/tickets `@example.test` explícitamente de prueba en el espacio QA, inyecta proveedor y almacenamiento en memoria, conserva/restaura los desempates de reparto y limpia únicamente sus registros. Sus diez escenarios comprueban reclamos concurrentes, deduplicación, reintento manual idempotente, carga/COMMIT ambiguos, leases obsoletos, revocación y rechazo íntegro. Incluye la caída del sexto intento: su lease vencido queda fallido, los archivos sin vincular pasan a limpieza y se eliminan después del margen; un archivo ya adjunto y su recibo procesado permanecen intactos. No envía correos, push ni solicitudes externas.

Referencias oficiales: [recepción y dominio administrado](https://resend.com/features/inbound), [recuperar un correo recibido y autenticación calculada por el servidor receptor](https://resend.com/docs/api-reference/emails/retrieve-received-email), [webhooks de recepción con cuerpo recuperado por API](https://resend.com/docs/dashboard/receiving/forward-emails), [metadatos y CDN de un adjunto recibido](https://resend.com/docs/api-reference/emails/retrieve-received-email-attachment).
