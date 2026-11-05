# Daybook Ticket: seis mejoras de servicio

Base publicada: `main@122b83f815b51b37756b625af7e8b8e5e8ea99a6`. Rama aislada: `codex/daybook-ticket-service-plus`. Autorizado implementar los seis puntos sin detener el trabajo independiente. Esta entrega prepara una versión revisable; no cambia producción, el dominio de Consorcio C17 ni servicios de pago.

## Entrega

1. Correo entrante para cuentas invitadas activas, creación y respuesta con direcciones privadas por destinatario, firma de Resend, autenticación DMARC calculada por el proveedor, permisos actuales y deduplicación transaccional. Separar QA/producción. Los correos con adjuntos se rechazan completos con un motivo visible para administración y una indicación de usar el portal; nunca guardar texto aparentando haber recibido los archivos. No modificar MX del dominio existente. Conservar payloads congelados anteriores.
2. Escalamiento configurable a otro encargado activo ante falta de respuesta o vencimiento, inicialmente desactivado, con etapas idempotentes y revalidación antes de entregar. Conserva responsables y los recordatorios actuales; no hace reasignaciones encubiertas.
3. Encuesta por resolución futura real, puntuación 1–5 y comentario, solo solicitante autorizado. Evitar dobles envíos, invalidar nuevas respuestas a encuestas de ciclos reabiertos y resumir por empresa/agente con atribución congelada.
4. Editor con negrita, cursiva, listas, código y enlaces seguros, vista previa y formato versionado. Los mensajes históricos continúan como texto. Vista previa autenticada de imágenes/PDF con la misma autorización que la descarga; ningún enlace Blob público.
5. Búsqueda en conversaciones y metadatos, paginación en servidor y carga acotada por ticket. Clientes nunca reciben coincidencias, notas, archivos o contadores privados. Conservar filtros, borradores, enlaces directos, avisos y selección limitada a lo visible.
6. Exportación cifrada de cuentas, empresas, tickets, conversaciones, notas, archivos enviados, acuerdos e historial. AES-256-GCM y clave proporcionada por propietario, sin almacenamiento de la clave. Recuperación operativa en un destino vacío con validación de huellas y contenido de archivos, con entregas y automatizaciones en pausa. Sesiones, tokens temporales y adjuntos sin enviar no son accesos portables y se excluyen. Límites iniciales explícitos: 100.000 filas, 24 MiB de datos y 128 MiB de archivo; para volúmenes superiores, usar el respaldo operativo de Postgres y Blob documentado.

## Conservación y pruebas

Migración aditiva `0005_service_plus`, sin reconstruir historia ni recalcular vencimientos. Datos ficticios de QA, correos/push simulados, sin claves productivas. Pruebas que mutan la base en serie y limpieza comprobada. Dependencias existentes sin instalaciones ni cambios al árbol compartido.

Aceptar solo tras lint, tipos, unitarias, integraciones de correo entrante/escalamiento/encuestas/búsqueda, recuperación de datos y archivos, regresiones de acceso/avisos/SLA/adjuntos, compilación y revisión visual en escritorio y móvil. Preparar PR, vista previa protegida cuando la configuración de QA esté disponible y procedimiento de publicación/reversión.

## Activación externa

Correo entrante requiere dirección receptora Resend del proyecto, clave de lectura de correo recibido, secreto de webhook independiente y secreto de capacidades por entorno. Una clave limitada a envío no sirve para recibir. La interfaz mostrará su estado real y no anunciará recepción habilitada hasta que funcione el webhook. Revisar cuota sin contratar planes. La configuración productiva y la prueba con correos reales se realizan después de revisar el candidato. La recuperación no sobrescribe una base existente ni restaura automáticamente sesiones activas.

## Evidencias

Se registrarán aquí los resultados reales y límites de la entrega. Los recibos privados de QA se guardan en `work/` y las capturas en `outputs/`, ignorados por Git.

Validación inicial del 5 de noviembre:

| Comprobación | Resultado |
|---|---|
| Migración QA 0005 | PASS: 29 tablas y 448 filas originales conservadas por huellas de sus columnas previas; sin historia ni formatos reinterpretados. |
| `npm run check` | PASS: lint, 180 unitarias, tipos y compilación con Node 24; proveedores y base ficticios en las comprobaciones sin integración. |
| Correo entrante | PASS: 7 grupos PostgreSQL, reintentos concurrentes, conflicto de contenido, autenticación y revocación, aislamiento empresarial, SLA/reapertura/reparto. Limpieza completa. |
| Escalamiento y satisfacción | PASS: 14 grupos PostgreSQL y cuatro bloques HTTP con sesiones ficticias; etapas, permisos, ciclos, calificación única, reportes y pausa independiente. |
| Búsqueda y paginación | PASS: 7 grupos PostgreSQL, 63 tickets y conversación paginada; notas internas excluidas, aislamiento y revocación; limpieza completa. |
| Editor, archivo y exportación HTTP | PASS: cuatro bloques, formato versionado, replay compatible con mensajes anteriores, notas protegidas y rutas de vista previa con acceso restringido. Exportación cifrada real de QA: 422 registros y seis archivos privados; descifrado y huellas comprobados. |
| Recuperación | PASS: 30 tablas con claves foráneas reales y dos archivos privados; cifrado, credenciales y microsegundos conservados, destino vacío, corrupción/rollback y COMMIT incierto. Automatizaciones y colas recuperadas en pausa. |
| Revalidación y carreras | PASS: 7 grupos; contextos obsoletos de rol, cuenta, empresa o permiso no reciben avisos ni metadatos. Carrera de dos conexiones entre comentario y entrega CSAT termina sin deadlock. |
| Operador de publicación 0005 | PASS: 16 unitarias del operador, hashes fijados, snapshot propio, guardas de destino, rollback y conservación. No ejecutado en producción. |

