# Guía del administrador: sumar a la empresa a Daybook

Una página para registrar a los empleados y sus equipos en el lanzamiento. Todo se hace en **Equipo y clientes**.

## Antes de empezar

1. **Crea las empresas.** Úsalas tal como aparecerán en los informes. También puedes crearlas al importar.
2. **Junta los datos en una planilla:** nombre, correo, empresa, ID del equipo (etiqueta de inventario), tipo, N° de serie (etiqueta del fabricante) y, si la conoces, marca y modelo. Si no tienes la serie de alguien, el empleado puede completarla después en el portal, siempre que tenga su ID.
3. **Verifica tu contraseña.** Invitar e importar son acciones sensibles: Daybook te pide la contraseña y la verificación dura 5 minutos.

## Registrar a muchas personas

1. **Importar clientes → Descargar plantilla.** Ábrela en Excel y completa una fila por persona. Guárdala como CSV.
2. **Archivo CSV → Revisar archivo.** Nada se crea todavía. Cada fila aparece como «Lista» o con su problema: correo ya registrado, ID o serie repetidos, empresa que no existe, equipo de otra persona, etc.
3. **Si hay problemas:** usa «Descargar problemas (CSV)», corrige la planilla y vuelve a cargarla. Mientras quede una fila con problemas no se crea nada.
4. **Crear N invitaciones.** Se crean todas juntas. No se envía ningún correo.
5. **Descargar enlaces (CSV).** Cada fila trae el enlace de esa persona, que vence a las 72 horas.

Importa por grupos, por ejemplo un área o una sede por día, de hasta 500 personas, para que los enlaces no venzan antes de repartirlos.

## Repartir los enlaces

- **Entrega cada enlace solo a su persona,** por un canal interno: correo corporativo, chat o en mano. Quien tenga el enlace puede crear esa cuenta.
- **No publiques** el archivo completo ni lo dejes en una carpeta compartida. Bórralo cuando termines de repartir.
- **Al abrir el enlace,** la persona elige su contraseña y entra directo a su portal.

## Seguimiento

- **Estado de los enlaces:** el filtro «Invitaciones pendientes» muestra quién falta. Cada fila dice «Enlace vigente hasta el …» o «Enlace vencido».
- **Renovar:** en «Enlaces de invitación» usa **Renovar vencidos** y descarga el CSV nuevo. «Renovar todos» también anula los enlaces que todavía funcionan, así que primero pide confirmación.
- **Equipos sin serie:** en **Equipos** usa el filtro «Sin serie». Los empleados ven «Confirma tu equipo» en el portal hasta completarla.
- **Corregir un dato ya registrado** (por ejemplo, una serie mal escrita): hazlo desde el inventario. El empleado no puede cambiarlo.

## Olvidó su contraseña

El correo está apagado, así que «Olvidé mi contraseña» no le llega a nadie. En su lugar:

1. **Equipo y clientes → Directorio de accesos,** en la fila de la persona: **Enlace para nueva contraseña.** Pide la verificación de tu contraseña como cualquier acción sensible.
2. **Copia el enlace y entrégaselo solo a ella,** por un canal interno, como un enlace de invitación.
3. **La persona abre el enlace** y elige una contraseña nueva. Se cierran todas sus sesiones abiertas.

Cada enlace:
- sirve **una sola vez** y vence a las **24 horas**;
- deja de funcionar si creas otro para la misma persona;
- no cambia nada hasta que se usa: la contraseña anterior sigue valiendo mientras tanto.

Si la persona tiene doble factor, igual se lo pedirá al entrar.

No está disponible para:
- quien aún no activa su cuenta: usa su enlace de invitación;
- un acceso revocado: primero restáuralo;
- la cuenta propietaria ni la tuya: la tuya se cambia en Seguridad;
- administradores, salvo que seas la persona propietaria;
- una cuenta que también se usa en otro espacio de Daybook.

Queda registrado en **Seguridad → Auditoría:**
- al crear el enlace, «Enlace para nueva contraseña creado» a tu nombre;
- cuando la persona lo usa, «Contraseña restablecida» a nombre de ella.

Los enlaces anteriores a la migración 0018 aparecen como «Acceso de una cuenta modificado» y «Otras sesiones cerradas».

## Si algo falla

- **«Verifica tu identidad para esta acción sensible»:** vuelve a escribir tu contraseña en Seguridad y repite la acción.
- **«Estás importando o renovando invitaciones demasiado seguido»:** espera unos minutos.
- **Alguien no puede entrar:**
  - si su enlace venció, renuévalo;
  - si ya activó la cuenta y olvidó la contraseña, usa **Enlace para nueva contraseña** en su fila del directorio (ver [Olvidó su contraseña](#olvidó-su-contraseña)).
- **Para cualquier otra cosa,** revisa el [runbook de incidentes](RUNBOOK_INCIDENTES.md).
