# Puente de registro push entre E6 y E7

Publicar **esta E6 parcheada antes de aplicar la migración 0013**. La migración sustituye el índice único de endpoint por el índice compuesto `(ownerId, memberId, endpoint)`. La E6 antigua seguiría solicitando el conflicto por endpoint y PostgreSQL rechazaría esos registros mientras el despliegue E7 termina.

## Secuencia de publicación

1. Revisar y publicar E6 con `push-registration-compat.ts`, conservando el índice actual y los datos existentes.
2. Comprobar salud y registro de navegador con la E6 parcheada. No ejecutar envíos de prueba externos sin autorización.
3. Ensayar y aplicar 0013 con el operador revisado y las comprobaciones de conservación correspondientes.
4. Publicar E7, cuyo registro usa **únicamente** el objetivo compuesto. No sustituirlo por el registro heredado al integrar ramas.

El puente no modifica índices, datos históricos, secretos ni proveedores. Reutiliza las mismas operaciones de registro, máximo de diez dispositivos activos, conservación de la fecha de alta para reintentos y cancelación por cuenta de avisos antiguos.

## Único caso de compatibilidad

La E6 intenta el lote heredado en una transacción con savepoint. Solo un error del INSERT que reúna `42P10`, rutina PostgreSQL `infer_arbiter_indexes` y el mensaje exacto de ausencia del índice único correspondiente permite repetir el lote con el objetivo compuesto.

Antes de repetir se espera la confirmación de `ROLLBACK TO SAVEPOINT`. Si la confirmación falla o se pierde, no se repite. Se conservan identificador, fecha y parámetros de la primera operación. El segundo intento no tiene otro fallback y el único COMMIT ocurre al terminar todo el lote. Errores de conexión, errores de otras sentencias, respuestas inciertas de COMMIT y otros códigos SQL no provocan reintentos. Un error distinto o traducido que no cumpla la firma se rechaza de forma conservadora.

En E7 el índice compuesto separa espacios y cuentas, incluidos los que utilizan el mismo endpoint. No se debe restaurar una restricción global de endpoint ni publicar código anterior al puente después de 0013. La reversión compatible utiliza esta E6 parcheada para el espacio Daybook; retirar pilotos requiere mantener además las barreras de identidad y aislamiento de E7 ya descritas en su entrega.

## Pruebas

Las pruebas unitarias ejecutan la clase `Database` real con un cliente ficticio: ambos índices, orden de rollback/fallback/COMMIT, límite conservado, identificador estable, SQL de cancelación, error ajeno, fallo del rollback y pérdida de confirmación del COMMIT. No crean datos ni realizan entregas externas.

El coordinador puede ejecutar serialmente `scripts/check-push-registration-transition-database.mjs` con `.env.test.local` y `DAYBOOK_QA_ALLOW_TEST_DATABASE=1`. El script acepta solo el host aislado de QA y exige proveedores reales desactivados. Crea un esquema temporal propio con las dos formas del índice y comprueba idempotencia, diez dispositivos, cancelación y separación por cuenta; al terminar elimina exclusivamente ese esquema. No se ejecuta automáticamente en la suite unitaria ni en producción.