Comprobaciones adicionales del candidato:

- Diez regresiones PostgreSQL anteriores: SLA, reparto, métricas, avisos, seguimiento, recordatorios, empresas, drenaje, entrega dirigida y adjuntos: PASS, limpieza completa y proveedores simulados.
- Vista previa de archivos: ocho comprobaciones de bytes PNG/PDF, cabeceras privadas y aislamiento con permisos actuales: PASS, limpieza completa.
- Recuperación con Vercel Blob privado de QA: PASS, dos objetos escritos, recuperados y verificados; objetos, cuentas y esquemas aislados eliminados.
- Auditoría de biblioteca del operador productivo contra QA en READ ONLY: PASS, 33 tablas y 459 filas, sin DDL ni backfill. No ejecutado en producción.
- GitHub Actions en `8911f9f`: checks y simulacro de recuperación en Postgres 17: PASS.
- Preview protegida de QA: https://daybook-ticket-service-plus-qa-domarchi.vercel.app. Login de la aplicación verificado mediante la cuenta Vercel; se conserva la protección del despliegue y la autenticación de Daybook.

Revisión visual en QA: PASS en escritorio y móvil. Cliente → solicitud con PNG/PDF privados → respuesta con formato del equipo → resolución → evaluación de cinco estrellas → informe por empresa/agente. Se comprobó la descarga PDF contra los bytes del archivo original y su renderizado nativo en Chrome. Se revisaron la configuración de escalamiento, los estados de correo sin activar, el formulario de respaldo y las ocho plantillas HTML/texto. Se corrigieron contraste, selecciones revocadas, etiquetas de eventos y compatibilidad del visor; se conservaron la autorización y la descarga privada. Limpieza visual: un ticket, una cuenta y dos objetos QA eliminados; producción intacta.

Endurecimiento final: el respaldo limita filas y bytes en PostgreSQL antes de materializarlos; excluye invitaciones y credenciales OAuth portables y también las invalida al recuperar archivos v1 anteriores. Conserva identidades y hashes de contraseña. El logger de autenticación conserva la gravedad de fallos sin registrar SQL ni tokens. Unitarias de estos casos, lint y tipos: PASS; compilación final: PASS.

Cierre de regresiones HTTP: seis de seis PASS (acceso, operaciones, SLA heredado, avisos, equipo/empresas/adjuntos y responsables de notificación), con limpieza de cada cohorte y restauración de ajustes. Hubo dos interrupciones de entorno resueltas y reintentadas: terminación externa del servidor local y trabajador manual QA desactivado. No se relajaron las aserciones ni se cambió la programación remota. El trabajador se habilitó únicamente en el proceso local de prueba, sin claves de envío; el servidor se cerró al finalizar HTTP.

Exportación HTTP final: cuatro bloques PASS sobre el código con las correcciones de credenciales temporales y preflight de tamaño; archivo cifrado descifrado y comprobado en memoria, 420 registros y seis archivos privados de QA. Limpieza completa de cuentas, tickets, operaciones, sesiones y empresas ficticias de esa ejecución.

CI remoto del código `9253e6d`: checks de Node 24 y ensayo de recuperación cifrada en PostgreSQL 17 PASS, incluidos los casos de invitación vigente y archivo v1 anterior. La última referencia, sus checks y la vista previa revisable se consultan en https://github.com/Domarchi/daybook-ticket/pull/4. Se conserva Vercel Authentication en Preview; el acceso ficticio de revisión está descrito en un archivo local privado de `work/`, que no se versiona.

Las pruebas no enviaron correos ni push reales. Producción, Consorcio C17, sus DNS y sus claves permanecen fuera de esta entrega. La activación productiva del correo entrante y las reglas nuevas se realiza siguiendo `SERVICE_PLUS_RELEASE.md`, después de revisar el candidato.

Recuperación final contra Neon y Blob privado de QA: PASS en 30 tablas y dos archivos. Se verificaron huellas, claves foráneas, credenciales locales y microsegundos, exclusión de credenciales temporales, imposibilidad de reutilizar una invitación v1 vigente, conservación de integrantes invitados, destino ocupado, rollback por corrupción y conservación de archivos ante COMMIT incierto. Limpieza final PASS de cuentas, objetos privados y dos esquemas aislados. Informe privado consolidado de ocho scripts: `work/REGRESSION_HTTP_SERVICE_PLUS_2026-11-05/FINAL_EIGHT_SCRIPTS_RESULT.2026-11-05.json`.
