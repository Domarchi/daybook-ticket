# Clasificación automática de tickets (Fase 5-C, 11 nov 2026)

El clasificador es código puro. Sus columnas llegan con la migración 0015 (F5-B, más abajo); la integración (guardar la categoría al crear el ticket, mostrarla, corregirla, filtrar) es F5-D.

## Categorías (`lib/ticket-category-model.ts`)

- **Elemento fallado** (grupo → elemento):
  - *Equipos y periféricos*: Monitor, Computador, Teclado, Mouse, Impresora, Docking, Celular, Otro.
  - *Conectividad*: Servicios Internet, Redes móviles, Red computacional, Red WiFi.
  - Acceso y contraseñas · Aplicaciones Microsoft · Aplicaciones No Microsoft · Aplicaciones DayBook · Otros.
- **Requerimiento**: Equipos, Cuentas de usuarios, Aplicaciones, Permisos de carpetas, Otros.
- La **descripción de la falla** es el cuerpo del ticket.

Los identificadores (`equipment`, `printer`, `folder_permissions`…) son estables y son los que se guardarán; las etiquetas se pueden cambiar sin migrar datos. **«Equipos y periféricos» y «Conectividad» son nombres provisionales**: el pedido no nombraba esos dos grupos.

## Cómo decide (`lib/ticket-classifier.ts`)

- Normaliza el texto (sin acentos ni mayúsculas, solo letras y números) y busca **palabras completas** de listas fijas; `imprim*` también cubre «imprimir», «imprime». Solo mira los primeros 5000 caracteres.
- Cada palabra suma un peso; si aparece en el **asunto** vale el doble. Gana el grupo con más puntos y, dentro de él, el elemento con más puntos. Si nada coincide: **Otros** con confianza baja.
- **Falla o pedido**: si el texto pide algo («necesito», «solicito», «instalar»…) y no describe una falla («no funciona», «error», «no puedo»…), es un requerimiento puro y no se propone elemento fallado. Si hay ambas cosas, se proponen las dos.
- Devuelve `confidence` (`high` cuando un grupo gana con claridad) y `matched`, las palabras que decidieron, para mostrar el porqué («impresora, tóner»).
- No envía el texto a ningún servicio. La firma `TicketClassifier` permite cambiar el motor más adelante (por ejemplo, una IA si se autoriza) sin tocar el resto.

## Cuánto acierta

- **Corpus de desarrollo** (61 frases escritas junto con las reglas): 100 % en grupo, elemento y requerimiento. Es un techo, no una estimación.
- **Frases nuevas** (20, escritas después y con otras palabras, **sin ajustar las reglas**): 17/20 = **85 %**. La prueba falla si baja de 80 %.
- Fallos conocidos de ese segundo grupo, ejemplos de lo que enseñarán los tickets reales:
  - «el compu no da imagen» → Otros (no conoce «compu»).
  - «mi teléfono no recibe llamadas» → Otros (solo conoce «celular», «teléfono móvil»…).
  - «hay que bloquear la cuenta de una persona que se fue» → Otros (no reconoce el pedido de baja).

Lo sensato es medir con tickets reales después de F5-D: las correcciones manuales (que el bot nunca pisa) dirán qué palabras faltan.

## Datos: migración 0015 (F5-B)

`drizzle-postgres/0015_ticket_categories.sql` añade a `tickets` cinco columnas `text` **nulas, sin valor por defecto y sin restricción**:

| Columna | Contenido |
| --- | --- |
| `faultGroup`, `faultElement` | grupo y elemento fallado (`equipment` / `printer`…); nulo si es un pedido sin falla |
| `requirement` | requerimiento (`folder_permissions`…), o nulo |
| `categorySource` | `bot` (sugerido) o `manual` (corregido por una persona; el bot nunca lo pisa) |
| `categoryConfidence` | `high` o `low` de la sugerencia |

- **Sin restricción en la base** a propósito: los valores válidos están en `lib/ticket-category-model.ts`. Cambiar la lista no exige DDL destructivo, que el operador no permite.
- **Sin relleno**: los tickets existentes quedan sin categoría. Clasificar los antiguos, si se quiere, será una acción aparte y explícita.
- **Respaldos**: las cinco columnas están en `ADDED_BACKUP_COLUMNS.tickets`, así que un respaldo anterior a 0015 se sigue restaurando (`scripts/ticket-category-backup.test.ts`).
- **Fusionar antes de aplicar es seguro**: ninguna consulta lee `tickets` entero con Drizzle (todo es SQL explícito) y el código actual no usa estas columnas. Fusionar el PR y aplicar la migración son independientes.

### Ensayo (11 nov 2026)

PostgreSQL 17 desechable en Docker, migrado hasta 0014 con 97 000 tickets y 388 000 mensajes (79 tablas, 485 000 filas), y el **operador real** de producción:

- `audit`: PASS, pendiente `0015_ticket_categories`.
- `dry-run`: PASS y revertido (diario sigue en 15 filas, columnas no creadas); confirma 0 filas con valor en las cinco columnas.
- `apply`: PASS en 7,6 s en total (la mayor parte es la huella de las 79 tablas; añadir columnas nulas sin defecto solo toca el catálogo). Después: diario de 16 filas, cinco columnas `text` nulas sin defecto, 0 tickets con valor, solo la extensión `plpgsql`, huellas de las tablas originales idénticas.
- `audit` posterior: `already_applied_no_changes`.

### Para aplicarla en producción (orden expresa con ventana)

1. Respaldo nuevo (`prod-run.sh backup`) y `e-audit 0015`.
2. Subir el límite de `need_n()` a 0015 en `outputs/handoff-review/prod-run.sh` (fuera de Git).
3. `e-dry 0015`.
4. La persona autorizada crea `~/.config/daybook-prod/ARMED`.
5. `e-apply 0015` con `...:through-0015` y `DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY=evolution-through-0015`.
6. Verificar diario (16 filas), las cinco columnas y las huellas; borrar `ARMED`.

No hay reversión automática: quitar las columnas sería DDL destructivo con orden expresa. No hace falta para volver atrás el código, porque nada las exige.
