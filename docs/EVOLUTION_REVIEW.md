# Daybook Ticket: revisión de la evolución E0–E7

Borrador de cierre del 5 de noviembre de 2026. Reúne la implementación, las evidencias locales y los pasos que siguen pendientes. **Producción permanece sin cambios:** no se han publicado estas entregas, migrado datos productivos, enrolado cuentas reales en MFA ni activado pilotos o trabajos nuevos.

El alcance es exclusivamente `Domarchi/daybook-ticket`. Se conservan usuarios, contraseñas, sesiones, empresas, tickets, conversaciones, archivos y las reglas existentes de SLA. Consorcio C17 y otros proyectos quedan fuera. No se han contratado servicios, ampliado planes ni modificado DNS.

Los recuentos indicados corresponden a candidatos concretos ya comprobados, no a una certificación del HEAD siguiente. Los checks finales de E6, incluido su puente push, y E7 están en proceso; el coordinador completará aquí sus SHA, resultados y estados de GitHub antes de aprobar una publicación.

## Matriz de entregas y revisión

| Entrega / PR | Funciones principales | Código, comprobaciones y QA disponibles | Estado de cierre |
| --- | --- | --- | --- |
| E0 · [PR #6](https://github.com/Domarchi/daybook-ticket/pull/6) | Base de fiabilidad y chat moderno, borradores y recuperación de envíos. | Código base `d6b51ca`; CI de código aprobado y Preview READY del registro `ae0b039`. Véase [plan de evolución](EVOLUTION_PLAN.md). | Base revisada; sin promoción productiva. |
| E1 · [PR #7](https://github.com/Domarchi/daybook-ticket/pull/7) | Citas, menciones en notas, seguidores, búsqueda completa, archivos, temas y controles de funciones. | Candidato `c8fde73`: lint, tipos, 280 pruebas y build. Ocho grupos QA, recuperación de borradores y permisos; recuperación de 40 tablas y dos archivos. | Implementación y QA revisadas; confirmar CI y Preview del SHA elegido al publicar. |
| E2 · [PR #8](https://github.com/Domarchi/daybook-ticket/pull/8) | Etiquetas, tipos, formularios/campos versionados, tareas, vistas personales y motivo de espera. | Candidato `11962f2`: lint, tipos, 292 pruebas y build. Ocho grupos QA; recorrido de creación/reintento, controles de cliente y recuperación de 45 tablas y dos archivos. | Implementación y QA revisadas; conservar la definición histórica de los campos. |
| E3 · [PR #9](https://github.com/Domarchi/daybook-ticket/pull/9) | Empresas, sedes, contactos responsables, inventario, servicios, contratos, documentos privados y avisos de fechas. | Código revisado `8ce2f01` y cierre documental `9d8375c`: 301 pruebas, lint, tipos y build. Trece escenarios QA; contratos internos, vínculos y SLA intacto. Recuperación de 57 tablas y tres archivos. | Implementación y QA revisadas; programador nuevo apagado. |
| E4 · [PR #10](https://github.com/Domarchi/daybook-ticket/pull/10) | Reglas simulables/versionadas, plantillas de tareas, relaciones y duplicados sin mover mensajes. | Candidato `87c5a3f`: lint, tipos, 323 pruebas y build. Quince grupos QA; ticket ficticio #398, simulación, una ejecución/tarea y reintento idempotente. Recuperación de 65 tablas y tres archivos. | Implementación y QA revisadas; motor y destino del pinger apagados. |
| E5 · [PR #11](https://github.com/Domarchi/daybook-ticket/pull/11) | Biblioteca editorial con versiones aprobadas, publicaciones por empresa, sugerencias, paneles e informes privados PDF/CSV. | Candidato `7c29108`: lint, tipos, 340 pruebas y build. Dieciocho escenarios QA, offsets horarios y clasificación histórica conservadora. Artículo ficticio #20 y captura idempotente por HTTP. Recuperación de 70 tablas y tres archivos. | Bytes y PNG del PDF revisados; guardar mediante Chrome nativo sigue pendiente manual. |
| E6 · [PR #12](https://github.com/Domarchi/daybook-ticket/pull/12) | TOTP/recuperación personal, sesiones propias, reautenticación, auditoría, salud y exportación privada sin credenciales. | QA de nueve grupos, recorrido HTTP y recuperación de 74 tablas y tres archivos, con MFA cifrado y la clave original. Corregidas reautenticación de configuración y revocaciones durante descargas. Puente push revisado con ocho pruebas focales. | Recierre de checks/CI del puente en curso: **no consignar un recuento final hasta que termine**. |
| E7 · PR #13 **pendiente de apertura/cierre** | Negocios invitados, roles por membresía, selector y rutas explícitas, marca/correo separados, cuotas y consola operativa sin acceso implícito al contenido. | 0013 ensayada y aplicada solo en QA. Hay pruebas comerciales y carrera de invitaciones aprobadas; se está cerrando la regresión acumulada, recuperación, recorrido HTTP/visual y checks finales. | PR, Preview protegida y evidencias finales pendientes. No activar pilotos. |

Las descripciones históricas «preparado» o «no ejecutado desde esta rama» de documentos anteriores reflejan el momento de implementación del agente. Las ejecuciones coordinadas posteriores se distinguen en esta revisión y sus registros; no autorizan por sí solas una publicación productiva. El estado final de **CI de GitHub** debe verificarse sobre el mismo SHA que la vista previa y el artefacto que se pretenda publicar.

## Vistas previas protegidas

| Entrega | Entrada de revisión |
| --- | --- |
| E0 | [Base de fiabilidad](https://daybook-ticket-reliability-qa-domarchi.vercel.app/) |
| E1 | [Colaboración](https://daybook-ticket-evolution-01-qa-domarchi.vercel.app/) |
| E2 | [Organización](https://daybook-ticket-evolution-02-qa-domarchi.vercel.app/) |
| E3 | [Empresas y contratos](https://daybook-ticket-evolution-03-qa-domarchi.vercel.app/) |
| E4 | [Automatización](https://daybook-ticket-evolution-04-qa-domarchi.vercel.app/) |
| E5 | [Conocimiento e informes](https://daybook-ticket-evolution-05-qa-domarchi.vercel.app/) |
| E6 | [Seguridad](https://daybook-ticket-evolution-06-qa-domarchi.vercel.app/) |
| E7 | Pendiente; registrar URL y SHA después de comprobar que el despliegue está READY y protegido. |

Estas vistas usan QA y datos ficticios. Mantener protección de Vercel y acceso de aplicación; no convertirlas en públicas para facilitar automatización. Las claves privadas, contraseñas, cookies y enlaces de invitación no forman parte de este documento. No se da por comprobada aquí una nueva visita a cada alias.

## Evidencias concretas

Los archivos `work/` y `outputs/` son evidencias locales excluidas de Git. La primera columna identifica el worktree donde se conservan. Antes de cerrar el PR correspondiente, archivar las evidencias necesarias en el lugar privado de revisión y asociarlas al SHA comprobado; nunca incluir secretos ni estado autenticado del navegador.

| Worktree | Registros y archivos de referencia |
| --- | --- |
| `daybook-evolution-01` | `work/e1-qa.log`, `work/e1-final-check.log`; capturas `outputs/evolution-01/chat-desktop.png`, `chat-mobile.png`, `private-draft-recovery.png`, `client-quote-recovery.png`. Cierre: [COLLABORATION_RELEASE.md](COLLABORATION_RELEASE.md). |
| `daybook-evolution-02` | `work/e2-review-final-check.log`, `work/e2-recovery-qa.log`, `work/e2-real-legacy-recovery-qa.log`; `outputs/evolution-02/organization-mobile.png` y `client-form-mobile.png`. Dominio: `scripts/check-work-organization-database.mjs`. Cierre: [WORK_ORGANIZATION.md](WORK_ORGANIZATION.md). |
| `daybook-evolution-03` | `work/e3-qa.log`, `work/e3-recovery-qa.log`, `work/e3-ui-final-check.log`, `work/release-qa-0009-audit.json`, `work/release-qa-0009-dry-run.json`; `outputs/evolution-03/contracts-desktop-dark.png` y `contracts-mobile.png`. Cierre: [SERVICE_CONTEXT.md](SERVICE_CONTEXT.md). |
| `daybook-evolution-04` | `work/e4-http.log`, `work/e4-recovery.log`, `work/e4-final-check.log`, `work/release-qa-0010-audit.json`, `work/release-qa-0010-dry-run.json` y `work/release-qa-0010-apply.json`; pruebas del pinger en `scripts/check-evolution-pinger.test.ts`. Cierre: [AUTOMATION_WORKFLOW.md](AUTOMATION_WORKFLOW.md). |
| `daybook-evolution-05` | `work/e5-database-fixed.log`, `work/e5-http.log`, `work/e5-recovery.log`, `work/e5-final-check.log`, `work/release-qa-0011-audit.json`, `work/release-qa-0011-dry-run.json` y `work/release-qa-0011-apply.json`; `outputs/evolution-05/reports-mobile.png`, `reports-desktop-dark.png`, `protected-preview-report.png` y `pdf/qa-report-second-check.png`. Bytes HTTP: `work/E5_REVIEW_REPORT.pdf` y `.csv`. Cierre: [KNOWLEDGE_REPORTS.md](KNOWLEDGE_REPORTS.md). |
| `daybook-evolution-06` | `work/e6-database.log`, `work/e6-http.log`, `work/e6-recovery.log`, `work/release-qa-0012-audit.json`, `work/release-qa-0012-dry-run.json` y `work/release-qa-0012-apply.json`; cierre del puente en `work/push-compat-full-check.log` y `work/push-compat-postcommit.log`. Cierre: [SECURITY.md](SECURITY.md). |
| `daybook-evolution-07` | `work/release-qa-0013-audit.json`, `work/release-qa-0013-dry-run.json` y `work/release-qa-0013-apply.json`; `work/e7-invitation-race-qa.log`, `work/e7-commercial-qa-direct.log`, `work/e7-qa-collaboration.log`, `work/e7-qa-draft-locks.log`, `work/e7-qa-organization.log`, `work/e7-qa-service-context.log` y `work/e7-final-check.log`. Los registros en curso no se consideran aprobados hasta su resultado terminal y limpieza. Cierre: [COMMERCIAL_WORKSPACES.md](COMMERCIAL_WORKSPACES.md). |

La migración QA comprobó las filas y todas las columnas originales de las tablas preexistentes: E1, 39 tablas/506 filas; E2, 43/587; E3, 48/612; E4, 60/638; E5, 68/660; E6, 73/676; E7, 78/680. Esos inventarios **no son datos de producción** ni el número de tablas incluidas en un respaldo de negocio. Los ensayos de recuperación, por su parte, verifican claves foráneas, huellas, archivos privados, compatibilidad histórica y limpieza de fixtures/esquemas propios.

## Controles que deben mantenerse

- Las funciones nuevas se controlan por espacio mediante `collaboration`, `organization`, `serviceContext`, `automation`, `knowledge`, `security` y `workspaces`. La migración no habilita automáticamente funciones, reglas, MFA obligatorio ni pilotos. Los controles ya existentes no se reinician.
- El motor administrativo y la programación son controles independientes. `DAYBOOK_AUTOMATION_JOB_ENABLED`/`DAYBOOK_AUTOMATION_JOB_SECRET` y `DAYBOOK_SERVICE_CONTEXT_JOB_ENABLED`/`DAYBOOK_SERVICE_CONTEXT_JOB_SECRET` corresponden a destinos separados de la Function existente. Configurar y activar exige revisión posterior; el código preparado no crea otro programador.
- Suspender un piloto conserva sus datos, cuotas, etapas y colas. Todo envío/recepción requiere estado operativo, destinatario y remitente todavía autorizados; un fallo no permite usar el remitente de otro negocio. Las funciones pausadas no reconstruyen eventos anteriores.
- Inventario, contratos, notas, menciones, tareas e informes internos siguen reservados al equipo. El encargado de empresa conserva el rol `client`. Los artículos se publican mediante una revisión aprobada y un destino de empresa explícito; un borrador posterior no altera esa publicación.
- Los permisos se comprueban en APIs globales y scoped. Las rutas antiguas pertenecen a Daybook; el operador no obtiene membresías ni acceso al contenido por su concesión de consola. Las descargas revalidan permiso, sesión y MFA después de abrir almacenamiento privado y cancelan el flujo si cambian.
- La exigencia de MFA depende de la política del servidor, no de ocultar su interfaz. Cada persona enrola su autenticador y guarda personalmente sus códigos; el propietario verifica recuperación antes de exigirlo al equipo.

## Puertas de publicación

La publicación productiva es un paso posterior y explícito. Debe quedar un SHA, un despliegue protegido y un conjunto de evidencias coherentes para cada entrega; no publicar una pila parcialmente comprobada.

1. Completar los checks finales de E6/E7, CI de los PR afectados y la revisión de E7 en escritorio, móvil, claro/negro y dos pestañas con roles distintos. Volver a comprobar aislamiento de búsqueda, artículos, informes, conversaciones, archivos y avisos después de revocar acceso.
2. Cerrar la regresión serial de QA y la recuperación acumulada. Registrar resultado terminal, huellas y limpieza; un log anterior a un arreglo no certifica el nuevo commit. Mantener correos, push y proveedores reales apagados durante esas pruebas.
3. Completar el paso manual de PDF: desde la captura mensual ya creada, descargar y **guardar el archivo usando Chrome nativo**, abrirlo en un visor y comprobar contenido, logo, número de páginas y acceso privado. Los bytes HTTP y PNG renderizados ya se revisaron; la interacción nativa de guardar sigue pendiente y no se sustituye por crear otra captura.
4. Registrar inventario productivo inicial y disponer de respaldo comprobado de base y archivos, punto de restauración dentro de la retención disponible y despliegue compatible de reversión. Distinguir respaldo operativo de plataforma de exportación de un negocio: esta última excluye identidades, contraseñas, sesiones y credenciales globales. Conservar de forma privada la clave original necesaria para factores cifrados y comprobar el rechazo de una clave ausente/incorrecta.
5. Usar el [operador revisado](EVOLUTION_RELEASE_OPERATOR.md), Node24 y el prefijo explícito correspondiente `--through=0007`…`0013`, en orden. Auditoría, simulación con rollback y aplicación requieren sus verificaciones y confirmaciones exactas; no usar el migrador genérico ni enmendar un SQL/diario aplicado. Las conexiones y secretos productivos se suministran por el mecanismo privado autorizado, sin copiarlos a documentos o logs.
6. **Publicar primero la E6 parcheada para push, antes de aplicar SQL0013.** Debe contener el puente `lib/push-registration-compat.ts`: solo el error confirmado del INSERT heredado `42P10`/`infer_arbiter_indexes`, después del rollback confirmado de su savepoint y antes de cualquier COMMIT, permite un único fallback compuesto. Nunca repetir por red, errores ajenos o COMMIT incierto. Revisar el ensayo aislado `scripts/check-push-registration-transition-database.mjs` antes de usar esa secuencia. E7 mantiene únicamente el target compuesto `(ownerId, memberId, endpoint)`.
7. Comparar huellas y columnas originales al aplicar cada prefijo; comprobar acceso, lectura/escritura y descarga de archivos ya existentes después del despliegue. Conservar cuentas, sesiones, contraseñas, mensajes congelados e idempotencias. Ante `commit_outcome_unknown`, detenerse y auditar el mismo prefijo con una conexión nueva antes de decidir: no reaplicar automáticamente.
8. Activar funciones y trabajos por separado después de su revisión. Comprobar capacidad disponible sin contratar ni aumentar planes. Los pilotos se dan de alta manualmente, nacen en borrador y solo se activan con propietario/MFA/recuperación, permisos, remitente verificado y presupuesto privado revisados. No habilitar registro público, IA, WhatsApp ni cobros automáticos.

El correo de Daybook actual conserva `Daybook Ticket <tickets@consorcioc17.cl>`. No modificar la web, DNS, buzones ni claves de Consorcio C17 como parte de esta publicación. Las pruebas reales con destinatarios requieren su autorización y cuentas activas; no forman parte de los ensayos ficticios descritos aquí.

## Reversión compatible

Pausar los destinos automáticos y funciones afectados, conservando tablas, columnas, archivos, versiones, publicaciones, eventos, colas y claves de idempotencia. Promover solo un despliegue revisado compatible con los datos y las protecciones ya utilizadas. No ejecutar DDL inverso destructivo, recalcular SLA ni eliminar datos para adaptar un build antiguo. Restaurar un respaldo es un procedimiento separado, con verificación y autorización propias.

- **Después de cualquier enrolamiento MFA:** no volver a un build anterior a su soporte, aunque el flag visual esté apagado. Conservar Better Auth2FA, la validación de sesión y MFA del servidor, la política y los factores cifrados con su clave original. No borrar factores, restablecer `twoFactorEnabled` ni bajar la política para facilitar la reversión.
- **Después de SQL0013:** el índice compuesto debe permanecer. No restablecer la unicidad global de endpoint ni borrar suscripciones para recrearla. La E6 parcheada solo sirve de puente si todavía no se ha cruzado la frontera comercial siguiente y conserva todas las demás protecciones activadas.
- **Después de aceptar membresías/invitaciones comerciales o utilizar E7:** no volver a un build previo a E7. Conservar aceptación del token concreto, membresías y roles por espacio, rutas/ACL explícitas y push por membresía. Pausar pilotos y funciones manteniendo esas barreras; el enlace antiguo de invitaciones por email no es compatible.
- Antes del primer piloto, cualquier evaluación de un build anterior exige demostrar que no hay membresías múltiples, invitaciones nuevas ni datos que necesiten la identidad de E7. Debe mantener igualmente MFA ya enrolado y el cierre del antiguo feed global de artículos para clientes. No basta con que las columnas añadidas sean nullable.

La recuperación acumulada pausa integraciones y publicaciones para revisión, pero conserva MFA, aprobaciones, contratos y capturas. No habilitar automáticamente la obligación de MFA, un piloto, un remitente o un trabajo al recuperar; tampoco desactivar protecciones que ya estaban en uso.

## Pendientes de cierre del coordinador

- Registrar SHA y resultado final de lint/tipos/unitarias/build y CI de E6 parcheada y E7; actualizar los enlaces de Preview con el mismo candidato.
- Completar y registrar la regresión/recuperación E7, sus inventarios y limpieza; confirmar el ensayo del puente push antes de SQL0013.
- Abrir/cerrar la revisión de PR #13 y su Preview protegida; terminar el recorrido visual/autenticado del espacio comercial y la comprobación nativa de guardar PDF.
- Preparar y revisar respaldo productivo, ventana, prefijos y despliegue compatible de reversión. Producción sigue sin cambios hasta esa decisión posterior.
