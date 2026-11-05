# Evolución de Daybook Ticket

Plan aprobado: fortalecer primero el servicio de Joaquín y Mario y después habilitar pilotos comerciales invitados, con una entrega revisable por bloque. Solo `Domarchi/daybook-ticket`; ningún otro proyecto ni Consorcio C17 forma parte de la implementación.

## Secuencia

| Entrega | Rama | Alcance | Estado |
|---|---|---|---|
| 0 | codex/daybook-ticket-reliability | Base PR #6, chat moderno, fiabilidad, Preview protegida | CI de código aprobado; Preview READY en ae0b039 |
| 1 | codex/daybook-evolution-01 | Citas, menciones privadas, seguidores, archivos y búsqueda completa; temas y controles de activación | En desarrollo y QA |
| 2 | codex/daybook-evolution-02 | Etiquetas, tipos, campos/formularios versionados, tareas, vistas y espera interna | Código aislado preparado; integración y QA pendientes |
| 3 | codex/daybook-evolution-03 | Empresas, sedes, equipos, servicios, contratos y vencimientos | Código aislado preparado; integración y QA pendientes |
| 4 | codex/daybook-evolution-04 | Reglas simulables, plantillas y relaciones/duplicados | En desarrollo aislado |
| 5 | codex/daybook-evolution-05 | Conocimiento versionado, informes privados y paneles | En desarrollo aislado |
| 6 | codex/daybook-evolution-06 | TOTP, sesiones, auditoría, salud y exportación sin credenciales | Código aislado preparado; integración y QA pendientes |
| 7 | codex/daybook-evolution-07 | Espacios explícitos, pilotos manuales y límites aislados | En desarrollo aislado; requiere entrega 6 |

Las ramas se apilan en orden de entrega antes de abrir sus PR. Cada trabajo se realiza en su worktree aislado. La revisión de seguridad empieza en cada bloque; una rama individual no autoriza su publicación productiva ni activar políticas, programadores o pilotos.

## Reglas de conservación

- Migraciones aditivas con comprobación de filas y columnas originales antes/después; no borrar ni reconstruir historial.
- Mantener IDs, cuentas, contraseñas, mensajes, archivos, estados y reglas actuales de SLA. Nuevos campos opcionales no alteran hashes de reintentos históricos.
- Notas, menciones, tareas, inventario y contratos son internos; citas y búsquedas revalidan permisos. Seguidores no sustituyen responsables ni destinatarios configurados.
- Reglas inicialmente desactivadas, sin código arbitrario ni respuestas públicas automáticas. Duplicados son vínculos: no mover mensajes ni cambiar el hilo o plazo original.
- TOTP mediante autenticador y recuperación personal; nunca habilitar obligaciones reales antes de que el propietario verifique su recuperación.
- Espacio de negocio distinto de empresa cliente. Preservar la clave de aislamiento al cambiar propietario. Invitaciones concretas y exportaciones sin credenciales globales antes de pilotos.
- IA, WhatsApp, cobros, API pública e integraciones externas quedan fuera de estas entregas. Sin contratación, aumento de planes ni cambios DNS automáticos.

## Validación y publicación

QA usa exclusivamente `.env.test.local`, base aislada y datos ficticios; pruebas mutantes en serie, sin correo ni push externos. Cada candidato debe superar lint, tipos, pruebas, compilación, revisión de escritorio/móvil y aislamiento. Cada entrega recibe PR y Preview protegida, evidencias y procedimiento de reversión antes de solicitar su revisión productiva.

El operador `scripts/migrate-evolution-qa.mjs` ensaya con rollback por defecto y aplica únicamente con `--apply`, sobre el host QA fijo. Sus huellas y resultados se conservan en `work/`, sin secretos en Git.

## Base y atribución

`origin/main` se verificó en dfa3839; la base de código del chat en d6b51ca. El primer intento de Vercel se bloqueó por atribución de cuenta antes del build. El commit de evidencia ae0b039 fue creado por el flujo autenticado de GitHub, conservando las autorías de los commits fuente, y generó el Preview READY `dpl_HYUmSMjH9Dm5S25AUu3dbqPCyCns`. Alias de revisión: https://daybook-ticket-reliability-qa-domarchi.vercel.app/. No hubo promoción productiva.
