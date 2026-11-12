# Operador de publicación y reversión de la evolución

El operador `scripts/migrate-evolution-production.mjs` migra únicamente un prefijo explícito, contiguo y revisado de 0007 a 0016. No publica una aplicación, activa funciones, crea pilotos, exige MFA, cambia planes ni envía correo o push. No carga archivos de entorno. Las credenciales deben existir previamente como `DATABASE_URL` y `DIRECT_DATABASE_URL` en el entorno privado del proceso autorizado; nunca se pasan como argumentos ni se muestran en los informes.

## Estado revisado de esta entrega

`REVIEWED_EVOLUTION_MIGRATIONS` contiene las migraciones `0007_collaboration` a `0016_equipment_and_requirements`, con sus fechas de diario (`1793912000000` para 0007, +1000 por índice hasta `1793912009000` para 0016) y sus SHA-256 fijados en `scripts/migrate-evolution-production.mjs`. Los archivos 0000 hasta el prefijo solicitado con `--through` se comprueban contra esas constantes antes de consultar la base. Los hashes y fechas 0000–0006 reutilizan el operador de fiabilidad ya revisado, que sigue siendo el único que aplica 0006: este operador exige 0000–0006 ya aplicadas.

Un objetivo superior falla con `evolution_prefix_not_reviewed` antes de crear una conexión. Cada entrega posterior debe añadir su propia constante revisada a continuación de la anterior, después de integrar y probar su SQL en QA. No se calculan constantes nuevas automáticamente a partir de los archivos locales. La fecha de 0007 es `1793912000000`; las siguientes aumentan exactamente 1000 por índice. Una migración registrada en la base es inmutable: no se corrige su archivo ni su fecha. Una corrección necesita otra migración y revisión.

El diario completo disponible debe tener índices y nombres contiguos, fechas estrictamente ascendentes, versión 7 y dialecto PostgreSQL. El objetivo utiliza solo los archivos de su prefijo; un archivo futuro no se ejecuta por existir en el repositorio. No se puede omitir una migración intermedia ni usar este operador para retroceder una base que ya tiene un prefijo superior.

## Preparación y comandos

Antes de una publicación autorizada: comprobar CI y QA del mismo commit, vista previa protegida, respaldo verificable y punto de restauración dentro de la retención disponible. Registrar el despliegue compatible al que se puede volver. Ejecutar desde el checkout revisado, con Node 24 y las dependencias existentes. No usar el migrador genérico ni instalar o actualizar dependencias durante la publicación.

Los hosts de producción aceptados son exactamente:

- Pooled: `ep-dawn-moon-bbwpjcrp-pooler.c-15.us-east-1.aws.neon.tech`.
- Directo: `ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech`.
- Base: `daybook_ticket`; puerto omitido o `5432`.

Se exige TLS. El proceso normaliza la conexión directa a `sslmode=verify-full`, con verificación de certificado y nombre, y rechaza `NODE_TLS_REJECT_UNAUTHORIZED=0`. Solo se aceptan `sslmode=require|verify-full` y, opcionalmente, `channel_binding=require`, sin parámetros duplicados, fragmentos, opciones de servidor ni cambios de host/base por query string. El identificador real de la base vuelve a comprobarse después de conectar.

Auditoría de solo lectura, sin confirmación de escritura:

```sh
node scripts/migrate-evolution-production.mjs --audit --through=0007
```

Simulación completa con bloqueos y DDL, que termina con `ROLLBACK`:

```sh
DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET='daybook-ticket:ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket:through-0007' \
node scripts/migrate-evolution-production.mjs --dry-run --through=0007
```

Aplicación, únicamente después de la autorización de publicación y las comprobaciones del mismo artefacto:

```sh
DAYBOOK_PRODUCTION_MIGRATION_CONFIRM_TARGET='daybook-ticket:ep-dawn-moon-bbwpjcrp.c-15.us-east-1.aws.neon.tech/daybook_ticket:through-0007' \
DAYBOOK_PRODUCTION_MIGRATION_ALLOW_APPLY='evolution-through-0007' \
node scripts/migrate-evolution-production.mjs --apply --through=0007
```

Cada prefijo requiere cambiar tanto `--through` como las dos confirmaciones exactas. Una confirmación de 0007 no autoriza 0008. No existe selección implícita de «la última migración». Guardar los informes agregados en un lugar privado, con permisos restringidos; no publicar capturas del entorno ni URLs con credenciales.

## Qué comprueba

`audit` utiliza una única transacción `REPEATABLE READ READ ONLY`, consulta el diario, catálogo y huellas agregadas y termina con `ROLLBACK`. No adquiere bloqueos de migración, genera snapshots temporales, ejecuta DDL ni modifica filas.

