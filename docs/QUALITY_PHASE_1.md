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

## A3. Salud y registros

- `GET /api/health` (público, sin sesión): `{status, version}` sin tocar la base de datos. Con `?deep=1` consulta la base con tope de 3 s y el resultado se reutiliza 10 s, de modo que una URL pública no mantiene despierto a Neon ni multiplica consultas; responde 503 si no contesta. `version` es el SHA del despliegue (`VERCEL_GIT_COMMIT_SHA`). Un monitor externo (decisión pendiente del usuario) debería usar la variante simple cada minuto y la `deep` cada 5–10 min.
- `lib/log.ts`: líneas JSON (`level`, `event`, `at`, `requestId`). `handle()` ahora registra los 500 inesperados con `requestId`, nombre del error y código de Postgres, y devuelve ese mismo `requestId` en el cuerpo y en `X-Request-Id`, para poder buscar el fallo en los registros a partir de lo que ve la persona. Se descartan los mensajes que traen la consulta SQL y sus parámetros ("Failed query ... params"), que antes sí se registraban.
- Pendiente: mostrar el `requestId` en el aviso de error de la interfaz (toca `desk.tsx`, queda para Fase 3) y el watchdog del pinger en el panel de salud existente.

## A4. Dependencias y CI

- `.github/dependabot.yml`: npm y GitHub Actions, semanal, agrupado, máximo 5 y 3 PR abiertos; los mayores de `next`, `react` y `react-dom` quedan fuera (se revisan a mano).
- `ci.yml`: nuevo trabajo `audit` (`npm audit --omit=dev --audit-level=high`) **informativo**: si encuentra avisos emite una anotación de advertencia en lugar de un check rojo (hoy los hay, ver abajo). Cuando quede limpio se quita el `|| echo`.
- Hallazgo: `npm audit` de producción reporta `next` 16.3.4 como crítico (RCE en `next/og` `ImageResponse` y fuga de Draft Mode con `use cache`; corregido en 16.4.5, mismo menor). El código **no usa** `next/og`, `ImageResponse` ni `use cache`, así que no hay exposición hoy; aun así conviene subir a 16.4.5 en un PR propio con su Preview. También hay avisos altos en `zod` anidado dentro de `@vercel/blob` (la "corrección" propuesta por npm es bajar de versión; no se aplica) y en `source-map-js`.
- **Pruebas de base de datos en CI: no se hizo.** Todos los `check-*-database.mjs` salvo `check-backup-recovery-database.mjs` (que ya corre en el simulacro semanal y en cada PR) exigen por aserción el host de Neon de QA, y esas aserciones son la protección contra tocar producción. Hacerlas correr contra el Postgres 17 del CI implica un guardián común (`scripts/qa-guard`) que acepte "QA de Neon" o "Postgres desechable local en CI" y migrar cada script a él. Se propone para la ventana de E7, cuando se revisan esos scripts de todos modos.

## A5. Poda de dependencias

Se quitan `@hookform/resolvers` y `date-fns` (cero importaciones; `date-fns` sigue llegando como dependencia de `react-day-picker`). Los 61 archivos de `components/ui` y sus paquetes (`radix-ui`, `recharts`, `cmdk`, `vaul`, `sonner`...) **no los importa ningún archivo de la aplicación**; su destino se decidió en la Fase 3: se borraron con sus paquetes (ver `docs/QUALITY_PHASE_3.md`).

## A6. Límites de tasa por dominio

`lib/rate-limit.ts` aplica ventanas fijas por usuario y acción sobre la tabla `authRateLimit` que ya usa Better Auth (sin migración). Una comprobación es un único `INSERT ... ON CONFLICT` atómico; por eso solo se limitan acciones caras o abusables, **no** el sondeo del feed. Límites por minuto y usuario: búsqueda de tickets 120, creación de tickets 30, reserva de adjuntos 30, emisión de tokens de subida 90, informes mensuales 10. Superado el límite: 429 con un mensaje en español. Si el propio limitador falla (base de datos), la petición **continúa** (falla abierto) y se registra `rate_limit_unavailable`: un fallo del limitador no debe tumbar la búsqueda. El SQL se comprobó contra un Postgres 17 desechable (ventana, reinicio, aislamiento entre usuarios y acciones). Ninguna de las cinco rutas está tocada por E7. El `reauth` de Seguridad conserva su propio contador.

