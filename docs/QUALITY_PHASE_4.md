# Fase 4 de calidad: pruebas de navegador y accesibilidad (11 nov 2026)

Hasta ahora la red de seguridad eran 485 pruebas unitarias que no abren un navegador. Esta fase añade pruebas de extremo a extremo con Playwright y axe, contra la aplicación compilada y una base PostgreSQL desechable. No toca producción ni la aplicación: solo añade pruebas, dos dependencias de desarrollo y un trabajo de CI.

## Cómo se ejecutan

```sh
docker run -d --rm --name daybook-e2e-pg -e POSTGRES_USER=daybook_e2e -e POSTGRES_PASSWORD=daybook-e2e-disposable \
  -e POSTGRES_DB=daybook_e2e -p 127.0.0.1:55433:5432 postgres:17
npm run build        # con DATABASE_URL, BETTER_AUTH_SECRET, DAYBOOK_SITE_URL y DAYBOOK_OWNER_EMAIL ficticios
npm run test:e2e
```

- Usa el Chrome instalado en el equipo (`channel: 'chrome'`); no descarga navegadores. Los runners de GitHub traen Chrome.
- `npm run check` no las incluye (necesitan base y compilación): corren en el trabajo `e2e` de `.github/workflows/ci.yml`, con un servicio `postgres:17` propio. Si falla, el informe y las trazas quedan 7 días como artefacto.
- El puerto (5180) y la base se pueden cambiar con `DAYBOOK_E2E_PORT` y `DAYBOOK_E2E_DATABASE_URL`.

## Qué impide que dañen algo real

- La preparación (`e2e/global-setup.ts`) **vacía** la base antes de cada corrida, así que `assertDisposableDatabase` solo la acepta si el host es local (`127.0.0.1`, `localhost`, `[::1]`) **y** el nombre empieza por `daybook_e2e`. Una URL de producción copiada por error se rechaza antes de ejecutar nada.
- El servidor de prueba no tiene proveedor de correo, push ni Blob configurados: nada externo es alcanzable.
- Todo es ficticio: la propietaria es `owner@example.test`, la contraseña se genera al azar en cada corrida y vive en `e2e/.state/` (ignorado por Git, permisos 600). No se leen ni se escriben archivos `.env`.
- La cuenta propietaria se activa por el **enlace de invitación real** (el mismo flujo que usa un operador), no por un atajo.

## Qué cubren (18 pruebas, unos 25 s)

| Proyecto | Comprueba |
| --- | --- |
| `anonymous` | inicio de sesión usable y accesible; contraseña errónea sin revelar qué falló; invitación desconocida explicada; `/` redirige a `/login` y `/api/tickets/updates` responde 401; `/api/health` público y mínimo |
| `setup` | activar la cuenta desde la invitación |
| `desktop` | bandeja vacía; crear un ticket; abrirlo pone `?ticket=N` en la URL y **Atrás, Adelante, recarga y enlace compartido** vuelven a él; respuesta y nota interna se guardan y sobreviven a la recarga; cambio de prioridad inmediato, con «Deshacer» y confirmado por el servidor; búsqueda; Configuración por secciones en la URL; modo oscuro |
| `mobile` (375 px) | la bandeja es una lista de tarjetas sin tabla ni desplazamiento lateral; el menú es un diálogo que se cierra con Escape y devuelve el foco; el ticket cabe en pantalla |
| `bita` | Bita, el asistente, contra un Anthropic **falso** local: resumen y sugerencias sin modelo, lista blanca y enmascarado de lo que saldría, origen y sesión, devolución del cupo ante una caída, clics reales (resumen, «Sugerir solución», «Pedir pasos a Bita», enlaces), móvil oscuro y tope diario. Ver `docs/BITA.md` |
| `session` | inicio de sesión con contraseña y cierre de sesión que revoca el acceso (corre al final: cerrar sesión invalida la sesión del servidor) |

Cada pantalla pasa por axe (WCAG 2.0/2.1 A y AA) en claro, oscuro y móvil. **Una violación crítica o grave falla la corrida**, y el mensaje nombra la regla, el elemento y, si es contraste, los colores encontrados.

En modo oscuro se revisan el acceso, la bandeja, el ticket, Resumen, Contactos, Conocimiento, Equipo, Configuración y Bita en móvil.

## Hallazgos de axe corregidos (12 nov 2026)

Al principio la puerta solo fallaba con violaciones críticas; las graves quedaban como anotaciones. Antes de endurecerla se corrigieron:

