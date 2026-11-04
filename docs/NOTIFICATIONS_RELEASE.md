# Avisos, seguimiento y recordatorios — entrega revisable

## Resultado

Rama `codex/daybook-ticket-notifications`, desde la versión publicada `4ea801696f073c4a17bd31278700f9a5a6c598d3`. Solo Daybook Ticket. No se modificaron producción, DNS, Consorcio C17 ni otros productos.

- Avisos persistentes por destinatario, contador completo, lectura entre dispositivos, filtros y paginación. El historial previo conserva lectura desconocida.
- Correo HTML/texto con logo existente por CID, asunto escapado y metadatos; sin conversaciones, notas ni archivos. Payloads antiguos y reintentos congelados se conservan.
- Webhook Svix sobre bytes originales, firmas y fechas verificadas, recibos mínimos, deduplicación, proyección estable y conciliación de eventos anticipados.
- Historial por ticket exclusivo del equipo; administración de salud y recordatorios reservada a propietario/administradores.
- Recordatorios de dos horas sin respuesta, una hora antes del vencimiento y vencidos; cada etapa, motivos agrupados y repetición móvil cada 24 horas por destinatario. Asignación activa o responsables configurados; revalidación antes de entregar.
- Worker autenticado antes de importar la base, con lease, cursor, presupuesto y recuperación. Pinger Neon aislado por entorno; cadencia prevista cada 30 minutos.

## Evidencia de validación (4 de noviembre de 2026)

| Comprobación | Resultado |
| --- | --- |
| Migración `0003` en QA | PASS: 21 tablas y 428 filas preexistentes idénticas, comparando sus columnas originales mediante SHA-256; recordatorios inicialmente desactivados |
| Unitarias sin base/proveedores | 71 PASS; se mantienen las pruebas anteriores |
| `check-alerts-db.mjs` | PASS: 65 avisos, contador completo, paginación, persistencia, destinatarios/empresas, revocación y carrera MVCC real en marcar todos |
| `check-mail-delivery.mjs` | PASS: 12 escenarios, cuatro solicitudes a transporte simulado y cero envíos externos; eventos anticipados v1/v2, reintento idéntico, deduplicación, aislamiento e historial estable |
| `check-reminders-database.mjs` | PASS: etapas, reloj público, notas, reasignación, revocación, rollback, pausa/reactivación; worker real con lease concurrente, cursor, fallo, recuperación y diez días sin tormenta de avisos |
| `check-notifications-http.mjs` | PASS: sesiones reales ficticias → ticket cliente → respuesta agente → portal; nota privada oculta; lectura persistente, intención de cuenta, seguimiento de equipo, webhook firmado duplicado y salud del worker |
| `check-access.mjs` | PASS: regresión de invitaciones, sesiones, roles, aislamiento, notas internas, reapertura/SLA, revocación, concurrencia y límites de autenticación |
| `check-pinger-edge.mjs` | PASS contra host nativo Neon QA: rechazo tanto anónimo como con ID de trigger real y encabezado reservado falsificado |
| Bundle pinger | ZIP reproducible, importación default.fetch válida, Node 24, sin nuevas dependencias ni modificaciones de node_modules compartido |

Las integraciones que mutan QA se ejecutan en serie, con cuentas `@example.test`, sin Resend real ni push real. Sus fixtures se eliminan. La prueba de correos reales de Joaquín/Mario no forma parte de esta ejecución.

La revisión visual local incluye correo y nuevos controles en computador y móvil. Las seis plantillas pueden regenerarse con `npm run preview:mail`; los archivos de revisión están en `outputs/mail-preview`, ignorados por Git. El envío conserva CID; únicamente la vista local sustituye la imagen por una data URL. Los clientes de correo pueden transformar colores y espaciados; no se promete equivalencia visual exacta entre Gmail y Outlook.

## Entornos

- Base QA: rama `br-wandering-breeze-bb9ow8vn`, proyecto Neon `purple-silence-58888058`. Producción no se usó para probar.
- Preview de Vercel: proyecto `daybook-ticket`, rama específica `codex/daybook-ticket-notifications`, secretos privados QA; sin RESEND_API_KEY ni VAPID_PRIVATE_KEY de producción.
- Pinger QA: `dkticketnotifyqa`, en la misma rama QA; trigger `trigger-045608e9-b929-45bf-aeb2-515d6dc79831`, cron `*/30 * * * *`, detenido al terminar.
- Remitente productivo previsto: `Daybook Ticket <tickets@consorcioc17.cl>`, conservando el existente y sin cambios DNS.

La conexión de Vercel permite crear Preview y variables privadas, pero rechazó crear un secreto de acceso de automatización con 403 `projectProtectionBypass`. El CLI disponible no tenía sesión; se canceló su inicio de sesión. No se desactivó Vercel Authentication ni se creó un enlace público de bypass. La conexión nativa completa Neon → Preview protegido requiere ese acceso privado; el worker completo se comprobó por HTTP en QA local y la procedencia del proxy se comprobó en Neon.

## Publicación posterior, conservando datos

1. Revisar PR, CI y Preview. Comprobar cuota Neon disponible antes de activar el programador; no aumentar planes automáticamente. Revisar el punto de recuperación disponible y registrar huellas de las columnas originales de usuarios, cuentas, sesiones, empresas, tickets, mensajes y archivos.
2. Aplicar únicamente la migración aditiva `0003` mediante conexión directa privada de producción. No importar QA, ejecutar seeds ni provisionar usuarios. Comparar los datos originales antes/después; los nuevos campos y tablas no sustituyen historia.
3. Configurar por separado `DAYBOOK_NOTIFICATION_ENVIRONMENT=production`, el nuevo `RESEND_WEBHOOK_SECRET` productivo y el secreto del worker. Registrar en Resend el endpoint productivo con los eventos documentados; no activar aperturas/clics. Mantener inicialmente el worker/trigger y los recordatorios desactivados.
4. Preparar y comprobar un build de producción sin asignar dominios; promover el build revisado. Verificar ingreso y lectura de tickets con cuentas existentes, sin generar mensajes o correos de prueba automáticamente.
5. Provisionar pinger y trigger de producción con identidad y secreto propios. Completar la prueba nativa, habilitar el tick de 30 minutos y activar recordatorios desde Configuración como último paso. El corte de activación evita recuperar todo el historial. La prueba real con Joaquín/Mario debe ser coordinada y explícita.

## Reversión

Detener el trigger y deshabilitar el worker/recordatorios. Antes de regresar a un build anterior a esta entrega, cancelar los recordatorios outbox todavía pendientes y esperar a que terminen o expiren los leases en vuelo: el sender antiguo no conoce la revalidación de recordatorios. Conservar esas filas canceladas y su historial. No eliminar columnas/tablas ni revertir migraciones mediante DROP; el esquema es aditivo. No reiniciar estados de correos aceptados ni reutilizar claves de idempotencia con otro contenido.

Ver [programador y seguridad](NOTIFICATIONS_SCHEDULER.md) para el contrato de procedencia Neon, secretos por ambiente, límites y cadencia.
