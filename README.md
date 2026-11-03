# Daybook Ticket

Centro de soporte de Servicios Daybook: acceso por correo y contraseña, invitaciones, roles y portal de clientes. Esta versión usa Next.js en Vercel y PostgreSQL en un proyecto Neon exclusivo. No comparte datos ni despliegues con Consorcio C17 u otros Daybook.

## Desarrollo

Requiere Node.js 24. Ejecutar `npm ci` y copiar `.env.example` a `.env.local` con una base independiente de desarrollo. La aplicación usa conexión pooled; las migraciones usan conexión directa.

```sh
node --env-file=.env.local scripts/migrate.mjs
npm run dev
```

La aplicación local escucha en `http://127.0.0.1:5173`. `drizzle-postgres/` contiene las migraciones PostgreSQL; `npm run db:generate` genera cambios desde el esquema Drizzle.

## Primer propietario

Un operador con acceso privado a la base prepara la invitación:

```sh
node --env-file=.env.local scripts/provision-owner.mjs --output /ruta/privada/owner-activation.json
```

El archivo tiene permisos privados y contiene un enlace de 72 horas. Entregarlo exclusivamente al propietario de `DAYBOOK_OWNER_EMAIL`. El propietario abre el enlace y crea personalmente su contraseña. Este comando no reemplaza cuentas propietarias ya activadas.

Después, el acceso es `/login`. `/setup` explica la activación; `/api/setup` rechaza todas las activaciones públicas. No se confía en cabeceras de ChatGPT ni existe registro libre.

## Conversaciones automáticas

El portal del cliente y la bandeja del equipo consultan `/api/tickets/updates` cada cinco segundos mientras la pestaña está visible y conectada, y cada quince segundos en segundo plano. El navegador puede limitar la frecuencia de pestañas en segundo plano. Al volver a la pestaña o recuperar la conexión se comprueban los cambios de inmediato. Las respuestas nuevas conservan el ticket abierto y los borradores, y los fallos temporales se reintentan con una espera creciente hasta 60 segundos. El indicador muestra si la actualización está activa o reconectando.

Cada consulta vuelve a comprobar la sesión y los permisos. El endpoint solo devuelve tickets, mensajes y avisos autorizados, sin procesar correo ni cargar la configuración del espacio. No requiere un proveedor adicional de mensajería.

La campana muestra los avisos recientes para cada destinatario. Los avisos reutilizan los eventos guardados con cada ticket/respuesta, sin depender de que el correo esté configurado. No se anuncian el historial inicial, mensajes propios ni notas internas. Un aviso nuevo muestra una tarjeta y un contador en la pestaña. Abrir el ticket desde un aviso crea otra pestaña para conservar los borradores.

«Activar sonido» permite un tono local breve; «Silenciar» conserva los avisos visuales. La preferencia se guarda por cuenta en este navegador. Tras recargar, el navegador puede exigir un nuevo clic para habilitar audio.

## Avisos con la página cerrada

En un navegador compatible, «Activar avisos con la página cerrada» solicita permiso y vincula ese navegador a la cuenta actual. «Probar aviso» envía una notificación al mismo dispositivo; «Desactivar» elimina su suscripción. La activación es independiente para cada navegador. Se puede cerrar la pestaña, pero hay que mantener la sesión iniciada y permitir las notificaciones del navegador en el sistema operativo. Cerrar sesión desactiva los avisos de ese navegador. El apagado del computador, el cierre forzado del navegador, la suspensión y el modo No molestar pueden impedir o retrasar su llegada. El sonido de los avisos del sistema depende de sus ajustes.

El servidor guarda cada entrega junto con el ticket o respuesta en la misma transacción y la envía mediante Web Push después de responder a la solicitud. Solo incluye eventos futuros para destinatarios autorizados; no envía mensajes propios, notas internas ni historial. Los endpoints y claves de suscripción se guardan exclusivamente en PostgreSQL. El service worker vuelve a comprobar la sesión y el acceso al ticket antes de mostrar un aviso genérico sin el contenido de la conversación. No almacena páginas ni datos privados para uso sin conexión.

«Probar en este equipo» solicita una notificación local, sin pasar por el proveedor push, para comprobar los permisos del navegador y del sistema. «Probar aviso» comprueba el envío remoto. Los registros de Vercel distinguen la validación del aviso (`push receipt`) del resultado de la API de notificaciones (`push display`), sin guardar claves, direcciones de suscripción ni contenido. Un resultado `shown` significa que el navegador aceptó mostrarlo; el sistema aún puede ocultar el banner mediante No molestar u otros ajustes.

