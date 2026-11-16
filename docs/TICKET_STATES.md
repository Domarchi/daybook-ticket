# Estados del ticket (Fase 5-A, 11 nov 2026)

Las personas ven cuatro estados. Se guardan solo tres valores; los otros dos se deducen de si el ticket tiene responsable. Todo vive en `lib/ticket-status.ts`.

| Se ve | Valor guardado | Regla |
| --- | --- | --- |
| Sin asignar | `open` sin `assigneeMemberId` | deducido; color ámbar |
| En proceso | `open` con `assigneeMemberId` | deducido; color azul |
| Solucionado | `resolved` | antes «Resuelto»; color verde |
| Cerrado | `closed` | nuevo; lo marca una persona; color gris |

## Reglas

- **Cerrar** solo desde Solucionado. Un ticket cerrado **solo puede reabrirse** (vuelve a abierto y reinicia el plazo de SLA, igual que reabrir uno solucionado). El servidor lo exige (409), no solo la pantalla.
- **Cliente en el portal**: no puede escribir en un ticket cerrado; se le pide crear uno nuevo. En Solucionado su respuesta lo reabre, como antes.
- **Correo entrante**: una respuesta por correo reabre también un ticket cerrado. Por correo no hay manera de pedirle al remitente que abra otro ticket, y archivar el mensaje en un ticket que nadie mira lo perdería.
- **Encuesta de satisfacción**: se crea al solucionar, como antes, y se puede contestar también cuando el ticket ya está cerrado.
- Cerrado cuenta como terminado en todas partes: SLA, recordatorios, escalamientos, asignación automática, colas activas y contactos activos.
- Cerrar no se ofrece como «Deshacer» (igual que solucionar).

## «En espera» retirado

- `pending` ya no se escribe. Si llega de una pestaña abierta antes del cambio, la API lo convierte en `open`.
- Las filas, respaldos y exportaciones antiguos que lo traen se siguen aceptando y se muestran como Sin asignar o En proceso. En producción había 1 ticket así (sin responsable) el 11 nov 2026: se ve como Sin asignar, sin tocar datos.
- Los filtros guardados con las colas `open` o `pending` siguen cargando; la bandeja los muestra como «Todos».
- **Sin migración**: `tickets.status` no tiene restricción en la base. El índice parcial `tickets_owner_active_page` (`status<>'resolved'`) sigue usándose con la nueva condición `status NOT IN ('resolved','closed')` (comprobado con `EXPLAIN` en PostgreSQL 17).

## Colas y contadores

Pestañas de la bandeja: Todos, Sin asignar, En proceso, Solucionados, Cerrados (más «Mis tickets» y «SLA vencido» desde el menú). Tarjetas del resumen: Sin asignar, En proceso, Solucionados, SLA vencido. `TicketCounts` pasa a `all, active, unassigned, inProgress, resolved, closed, mine, overdue`.

## Informes y métricas

- **Informe por empresa** (pantalla, CSV, PDF y Bita): la carga actual se cuenta como «Sin asignar actuales» y «En proceso actuales» (tickets activos sin y con responsable); «Vencidos actuales» cuenta todos los activos con plazo cumplido. Un ticket antiguo en «En espera» cuenta como activo, igual que en la bandeja.
- **Informes mensuales guardados antes** de este cambio no se reescriben: conservan sus «Abiertos actuales» y «Pendientes actuales» tal como se capturaron, y su CSV y PDF los muestran con esas palabras. El esquema acepta una de las dos formas, nunca una mezcla (`currentLoadRows` en `lib/knowledge-model.ts`).
- **Métricas por agente**: una sola columna «En proceso» (CSV: «En proceso actuales») con los tickets activos de cada persona; la columna «Pendientes» se retiró. Las métricas se calculan al consultarlas: no hay datos guardados que migrar.

## Pendiente

- No hay acción masiva «Cerrar seleccionados» (sí «Marcar como solucionados»).
- El cierre automático tras N días necesitaría un trabajo programado nuevo, no autorizado.

## Pruebas

`scripts/ticket-status.test.ts` cubre el modelo y dos guardas de regresión: ninguna consulta puede tratar solo `resolved` como terminado (salvo la creación de la encuesta) y ninguna pantalla vuelve a ofrecer «En espera» o «Resuelto». La prueba de navegador «the four states» recorre Sin asignar → En proceso → Solucionado → Cerrado → reabierto, las pestañas, y comprueba que cerrar sin solucionar devuelve 409.
