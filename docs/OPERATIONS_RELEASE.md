# Horarios, reparto y métricas — publicación y revisión

Esta entrega parte de producción `b696f73f1022d89da4b64a51c51f534080083ad7` y se prepara en `codex/daybook-ticket-operations`. La preparación no publica ni cambia cuentas o tickets productivos. El alcance y las decisiones están en [OPERATIONS_PLAN.md](OPERATIONS_PLAN.md).

## Uso

- **Atención y reparto → Horarios y SLA:** administración elige la configuración general o una empresa, horas por prioridad, zona horaria, tramos semanales y fechas no laborables. La empresa hereda el acuerdo general hasta guardar una excepción completa. Los cambios se aplican a nuevos tickets y reaperturas, sin recalcular plazos existentes.
- **Atención y reparto → Reparto automático:** crear una regla desactivada, seleccionar empresa/departamento si corresponde y los integrantes elegibles. Revisar orden y capacidad antes de activarla. Solo la primera regla coincidente decide el grupo; si nadie puede recibir el ticket queda sin asignar. No hay reparto retroactivo.
- **Disponibilidad:** cada agente puede pausar nuevas asignaciones desde Resumen; administración configura capacidades. Pausar no retira tickets. La asignación manual conserva prioridad y puede superar la capacidad automática.
- **Métricas del equipo:** administración consulta fechas inclusivas de Santiago, empresa y CSV. Respuestas públicas cuentan por autor; notas internas no cuentan. La carga es actual, independiente del período. Las resoluciones registradas mantienen su vencimiento y empresa originales. Los períodos sin información histórica se muestran como tales.

Los recordatorios existentes mantienen el aviso de dos horas corridas sin respuesta y su ejecución durante las 24 horas. Esta entrega no cambia sus secretos, cron, remitente ni destinatarios configurados.

## Datos y límites

La migración aditiva `0004_service_operations` añade cuatro tablas y dos campos anulables en tickets. No cambia columnas originales ni rellena configuración, asignaciones, calendarios o resultados históricos. Los archivos y sus permisos siguen utilizando el almacenamiento privado actual.

Cada ticket nuevo guarda una instantánea del acuerdo y el inicio del ciclo. Cambiar prioridad usa esa instantánea; reabrir inicia otro ciclo con el acuerdo vigente. Cambiar únicamente la empresa conserva el vencimiento. Los tickets anteriores siguen su comportamiento previo hasta una transición explícita aplicable. Las resoluciones anteriores no se reconstruyen a partir del estado actual.

Las fechas no laborables se introducen manualmente; no se importan feriados nacionales. Las métricas de duración son horas transcurridas, aunque el vencimiento del SLA pueda correr solo en horario hábil. No se incorpora todavía un SLA de primera respuesta.

## Verificación reproducible

Node 24 y las dependencias fijadas por `package-lock.json`. CI no usa base, claves ni servicios productivos:

```sh
npm run check
```

QA usa únicamente `.env.test.local`, el host aislado fijo y personas `@example.test`. Las pruebas de base se ejecutan en serie y eliminan sus propias filas. Ninguna prueba permite configurar proveedores de envío reales.

```sh
npm run db:migrate:operations:qa
npm run test:operations:qa
node scripts/start-qa.mjs
# En otra terminal, con DAYBOOK_SITE_URL=http://127.0.0.1:5175:
npm run test:operations:http
node --env-file=.env.test.local --import tsx scripts/check-access.mjs http://127.0.0.1:5175
npm run test:notifications:qa
npm run test:notifications:http
```

La vista previa conserva Vercel Authentication y el acceso privado por invitación de Daybook. Sus secretos se limitan a Preview y a esta rama; usa la base y Blob QA. No se incluyen claves de envío de correo/push y el worker está deshabilitado. No se deben reutilizar las cuentas ficticias ni sus contraseñas en producción.

## Publicación posterior autorizada

1. Revisar PR, CI, evidencias y vista previa del mismo commit. Confirmar la referencia productiva actual, el punto de recuperación disponible en Neon y el procedimiento de restauración. No restaurar ni copiar QA a producción.
2. Ejecutar primero el modo de auditoría y después el ensayo con rollback del operador `scripts/migrate-operations-production.mjs`, usando conexión directa privada al destino productivo fijo. El operador exige hashes de las cinco migraciones revisadas, journal exacto y verificaciones de conservación. Sus comandos y guardas están en la cabecera del archivo.
3. En una ventana breve, aplicar únicamente `0004` con las confirmaciones explícitas del operador. Conservar su informe privado de recuentos y huellas; comparar cuentas, sesiones, tickets, conversaciones y archivos antes/después. No ejecutar provisionado, seeds ni pruebas ficticias en producción.
4. Construir la referencia revisada como despliegue productivo sin asignar dominios, con la configuración productiva existente. Comprobar acceso y lectura con cuentas actuales. Promover ese mismo build tras comprobarlo.
5. Confirmar que no aparecieron políticas, reglas, disponibilidad ni resultados históricos por migración. El SLA general conserva las horas existentes. Configurar y activar reglas/acuerdos únicamente por decisión administrativa explícita. El programador de recordatorios y su prueba real no necesitan repetirse para publicar esta entrega.

## Desactivación y reversión

Deshabilitar las reglas detiene el reparto nuevo y conserva responsables e historial. Eliminar una excepción empresarial vuelve a heredar el acuerdo general para futuros ciclos; no altera vencimientos guardados. Restablecer atención continua conserva las horas generales. Ninguna de estas acciones borra usuarios, conversaciones o archivos.

No eliminar tablas ni columnas al revertir. Un build anterior desconoce las instantáneas y calendarios: podría calcular prioridades y reaperturas con horas corridas, y no registrará nuevas resoluciones. Preferir desactivar reglas y políticas conservando este build compatible; si se requiere volver al build previo, registrar esa limitación, conservar todos los datos nuevos y comprobar los tickets modificados durante el intervalo. No cambiar claves de correo ni reiniciar su idempotencia.

## Evidencias

Los resultados finales de QA, CI y revisión visual se registran en [OPERATIONS_PLAN.md](OPERATIONS_PLAN.md). Los informes detallados locales se guardan en `work/` (ignorado por Git); no contienen credenciales y no se publican archivos de entorno.
