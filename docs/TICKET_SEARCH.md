# Búsqueda y páginas de conversaciones

La bandeja del equipo y el portal del cliente consultan páginas de 50 tickets. La búsqueda incluye número, asunto, solicitante, correo, departamento y mensajes de las conversaciones autorizadas. El equipo puede encontrar sus notas internas; los clientes no obtienen coincidencias, extractos ni recuentos derivados de notas internas. Los filtros persistentes del equipo se aplican en PostgreSQL, antes de paginar.

Los recuentos generales, la distribución por departamento y los totales del directorio se calculan en la base sobre todo el conjunto autorizado. No se calculan sobre la primera página. La selección masiva se limita a los tickets visibles. La exportación CSV recorre todas las páginas de los filtros actuales, hasta 10.000 resultados; al superar ese máximo solicita dividir los filtros y no descarga un CSV incompleto.

## Interfaces

- `GET /api/tickets/search?q=&queue=all&priority=all&department=all&company=all&agent=all&limit=50&cursor=...` devuelve `{items,total,nextCursor}`. Máximo 100 por página y 200 caracteres de búsqueda. `none` permite empresa/responsable ausente. Vistas: all/open/pending/resolved/mine/unassigned/overdue.
- `GET /api/tickets/:id/conversation?limit=50&cursor=...` devuelve `{ticket,messages,nextCursor}`: la cola reciente de una sola conversación, en orden cronológico. «Cargar mensajes anteriores» obtiene la siguiente página antigua. Los enlaces a tickets fuera de la primera página funcionan mediante esta interfaz.
- `GET /api/tickets/contacts?limit=50&cursor=...` entrega el directorio paginado al equipo, con totales de tickets y activos por solicitante.
- `/api/workspace` y `/api/tickets/updates` conservan viewer/alertas/contratos anteriores, pero entregan como máximo 50 tickets y `messages: []`. Añaden `ticketPage`, `ticketCounts` y `ticketDepartments`; los consumidores de conversaciones deben usar la interfaz específica.

Las páginas usan cursores de orden `(updatedAt,id)` para tickets y `(createdAt,id)` para mensajes. El cursor no concede acceso: cada lectura vuelve a validar sesión, espacio, rol y pertenencia a la empresa. Cambiar filtros o cuenta reinicia la página. Las lecturas antiguas se cancelan, no se mezclan datos de cuentas, y los avisos y sonidos conservan su fuente independiente.

No se crean enlaces públicos ni caché compartida. El texto de búsqueda permanece como parámetro SQL; `%`, `_` y barras se buscan literalmente. Las páginas muestran el estado vigente: mientras otras personas modifican tickets, los totales y la posición pueden cambiar. La exportación elimina IDs repetidos durante la lectura; no es un respaldo con instantánea transaccional.

## Verificación

`node --import tsx --test scripts/check-ticket-search.test.ts` valida límites, filtros, cursores y caracteres especiales. Después de aplicar `0005` en QA, ejecutar **en serie**:

```sh
node --env-file=.env.test.local --import tsx scripts/check-ticket-search-database.mjs
```

El script está limitado al host QA fijo, rechaza proveedores reales y elimina sus 63 tickets ficticios, mensajes, miembros y empresas. Incluye dos empresas, encargado, nota privada, paginación con empates, detalle fuera de la primera página, directorio y revocación de permisos.
