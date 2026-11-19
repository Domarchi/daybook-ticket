# Runbook de incidentes de Daybook Ticket

Qué hacer cuando algo falla en producción (`https://daybook-ticket.vercel.app`). Todo lo que cambie producción (redesplegar, revertir, migrar, rotar secretos o cambiar planes) necesita la **orden expresa de la persona responsable**. Este documento indica qué revisar y qué proponer.

## 1. Diagnóstico en 2 minutos

| Comprobación | Cómo | Bien | Mal |
| --- | --- | --- | --- |
| La app responde | `curl https://daybook-ticket.vercel.app/api/health` | `{"status":"ok","version":"<sha>"}` | Error o tiempo agotado: ver §2 (Vercel). |
| Versión publicada | El `version` de arriba frente al último commit de `main` | Coinciden | Distintos: ver §3 (despliegue). |
| La base responde | `curl 'https://daybook-ticket.vercel.app/api/health?deep=1'` | `"database":"ok"` | `unreachable` o 503: ver §4 (Neon). Tras un rato sin uso, la primera consulta puede fallar mientras Neon despierta: repetir una vez. |
| Inicio de sesión | Abrir `/login` | Formulario visible | Página de error: revisar los registros de Vercel (§2). |

Estado de los proveedores: [Vercel](https://www.vercel-status.com), [Neon](https://neonstatus.com).

## 2. La app no responde o da errores 500

1. En Vercel → proyecto `daybook-ticket` → **Logs**, filtra por `level=error`. Los registros son JSON con `event` y `requestId`, sin datos personales.
2. Si empezó tras un despliegue, la salida rápida es **volver al despliegue anterior** (Vercel → Deployments → *Promote/Instant Rollback*), con orden expresa y respetando §6.
3. Si no hubo despliegue, revisa Neon (§4) y el estado de Vercel.

## 3. El despliegue no llegó a producción

- Revisa el estado del commit: `gh api repos/Domarchi/daybook-ticket/commits/<sha>/statuses`.
- **«Deployment rate limited — retry in 24 hours»:** se alcanzó el límite diario de despliegues del plan. Producción sigue con la versión anterior. El siguiente push a `main` publica todo lo acumulado. No redesplegar ni cambiar de plan sin orden.
- **Error de compilación:** la CI de GitHub debió detectarlo. Corrige en una rama con PR y CI verde.

## 4. La base de datos (Neon)

- **Primera consulta lenta o `unreachable` tras inactividad:** es el arranque en frío de Neon. Se resuelve solo en segundos.
- **Respuestas lentas con mucho uso:** el cómputo del proyecto `daybook-ticket` está fijo en 0,25 CU. Mira [la prueba de carga](LOAD_TEST.md) y el consumo en la consola de Neon. Subir de plan o de CU lo decide la persona responsable.
- **Límite del plan alcanzado** (cómputo mensual o almacenamiento de 1 GB): Neon puede suspender el cómputo. La app responde 503 en `?deep=1`. Solo se recupera ampliando el plan o esperando el reinicio mensual, y ambas cosas las decide la persona responsable.
- **Nunca** ejecutar el migrador genérico ni SQL manual sobre producción. Las migraciones van con el operador y una ventana autorizada ([EVOLUTION_RELEASE_OPERATOR.md](EVOLUTION_RELEASE_OPERATOR.md)).

## 5. Problemas de las personas

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| «Necesitas una invitación válida» | El enlace venció, se renovó o ya se usó | Renovar el enlace en **Equipo y clientes → Enlaces de invitación**. |
| «Has realizado varios intentos» | Límite de inicio de sesión **por dirección IP**: 60 por minuto con #86 (antes 5). Una oficina detrás de una misma IP lo comparte. | Esperar un minuto. Si se repite con muchas personas, revisar en los registros de Vercel si es un ataque (muchos intentos fallidos) antes de proponer subirlo. |
| Olvidó la contraseña | El correo está apagado: «Olvidé mi contraseña» no llega | Un administrador crea **Enlace para nueva contraseña** en su fila del directorio y se lo entrega ([guía](GUIA_ADMINISTRADOR.md#olvidó-su-contraseña)). Sirve una vez, vence a las 24 h y cierra sus sesiones. Si su cuenta también se usa en otro espacio, no se ofrece: la recupera soporte de Daybook. |
| No ve su equipo | Equipo dado de baja o asignado a otra persona | Revisarlo en **Equipos** (historial del equipo). |
| «Verifica tu identidad» al invitar | La verificación de contraseña dura 5 minutos | Volver a verificar en Seguridad. |

## 6. Volver atrás sin perder datos

Hay versiones a las que **no se puede volver** porque no entienden los datos nuevos:

- **E7 (0013) ya está aplicada:** no bajar de E7 ([PUSH_INDEX_TRANSITION.md](PUSH_INDEX_TRANSITION.md)).
- **Tras el primer informe mensual con «Sin asignar / En proceso»:** no bajar de `3860576` ([TICKET_STATES.md](TICKET_STATES.md)).
- **Con MFA enrolado:** conservar la clave original de Better Auth (`BETTER_AUTH_SECRET`). Rotarla deja inutilizables los factores cifrados y cierra todas las sesiones.

Las entregas del lanzamiento (L1–L4: serie obligatoria, importación, enlaces y «Confirma tu equipo») no tienen migración. Volver a una versión anterior conserva los datos, pero quita esas pantallas.

## 7. Incidentes de seguridad

- **Se filtró un CSV de enlaces:** en **Enlaces de invitación**, usa **Renovar todos**, que anula los enlaces anteriores. Si alguien ya activó una cuenta ajena, revoca su acceso en el directorio.
- **Se filtró un enlace para nueva contraseña:** crea otro para la misma persona; el anterior deja de funcionar. Si ya se usó, en **Seguridad → Auditoría** aparece «Otras sesiones cerradas» a nombre de la persona. En ese caso, revoca su acceso de inmediato. Para devolvérselo, restáuralo y en ese momento entrégale en mano un enlace nuevo: al usarlo se cierran todas las sesiones de la cuenta, también la de quien usó el enlace filtrado.
- **Cuenta comprometida:** revoca el acceso de la persona en **Equipo y clientes**. Revisa sus sesiones y la auditoría en **Seguridad**.
- **Secreto expuesto** (base, Blob, correo): rótalo en el proveedor, actualiza la variable en Vercel y redespliega, siempre con orden expresa. Ver `BETTER_AUTH_SECRET` en §6 antes de tocarla.
- **Respaldos:** copias cifradas en `~/daybook-backups` del equipo del operador ([AUTOMATIC_BACKUPS.md](AUTOMATIC_BACKUPS.md)). Mantener una copia **fuera** de este equipo.

## 8. Después del incidente

Anota en un ticket interno qué pasó, a quiénes afectó, cuánto duró, la causa y qué se cambió. Si hizo falta revertir, abre un PR con la corrección y su prueba antes de volver a publicar.
