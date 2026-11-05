# Entrega 1: colaboración y presentación

## Comportamiento

El equipo y los clientes pueden citar mensajes autorizados y volver al original, incluso fuera del lote de conversación cargado. Las notas solo se citan dentro de otras notas. Las menciones identifican cuentas activas del equipo y generan avisos privados. Seguir un ticket suma sus actualizaciones públicas sin cambiar responsable ni quitar destinatarios obligatorios.

La búsqueda consulta todo el historial autorizado. La galería pagina archivos y filtra por nombre, tipo y fechas de Santiago; conserva las rutas privadas de vista previa y descarga. Listado, contexto, búsqueda y entrega de avisos vuelven a comprobar pertenencia y permisos.

Se añaden selector claro/oscuro/automático por cuenta, negro neutro y dorado, y detalles del ticket plegables en móvil. El texto de los borradores continúa separado por cuenta, rol y ticket. Las referencias de cita y selección de menciones se conservan mientras está abierto el editor; al recargar se recupera el texto y debe elegirse de nuevo la referencia.

## Preparación y conservación

La migración aditiva `0007_collaboration` agrega referencias opcionales y cuatro tablas. No cambia contraseñas, miembros, estados, vencimientos ni mensajes anteriores. No genera menciones o seguidores retroactivos. Los nuevos campos opcionales no cambian las claves de reintento antiguas. Los respaldos aceptan perfiles por conjuntos exactos de tablas y restauran citas con clave diferida.

Todas las funciones nuevas nacen desactivadas. Un administrador habilita «Conversaciones colaborativas» después de revisar. La obligación de MFA es una política independiente y no se desactiva con este panel.

## Evidencias de QA

- 252 pruebas unitarias; lint, tipos y compilación de producción.
- Ocho grupos de pruebas de base, con rollback y sin correo/push real: citas y audiencia, menciones, reintentos, revocación, búsqueda, archivos, seguidores y preferencias aisladas.
- Ensayo y aplicación serial de la migración en QA: 39 tablas y 506 filas preexistentes con huellas idénticas de todas sus columnas originales.
- Ticket ficticio #379: nota privada no consultable por cliente; reenvío de respuesta con el mismo `operationId` devuelve el mensaje original; búsqueda completa y contexto anterior a los 50 mensajes recientes comprobados por HTTP y navegador.
- Revisión de escritorio y 390×844: claro/oscuro, búsqueda, salto al original, cita privada abre nota y desaparece al volver a respuesta pública, galería y detalles plegables. Sin desbordamiento horizontal.

Las capturas locales se guardan en `outputs/evolution-01/`. Las pruebas usan únicamente `.env.test.local`, cuentas `example.test` y registros de prueba. La programación y los proveedores externos permanecen desactivados.

## Publicación y reversión

1. Revisar PR, CI del commit exacto y Preview protegida. No publicar una rama posterior antes de revisar sus dependencias.
2. En la ventana de publicación autorizada, crear respaldo cifrado y verificar recuperación y archivos privados. Registrar inventarios y huellas sin extraer contenido sensible.
3. Ensayar la migración acumulada sobre QA, aplicar únicamente el prefijo revisado con un operador que valide el destino, diario y hashes; comparar las columnas y filas preexistentes dentro de la misma transacción. No usar un operador histórico de otra migración para saltarse estas comprobaciones.
4. Publicar el commit revisado con funciones pausadas, comprobar acceso, conversación, descarga y salud, y habilitar colaboración explícitamente.
5. Para detener la función, apagar su interruptor. Para volver a la aplicación anterior, promover el despliegue anterior conservando las tablas aditivas; no ejecutar migraciones destructivas ni restaurar una copia antigua sobre nuevos tickets.

Esta entrega no publica producción, cambia DNS, activa MFA ni habilita negocios comerciales.

## Candidato revisable

Código validado localmente en `9f7efa1`: `npm run check` final aprobado (252 pruebas), segunda pasada de lint sin advertencias, ocho grupos QA con rollback y recorrido HTTP/visual de #379. Este registro autenticado solicita únicamente la construcción del Preview protegido de la entrega 1. Producción y proveedores reales siguen sin cambios.

## Ensayo de recuperación ampliado

El primer CI detectó un error de limpieza del ensayo: las preferencias se identifican por `userId`, no por `ownerId`. Se corrigió el alcance de limpieza y se añadieron fixtures de cita, seguimiento y tema. La recuperación QA posterior pasó con 40 tablas, dos archivos privados, claves foráneas reales, huellas exactas y limpieza completa de cuentas/esquemas ficticios. No hubo envíos externos.

La corrección del ensayo está en `0eaf98f`; su recorrido QA completo terminó con `QA recovery cleanup PASS`. El contenido y las capturas del chat siguen correspondiendo al código revisado de la entrega 1.

## Corrección de recuperación de borradores y orden de bloqueos

La primera revisión conservaba el texto del borrador, pero la cita y las menciones vivían solo en memoria. Si el servidor guardaba un mensaje y se perdía la respuesta, una recarga podía quitar esos campos y producir otra `operationId` al reintentar. Esta corrección guarda únicamente identificadores de cita/menciones por cuenta, rol, ticket y audiencia; recupera los intentos inciertos antiguos solo cuando el texto coincide y no existe una selección posterior explícita. Mantiene valores explícitos como `null`, listas vacías y el orden original de menciones para conservar el hash del intento anterior. Los borradores sin referencias siguen omitiendo esos campos.

Las citas recuperadas se consultan otra vez en el endpoint autorizado de contexto. No se guarda el texto citado en el navegador. Una revocación, nota privada en el portal de cliente o error de red no muestra contenido antiguo ni elimina silenciosamente el identificador; permite reintentar la comprobación o retirar la cita. Respuesta pública y nota tienen referencias independientes. La finalización de un envío lento compara texto y referencias, conservando una cita o mención nueva aunque el cuerpo no haya cambiado.

`DraftOperations` compara objetos de forma canónica sin cambiar arrays, campos omitidos o `null`, por lo que la reordenación de claves conserva IDs ya almacenadas. Los adjuntos mantienen su recuperación actual de recepción incierta. El helper genérico `readNewTicketOrganization` / `writeNewTicketOrganization` admite hasta 20 valores escalares acotados y el identificador del tipo; no contiene definiciones ni permisos E2. Su conexión a los formularios corresponde a la entrega 2. `clearNewTicketDraft` limpia también los metadatos y el recibo ya confirmado.

El seguimiento toma el bloqueo de trabajo del espacio antes de bloquear al miembro y ticket. El envío reserva los mencionados antes del ticket, con una comprobación de acceso previa que evita revelar la existencia de citas de otros tickets. Esto elimina la inversión respecto de lectores de pertenencia y de tareas/metadatos integrados.

Validación local de esta corrección: pruebas de almacenamiento, recarga, pérdida de respuesta, audiencias, revocación y compatibilidad de recibos. `scripts/check-collaboration-draft-locks-database.mjs` queda preparado para QA serial con dos conexiones y rollback total; **no se ejecutó en este worktree**. La revisión visual anterior no cubre los estados nuevos de recuperación: el coordinador revisará esos estados junto con la integración E2 antes de publicar.

Cierre local de la corrección (2026-11-05): lint pertinente sin errores ni advertencias; `npm run typecheck` y `npm run build` aprobados; 30/30 pruebas de borradores, colaboración y UI existentes aprobadas, más 10/10 de recuperación después del ajuste final del helper de metadatos. Sintaxis del QA de bloqueos y `git diff --check` aprobados. Sin ejecución de QA mutante, migraciones ni cambios en proveedores o producción.