| Regla | Causa | Arreglo |
| --- | --- | --- |
| `color-contrast` | Un gris fijo de modo claro (`#69675f`) en unas 120 reglas de `globals.css`, `mail-tracking.css` y `notification-settings.css`, que no cambiaba en oscuro | Usan `var(--muted)`: mismo valor en claro, `#a1a1a1` en oscuro |
| `color-contrast` | Fondos blancos fijos en oscuro: panel «En foco», anillo del Resumen, resumen de Equipo, cabecera y botón del seguimiento de correos, `kbd`, pantalla de acceso | Reglas oscuras en `evolution-theme.css` (preferencia del sistema y tema elegido) |
| `color-contrast` | Colores de prioridad, «Actualización automática», avisos, rol de acceso y nota de privacidad pensados solo para fondo claro | Versiones claras en modo oscuro |
| `color-contrast` (claro) | «Vencido» (`#bc8980`, 2,98:1) y el aviso de push (`#70766c`, 4,39:1) | `#a5473b` (5,89:1) y `var(--muted)` (5,33:1) |
| `label-content-name-mismatch` | El botón/enlace del logo tenía un `aria-label` («Daybook Ticket · Ir a la bandeja») que no contiene su texto visible | Sin `aria-label`: el nombre sale del logo, «Daybook Ticket» |

Los avatares conservan su fondo pastel también en oscuro, así que sus iniciales se mantienen oscuras.

## Observación de la primera corrida en CI

En GitHub, más lento que un portátil, la prueba de respuesta y nota falló una vez: la nota ya aparece en la conversación **un instante antes** de que el compositor termine de limpiar su borrador, y recargar justo en ese hueco devuelve el texto enviado al cuadro de redacción como borrador. Reenviarlo no duplica nada (la operación es idempotente), así que no se tocó la aplicación; la prueba ahora espera a que el cuadro se vacíe, que es la señal visible de «envío terminado». Esta suite no usa reintentos: sus pruebas se apoyan en los datos de las anteriores y repetir un paso sobre una base ya cambiada daría falsos fallos (un reintento creó un segundo ticket idéntico).

## Lo que todavía no cubren

- **MFA, recuperación y reautenticación** (ya validadas contra QA con helpers HTTP privados).
- **Aislamiento entre dos espacios**: depende de la función `workspaces`, que sigue apagada.
- **Adjuntos**: necesitan Blob privado.
- Un navegador distinto de Chrome.

## Cambios de dependencias

`@playwright/test` 1.59.1, `playwright-core` 1.59.1 (fijada para que `@axe-core/playwright` no instale otra versión) y `@axe-core/playwright` 4.14.0, todas exactas y solo de desarrollo. `axe-core` pasó de 4.11.4 a 4.14.0 (lo comparte `eslint-plugin-jsx-a11y`; el lint no cambió).

## Pruebas de base de datos en CI (13 nov 2026)

El trabajo `database` de `ci.yml` corre en serie los 24 `scripts/check-*-database.mjs` (`npm run test:database:ci`) contra un Postgres 17 de servicio. Antes migra la base desde cero. El simulacro de recuperación sigue en su propio flujo, `recovery-drill.yml`.

- **Protección común:** `scripts/database-check-target.mjs`.
  - El modo CI exige `CI=true` y `DAYBOOK_DATABASE_CI=1`, host `127.0.0.1`/`localhost`, puerto 5432 y base y usuario `daybook_db_ci`.
  - Ese modo rechaza las variables de QA y cualquier clave de correo, push, Blob o IA, además de `VERCEL_ENV=production`.
  - Sin ese indicador, cada script conserva **sus mismas** aserciones del host de QA en Neon.
  - Una prueba unitaria exige que todo script `check-*-database` nuevo entre en la lista y use la protección.
- **Lo que encontró al correr por primera vez:** 10 de los 24 scripts estaban rotos desde E7 o F5. También habrían fallado contra QA:
  - **Ocho creaban espacios ficticios sin perfil.** Desde E7 un espacio sin perfil queda «en incorporación o en pausa» (423). Ahora siembran el perfil activo con `seedQaWorkspaceProfiles` y lo borran al limpiar.
  - **Recordatorios esperaba el comportamiento de un solo espacio.** Desde E7 el trabajador recorre todos los espacios activos: `skipped` solo significa «no hay espacios» y el fallo de un espacio deja el ciclo `incomplete` sin lanzar el error. La prueba ahora verifica el arrendamiento y el resultado del ciclo.
  - **Búsqueda sumaba `open + resolved`.** F5 cambió los conteos a `active`, `unassigned`, `inProgress`, `resolved` y `closed`.
  - **Vista previa de adjuntos esperaba 404 para un miembro revocado.** Ahora el bloqueo del miembro vivo responde 403 antes de buscar el archivo.
  - **Correo entrante:** desde E7 un espacio distinto de `daybook` necesita la recepción activada y un remitente verificado. La prueba los configura con valores ficticios y solo dentro del proceso.
  - **Correo entrante confiable usa el espacio `daybook`.** En la base vacía del CI la prueba crea uno ficticio y lo borra al terminar.
- **Comprobación local:** dos corridas completas en una base vacía pasaron las 24 pruebas. Al final no quedó ninguna fila en `organizations`, `members`, `tickets`, `messages`, `workspaceProfiles` ni `authUser`.
