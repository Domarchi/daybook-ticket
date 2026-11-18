# Lista del lanzamiento a toda la empresa (Fase 7)

## Qué ya está en producción

| Entrega | Qué hace | PR |
| --- | --- | --- |
| L1 | N° de serie obligatorio y «Marca y modelo» al invitar, registrar y entregar equipos | #82 |
| L2 | Importar clientes y sus equipos desde una planilla CSV, con revisión previa y enlaces descargables | #83 |
| L3 | Estado de cada enlace de invitación y renovación en grupo | #84 |
| L4 | «Confirma tu equipo» en el portal: el empleado completa la serie o registra su equipo | #85 |
| — | Límite de inicio de sesión por IP pensado para oficinas que comparten una IP pública | #86 |

Guías: [administrador](GUIA_ADMINISTRADOR.md) y [empleado](GUIA_EMPLEADO.md). Incidentes: [runbook](RUNBOOK_INCIDENTES.md). Capacidad: [prueba de carga](LOAD_TEST.md).

## Decisiones pendientes de la persona responsable

- [ ] **Recuperar contraseñas:** «Olvidé mi contraseña» envía un correo y el correo está apagado. Sin él, quien olvide su contraseña no puede recuperarla por su cuenta. Hay dos caminos: encender el correo transaccional (remitente y proveedor aprobados) o construir un «enlace para restablecer» que genere el administrador, como los enlaces de invitación.
- [ ] **Capacidad de Neon:** comparar el ritmo de horas activas con el cómputo mensual del plan y decidir si se permite autoescalar sobre 0,25 CU ([LOAD_TEST.md](LOAD_TEST.md)).
- [ ] **Uso de empresa en Vercel:** revisar que el plan de Vercel permita uso comercial y el volumen de despliegues.
- [ ] **Grupo piloto:** un área de 10 a 30 personas durante una semana antes de sumar al resto.

## Antes del día del lanzamiento

- [ ] **Repositorio:** volver a privado.
- [ ] **Credenciales:** rotar la contraseña del rol de Neon y actualizarla en Vercel.
- [ ] **Respaldos:** hacer un respaldo nuevo y copiarlo **fuera** de este computador.
- [ ] **Empresas:** crearlas con el nombre que aparecerá en los informes.
- [ ] **Planillas por grupo:** con ID, tipo y serie de cada equipo. Revisarlas con «Revisar archivo» antes de crear las invitaciones.
- [ ] **Canal de entrega de los enlaces:** acordar por dónde llegan (correo corporativo, chat). Nunca un archivo compartido.
- [ ] **Guía del empleado:** enviarla junto con el enlace.
- [ ] **Equipo de soporte:** confirmar quiénes atienden la bandeja la primera semana y que tienen su cuenta activa.

## El día del lanzamiento

1. **Comprobar producción:** `curl https://daybook-ticket.vercel.app/api/health` (y `?deep=1`).
2. **Importar** el grupo del día y descargar los enlaces.
3. **Repartir los enlaces** y la guía del empleado.
4. **Durante el día,** revisar «Invitaciones pendientes» y el filtro «Sin serie» en Equipos.
5. **Al final del día,** renovar los enlaces vencidos de quienes no alcanzaron a entrar.

## Primera semana

- **Revisar cada día** los errores en los registros de Vercel y el consumo en Neon.
- **Seguimiento de equipos:** la lista «Sin serie» debe llegar a cero; avisar a quienes falten.
- **Ajustar:** reunir las dudas de los empleados para actualizar la guía y los artículos del centro de ayuda.