## B1. Tokens de diseño (aditivo)

`app/tokens.css` define tokens semánticos (`--color-bg|surface|text|text-muted|border|accent|accent-soft|focus|danger-*`, radios, espaciado, sombra, anillo de foco, objetivo táctil) con el modo oscuro **definido una sola vez**, y no renombra nada: `--ink`, `--paper`, `--blue`, `--lime` siguen funcionando (`--blue` y `--lime` son alias del dorado/marrón, pese al nombre). `scripts/design-tokens.test.ts` comprueba contraste WCAG AA en claro y oscuro para cada par texto/fondo, que el bloque `prefers-color-scheme` repite el oscuro explícito, que los tokens coinciden con la paleta heredada (sin deriva) y que todo token que usa `accessibility.css` existe. Hallazgo corregido: el texto del aviso de error en modo claro (#b46c60 sobre #fff0ed) estaba por debajo de 4,5:1; ahora usa `--color-danger-text` (#8f3f33). La migración de los ~410 colores fijos y la sustitución de las listas de selectores oscuros de `evolution-theme.css` por reglas que solo leen tokens queda para la Fase 3, con capturas antes/después.

## Cierre de la Fase 1 y lo que se aplaza a propósito

Hecho en esta rama: A1, A2, A3, A4 (Dependabot y auditoría), A5 (dependencias sin uso), A6, B1 (tokens aditivos) y B2. La actualización de `next` a 16.4.5 va en un PR aparte porque es un cambio de framework.

Se aplaza porque colisiona con E7 (lo verifica `git merge-tree` contra `codex/daybook-evolution-07`):

- **Textos y marca (B3):** la marca fija "Servicios Daybook" (`desk.tsx`, pie y metadatos del acceso) y el relleno de marketing. `desk.tsx` tiene cambios de E7 en esas mismas líneas y E7 introduce espacios con marca propia; se hace sobre la base E7 (Fase 3), donde además se decide el nombre de marca por espacio.
- **Estado de publicación en los documentos:** `docs/EVOLUTION_PLAN.md` en `main` aún lista las entregas 1–6 como "en desarrollo"; la rama E7 ya reescribe esa tabla y añade `EVOLUTION_REVIEW.md`, cuya frase "El código no se ha fusionado ni publicado en producción" ya no es cierta (E1–E6 están en producción, migraciones 0006–0012 aplicadas, flags apagados). Editar la tabla aquí produciría conflictos; se corrige al integrar `main` en E7 (Fase 2), con el estado real: E1–E6 publicadas, E7 pendiente, 0013 sin aplicar.
- **Pruebas de base de datos en CI:** requieren una guarda común (ver A4); se hacen con los scripts de E7.

## Verificación

`npm run check`: lint, 395 pruebas unitarias (21 nuevas), tipos y build correctos. Cabeceras comprobadas con `next start` en una respuesta HTML, una de API y el service worker; `/api/health` comprobado en vivo (la variante `deep` responde 503 sin base de datos). Una fusión simulada con `codex/daybook-evolution-07` no produce conflictos. Pendiente: Preview protegida y revisión manual en navegador (escritorio y 375 px) antes de pedir publicación.

## Conflicto conocido con E7

Una fusión simulada con `codex/daybook-evolution-07` (`git merge-tree`) tiene **un solo conflicto, trivial**, en `handle()` de `lib/server.ts`: E7 inserta dos líneas (`workspace_quota_exceeded`, `workspace_paused`) justo antes del bloque de 500 que aquí se reemplaza por el registro estructurado. Al integrar `main` en E7 (Fase 2) se conservan las dos líneas de E7 y a continuación el bloque `requestId`. `auth()` y `package.json` se fusionan solos. No se evitó reescribiendo el cambio porque la alternativa dejaba el registro con mensajes que pueden incluir SQL.

## Reversión

Todo es aditivo y sin migraciones: revertir el commit restaura el comportamiento anterior sin tocar datos, sesiones ni permisos.
