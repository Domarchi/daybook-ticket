@AGENTS.md
@docs/CLAUDE_HANDOFF.md

# Continuidad de Daybook Ticket

Trabaja únicamente en `Domarchi/daybook-ticket`, dentro del worktree y la rama acordados. El punto de continuación es el clon independiente `daybook-ticket-claude`, rama `codex/daybook-evolution-07`; confirma la raíz Git real, HEAD y cambios locales antes de editar. El worktree fuente `daybook-evolution-07` y los demás worktrees quedan como referencias o entregas independientes. No copies cambios entre carpetas ni descartes cambios ajenos.

La evolución E0–E7 está en revisión y QA; este contexto no autoriza fusionar, desplegar producción, aplicar migraciones productivas ni activar pilotos, MFA obligatorio o trabajos nuevos. Conserva usuarios, contraseñas, sesiones, permisos, tickets, mensajes, empresas, archivos e idempotencias existentes.

- Lee las guías locales de la versión instalada de Next.js antes de cambiar sus APIs, conforme a `AGENTS.md`.
- En los worktrees fuente, `node_modules` es compartido mediante un enlace simbólico: no ejecutes instalaciones ni modificaciones en ese destino. En el clon independiente, Node24 y el lockfile permiten `npm ci` exclusivamente sobre su directorio propio; no instalar si resulta ser un enlace. No actualizar dependencias por iniciativa del traspaso.
- El clon se entrega sin `.env` privados, accesos QA ni sesiones; puede conservar la plantilla versionada `.env.example`. Las pruebas locales puras no necesitan esos archivos. QA usa solo un mecanismo privado aprobado, datos ficticios y scripts con guardas; el archivo `.env.test.local` del worktree fuente no se copia al clon. No abras, imprimas ni copies su contenido; no cargues secretos de producción. Ejecuta las pruebas que escriben QA en serie y verifica su limpieza. Correo y push reales permanecen apagados.
- No copies cookies, claves, enlaces de invitación, factores MFA, códigos de recuperación, archivos privados de acceso QA ni credenciales OAuth de Codex/ChatGPT a Claude, a Git o a un paquete de exportación. Las conexiones externas requieren el inicio de sesión personal correspondiente.
- No toques Consorcio C17, otros repositorios, DNS, cuentas, planes o proveedores. No instales herramientas ni configures MCP durante el primer repaso local. La instalación bloqueada de dependencias en el clon nuevo puede estar ya preparada por el coordinador; no repetirla sobre el enlace compartido.
- Mantén el aislamiento por `ownerId` estable y por URL de espacio. Ningún flag visual puede omitir MFA. Después de usar E7, una reversión conserva sus barreras de identidad e invitación concreta; después de enrolar MFA, conserva el plugin, los factores y la clave original bajo custodia privada.

Avanza en cambios locales autorizados y reversibles. Antes de una acción remota sensible, prepara un resultado revisable y comprueba la autorización concreta vigente. No extrapoles autorizaciones antiguas de otras publicaciones a esta entrega.