`dry-run` y `apply` usan un solo `pg.Client` directo y una transacción exterior. Adquieren un bloqueo consultivo de evolución y bloquean el diario de Drizzle y todas las tablas públicas existentes en orden determinista. El plazo de espera de bloqueos es tres segundos; las consultas están acotadas y PostgreSQL 17 o superior recibe un límite de transacción de 180 segundos. Una aplicación activa puede esperar brevemente o recibir un conflicto; no se prolonga automáticamente la ventana de bloqueo.

Antes y después se comprueban:

- El diario completo aplicado debe coincidir con el prefijo de hashes y fechas revisados, partiendo de 0000–0006 ya aplicadas.
- Todas las definiciones originales de columnas, incluidos tipos, posiciones, nulabilidad, valores por defecto, identidad, generación y colación.
- Huellas SHA-256 y número de filas de **todas** las tablas públicas, incluso tablas ajenas a la lista de funciones conocidas, proyectando exactamente las columnas originales. Los datos permanecen en PostgreSQL; solo salen agregados y huellas.
- Tablas y columnas nuevas exactamente previstas, sus tipos y valores por defecto. Las tablas nuevas deben quedar vacías; las columnas añadidas a filas existentes solo reciben su valor literal revisado o `NULL`.
- Índices y restricciones anteriores sin cambios no autorizados. Se rechazan esquemas parciales, nuevas columnas inesperadas, reescrituras de datos y alteraciones del diario.
- Los nuevos controles de funciones, automatizaciones, recordatorios de contexto, MFA y espacios nacen desactivados o en borrador. Los controles existentes se conservan con sus datos, incluso si ya estaban activos; el operador nunca los reinicia.

Los bytes verificados se copian antes de la migración a una carpeta temporal privada `0700`, con archivos `0600`. El migrador estándar solo ve esa copia con su diario recortado al objetivo. Editar SQL o el diario del checkout concurrentemente no cambia lo que se ejecuta. La copia se elimina al terminar.

Se utiliza el adaptador de transacción revisado: el `BEGIN/COMMIT` interno del migrador instalado se convierte en un único `SAVEPOINT/RELEASE SAVEPOINT` sobre la misma conexión. Nunca puede confirmar antes de las comprobaciones exteriores. Un fallo revierte las tablas, columnas y el diario; los incrementos de secuencias PostgreSQL no son transaccionales, por lo que una simulación puede dejar un hueco inocuo en el ID serial del diario.

La gramática adicional rechaza escrituras de datos en la migración, `DO`, consultas ejecutables, reemplazos de objetos, `DROP`, `TRUNCATE` y cambios o eliminación de columnas originales. Los cuerpos de las funciones de seguridad/cuotas de 0012/0013 solo se admiten bajo nombres y formas revisados y hash de archivo fijado; no se ejecutan ni se crean filas que activen esas funciones durante la migración.

0014 solo crea dos índices sobre `tickets` (sin extensiones, datos, columnas ni restricciones); la gramática sigue rechazando `CREATE EXTENSION` y todo lo que no sea un índice.

0015 solo añade cinco columnas `text` nulas, sin valor por defecto ni restricción, a `tickets` (`faultGroup`, `faultElement`, `requirement`, `categorySource`, `categoryConfidence`). El operador verifica que ninguna fila existente quede con valor (sin relleno) y que las columnas originales no cambien. Los respaldos anteriores a 0015 siguen restaurándose porque esas columnas figuran en `ADDED_BACKUP_COLUMNS`.

0016 (Fase 6) es aditiva:
- `customerAssets.assetTag` (`text` nula) con el índice único `customer_assets_owner_tag` sobre `("ownerId","assetTag")`. Los NULL no chocan, así que las filas existentes no necesitan valor y no hay relleno.
- La tabla nueva y vacía `ticketFulfillment` con su índice `ticket_fulfillment_owner_stage`. La única restricción es el formato de `expectedOn`; las etapas y los motivos se validan en `lib/fulfillment-model.ts`.
- Los respaldos anteriores siguen restaurándose porque `assetTag` figura en `ADDED_BACKUP_COLUMNS`. `ticketFulfillment` entra en el formato de respaldo con F6-B2, el primer código que la escribe; hasta entonces está vacía.

Las dos excepciones estructurales estrechas son:

