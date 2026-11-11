# Clasificación automática de tickets (Fase 5-C, 11 nov 2026)

Código puro, sin base de datos ni interfaz todavía: la integración (guardar la categoría al crear el ticket, mostrarla, corregirla, filtrar) es F5-D y necesita la migración 0015 (F5-B).

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
