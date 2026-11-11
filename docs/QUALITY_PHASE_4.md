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
| `session` | inicio de sesión con contraseña y cierre de sesión que revoca el acceso (corre al final: cerrar sesión invalida la sesión del servidor) |

Cada pantalla pasa por axe (WCAG 2.0/2.1 A y AA) en claro, oscuro y móvil. **Una violación crítica falla la corrida.** Las graves no fallan todavía: quedan como anotaciones del informe para decidir cuándo endurecer la puerta.

## Hallazgos de axe (graves, aún sin corregir)

| Regla | Dónde | Nodos |
| --- | --- | --- |
| `color-contrast` | modo oscuro: bandeja (13) y ticket (11); en claro y móvil, 1 nodo en casi todas las pantallas | hasta 13 |
| `label-content-name-mismatch` | 1 nodo en casi todas las pantallas (un control cuyo nombre accesible no contiene su texto visible) | 1 |

Siguiente paso natural: corregir esos dos grupos y pasar «grave» a fallo. Es un cambio visual, por eso no va mezclado con esta fase.

## Observación de la primera corrida en CI

En GitHub, más lento que un portátil, la prueba de respuesta y nota falló una vez: la nota ya aparece en la conversación **un instante antes** de que el compositor termine de limpiar su borrador, y recargar justo en ese hueco devuelve el texto enviado al cuadro de redacción como borrador. Reenviarlo no duplica nada (la operación es idempotente), así que no se tocó la aplicación; la prueba ahora espera a que el cuadro se vacíe, que es la señal visible de «envío terminado». Esta suite no usa reintentos: sus pruebas se apoyan en los datos de las anteriores y repetir un paso sobre una base ya cambiada daría falsos fallos (un reintento creó un segundo ticket idéntico).

## Lo que todavía no cubren

- **MFA, recuperación y reautenticación** (ya validadas contra QA con helpers HTTP privados).
- **Aislamiento entre dos espacios**: depende de la función `workspaces`, que sigue apagada.
- **Adjuntos**: necesitan Blob privado.
- **Pruebas de base de datos** (`check-*-database.mjs`): siguen sin correr en CI; falta un guardián común. El trabajo `e2e` ya demuestra que un Postgres de servicio basta.
- Un navegador distinto de Chrome.

## Cambios de dependencias

`@playwright/test` 1.59.1, `playwright-core` 1.59.1 (fijada para que `@axe-core/playwright` no instale otra versión) y `@axe-core/playwright` 4.14.0, todas exactas y solo de desarrollo. `axe-core` pasó de 4.11.4 a 4.14.0 (lo comparte `eslint-plugin-jsx-a11y`; el lint no cambió).
