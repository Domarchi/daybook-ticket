# Adjuntos privados de Daybook Ticket

El navegador reserva un archivo, solicita un token de carga para esa ruta exacta y lo envía directamente a un almacén **privado** de Vercel Blob. La ruta autenticada `complete` descarga el objeto privado y valida su contenido antes de marcarlo `ready`. No se configura un webhook público. No se crean almacenes ni se activan planes desde la aplicación.

Variables exclusivamente servidor: `DAYBOOK_BLOB_ENV=qa|production` y el token correspondiente `DAYBOOK_BLOB_QA_READ_WRITE_TOKEN` o `DAYBOOK_BLOB_PRODUCTION_READ_WRITE_TOKEN`. Solo `VERCEL_ENV=production` selecciona producción; local y preview exigen `qa`. No hay fallback a `BLOB_READ_WRITE_TOKEN`, OIDC ni emuladores. Cada entorno debe tener su propio almacén privado. La ausencia o discrepancia de configuración desactiva nuevas cargas y no altera los tickets.

## Contrato de la interfaz

- `POST /api/attachments/reserve`: `{draftId,kind,ticketId?,name,size,contentType}`. `draftId` UUID estable para ese miembro, ticket y audiencia. `kind=request` corresponde a un ticket nuevo sin `ticketId`; `reply|note` requieren ticket. Devuelve `{attachment,pathname,uploadUrl}`.
- `upload(pathname,file,{access:'private',contentType:attachment.contentType,handleUploadUrl:uploadUrl,clientPayload:JSON.stringify({attachmentId:attachment.id})})` desde `@vercel/blob/client`. El token dura como máximo cinco minutos, permite solo la ruta/MIME/tamaño reservados y prohíbe reemplazos y multipart.
- `POST /api/attachments/:id/complete` con `{}` valida y devuelve `{attachment}` listo. Reintentar la confirmación del mismo archivo es seguro. Un fallo de validación retira el archivo del borrador.
- `GET /api/attachments?draftId=...&kind=...&ticketId=...` devuelve `{attachments,configured}`. Solo devuelve pendientes propios vigentes del borrador exacto.
- `DELETE /api/attachments/:id` quita un archivo pendiente. Un archivo enviado no se puede eliminar.
- El envío del ticket/mensaje incluye `attachmentIds` y `draftId`. `linkReadyAttachments(tx,access,...)` debe ejecutarse en la misma transacción que el mensaje y sus avisos. El resultado de la operación idempotente se guarda en esa transacción.
- `GET /api/attachments/:id/download` autentica, revisa nuevamente el ticket y la visibilidad del mensaje y transmite el archivo con `Content-Disposition: attachment`, `nosniff` y `private, no-store`. No redirige a una URL Blob ni publica credenciales/rutas en el feed.

## Estados y límites

`reserved → uploaded → ready → attached`; los pendientes rechazados, retirados o vencidos pasan por `deleting → deleted`. Solo `ready` vigente puede vincularse, siempre con el mismo propietario, miembro, borrador y audiencia. Una nota interna nunca se convierte en adjunto público. Los adjuntos enviados se conservan con el historial.

Hasta cinco archivos de 10 MiB por mensaje; hasta diez archivos / 100 MiB pendientes por miembro, reservados mediante bloqueo transaccional. PNG/JPEG/WebP se decodifican (máximo 40 millones de píxeles y 100 cuadros); PDF se analiza; TXT/CSV requieren UTF-8; DOCX/XLSX requieren paquete OOXML, XML y CRC válidos, sin macros/ejecutables/entidades, hasta 1000 entradas y 50 MiB expandidos. Esto es validación de formato y límites, no un servicio antivirus ni una garantía de documentos libres de contenido malicioso.

Los pendientes dejan de poder vincularse a las 24 horas. La limpieza física es diferida, acotada y reintentable: actividad del propio usuario o `POST /api/attachments/cleanup` administrativo, sin cron. Espera un margen de seis minutos para no borrar durante la vigencia de tokens de carga ya emitidos. Un archivo retirado puede seguir contando temporalmente en la cuota hasta su limpieza. Un error del proveedor conserva el estado pendiente de limpieza y no borra adjuntos enviados. Se procesan como máximo veinte candidatos y no se inician más eliminaciones después de diez segundos.

Pruebas puras: `node --import tsx scripts/check-attachments.test.ts`. Pruebas transaccionales: `node --env-file=.env.test.local --import tsx scripts/check-attachments-db.mjs`, exclusivamente en la rama QA permitida y con almacenamiento inyectado sin llamadas Blob reales.
