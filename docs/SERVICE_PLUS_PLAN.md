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
| `npm run check` | PASS: lint, 167 unitarias, tipos y compilación con Node 24; proveedores y base ficticios en las comprobaciones sin integración. |
| Correo entrante | PASS: 7 grupos PostgreSQL, reintentos concurrentes, conflicto de contenido, autenticación y revocación, aislamiento empresarial, SLA/reapertura/reparto. Limpieza completa. |
| Escalamiento y satisfacción | PASS: 14 grupos PostgreSQL y cuatro bloques HTTP con sesiones ficticias; etapas, permisos, ciclos, calificación única, reportes y pausa independiente. |
| Búsqueda y paginación | PASS: 7 grupos PostgreSQL, 63 tickets y conversación paginada; notas internas excluidas, aislamiento y revocación; limpieza completa. |
| Editor, archivo y exportación HTTP | PASS: cuatro bloques, formato versionado, replay compatible con mensajes anteriores, notas protegidas y rutas de vista previa con acceso restringido. Exportación cifrada real de QA: 422 registros y seis archivos privados; descifrado y huellas comprobados. |
| Recuperación | PASS: 30 tablas con claves foráneas reales y dos archivos privados; cifrado, credenciales y microsegundos conservados, destino vacío, corrupción/rollback y COMMIT incierto. Automatizaciones y colas recuperadas en pausa. |
| Revalidación y carreras | PASS: 7 grupos; contextos obsoletos de rol, cuenta, empresa o permiso no reciben avisos ni metadatos. Carrera de dos conexiones entre comentario y entrega CSAT termina sin deadlock. |
| Operador de publicación 0005 | PASS: 16 unitarias del operador, hashes fijados, snapshot propio, guardas de destino, rollback y conservación. No ejecutado en producción. |

Las pruebas no enviaron correos ni push reales. La revisión visual, regresiones completas, CI remoto y Preview se registrarán al cerrar el candidato.
