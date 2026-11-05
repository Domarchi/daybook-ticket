# Conversación renovada de Daybook Ticket

La conversación del cliente y la del equipo usan el mismo componente. Los mensajes propios aparecen a la derecha; las notas internas mantienen una presentación con candado y la etiqueta «Solo el equipo». El negro y el dorado siguen la identidad de Daybook.

## Funciones

- Fechas agrupadas y horas de Santiago, con autor identificado por su cuenta y rol.
- Historial con desplazamiento propio y editor al pie del chat, sin superponer la página.
- Búsqueda de texto, autores y nombres de archivos en los mensajes cargados. Enter y Shift+Enter recorren coincidencias; Escape cierra y devuelve el foco.
- Salto a los últimos mensajes. Si llega una respuesta mientras se lee más arriba, se conserva la posición y se muestra un contador de mensajes nuevos en esa conversación.
- Editor compacto con altura automática, formato desplegable, vista previa y Ctrl/Cmd+Enter para enviar. Enter inserta una línea.
- Respuestas guardadas plegables, adjuntos privados y borradores de respuesta/nota separados, conservando los mecanismos existentes de permisos e idempotencia.

El contador dentro del chat es temporal y ayuda a volver al final. El centro de avisos persistentes conserva su comportamiento. No se muestran confirmaciones de lectura ni de entrega de mensajes que el sistema no registra.

## Verificación

- 247 pruebas unitarias aprobadas, incluidas siete de agrupación, búsqueda, nuevos mensajes y exclusión de notas/archivos privados al renderizar el cliente.
- Lint, tipos y compilación de producción aprobados.
- QA aislado, con cuentas ficticias y sin claves de envío de correo, recepción de correo ni push. Trabajos automáticos desactivados durante la prueba local.
- Ticket ficticio #376: cliente con nueve mensajes públicos y equipo con diez mensajes, incluida una nota interna. Envío por teclado del cliente y del agente guardado exactamente una vez; vista previa Markdown e inserción de respuesta guardada comprobadas.
- Llegada de un mensaje sin cambiar la posición de lectura (`scrollTop: 385` antes y después), salto al final y ausencia de conteo repetido al actualizar.
- Borrador público recuperado al alternar entre respuesta y nota. El borrador privado temporal se retiró sin enviarlo.
- Revisión visual en escritorio y 390×844, sin desbordamiento horizontal; formato plegado y retorno de foco al cerrar búsqueda comprobados.

La prueba usa el mismo contrato de creación de mensajes y las mismas rutas de conversaciones. No requiere migraciones, dependencias nuevas ni cambios de configuración. Los datos productivos permanecen intactos. Para revertir, restaurar la versión anterior de la aplicación; las conversaciones y los archivos se conservan.

## Comprobación de la base de evolución

La entrega 0 confirmó que `origin/main` está en `dfa3839d9a066631e8afd0ee5b5648369fd03fac` y el candidato de chat en `d6b51cae6bf3f8e3a61ab7dc275f620228bd66bb`. Los dos controles CI y la recuperación ficticia están aprobados. El primer despliegue Git de ese candidato quedó bloqueado antes del build por atribución de cuenta; no fue un fallo de compilación. Esta evidencia se registra mediante el flujo autenticado de GitHub, conservando las autorías y el historial de los commits de código. La preparación de una vista previa no autoriza publicar producción ni activar pilotos.
