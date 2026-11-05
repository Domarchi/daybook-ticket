# Daybook Ticket: horarios, asignación y métricas

## Alcance y conservación

Entrega revisable desde producción `b696f73f1022d89da4b64a51c51f534080083ad7`, en la rama `codex/daybook-ticket-operations` y su worktree aislado. Solo Daybook Ticket. No fusionar ni publicar esta entrega en producción hasta una autorización posterior.

Conservar usuarios, contraseñas, sesiones, empresas, tickets, conversaciones, adjuntos, avisos e historial de correo. Migración aditiva, sin seeds productivos ni reconstrucción inventada de datos históricos. QA utiliza únicamente la base aislada existente y personas ficticias; correo y push reales desactivados. No instalar dependencias ni modificar el node_modules compartido, DNS, otros proyectos o planes.

## Decisiones confirmadas

El propietario eligió **SLA de resolución por empresa, conservando el aviso de dos horas sin respuesta**. Los avisos y recordatorios continúan funcionando 24/7; el calendario de atención define el vencimiento de resolución.

### Horarios y SLA

- Configuración general y excepciones completas por empresa: horas de resolución por prioridad, zona IANA, atención continua o ventanas semanales, y fechas no laborables introducidas por administración.
- Sin una política nueva, se conservan las horas actuales y el funcionamiento continuo. No importar automáticamente feriados legales.
- El cálculo considera fines de semana, fechas no laborables y cambios de hora de la zona elegida. Se validan intervalos, solapamientos, fechas y horizontes imposibles.
- Nuevos tickets guardan una instantánea de la política y el inicio del plazo. Modificar una política no recalcula tickets existentes.
- Cambiar prioridad utiliza la instantánea y el inicio del ciclo. Reabrir establece un ciclo nuevo con la política vigente; cambiar empresa por sí solo no altera el vencimiento.
- Tickets anteriores conservan su dueAt y su comportamiento previo hasta una transición explícita aplicable. No inventar calendarios históricos.
- Una sola interfaz edita el SLA general; el API anterior de ajustes conserva compatibilidad y sincronización.

### Asignación automática

- Reglas administrativas ordenadas por prioridad con filtros opcionales de empresa y departamento, y una lista explícita de integrantes elegibles.
- Reglas nuevas desactivadas inicialmente. Aplicación exclusivamente a tickets nuevos sin responsable indicado manualmente; ningún reparto retroactivo.
- Primera regla coincidente: elegir al integrante activo, con cuenta, disponible y por debajo de su capacidad automática, con menos tickets abiertos/en espera. Desempate por asignación automática más antigua y luego identificador.
- Sin candidatos disponibles, dejar sin asignar. La asignación manual conserva su prioridad y puede exceder la capacidad automática.
- Disponibilidad propia editable por integrantes del equipo; administración gestiona capacidades y otras personas. Clientes, invitados y revocados nunca reciben asignaciones.
- Serializar decisiones y cambios de responsable por espacio antes de bloquear membresías/tickets. Mantener las versiones optimistas y la idempotencia de creación.
- Registrar asignaciones automáticas reales en la actividad. Reutilizar los avisos existentes, sin un correo adicional por asignación.

### Métricas por agente

- Pantalla de administración con período y empresa, exportación CSV y estados de carga, vacío y error.
- Carga actual por responsable, respuestas públicas del período, primera respuesta, resoluciones y cumplimiento de SLA.
- Atribuir respuestas a su autor real y resoluciones a quien ejecutó la transición; las notas internas no cuentan como respuestas al cliente.
- Tiempos de atención expresados como horas transcurridas; fechas de los filtros en America/Santiago. La carga actual se distingue de los hechos del período.
- Registrar resultados de SLA desde transiciones reales de resolución, guardando vencimiento y ciclo. No deducir cumplimiento histórico a partir de un vencimiento editable hoy.
- Mostrar cobertura/ausencia de información: autores desconocidos y resoluciones anteriores no se convierten en ceros ni en incumplimientos ficticios.
- Solo administradores pueden consultar métricas del equipo; filtros y consultas siempre limitados al espacio autorizado.

## Orden de implementación

1. Modelos y migración aditiva; calendario y validaciones puras; contratos de APIs.
2. Integración transaccional de SLA, reparto, reaperturas y registro de resoluciones en las operaciones actuales.
3. Interfaces de políticas, disponibilidad, reglas y métricas, manteniendo la identidad Daybook y uso móvil.
4. QA en serie, revisión cruzada, comprobaciones locales/CI y vista previa protegida.
5. Entregar PR, evidencia y procedimiento de publicación/reversión; no activar reglas productivas ni recalcular históricos automáticamente.

## Aceptación

