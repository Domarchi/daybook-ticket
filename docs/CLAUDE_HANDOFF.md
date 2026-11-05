# Continuar Daybook Ticket desde Claude

Preparación local del 5 de noviembre de 2026. Este documento permite retomar el repositorio existente; no publica una versión, migra producción, configura herramientas remotas ni transfiere credenciales. El coordinador debe cerrar los SHA, CI y Preview finales en [EVOLUTION_REVIEW.md](EVOLUTION_REVIEW.md) antes de la revisión productiva.

## Abrir el proyecto en este computador

El equipo utiliza Ubuntu 26.04.1 LTS x86_64. Se comprobó la instalación de Claude Desktop (`/usr/bin/claude-desktop`, versión observada 4.16336.0) y Claude Code CLI (`/home/friday/.local/bin/claude`, versión observada 2.1.317). No se instaló nada ni se verificaron su cuenta, suscripción o autenticación. La documentación actual admite Claude Desktop para Linux en beta; el Code tab local necesita un plan que lo habilite. Linux beta no incluye Computer Use ni dictado. [Linux oficial](https://code.claude.com/docs/en/desktop-linux), [inicio de Code Desktop](https://code.claude.com/docs/en/desktop-quickstart).

1. Abre **Claude Desktop → Code → Local → Open folder**.
2. Elige `/home/friday/Documents/Codex/2026-11-03/usa/work/daybook-ticket-claude`, el **clon local independiente** que prepara el coordinador a partir del HEAD final de E7. No abrir los worktrees fuente con sus archivos privados como carpeta de trabajo de Claude.
3. Inicia el primer repaso en **Plan**. Comprueba que se cargaron `CLAUDE.md`, `AGENTS.md` y este documento mediante `/context all`. Revisa permisos y conexiones con `/permissions` y `/mcp`.
4. Para ejecutar cambios locales acordados, usa Manual/default y revisa las acciones sensibles. No habilites modos de omitir permisos.

Alternativa de terminal, sin instalar nada:

```sh
cd '/home/friday/Documents/Codex/2026-11-03/usa/work/daybook-ticket-claude'
claude --permission-mode plan
```

No usar `claude --desktop` ni `/desktop` como instrucciones de traspaso en este Linux: la referencia actual limita esas opciones a otras plataformas. Abrir la aplicación y seleccionar la carpeta local evita esa limitación. `CLAUDE.md` importa explícitamente `@AGENTS.md` y esta guía; su texto proporciona contexto, no una barrera de permisos. Las restricciones de lectura tampoco sustituyen el control de comandos que podrían leer archivos indirectamente. [CLI oficial](https://code.claude.com/docs/en/cli-reference#cli-flags), [memoria e imports](https://code.claude.com/docs/en/memory), [permisos](https://code.claude.com/docs/en/permissions).

## Carpeta independiente y materiales excluidos

El coordinador prepara `work/daybook-ticket-claude` desde el HEAD final revisado de E7 mediante un clon local con `--no-hardlinks`, rama `codex/daybook-evolution-07` y origen `https://github.com/Domarchi/daybook-ticket.git`. Se conserva el mismo repositorio; no se crea un producto, proveedor o cuenta nuevos. El clon tiene metadatos Git y dependencias propios y no recibe automáticamente futuros cambios del worktree fuente.

No contiene archivos `.env` con configuración privada (solo se permite la plantilla versionada `.env.example`), credenciales/configuraciones OAuth locales, cookies, archivos de acceso QA, datos privados de respaldo ni copias completas de `work/` u `outputs/`. Solo se incorpora la evidencia **curada y sin secretos** que indique el coordinador, preferentemente en `outputs/handoff-review/`, ya excluido de Git. No copiar capturas de autenticadores, códigos, enlaces privados ni estados del navegador. El comprobador no convierte esos materiales en un paquete.

Los worktrees fuente E2–E7 conservan el contexto de revisión y sus mecanismos privados de QA; son referencias, no carpetas para importar globalmente a Claude. El coordinador puede ejecutar QA allí y asociar su resultado a un commit concreto. Si el nuevo trabajo requiere QA desde el clon, primero preparar un mecanismo privado aprobado para ese clon; no copiar el `.env.test.local` fuente ni inventar valores o usar producción.

La preparación del clon no configura cuentas, MCP ni accesos remotos de Claude. El siguiente paso local funciona sin esas conexiones.

## Estado Git que hay que comprobar primero

Repositorio: [Domarchi/daybook-ticket](https://github.com/Domarchi/daybook-ticket). La referencia productiva registrada es `dfa3839d9a066631e8afd0ee5b5648369fd03fac`; `origin/main` local coincide con ella en el inventario de esta preparación. Esto no sustituye verificar el despliegue real antes de una publicación.

El checkout `/home/friday/Documents/Codex/2026-11-03/usa/work/daybook-ticket-vercel`, rama `main`, es **solo referencia**. Su HEAD local observado es `5fc1d98`, distinto de `origin/main`; no asumir que ese checkout es el candidato publicado, no resetearlo y no usarlo para continuar esta evolución.

En la raíz Git **actual del clon**, ejecutar estas lecturas antes de editar:

```sh
node scripts/check-handoff-environment.mjs
git status --short
git branch --show-current
git rev-parse HEAD
git log -5 --oneline
```

El comprobador es local y no carga archivos `.env`, no consulta bases o proveedores, no autentica herramientas ni instala dependencias. Muestra metadatos Git, versión de Node, rutas de binarios y presencia de archivos, nunca sus contenidos privados. No ejecuta Claude ni lee la URL remota o configuraciones de autenticación. El comprobador distingue el clon independiente (Git y `node_modules` propios) de la fuente07 (dependencias compartidas por symlink). En modo clon no inspecciona las carpetas fuente vecinas; solo las enumera como referencias. En un clon local, cambiar la URL de origin no refresca sus refs: el coordinador debe comprobar `origin/main` contra GitHub antes de atribuirle la base publicada. Si hay cambios sin commit, conservarlos y revisar su pertenencia con el coordinador. No usar `reset --hard`, `clean`, cambios de rama forzados o sustitución de archivos para obtener un estado limpio.

La entrada de edición es el clon; las siguientes carpetas son referencias de la revisión. Las ramas están apiladas por entrega: E7 integra E1–E6. Esta tabla es un inventario local observado, no una certificación de CI de cada HEAD. El coordinador actualizará las referencias finales de revisión antes de su cierre.

Base de worktrees: `/home/friday/Documents/Codex/2026-11-03/usa/work/`.

| Entrega | Worktree / rama | HEAD local observado | PR |
| --- | --- | --- | --- |
| E0 | `daybook-ticket-reliability` / `codex/daybook-ticket-reliability` | `ae0b039` | [#6](https://github.com/Domarchi/daybook-ticket/pull/6) |
| E1 | `daybook-evolution-01` / `codex/daybook-evolution-01` | `5f10848` | [#7](https://github.com/Domarchi/daybook-ticket/pull/7) |
| E2 | `daybook-evolution-02` / `codex/daybook-evolution-02` | `4677f62` | [#8](https://github.com/Domarchi/daybook-ticket/pull/8) |
| E3 | `daybook-evolution-03` / `codex/daybook-evolution-03` | `f6ad03b` | [#9](https://github.com/Domarchi/daybook-ticket/pull/9) |
| E4 | `daybook-evolution-04` / `codex/daybook-evolution-04` | `88c0251` | [#10](https://github.com/Domarchi/daybook-ticket/pull/10) |
| E5 | `daybook-evolution-05` / `codex/daybook-evolution-05` | `1af4c78` | [#11](https://github.com/Domarchi/daybook-ticket/pull/11) |
| E6 | `daybook-evolution-06` / `codex/daybook-evolution-06` | `15e935a` | [#12](https://github.com/Domarchi/daybook-ticket/pull/12) |
| E7 | `daybook-evolution-07` / `codex/daybook-evolution-07` | `HEAD de PR #13` | [#13](https://github.com/Domarchi/daybook-ticket/pull/13) |

Para otra entrega, acordar su repositorio local, worktree y rama concretos antes de cambiar de contexto. No editar los worktrees fuente desde el clon ni sincronizar ambos con copias masivas de archivos. Resolver divergencias mediante commits revisados, sin resetear la otra carpeta. Las ramas históricas de notificaciones, mejoras, operaciones y fiabilidad no son el punto de continuación comercial.

## Implementado y comprobado

La descripción completa y los límites funcionales están en [EVOLUTION_PLAN.md](EVOLUTION_PLAN.md), [EVOLUTION_REVIEW.md](EVOLUTION_REVIEW.md) y [COMMERCIAL_WORKSPACES.md](COMMERCIAL_WORKSPACES.md).

- E1–E5 incluyen colaboración, organización, contexto de empresas/equipos/contratos, automatizaciones simulables y conocimiento/informes privados. Sus candidatos de código y recuentos históricos se conservan en la revisión; no presentar un log viejo como comprobación de un commit posterior.
- E6 incluye TOTP y recuperación personal, sesiones, reautenticación, auditoría, salud, exportación de negocio y recuperación de 74 tablas con MFA cifrado. El candidato del puente push `bcdb430` superó lint, 371 pruebas, tipos y compilación. La revisión registra QA y CI posteriores y una Preview protegida.
- E7 incluye identidad global con membresías distintas por negocio, rutas explícitas, pilotos invitados, cuotas, marca/remitente por negocio y consola sin acceso automático al contenido. La ejecución local del candidato de código `bd35de9`, registrada en `work/e7-corrected-ui-check.log`, terminó con **412/412 pruebas**, lint, tipos y compilación correctos. La corrección posterior del estado de carga del operador se comprueba en el check final de la entrega. La recuperación acumulada de **75 tablas** terminó correctamente. Los cambios de código posteriores deben repetir los checks correspondientes.
- Los resultados privados curados de E7 registran HTTP con dos negocios y roles distintos (**8 comprobaciones**, 22:57 UTC), MFA real/recuperación de un solo uso/reautenticación/revocación (**7**, 22:58 UTC) y dos adjuntos ficticios reales mediante Blob privado (**5**, 23:17 UTC), el 5 de noviembre de 2026. Las sesiones Node de los adjuntos se cerraron correctamente. No hubo envíos externos ni cambios de dominio desde los validadores HTTP; las cargas y los dos mensajes se realizaron antes mediante la interfaz de QA.
- La carrera de invitaciones pasó con bloqueo anterior a miembros, invalidez del token renovado, reintento estable, esquema aislado eliminado e inventario público conservado. La migración 0013 se ensayó y aplicó únicamente en QA; los inventarios productivos no se alteraron.

En la fuente se conservan los ficheros `work/E7_REVIEW_HTTP_RESULT.json`, `work/E7_MFA_HTTP_RESULT.json`, `work/E7_ATTACHMENT_HTTP_RESULT.json`, los logs de QA y `outputs/evolution-07/` son evidencias locales excluidas de Git. El clon recibe únicamente una selección curada en `work/qa-evidence/`, con resultados y capturas sin credenciales. Solo consultar los informes curados necesarios. Los archivos privados de acceso, invitaciones o factores de QA son credenciales y quedan fuera de cualquier exportación, PR, captura o paquete global.

**CI y Preview:** el coordinador confirmó CI verde y Preview READY protegida para las entregas E2–E6; la revisión contiene también los resultados anteriores de E0/E1. El cierre remoto definitivo de E7 se consulta en el HEAD de PR #13 y en `work/qa-evidence/FINAL_STATUS.json` del clon preparado. Ese inventario curado se genera después de verificar CI y Preview, sin incorporar credenciales. No presentar este traspaso como una conexión remota de Claude ya configurada ni como autorización productiva. Registrar en [EVOLUTION_REVIEW.md](EVOLUTION_REVIEW.md) el SHA exacto, resultado terminal de GitHub y URL READY protegida que se vaya a revisar. Un alias puede avanzar: no equivale por sí mismo a una prueba sobre el mismo commit.

## Comandos y límites para continuar

Node requerido: **24.x**. En el clon nuevo, el coordinador puede preparar dependencias propias mediante `npm ci` usando el lockfile sin modificarlo. Confirmar primero que la raíz es `daybook-ticket-claude` y que `node_modules` no es un enlace. En los worktrees fuente, el destino de `node_modules` es compartido: no ejecutar instalaciones, reparaciones ni ediciones allí. El workflow CI instala en su checkout efímero; eso no habilita modificar el enlace local.

Después de un cambio de código pertinente, coordinar un único proceso de Next/build por worktree y utilizar:

```sh
npm run lint
npm run test:unit
npm run typecheck
npm run build
```

`npm run check` reúne esos cuatro pasos. Sus pruebas unitarias no necesitan la base ni proveedores. El workflow también comprueba el pinger de notificaciones y tiene un ensayo separado de recuperación con datos ficticios. Revisar ambos estados del PR, no solo la compilación.

El clon limpio no lleva secretos QA. Las pruebas que escriben QA, los simulacros de recuperación y los validadores HTTP se ejecutan **serialmente**, por el coordinador, con el mecanismo privado aprobado del worktree correcto. `.env.test.local` es solo una referencia privada del origen; no se incluye ni se copia al clon por este traspaso. Mantener sus guardas de host/base, TLS, modo QA y proveedores apagados. No quitar una guarda para hacer pasar un test ni ejecutar estos scripts apuntando al entorno productivo. No abrir, imprimir ni copiar el contenido de ese archivo, ni cargar credenciales productivas como sustitución.

Los helpers HTTP privados usan exclusivamente cuentas `@example.test` del fixture. No volver a ejecutar el validador MFA sin revisar su marcador: ya consumió un código ficticio concreto y está diseñado para impedir la repetición automática después de una respuesta incierta. No regenerar factores/códigos ni invalidar la sesión del navegador de otra persona para repetirlo. Las pruebas reales de correo/push y las cuentas reales requieren su autorización específica.

Primeros pasos sugeridos en Claude:

1. Comprobar repo/rama/HEAD, cambios locales y carga de instrucciones; leer los pendientes finales de revisión.
2. Comprobar la correspondencia de los resultados con el candidato, incluidos CI y Preview protegida. Revisar resultados existentes antes de repetir una prueba que escribe.
3. Hacer un plan del siguiente trabajo dentro de la entrega acordada. Mantener QA ficticia y aislar cada cambio; preparar un resultado revisable antes de cualquier decisión productiva.

## Conexiones de Claude y credenciales

La primera revisión local no necesita MCP. No copiar configuraciones globales, cookies de navegador, OAuth de Codex/ChatGPT, tokens, secretos de Vercel, credenciales Neon/Resend ni archivos de acceso QA a Claude. No crear un archivo de claves o un paquete completo del directorio. Abrir el clon independiente conserva las fuentes sin trasladar esos materiales privados del origen.

Claude Desktop Code local y Claude Code pueden compartir configuración de Claude; Code local también puede cargar los servidores del archivo de configuración de Desktop, y los conectores de la cuenta Claude pueden aparecer en Code. Eso no transfiere las conexiones de ChatGPT/Codex. Antes de añadir una conexión, revisar `/mcp` para evitar duplicarla y autenticarla personalmente mediante el flujo admitido. [Configuración compartida](https://code.claude.com/docs/en/desktop#shared-configuration), [conectores de Claude en Code](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claudeai).

| Servicio existente | Continuidad permitida y alcance pendiente |
| --- | --- |
| GitHub | `gh` está instalado; su autenticación no se inspeccionó para este traspaso. La persona puede comprobar `gh auth status` y, si falta, usar `gh auth login --hostname github.com --git-protocol https --web`. Autorizar solo el repositorio necesario. El conector de contexto de GitHub no garantiza permisos para push o PR. El MCP GitHub remoto tiene requisitos propios; no prometer OAuth remoto genérico ni instalar servidores/Docker automáticamente. [CLI](https://cli.github.com/manual/gh_auth_login), [integración de contexto](https://support.claude.com/en/articles/10167454-use-the-github-integration), [MCP oficial](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-claude.md). |
| Vercel | Si se necesita, la persona puede conectar el servidor oficial `https://mcp.vercel.com` y revisar `/mcp`. `--scope local` limita dónde se guarda la configuración del cliente, **no** los permisos del proveedor ni el proyecto. No conceder ni utilizar escrituras productivas por inferencia. No cambiar planes, secretos ni protección como parte del traspaso. [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp). |
| Neon | Mantenerlo desconectado durante el primer repaso. El servidor oficial admite `readonly=true` y `projectId`, pero la documentación no ofrece un parámetro de aislamiento por rama. Si QA y producción comparten proyecto, ese grant no limita la lectura a QA. Primero revisar un proyecto QA aislado o una ACL/rol aprobado; no crear infraestructura para resolverlo automáticamente. [Claude Code y Neon](https://neon.com/docs/ai/agent-setup/claude-code), [alcances MCP oficiales](https://github.com/neondatabase/mcp-server-neon/blob/main/README.md). |
| Resend / correo y push | Mantener las entregas reales apagadas. Cualquier sesión o conexión necesaria se autentica personalmente y se limita al trabajo aprobado; no importar claves/cookies del otro asistente ni crear un proveedor nuevo. El remitente actual de Daybook sigue siendo `Daybook Ticket <tickets@consorcioc17.cl>`. |

La autorización previa de ciertos secretos para Vercel no es una autorización para copiarlos a configuraciones globales de otro asistente. Si una conexión requiere una aprobación nueva, terminar primero la preparación local revisable y explicar la acción y su alcance concreto.

## Publicación y reversión que no deben perderse

Producción continúa en su base registrada: **no fusionar ni desplegar esta evolución automáticamente**. El siguiente asistente debe conservar el control de publicación explícito del usuario y las puertas descritas en [EVOLUTION_RELEASE_OPERATOR.md](EVOLUTION_RELEASE_OPERATOR.md) y [EVOLUTION_REVIEW.md](EVOLUTION_REVIEW.md).

- Migraciones aditivas, prefijos revisados, inventarios/huellas anteriores y posteriores, respaldo de base y archivos y un despliegue compatible de reversión. No ejecutar el migrador genérico sobre producción ni enmendar SQL/journal aplicado. Un COMMIT incierto exige auditoría con conexión nueva, sin reintento automático.
- **E6 parcheada antes de SQL0013:** registrar push mediante el puente seguro antes de reemplazar el índice. Después, E7 usa solo `(ownerId, memberId, endpoint)`. No reconstruir unicidad global ni eliminar suscripciones para permitir un build antiguo. Véase [PUSH_INDEX_TRANSITION.md](PUSH_INDEX_TRANSITION.md).
- **MFA ya enrolado:** una reversión conserva Better Auth2FA, validación de sesión/MFA, factores cifrados, política y custodia privada de la clave original. No bajar `twoFactorEnabled`, borrar factores o desactivar política para adaptar un build anterior.
- **E7 ya utilizada:** conservar aceptación de invitación concreta, identidades globales, membresías/roles por negocio, rutas y ACL explícitas, claves estables de aislamiento y separación de push. No volver al código que enlazaba todas las invitaciones por email. Pausar pilotos/funciones conserva esas barreras y sus datos.
- La exportación de un negocio excluye credenciales globales y no sustituye el respaldo operativo. La recuperación se hace sobre destino vacío, verifica factores con la clave original y deja trabajos/pilotos/integraciones pausados sin desactivar MFA ni borrar historial.

No tocar Consorcio C17, otros proyectos, web/DNS/buzones, cuentas, proveedores o planes. No activar registro público, cobros, IA ni WhatsApp en esta continuidad. La instalación de Claude y este documento no cambian esas decisiones.
