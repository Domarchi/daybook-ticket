# Requerimientos con seguimiento (Fase 6)

Un requerimiento es un ticket que pide algo, por ejemplo un equipo, una cuenta o un permiso, y no informa una falla. Su avance se sigue como el de una encomienda. El cliente lo pide y ve el avance; el equipo lo gestiona.

Este documento describe las reglas de **F6-B1**, que viven en `lib/fulfillment-model.ts` y `lib/asset-tag.ts`. Ese código no usa la base de datos ni el reloj: quien lo llama entrega la fecha de hoy. La tabla `ticketFulfillment` (migración 0016), las pantallas y el portal llegan en las entregas siguientes.

## Etapas

```
Solicitado → En gestión → Listo para entregar → Entregado
        (o Cancelado, con motivo, desde cualquier etapa abierta)
```

| Cambio | Permitido | Condición |
| --- | --- | --- |
| Avanzar | Sí, también saltando etapas | Un equipo en stock puede pasar directo a «Listo» o «Entregado» |
| «Listo para entregar» → «En gestión» | Sí | Exige motivo |
| Cualquier otro retroceso | No | |
| Cancelar | Desde Solicitado, En gestión o Listo | Exige motivo |
| Desde Entregado o Cancelado | No | Son etapas finales |

Los motivos y notas admiten hasta 500 caracteres.

## Retrasos

- **«Atrasado» no es una etapa.** Se calcula al leer: el requerimiento sigue abierto, tiene fecha comprometida y ese día ya pasó. El mismo día comprometido todavía no está atrasado. No hay trabajo programado.
- La **fecha comprometida** es un día (`YYYY-MM-DD`), no un instante. «Hoy» se calcula en la zona horaria del espacio, por ejemplo America/Santiago. La fecha es opcional y, si se indica, no puede estar en el pasado.
- **Informar retraso** exige:
  - un motivo de la lista: Proveedor, Sin stock, Aprobación pendiente, Logística u Otro;
  - una nota si el motivo es «Otro»;
  - una nueva fecha comprometida, desde hoy en adelante.

  El cliente ve el motivo y la nueva fecha.

## Entrega

- **Ticket:** «Entregado» deja el ticket en **Solucionado** en la misma operación y crea la encuesta de satisfacción, como al resolver hoy. Cancelar no cambia el estado del ticket.
- **Equipos:** si lo pedido es un equipo (requerimiento «Equipos»), la entrega exige el **ID del equipo**. Ese equipo queda en el inventario asignado a quien lo pidió, lo que conecta con F6-A.
- **Confirmar recepción:** es opcional, la hace quien pidió el requerimiento, una sola vez y solo después de la entrega. La entrega vale aunque no la confirme.

## ID del equipo

- **Normalización:** antes de comparar, se quitan los espacios de los extremos, se juntan los espacios interiores y se pasa a mayúsculas. Así, « nb-0042 » y «NB-0042» son el mismo equipo.
- **Formato:** letras sin tildes ni ñ, números, espacios y `- _ . /`. Debe empezar con letra o número y tener hasta 64 caracteres.

## Línea de seguimiento

- **Pasos:** cada paso queda hecho, actual o pendiente. «Entregado» completa la línea.
- **Cancelado:** los pasos alcanzados quedan hechos y «Cancelado» cierra la línea. Para saber hasta dónde llegó, se usa la etapa que tenía al cancelarse, que viene del historial.

## Pruebas

`scripts/fulfillment-model.test.ts` recorre los 25 cambios de etapa posibles, los motivos, las fechas (incluido el cambio de día en Santiago), el atraso, los retrasos, la entrega con y sin equipo, la confirmación de recepción, la línea de seguimiento y el ID del equipo.

## F6-B2: seguimiento en el ticket y sección «Requerimientos»

- **Seguir como requerimiento:** el panel aparece en un ticket abierto que tiene un requerimiento en «Clasificación». Crea la fila en `ticketFulfillment` en «Solicitado», con fecha comprometida opcional.
- **Mover de etapa:**
  - las reglas son las de `stageChangeProblem`;
  - «Entregado» no se ofrece aquí, porque registra el equipo (F6-B4);
  - cada cambio controla la versión (409) y bloquea la fila.
- **Fecha comprometida:**
  - la primera se fija libremente;
  - para cambiarla después hay que pasar por «Informar retraso», así el cliente siempre ve el motivo.
- **Informar retraso:** guarda el motivo, la nota y la nueva fecha. «Atrasado» se calcula al leer, con la fecha de hoy en America/Santiago.
- **Historial:**
  - cada paso queda en `ticketEvents`, con las acciones `fulfillment`, `fulfillment_delay` y `fulfillment_date`;
  - los valores se guardan en JSON para que el portal (F6-B3) arme su línea de tiempo;
  - `lib/fulfillment-display.ts` los convierte en texto.
- **Sección «Requerimientos»:** listas En curso, Solicitados, En gestión, Listos para entregar, Atrasados y Cerrados. Cada lista muestra su conteo, y cada fila lleva al ticket.
- **Respaldo y exportación de negocio:** incluyen `ticketFulfillment`. Los respaldos anteriores, que tienen una tabla menos, siguen validándose y restaurándose.
- **API:**
  - `GET` para quien puede abrir el ticket;
  - `POST` y `PATCH /api/tickets/[id]/fulfillment` solo para el equipo de soporte;
  - `GET /api/fulfillments?filter=` para la sección.

## F6-B3: el portal del cliente

- **Pedir:** el formulario de nuevo ticket pregunta «Tipo de solicitud». Las opciones son «Una falla o consulta», donde clasifica el sistema, o «Un pedido: Equipos / Cuentas de usuarios / Aplicaciones / Permisos de carpetas / Otros». Un pedido:
  - queda clasificado como ese requerimiento, con `categorySource='manual'`, así que el clasificador no lo cambia;
  - empieza en «Solicitado» en la misma transacción.
- **Mis requerimientos:** lista los pedidos que el cliente puede ver, propios o de su empresa si es encargado. Usa la misma regla de acceso que los tickets e indica etapa, fecha comprometida y si está atrasado.
- **En el ticket del portal:** «Seguimiento de tu requerimiento» muestra:
  - la misma línea de etapas;
  - la frase de la etapa actual;
  - la fecha comprometida, o «Te avisaremos cuando la tengamos» si aún no hay;
  - el motivo y la nota del último retraso;
  - el historial, del más reciente al más antiguo, sin nombres del equipo.
- **Lo que ve el cliente:** los motivos de volver atrás, de cancelar y de un retraso. El panel del equipo lo avisa («Motivo (lo verá el cliente)», «Nota para el cliente»).