- Migración conserva todas las filas y columnas preexistentes por huellas SHA-256 en QA.
- Calendarios: 24/7, ventanas, fines de semana, fechas no laborables, zonas distintas y cambios de hora; reglas inválidas rechazadas.
- Empresas aisladas; APIs administrativas denegadas a clientes y miembros revocados, incluyendo revocaciones concurrentes.
- Cambios de política no alteran vencimientos existentes; prioridad y reapertura usan el inicio correcto del ciclo.
- Creaciones simultáneas respetan capacidad, disponibilidad y reparto; una toma manual no es sobrescrita. Reintentos no duplican tickets, asignaciones, eventos ni avisos.
- Métricas verificadas contra hechos ficticios conocidos: autor real, notas excluidas, reaperturas, períodos, empresas, cobertura y cumplimiento con vencimiento congelado.
- Regresiones de acceso, empresas, borradores, archivos, avisos, entrega y recordatorios existentes.
- Lint, tipos, pruebas unitarias/integración y compilación correctos; revisión visual en computador/móvil y Preview protegido.

## Publicación y reversión

La autorización actual permite preparar y comprobar esta versión. Producción permanece sin cambios. La publicación posterior requiere revisar respaldo/restauración disponible, ensayar la migración con preservación, registrar el estado productivo y promover un build revisado.

Para detener el reparto, deshabilitar reglas, conservando asignaciones e historial. Las políticas nuevas no modifican vencimientos ya almacenados. No borrar columnas ni resultados de métricas al volver de versión. Un build anterior desconoce instantáneas/calendarios: revisar sus efectos sobre futuras prioridades y reaperturas antes de elegirlo como reversión; preferir desactivar funciones conservando el build compatible.

## Resultados

Implementación completada en el worktree aislado, con QA el 4 de noviembre de 2026 (America/Santiago). Producción no se modifica en esta entrega.

| Comprobación | Evidencia |
| --- | --- |
| Migración aditiva `0004` en QA | PASS: 25 tablas y 445 filas previas conservadas, comparando todas sus columnas originales mediante SHA-256. Nuevas tablas vacías y campos de ticket sin backfill. |
| Lint, tipos y compilación | PASS con Node 24.22.0, Next 16.3.4 y dependencias existentes. Sin instalaciones ni cambios en el lockfile. |
| Pruebas unitarias | 121 PASS, incluidas calendario/DST, selección por carga, métricas/CSV y operadores de migración actuales y anteriores. |
| Políticas en PostgreSQL QA | 10 grupos PASS: herencia, sincronización, aislamiento, revocación, rollback y conflictos de versión/identidad al eliminar y recrear. Dos tickets de control sin alteraciones. |
| Reparto en PostgreSQL QA | 7 grupos PASS: diez creaciones simultáneas, ocho asignadas y dos sin asignar, respetando capacidad cuatro por agente; sin sobreasignación ni escrituras duplicadas. |
| Métricas en PostgreSQL QA | PASS: autor real, notas excluidas, roles desconocidos, tiempos, carga, vencimiento/empresa congelados, reaperturas, permisos y rollback; cero fixtures restantes. |
| Recorrido HTTP sobre build compilado | PASS: cuatro cuentas ficticias, dos empresas y doce tickets. Incluye snapshot/prioridad, reaperturas por equipo/cliente, notas privadas, métricas, permisos y revocación. Seis creaciones simultáneas reparten cuatro tickets (dos por agente) y dejan dos sin asignar; reintentos conservan asignación, eventos y avisos. Limpieza verificada de cuentas, tickets, empresas, operaciones, resultados y reglas. |
| Regresiones de acceso y empresas | PASS con sesiones reales: invitaciones, aislamiento, encargados, revocación, expiración, rate limit, notas privadas y paridad de autorizaciones en correo/push. |
| Adjuntos privados | PASS con transporte inyectado: cuotas concurrentes, tokens, permisos, rollback, descargas, notas internas, caducidad y limpieza. No se repite carga Blob real; el mecanismo de almacenamiento no cambia. |
| Avisos, entrega y recordatorios | PASS en base y HTTP: lectura persistente y carreras, webhooks firmados/repetidos/desordenados, payloads congelados, etapas/reasignación y worker con lease/cursor/recuperación/salud. Cero entregas externas. |
| Compatibilidad del editor SLA anterior | PASS: la primera edición explícita y las siguientes invalidan editores obsoletos. Las 26 filas de tickets, sus vencimientos e instantáneas y la configuración de avisos permanecen idénticos; acuerdo/ajustes restaurados exactamente y sesión de prueba cerrada. |
| Revisión visual | Paneles de horarios y métricas revisados en escritorio y móvil; tabla desplazable dentro de su contenedor, navegación accesible y selección manual conservada al recuperar borrador. Vista previa privada revisada al entregar. |

La vista previa usa únicamente QA, con worker deshabilitado y sin claves de envío. CI ejecuta el mismo lint, pruebas unitarias, tipos, build y compilación del pinger con valores ficticios; su estado y el enlace de Preview se consultan en el PR de esta rama. Ver [procedimiento de publicación y reversión](OPERATIONS_RELEASE.md) y [comandos de QA](OPERATIONS_QA_COMMANDS.md).

Se corrigieron además dos problemas detectados por revisión cruzada: autores antiguos con roles desconocidos no reciben atribuciones inventadas, y un editor antiguo no puede sobrescribir una política eliminada y recreada aunque coincida su número de versión. Las selecciones explícitas «Sin asignar (manual)» se conservan en los borradores.
