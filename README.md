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

El portal del cliente y la bandeja del equipo consultan `/api/tickets/updates` cada cinco segundos mientras la pestaña está visible y conectada. Al volver a la pestaña o recuperar la conexión se comprueban los cambios de inmediato. Las respuestas nuevas conservan el ticket abierto y los borradores, y los fallos temporales se reintentan con una espera creciente hasta 30 segundos. El indicador muestra si la actualización está activa o reconectando.

Cada consulta vuelve a comprobar la sesión y los permisos. El endpoint solo devuelve tickets y mensajes autorizados, sin procesar correo ni cargar la configuración del espacio. No requiere un proveedor adicional de mensajería.

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

## Identidad y procedencia

El símbolo y favicon de Daybook se copiaron sin cambios desde `Domarchi/daybook-5`, `public/brand/asistencia/`, revisión `5c9c7d0e0cd62a7c60d0e911aec71a7038bcc73b`. La composición Daybook Ticket conserva esa identidad con carbón y dorado. El proyecto de referencia no se modificó.

`docs/ARCHITECTURE.md` documenta permisos y límites. `docs/REA-ANALYSIS.txt` conserva el análisis original de REA. El código fuente excluye datos, credenciales y enlaces de activación.

## Correo y límites

El envío requiere un remitente de dominio verificado y Resend configurado. No hay correo entrante, adjuntos, webhooks de entrega ni programador permanente de reintentos. La cola se procesa con actividad de la aplicación y por acción administrativa. La recuperación de contraseña depende del correo configurado.