1. 0009 puede sustituir exactamente `attachments_kind`, conservando los valores actuales y ampliando el conjunto a `request`, `reply`, `note`, `contract`. Se exige la eliminación y reposición revisada juntas, y se verifica la restricción anterior y posterior.
2. 0013 puede sustituir exactamente `push_subscription_endpoint`, desde el índice único de `endpoint` al índice único de `(ownerId, memberId, endpoint)`. Se verifica la forma anterior y posterior y la conservación completa de las filas. No se permite eliminar suscripciones ni mensajes para hacer encajar una estructura antigua.

Una versión ya aplicada se comprueba sin volver a ejecutar DDL ni confirmar otra transacción de escritura.

## Fallos e incertidumbre de confirmación

Los errores públicos contienen únicamente un código propio permitido o un SQLSTATE, sin mensajes del proveedor, consultas, datos, tokens ni credenciales. Una falta de bloqueo o un cambio inesperado exige revisar su causa; no se reintenta automáticamente.

Si se pierde la respuesta de `COMMIT`, el resultado es `commit_outcome_unknown`, `committed: "unknown"` y `nextAction: "audit_before_any_retry"`. Un `ROLLBACK` posterior no demuestra que el servidor no haya confirmado. Detener la publicación y ejecutar una auditoría explícita del **mismo prefijo**, con una conexión nueva, antes de decidir cualquier acción. Revisar diario, esquema y salud; nunca volver a aplicar a ciegas ni alterar el diario para forzar un reintento.

## Ensayo en QA y pruebas locales

`runEvolutionMigrationOperator(client, { mode, through, artifacts? })` es la entrada de biblioteca. Un coordinador puede usarla con un cliente ya conectado a QA, después de comprobar separadamente el host QA exacto, base, TLS y ausencia de proveedores reales. El código de transacción, migrador, preservación y confirmación es el mismo. La CLI de producción no admite saltarse sus hosts ni cargar una política de hashes alternativa. No envolver esta entrada en otra transacción: el operador administra su transacción exterior y puede confirmar únicamente en modo `apply`.

La prueba local se ejecuta sin credenciales, bases ni red:

```sh
node --test scripts/check-evolution-production-migration.test.mjs
npx eslint scripts/migrate-evolution-production.mjs scripts/check-evolution-production-migration.test.mjs
```

Las 17 pruebas nuevas usan el migrador Drizzle realmente instalado sobre un cliente transaccional ficticio. Cubren prefijos, hashes y fechas, objetivos/TLS, snapshots privados, bloqueo, preservación de datos y catálogo, rollback, valores iniciales, controles existentes, respuesta perdida de `COMMIT` y ausencia de divulgación. También pasaron las regresiones de los operadores de notificaciones y fiabilidad: 36 pruebas en total, junto con lint y comprobación de sintaxis. No sustituyen ejecutar el SQL real en PostgreSQL de QA; ese ensayo es una comprobación adicional obligatoria del coordinador antes de publicar. Durante esta implementación no se ejecutó el operador contra QA ni producción.

## Reversión de la aplicación, conservando datos

Revertir significa pausar las funciones afectadas mediante sus interruptores y trabajos independientes, y promover un despliegue **compatible y revisado**. Conservar tablas, columnas, versiones, historial, archivos y claves de idempotencia. No ejecutar migraciones inversas destructivas, no borrar vínculos y no reescribir mediciones antiguas. La restauración de un respaldo es un procedimiento distinto, con su propia autorización y verificación; nunca se activa como respuesta automática a un fallo de despliegue.

Las protecciones ya utilizadas no se desactivan para volver atrás: conservar MFA enrolado, códigos de recuperación, políticas de seguridad, comprobación de sesiones, permisos por espacio, aceptación de la invitación concreta y el índice de push por membresía. No restablecer MFA ni bajar su exigencia automáticamente durante la reversión o restauración.

**Frontera de compatibilidad E7:** después de aceptar membresías o invitaciones de espacios independientes, no volver a un build anterior a E7. Su antiguo enlace de invitaciones por correo puede aceptar invitaciones distintas de la presentada y omite el contexto comercial. Pausar pilotos o funciones manteniendo identidad y ACL de E7 y el índice de push por espacio/membresía. Nunca eliminar membresías, invitaciones o suscripciones para recuperar el índice global anterior.

Antes del primer piloto, un despliegue anterior solo puede considerarse tras comprobar que no existen membresías múltiples, invitaciones comerciales nuevas ni datos que requieran la identidad de E7, y que conserva todas las protecciones ya activadas, incluida la publicación de artículos por empresa. No basta con que la migración haya añadido columnas nullable. Esta comprobación y la elección del despliegue compatible son pasos explícitos del responsable de publicación; el operador no los supone ni cambia los datos para satisfacerlos.
