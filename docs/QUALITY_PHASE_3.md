# Fase 3 de calidad: base de código y navegación (9–10 nov 2026)

Se construye sobre `main` con E7 ya publicada (`b0ecfb1`). Cada entrega es un PR pequeño y reversible; no hay migraciones.

## C2. `app/desk.tsx` partido en módulos

`app/desk.tsx` pasó de 61 KB a unos 12 KB y conserva solo el armazón: estado, carga de datos y manejadores. Lo demás vive en `app/desk-parts/`:

| Archivo | Contenido |
| --- | --- |
| `shared.tsx` | constantes de estado y prioridad, formato de fechas y plazos, `Avatar`, `Status`, `Priority`, `Modal`, `Empty`, `Stat`, `PageTitle` y `request` |
| `sidebar.tsx` | menú lateral |
| `inbox-view.tsx` | bandeja, filtros, tabla, selección y resumen |
| `ticket-view.tsx` | detalle del ticket |
| `section-view.tsx` | las demás secciones (seguridad, empresas, conocimiento, equipo, ajustes, ayuda…) |
| `staff-composer.tsx`, `ticket-form.tsx`, `settings-form.tsx`, `overview.tsx` | formularios y resumen que ya eran componentes aparte |

Es un movimiento mecánico: el JSX se trasladó sin cambios y recibe por propiedades lo que antes leía del cierre. El tamaño de los chunks generados no cambia y las pruebas siguen igual.

## C1. Vista y ticket en la URL

La vista y el ticket abierto dejan de ser estado interno y salen de la URL (`lib/desk-url.ts`):

| URL | Pantalla |
| --- | --- |
| `/` | bandeja |
| `/?view=overview` (y `contacts`, `knowledge`, `team`, `settings`, `portal`, `operations`, `metrics`, `service`, `reports`, `security`) | esa vista |
| `/?ticket=12` | el ticket 12 |
| `/?view=service&company=<uuid>` | una empresa en «Empresas y servicios» |

En un espacio de negocio la ruta es la misma bajo `/w/<id>`. `?serviceContext=1` sigue funcionando.

- **Atrás y Adelante** recorren las pantallas visitadas; recargar conserva dónde estabas; el enlace se puede compartir o abrir en otra pestaña.
- Se usa `window.history.pushState`, que Next sincroniza con `useSearchParams`: no hay ida y vuelta al servidor ni consultas nuevas.
- «Volver a la bandeja» vuelve atrás si el ticket se abrió desde la lista; si se abrió con un enlace directo, muestra la bandeja en el mismo sitio y no saca a la persona de la aplicación.
- Las rutas de retorno tras iniciar sesión aceptan `view` solo con valores conocidos (`lib/return-path.ts`); el resto sigue rechazándose.
- Ctrl/⌘ K ahora también cierra el ticket abierto para llevar al buscador.
- No cambia el estado de filtros ni de búsqueda (siguen en el navegador).

### No incluido
Los elementos del menú y las filas siguen siendo botones, no enlaces: no se puede abrir una vista en una pestaña nueva con clic central. Se hará junto con la bandeja móvil (C3), que toca esos mismos elementos.

## C3. Bandeja móvil y enlaces reales

- **Tarjetas bajo 750 px** (`app/desk-parts/ticket-cards.tsx`, `app/mobile-inbox.css`): en pantallas estrechas la bandeja deja de ser una tabla con scroll horizontal y muestra una tarjeta por ticket: número, estado y prioridad con texto, asunto (hasta 3 líneas), solicitante y departamento, responsable, «Actualizado hace…» y plazo (vencido en rojo). Casilla de 44 px, «Seleccionar tickets de esta vista» y las mismas acciones masivas. De 751 px en adelante sigue la tabla. Usa los tokens de diseño: el modo oscuro sale de sus valores, sin lista de selectores.
- **Asunto como enlace** (`DeskLink` en `app/desk-parts/shared.tsx`): el asunto de cada fila y de cada tarjeta es un `<a href="?ticket=N">`. Un clic normal abre el ticket en el sitio; clic central, Ctrl/⌘+clic o «abrir en pestaña nueva» usan el navegador y funcionan gracias a la URL de C1.
- **Menú móvil como cajón accesible** (`app/desk-parts/sidebar.tsx`): al abrirse toma el foco, mantiene Tab dentro, se cierra con Escape, bloquea el scroll de la página, inhabilita el contenido de detrás (`inert`) y devuelve el foco al botón que lo abrió; se anuncia como diálogo modal. Si la ventana deja de ser estrecha mientras está abierto, se cierra y no reaparece al volver a encogerla.

