# Correo entrante de Daybook Ticket

## Comportamiento

Un cliente activo invitado puede crear un ticket escribiendo desde su correo registrado a su dirección privada, disponible en su portal. No se crean cuentas a partir del correo. El ticket usa su empresa actual, prioridad normal, primer departamento configurado, calendario/SLA vigente y reparto automático normal. Los encargados reciben el aviso habitual.

Las nuevas respuestas públicas del equipo pueden incluir `Reply-To` por destinatario. La respuesta del cliente se incorpora al ticket correcto como comentario público y notifica al equipo. Si estaba resuelto, abre un ciclo nuevo usando el SLA vigente. El asunto nunca decide qué ticket o empresa puede consultar una persona. El equipo sigue respondiendo desde el portal; ningún correo entrante crea notas internas.

Esta entrega incorpora **texto**. Un correo con archivos se registra como no incorporado (`attachments_use_portal`); no se guarda solo el texto perdiendo los archivos. La interfaz y el pie del correo indican que los adjuntos deben enviarse desde el portal. Administración puede revisar los últimos ingresos y sus motivos de rechazo en Configuración. No se envían respuestas automáticas a remitentes rechazados, evitando bucles y correo no solicitado.

Algunos clientes de correo citan la marca CID de Daybook como imagen inline al responder. Se omite exclusivamente esa imagen pública si sus bytes coinciden exactamente con el SHA-256 del logo existente. Se consulta la API de adjuntos y el CDN documentado de Resend con límites estrictos y sin redirecciones; el nombre o tamaño por sí solos no autorizan omitir archivos. Una imagen modificada o cualquier otro archivo mantiene el rechazo íntegro.

## Identidad, permisos y reintentos

- Direcciones opacas con HMAC de 96 bits, vinculadas a cuenta, correo, espacio, ambiente y clase de operación. El secreto nunca llega al navegador. Cambiar el correo o retirar la cuenta invalida la dirección anterior.
- Para respuestas, el identificador opaco referencia un aviso realmente congelado y su destinatario. Se comprueba el `Reply-To` original, el ambiente y una antigüedad máxima de 90 días. Las direcciones de creación no sirven para responder a un ticket.
- Además de la firma del webhook, la dirección opaca y la coincidencia exacta del remitente, se exige autenticación recuperada mediante la API de Resend: `authentication.dmarc = pass`, o `dmarc = gray` únicamente si `dkim = pass`. Según el contrato del proveedor, ese DKIM debe coincidir con el dominio From; el caso gray permite dominios con política DMARC `p=none`. SPF por sí solo no basta. No se confía en `Authentication-Results` enviado dentro del mensaje. Los resultados ausentes, fallidos o indeterminados se rechazan.
- Membresía, cuenta activa, rol cliente y acceso actual al ticket se vuelven a comprobar bajo bloqueo dentro de la transacción. Cambiar de empresa no traslada los tickets históricos.
- Un recibo por `email_id` guarda un resumen hash, estado y referencias, sin conservar otra copia del correo. El recibo, ticket/comentario y avisos se confirman juntos. Repeticiones concurrentes devuelven el resultado anterior; reutilizar un identificador con contenido distinto se rechaza.
- Las entradas ajenas a las direcciones Daybook se reconocen sin consultar su cuerpo. La API del proveedor utiliza una URL fija, sin redirecciones ni descargas de enlaces suministrados por el remitente.

Límites: webhook de 256 KiB, respuesta del proveedor de 2 MiB, texto nuevo de 20.000 caracteres y 60 incorporaciones por cliente en una hora. Se omite el texto citado después de separadores habituales de respuesta. HTML se convierte en texto inerte; scripts, estilos y elementos activos nunca se renderizan. Se descartan respuestas automáticas y listas.

## Configuración por ambiente

La función queda desactivada mientras falte una conexión completa. QA y producción requieren secretos diferentes; QA conserva únicamente personas ficticias y transporte simulado durante las pruebas automatizadas.

| Variable privada de servidor | Uso |
| --- | --- |
| `DAYBOOK_INBOUND_ENABLED` | `true` como último paso de activación; ausente conserva la recepción pausada. |
| `DAYBOOK_INBOUND_DOMAIN` | Dominio de recepción exacto, por ejemplo el `<id>.resend.app` proporcionado por Resend. |
| `DAYBOOK_INBOUND_TOKEN_SECRET` | Secreto aleatorio independiente de al menos 32 caracteres para direcciones privadas. |
| `RESEND_INBOUND_API_KEY` | Clave con acceso de lectura al correo recibido; no sustituye la clave restringida de envío existente. |
| `RESEND_INBOUND_WEBHOOK_SECRET` | Firma propia del webhook entrante, diferente de la firma del seguimiento de entregas. |

La recepción directa de Resend permite usar su dominio `.resend.app` sin cambiar DNS. No reemplazar los MX de Consorcio C17. Si posteriormente se utiliza un dominio propio, dedicar un subdominio y comprobar sus registros por separado antes de activarlo.

1. Aplicar la migración aditiva de esta entrega y comprobar conservación de datos.
2. Consultar cuota disponible; no aumentar planes automáticamente. Obtener la dirección de recepción del proyecto/cuenta del proveedor.
3. Registrar un webhook independiente para `email.received` hacia `https://<host-de-daybook>/api/webhooks/resend/inbound`. Guardar su firma y las demás variables como secretos privados del ambiente correspondiente.
4. Conectar y probar en QA con clientes ficticios, manteniendo los avisos de prueba sin entregas externas. Antes de activar producción, comprobar el remitente, la cuenta invitada, el acceso a la empresa y los registros de rechazo.
5. Activar `DAYBOOK_INBOUND_ENABLED=true`. Los clientes obtienen su dirección desde `GET /api/email-inbound`; sus respuestas usarán el `Reply-To` de los avisos nuevos.

Los correos antiguos y sus claves de idempotencia se conservan. Solo las notificaciones nuevas se crean con versión 3; los payloads ya congelados de cualquier versión se reenvían con sus bytes originales. No añadir `Reply-To` a un envío previamente congelado.

Para pausar, desactivar `DAYBOOK_INBOUND_ENABLED`, manteniendo datos, dominio y secretos. El portal conserva sus solicitudes y conversaciones. Rotar el secreto de direcciones invalida las direcciones de creación y respuesta anteriores; hacerlo únicamente como acción administrativa deliberada.

## Comprobaciones

```sh
node --import tsx --test scripts/check-inbound-email.test.ts scripts/check-mail-delivery.test.ts
node --env-file=.env.test.local --import tsx scripts/check-inbound-email-database.mjs
```

La segunda prueba se ejecuta en serie después de migrar QA. Usa un espacio y cuentas `@example.test` propios, llama al servicio transaccional con el transporte del proveedor inyectado y limpia sus filas. Comprueba concurrencia, reintentos, conflicto de contenido, reparto, reapertura, revocación de empresa, remitentes no autenticados y rechazo íntegro de archivos. No envía correos, push ni solicitudes al proveedor.

Referencias oficiales: [recepción y dominio administrado](https://resend.com/features/inbound), [recuperar un correo recibido y autenticación calculada por el servidor receptor](https://resend.com/docs/api-reference/emails/retrieve-received-email), [webhooks de recepción con cuerpo recuperado por API](https://resend.com/docs/dashboard/receiving/forward-emails), [metadatos y CDN de un adjunto recibido](https://resend.com/docs/api-reference/emails/retrieve-received-email-attachment).