Configurar un par VAPID distinto por entorno. `VAPID_PRIVATE_KEY` es un secreto del servidor; `VAPID_PUBLIC_KEY` se entrega al navegador autenticado. `VAPID_SUBJECT` es el origen HTTPS del servicio. El proveedor del navegador puede conservar avisos hasta 24 horas. Se realizan reintentos breves ante fallos temporales y se desactivan suscripciones vencidas; no hay un programador permanente que garantice reintentos tras caídas del servidor. La entrega aceptada por el proveedor no confirma que el usuario haya visto el aviso.

## Vercel

Usar exclusivamente el proyecto `daybook-ticket`, Node.js 24, framework Next.js, instalación `npm ci` y compilación `npm run build`. Región `iad1`, próxima a la base Neon.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión pooled PostgreSQL; secreto |
| `BETTER_AUTH_SECRET` | Secreto aleatorio de autenticación de al menos 32 bytes |
| `DAYBOOK_SITE_URL` | Origen HTTPS canónico del producto |
| `DAYBOOK_OWNER_EMAIL` | Correo reservado al propietario |
| `RESEND_API_KEY` | Opcional, proveedor de correo |
| `DAYBOOK_EMAIL_FROM` | Opcional, remitente de un dominio verificado |
| `VAPID_PUBLIC_KEY` | Clave pública de Web Push |
| `VAPID_PRIVATE_KEY` | Clave privada de Web Push; secreto |
| `VAPID_SUBJECT` | Origen HTTPS de contacto para Web Push |

`DIRECT_DATABASE_URL` se conserva en el entorno privado del operador para migraciones. No es necesaria en Vercel. Aplicar migraciones y pruebas antes de publicar. Las previews deben usar una rama de datos y un secreto de autenticación separados.

## Pruebas

Usar una rama Neon exclusiva de QA. `.env.test.local` requiere las conexiones, secreto de autenticación, URL local, `DAYBOOK_OWNER_EMAIL` y `DAYBOOK_QA_OWNER_EMAIL` con un correo `@example.test`, `DAYBOOK_QA_ALLOW_TEST_DATABASE=1` y `DAYBOOK_QA_DATABASE_HOST` igual al host de la conexión. Resend debe permanecer desconfigurado.

```sh
node --env-file=.env.test.local scripts/migrate.mjs
node --env-file=.env.test.local --import tsx scripts/check-database.mjs
node --env-file=.env.test.local node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 5173
# En otra terminal:
node --env-file=.env.test.local --import tsx scripts/check-access.mjs http://127.0.0.1:5173
npm run build
```

Se comprueban sesiones, invitaciones, permisos, aislamiento de clientes, notas internas, artículos, reapertura con SLA, revocación, límites de autenticación y transacciones.

Con el servidor local apuntando a la rama QA existente, `node --env-file=.env.test.local scripts/check-ticket-updates.mjs` prueba el endpoint de actualización, ambos sentidos de la conversación, aislamiento, notas internas y revocación. Guarda sesiones ficticias privadas en `work/ticket-updates-qa.json` para verificar en el navegador la llegada de mensajes mientras se conserva un borrador. Nunca ejecutarlo contra producción.

`node --import tsx scripts/check-alert-tracker.test.ts` comprueba que los avisos iniciales permanecen silenciosos, que cada evento se anuncia una sola vez y que cambiar de cuenta o rol no mezcla historiales.

`node --import tsx scripts/check-web-push.test.ts` y `node --test scripts/check-web-push-worker.test.mjs` verifican los destinos permitidos, las claves y el comportamiento del service worker sin conexiones externas. Con el servidor QA activo, `node --env-file=.env.test.local --import tsx scripts/check-web-push-api.mjs` prueba permisos, cambios de cuenta, revocación, cola transaccional, reintentos y suscripciones vencidas; usa un transporte de prueba y nunca envía a un proveedor real.

## Identidad y procedencia

El símbolo y favicon de Daybook se copiaron sin cambios desde `Domarchi/daybook-5`, `public/brand/asistencia/`, revisión `5c9c7d0e0cd62a7c60d0e911aec71a7038bcc73b`. La composición Daybook Ticket conserva esa identidad con carbón y dorado. El proyecto de referencia no se modificó.

`docs/ARCHITECTURE.md` documenta permisos y límites. `docs/REA-ANALYSIS.txt` conserva el análisis original de REA. El código fuente excluye datos, credenciales y enlaces de activación.

## Correo y límites

El envío requiere un remitente de dominio verificado y Resend configurado. No hay correo entrante, adjuntos, webhooks de entrega ni programador permanente de reintentos. La cola se procesa con actividad de la aplicación y por acción administrativa. La recuperación de contraseña depende del correo configurado.