### No incluido
Los botones del menú lateral siguen siendo botones, no enlaces. Convertirlos exige duplicar unas once reglas de `globals.css` y repasar su aspecto en claro y oscuro en escritorio; se hará aparte, si interesa abrir vistas en pestaña nueva.

## C4. Cambios instantáneos, con deshacer

Estado, prioridad, departamento y cuenta del cliente de un ticket se aplican en pantalla al elegirlos; el servidor confirma o el cambio se retira. Antes cada cambio bloqueaba toda la aplicación (`busy`), esperaba la respuesta y la recarga completa, y mostraba «Guardando…» por encima de todo.

- **Lógica** (`lib/ticket-overlay.ts`): cada cambio recibe un número de secuencia por campo, de modo que una respuesta tardía de un cambio anterior no puede deshacer ni confirmar uno posterior; el último ticket devuelto por el servidor se conserva hasta que la recarga normal trae una versión igual o mayor, así la pantalla no vuelve un instante al valor antiguo y el siguiente cambio que necesita `expectedVersion` (asignación) manda la versión correcta. Solo se adoptan campos conocidos de la fila devuelta.
- **Estado por campo**: solo el control que se está guardando queda inhabilitado (`aria-busy`); el resto del ticket y la navegación siguen utilizables.
- **Si falla**: el valor vuelve al anterior y aparece el aviso de error; si la respuesta se perdió, se recarga lo que tiene el servidor.
- **Deshacer**: el aviso de confirmación (10 s) incluye «Deshacer», que repite el cambio con los valores anteriores. No se ofrece al resolver un ticket ni al reabrir uno resuelto: resolver crea una solicitud de satisfacción que no se puede retirar, y volver a resolver la repetiría.
- **Asignación** (`AssignmentControls`): conserva su confirmación explícita («Confirmar asignación», «Tomar ticket»); ahora solo espera ese bloque, informa de sus errores en el propio bloque, y entrega al resto de la pantalla el ticket devuelto (con su versión). Sin deshacer: ya exige confirmar y puede avisar a la persona asignada.
- **Resolver selección** (acción masiva): se resuelven los tickets por separado y se informa el resultado por ticket («Se resolvieron 3 de 5. No se pudieron resolver: #0012, #0014»); los que fallaron quedan seleccionados para reintentar. Antes un fallo cortaba el aviso sin decir cuáles se habían resuelto.

### No incluido
Nuevas acciones masivas (asignar, prioridad) y deshacer para acciones masivas.

## C5. Combobox con búsqueda

Cliente, responsable y empresa se elegían en una lista desplegable nativa que obliga a recorrerla entera. Ahora son un combobox con búsqueda (`app/combobox.tsx`, `lib/combobox.ts`, `app/combobox.css`):

- **Dónde**: «Cuenta del cliente», «Responsable» y «Empresa del ticket» en el detalle del ticket, y los filtros de empresa y agente de la bandeja (versión compacta). Estado, prioridad y departamento siguen siendo listas nativas: son pocas opciones.
- **Búsqueda**: se escribe para filtrar, sin distinguir mayúsculas ni acentos («joaquin» encuentra «Joaquín»), por nombre **o** por el texto de apoyo (el correo); deben coincidir todas las palabras y los nombres que empiezan por lo escrito salen primero. Las opciones deshabilitadas (p. ej. «· sin acceso activo») se muestran, pero no se pueden elegir.
- **Teclado y lector de pantalla**: patrón ARIA 1.2 de «combobox editable con lista» (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role="listbox"`/`option`). Flechas mueven (saltan las deshabilitadas y dan la vuelta), Inicio/Fin, Enter elige, Escape cierra sin cambiar, Tab cierra. Anuncia «N resultados» / «Sin resultados». Objetivos de 44 px.
- **La lista se dibuja sobre la página** (portal), no dentro del panel: los paneles recortan su contenido y la lista se cortaba. Se coloca bajo el campo, o encima si abajo no hay sitio.
- **Aspecto**: solo tokens de diseño (modo oscuro automático). Nuevo token `--color-border-strong` para el borde de los controles, con contraste de 3:1 como mínimo (WCAG 1.4.11) comprobado por `scripts/design-tokens.test.ts`; el borde nativo anterior (#b5b9b3) no llegaba a 2:1.

### No incluido
- **Formulario «Nuevo ticket»**: sus listas de cuenta y responsable se mantienen nativas. El borrador (`lib/new-ticket-draft.ts`) lee los valores del formulario y su reintento compara cargas con reglas delicadas (`__auto__`, recibos inciertos); cambiar esos controles exige reescribir esa lógica con pruebas propias y no se mezcla con este cambio.
- **`components/ui` (61 archivos de shadcn, sin importar desde la app)**: no se adopta el `combobox` que traen porque depende de `@base-ui/react` y de variables de tema (`text-muted-foreground`…) que esta aplicación no define. Su borrado, con los paquetes que solo ellos usan, va en un PR aparte.

## C6. Configuración por secciones y barra de avisos más corta

- **Subnavegación** (`app/desk-parts/settings-view.tsx`, `lib/settings-sections.ts`, `app/settings-nav.css`): Configuración dejaba nueve paneles apilados en una página larguísima. Ahora muestra una sección cada vez: **General** (marca, departamentos, responsables de avisos), **Correo y avisos**, **Organización** (si esa función está activa), **Copias de seguridad** (si la plataforma las permite), **Funciones** y **Negocio** (solo en espacios de negocio). La sección va en la URL (`/?view=settings&section=mail`; General es `/?view=settings`), así que Atrás, recargar y los enlaces compartidos funcionan, y cada pestaña es un enlace real (clic central, nueva pestaña). Un enlace a una sección que ese espacio no tiene abre General. En móvil las secciones se desplazan en horizontal.
- **Retorno tras iniciar sesión**: `lib/return-path.ts` acepta `section` solo con `view=settings` y un nombre conocido que no sea General.
- **Lenguaje**: el título «Hazlo tuyo» pasa a «Configuración» y el panel de funciones deja de hablar de «entregas» («Activa o pausa partes de Daybook en este espacio. Pausar una función conserva sus datos…»); el aviso de base de datos pendiente se explica sin jerga.
- **Barra de avisos** (`app/push-menu.tsx`): con los avisos de escritorio activos la barra mostraba cuatro controles seguidos («Avisos en este equipo», «Probar aviso», «Probar en este equipo», «Desactivar»), que en móvil se apilaban. Ahora es un solo botón «Avisos en este equipo» que abre un panel con esas tres acciones y su explicación; Escape o un clic fuera lo cierran y el foco vuelve al botón. El sonido y la campana siguen a la vista, el botón de sonido conserva su marca `data-sound-toggle` (la usa el desbloqueo del audio) y el resultado de una prueba sigue visible con el panel cerrado. Los demás estados (activar, bloqueado, error, no disponible) no cambian.

### No incluido
La barra de apariencia/estado/avisos no se reorganiza más allá de eso, y las vistas Equipo, Atención y Métricas siguen con sus paneles apilados.

## Limpieza de `components/ui`

Se borran los 61 archivos de `components/ui` (kit de shadcn que ninguna pantalla importaba, comprobado con `grep` y con `typecheck` y `build`), sus archivos de apoyo (`components.json`, `lib/utils.ts` con `cn`, `hooks/use-mobile.ts`) y la excepción de ESLint que existía para ellos. Con ellos salen 16 paquetes de producción que solo usaban esos archivos —`@base-ui/react`, `@shadcn/react`, `class-variance-authority`, `clsx`, `cmdk`, `embla-carousel-react`, `input-otp`, `next-themes`, `radix-ui`, `react-day-picker`, `react-hook-form`, `react-resizable-panels`, `recharts`, `sonner`, `tailwind-merge`, `vaul`— y `tw-animate-css` de desarrollo. Se conservan `tailwindcss` y `@tailwindcss/postcss` porque `app/globals.css` los importa (el reinicio de estilos y la clase `sr-only` salen de ahí).

- Paquetes instalados: 782 → 615 en el lock; `node_modules` pasa de 755 MB a 642 MB y de 415 a 366 entradas.
- El lock no cambia la versión de ningún paquete que se conserva.
- Los chunks que genera la compilación no cambian de tamaño: ese código no se empaquetaba.
- `npm audit --omit=dev` sigue con los mismos 10 avisos (5 moderados, 5 altos): ninguno venía de lo borrado (`zod` anidado en `@vercel/blob`, `source-map-js`, `drizzle-kit`/`esbuild`).
- Si algún día hace falta un componente de ese estilo, se puede volver a añadir con `shadcn add` o recuperar de este historial (`git show eab91f4:components/ui/<archivo>`).

## C7. Formato único con Prettier y avisos de tamaño

- **Prettier** (`.prettierrc.json`: ancho 120, comillas simples, comas finales, flechas sin paréntesis para un solo argumento): se aplica a todo el código TypeScript, JavaScript, JSON y YAML. Se excluyen lo generado o ajeno (`node_modules`, `.next`, `public`, `outputs`, `work`), las migraciones SQL y el diario de Drizzle (`drizzle-postgres`, cuyos hashes están fijados en los operadores de migración), la prosa (`*.md`) y, de momento, el CSS heredado (32 archivos de reglas en una línea que se reformatearán en otra pasada, con capturas).
- **Cómo se comprobó que no cambia el comportamiento**: se compiló el árbol sin formatear y el formateado en el mismo directorio y se compararon los archivos que genera la compilación (llevan el hash de su contenido). 22 de 25 son idénticos byte a byte; los 3 restantes difieren solo en cómo se escribe un espacio de texto JSX («`Última pasada correcta: {x}`» pasa a «`Última pasada correcta:{' '}{x}`»), que se dibuja igual. El archivo ZIP del programador de avisos de Neon (`npm run build:notification-pinger`) tiene el **mismo SHA-256** antes y después. Las 484 pruebas pasan; solo hubo que hacer robusta a espacios una prueba que leía código fuente con una expresión regular.
- **Que no se desvíe**: `npm run format` aplica el formato, `npm run format:check` lo comprueba, y ambos forman parte de `npm run check` y de CI (paso «Check formatting»). `.git-blame-ignore-revs` lista el commit de formato para que `git blame` y GitHub lo salten.
- **Avisos de tamaño** (`eslint.config.mjs`): `max-lines` (800 líneas sin blancos ni comentarios) y `complexity` (40) en `app/`, `lib/` y `hooks/`, como **avisos**, no errores: nombran lo que conviene partir después. Hoy señalan 8 archivos (`app/operations-settings.tsx` 1323 líneas, `app/automation.tsx` 1273, `app/work-organization.tsx` 1249, `app/service-context.tsx` 1218, `app/knowledge.tsx` 1092, `lib/automation.ts` 1067, `app/client-portal.tsx` 943, `app/security-center.tsx` 836) y 12 funciones (`processOutboxBatch` en `lib/mail.ts`, complejidad 71; `ClientPortal`, 69; `validDomainResponse`, 65; `SecurityCenter`, 58; una función de `lib/ticket-mutations.ts`, 58; `Desk`, 55; `LoginForm`, 54; `validateBackup`, 53; una de `lib/inbound-email.ts`, 51; `AutomationPanel`, 49; una de `hooks/use-workspace.ts`, 44; `AutomationRuleEditor`, 42). Se convertirán en errores cuando esa lista se vacíe.

### Nota sobre Prettier
Con algunas cadenas de métodos, Prettier tarda dos pasadas en estabilizar su salida; `npm run format` se puede repetir sin riesgo y la comprobación pasa cuando el resultado ya no cambia.

## Verificación
`npm run check`: lint, pruebas, tipos y build correctos. La lógica de URL y de retorno está cubierta por pruebas unitarias con un historial simulado (`scripts/desk-url.test.ts`, `scripts/check-portal-return-path.test.ts`).

C3 (antes de publicar): `scripts/ticket-cards.test.ts` renderiza las tarjetas (enlaces, etiquetas, estado, plazo vencido, «ahora», selección) y `scripts/design-tokens.test.ts` exige que `mobile-inbox.css` solo use tokens definidos. El aspecto a 375 px, claro y oscuro, se comprobó con el componente real y el CSS de la aplicación en una página estática (no con datos reales).

Recorrido de C1/C2 en producción con una sesión real (10 nov 2026, tras publicar `1a478e6`): abrir un ticket cambia la URL a `/?ticket=N`; Atrás vuelve a la bandeja y Adelante reabre el ticket; abrir `/?ticket=N` directamente muestra el ticket; Seguridad cambia a `/?view=security` y Atrás vuelve a la bandeja; `/?view=metrics` abre Métricas del equipo. Ese recorrido encontró un fallo: con un enlace directo, «Volver a la bandeja» cambiaba la URL pero dejaba el ticket en pantalla, porque `replaceState` recibía el estado interno de Next.js y Next lo trata como una llamada propia y no actualiza `useSearchParams`. Se corrige pasando un objeto nuevo, y la prueba simula ese comportamiento de Next para que no vuelva a pasar.

## Reversión
Revertir el commit restaura el estado interno anterior; no hay datos ni migraciones.

## C8. Migración 0014: índices de las colas

**Preparada, no aplicada.** `drizzle-postgres/0014_ticket_queue_indexes.sql` crea dos índices sobre `tickets` y nada más (sin datos, columnas, restricciones ni extensiones):

| Índice | Definición | Para qué |
| --- | --- | --- |
| `tickets_owner_assignee_page` | `("ownerId","assigneeMemberId","updatedAt" DESC, id DESC)` | «Mis tickets» y el filtro por agente: recorre ya ordenado en vez de revisar todos los del espacio. |
| `tickets_owner_active_page` | `("ownerId","updatedAt" DESC, id DESC) WHERE status<>'resolved'` | «Sin asignar», «Vencidos» y las vistas de trabajo pendiente. Es parcial: los resueltos (la mayoría con el tiempo) no entran, así que el índice es pequeño. |

### Cómo se decidió
Se midió con PostgreSQL 17 desechable en local (nada de producción): un espacio de 40 000 tickets y otros 19 de 3 000 (97 000 tickets, 388 000 mensajes), con las consultas reales de `lib/ticket-search.ts`.

| Consulta (espacio de 40 000 tickets) | Sin índice | Con 0014 |
| --- | --- | --- |
| Mis tickets, agente con 3 tickets antiguos | 7,6 ms | 0,06 ms |
| Sin asignar (activos) | 6,5 ms | 2,7 ms |
| Vencidos (activos), primera página | 0,11 ms | 0,03 ms |

- **Hoy no se nota**: producción tiene unos pocos tickets, donde cualquier plan tarda microsegundos. Son índices para cuando un espacio crezca, y cuestan poco: 6,4 MB y 0,9 MB por 40 000 tickets, más un pequeño coste en cada escritura.
- **Se probaron y se dejaron fuera**:
  - `(ownerId, status, updatedAt DESC, id DESC)`: la cola por estado ya iba en 0,1 ms con el índice existente; la ganancia (0,1 → 0,03 ms) no justifica otro índice.
  - `(ownerId, dueAt) WHERE status<>'resolved'`: el planificador no lo usó en ninguna consulta de la aplicación.
  - **`pg_trgm` para la búsqueda de texto**: un índice GIN sobre `messages.body` bajó la búsqueda de 383 a 144 ms (con muchas coincidencias) y de 158 a 47 ms (sin coincidencias), pero ocupa 66 MB sobre una tabla de 64 MB —el doble de espacio, en una base con límite de tamaño— y no ayuda a la mitad de la consulta que busca en asunto, nombre y correo (`concat_ws` no es inmutable, no se puede indexar). Además exigiría `CREATE EXTENSION` en producción, que el operador no admite. Conviene revisarlo cuando los mensajes superen unos cientos de miles, y entonces junto con reescribir esa búsqueda para que pueda usar el índice.
- **Snapshots de Drizzle**: no se regeneran. Se quedan en 0006 como las migraciones 0007–0013 (escritas a mano y fijadas por hash en el operador); `db/schema.ts` refleja los índices a mano y `drizzle-kit generate` no se usa.

### Ensayo con el operador real
Contra esa base desechable dejada en el estado de producción (hasta 0013, 79 tablas, 485 000 filas) se ejecutaron `runEvolutionMigrationOperator` en `audit`, `dry-run` y `apply` con `--through=0014`: las tres pasan; la simulación no deja índices ni fila de diario; la aplicación deja el diario en 15 filas, los dos índices, ninguna extensión y las huellas de las 79 tablas originales idénticas; una auditoría posterior responde `already_applied_no_changes`. Las consultas de arriba pasan a usar los índices nuevos.

### Qué falta para aplicarla en producción
Nada de esto está hecho; necesita una orden del usuario con ventana, igual que la 0013:
1. Respaldo nuevo (`prod-run.sh backup`) y auditoría (`e-audit 14`).
2. Subir el límite de `need_n()` a 14 en `outputs/handoff-review/prod-run.sh` (archivo ignorado por Git).
3. Simulación (`e-dry 14`), que el usuario cree `~/.config/daybook-prod/ARMED` y aplicación (`e-apply 14`, confirmaciones `...:through-0014` y `evolution-through-0014`).
4. Comprobar diario (15 filas), los dos índices y huellas, y retirar `ARMED`.

Los índices no cambian ningún resultado ni lo que ve la aplicación, así que la fusión de este PR y la aplicación de la migración son independientes y pueden hacerse en cualquier orden. La creación toma un bloqueo breve de escritura sobre `tickets` (milisegundos con el volumen actual). No hay reversión automática: dejar los índices es inocuo y, si algún día hiciera falta quitarlos, sería un `DROP INDEX` manual aparte con orden expresa (el operador no admite `DROP`).

