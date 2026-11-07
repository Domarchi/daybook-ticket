# Fase 1 de calidad (7 nov 2026)

Cambios locales sobre `main` (`b77d314`), preparados para revisión. No se han publicado ni requieren migración. Plan completo: ingeniería y UX en dos carriles; E7 queda para una segunda ventana.

## A1. Sondeo adaptativo (`lib/poll-schedule.ts`, `hooks/use-workspace.ts`)

Antes, cada pestaña consultaba `/api/tickets/updates` cada 5 s (15 s oculta), sin límite. Mientras haya una pestaña abierta, Neon Free no se suspende; una pestaña olvidada lo mantiene despierto indefinidamente.

| Situación | Intervalo |
| --- | --- |
| Visible y con actividad en los últimos 2 min | 5 s (sin cambio: el chat abierto depende de esto) |
| Visible, sin actividad 2–10 min | 15 s |
| Visible, sin actividad más de 10 min | 30 s (nunca se detiene: una pantalla de pared debe seguir mostrando tickets) |
| Oculta | 30 s; **se detiene tras 60 min oculta** y se reanuda al mostrarla |

Los fallos duplican el intervalo hasta 3 veces (tope 120 s). Cualquier clic, tecla, toque o scroll tras un periodo inactivo adelanta la siguiente lectura. Las constantes están en `lib/poll-schedule.ts`.

Compromiso: una pestaña oculta más de una hora deja de actualizar alertas dentro de la app hasta que se vuelva a mostrar. Las notificaciones push no dependen de esto.

Pendiente de Fase 3: una versión ligera del feed (contador por propietario mantenido por triggers) para evitar las ~10 consultas por lectura. No se hizo aquí porque requiere migración y la lista de mutaciones que alteran el feed es amplia.

## A2. Cabeceras de seguridad y origen de mutaciones

- `next.config.ts`: `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security` (1 año, sin `includeSubDomains`), `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` y una CSP **solo con directivas que no afectan a los scripts** (`frame-ancestors 'self'`, `base-uri`, `object-src`, `form-action`). `'self'` porque las vistas previas de adjuntos se incrustan en la propia app. Una CSP de scripts exige nonces por petición (`proxy.ts`) y se introducirá aparte, primero en modo solo-informe.
- `lib/request-origin.ts` / `lib/server.ts`: una mutación con `Origin` distinto se rechaza (como antes). Sin `Origin`, un navegador que declara `Sec-Fetch-Site: cross-site|same-site` también se rechaza. Los clientes sin esas cabeceras (scripts, validadores HTTP de QA) siguen funcionando.
- `scripts/api-route-guards.test.ts`: recorre `app/api/**/route.ts` y falla si una ruta nueva no autentica al llamante ni figura como excepción documentada (auth, webhooks firmados, ticks con secreto, `setup`).

## B2. Accesibilidad puntual

- Modal (`Modal` en `app/desk.tsx`): `aria-labelledby` al título, bloqueo del scroll de la página y devolución del foco al elemento que lo abrió.
- Navegación principal: `aria-current="page"`. Pestañas de cola: `aria-pressed`.
- Tabla de tickets: la columna de acciones tiene encabezado accesible y el chevron deja de ser una segunda parada de tabulador (el asunto ya abre el ticket).
- `app/accessibility.css` (aditivo): foco visible en el buscador y el editor de respuesta; objetivos táctiles de 44 px con puntero grueso.
- Atajo de búsqueda: muestra `⌘ K` en Apple y `Ctrl K` en el resto.

Fuera de esta entrega (Fase 3, tocan líneas que E7 modifica): `aria-current` de la barra inferior (Seguridad, Configuración, Centro de ayuda), marca fija "Servicios Daybook", relleno de marketing, cajón móvil con trampa de foco, contraste de botones deshabilitados.

## Verificación

`npm run check`: lint, 388 pruebas unitarias (14 nuevas), tipos y build correctos. Cabeceras comprobadas con `next start` en una respuesta HTML, una de API y el service worker. Una fusión simulada con `codex/daybook-evolution-07` no produce conflictos. Pendiente: Preview protegida y revisión manual en navegador (escritorio y 375 px) antes de pedir publicación.

## Reversión

Todo es aditivo y sin migraciones: revertir el commit restaura el comportamiento anterior sin tocar datos, sesiones ni permisos.
