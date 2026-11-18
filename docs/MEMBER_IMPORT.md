# Importar clientes desde una planilla (Fase 7, L2)

Para el lanzamiento a toda la empresa, un administrador puede registrar a muchos empleados y sus equipos con un archivo CSV. Así no tiene que invitar a cada persona por separado. Está en **Equipo y clientes → Importar clientes**.

## Cómo se usa

1. **Descargar plantilla.** Es un CSV con `;` y BOM para que Excel en español lo abra en columnas y con tildes.
2. **Completar una fila por persona** con estas columnas:
   - Nombre
   - Correo
   - Empresa
   - ID del equipo
   - Tipo de equipo: Monitor, Computador, Teclado, Mouse, Impresora, Docking, Celular u Otro
   - N° de serie
   - Marca y modelo (opcional)

   Las columnas se reconocen por su nombre, en cualquier orden. También sirven variantes como «Serie», «correo electrónico», «ID» o «Modelo». Las columnas que no se reconocen se ignoran y se avisa. El separador puede ser `;`, `,` o tabulador.
3. **Revisar archivo.** Muestra el resultado fila por fila y **no escribe nada**.
4. **Crear N invitaciones.** El botón solo aparece cuando todas las filas están listas. Todo se crea en una sola transacción, o no se crea nada.
5. **Descargar enlaces (CSV).** Trae nombre, correo, empresa, ID del equipo, enlace y vencimiento. El administrador entrega cada enlace a su persona por un canal interno.

## Reglas

- Hasta **500 filas** por archivo (unos 400.000 caracteres).
- Cada fila se valida igual que el formulario de invitación:
  - nombre de hasta 160 caracteres;
  - correo válido, que se guarda en minúsculas;
  - empresa;
  - ID del equipo con su formato;
  - tipo de la lista;
  - **serie obligatoria**, normalizada (ver `REQUIREMENTS_TRACKING.md`).
- **Empresa:** se compara sin mayúsculas, tildes ni espacios dobles. Si no existe:
  - es un error;
  - salvo que se marque «Crear las empresas que falten», y entonces se crea una vez por nombre.
- **Repetidos dentro del archivo:** correo, ID o serie repetidos son error en la segunda aparición, que indica la línea de la primera.
- **Lo que ya existe en el espacio:**
  - un correo con cuenta o invitación es error;
  - un ID asignado a otra persona, de otra empresa o dado de baja es error;
  - un ID libre de la misma empresa **se asigna**, recibe la serie si no tenía y queda anotado en la fila;
  - una serie distinta de la registrada en ese ID es error;
  - una serie que ya está en otro equipo es error.
- **Un solo error bloquea todo.** Para corregir, se descarga «Descargar problemas (CSV)», se arregla la planilla y se vuelve a cargar.
- **Al confirmar, el servidor vuelve a revisar el archivo** dentro de la transacción, que tiene el mismo bloqueo de trabajo que una invitación individual. Si algo cambió desde la revisión, responde 409 con la revisión nueva y no escribe nada.
- **Repetir el mismo archivo** después de importarlo da error en todas las filas (correos ya registrados), así que nadie se crea dos veces.

## Seguridad

- **Quién puede usarlo:**
  - solo administradores (`requireAdmin`);
  - como toda escritura bajo `/api/members`, exige haber verificado la contraseña en los últimos 5 minutos (428 si no);
  - límite de 30 revisiones o importaciones cada 10 minutos por persona.
- **Sin correos:** la importación no encola correos de invitación (`lib/member-import.ts` no usa `mailOutbox`).
- **Los enlaces:**
  - vencen a las 72 horas;
  - el token solo se guarda como hash, así que se ven una única vez: en la pantalla de resultado y en el CSV descargado;
  - cada enlace permite crear la cuenta de esa persona: la pantalla pide entregarlo solo a ella y no reenviar el archivo completo;
  - un enlace vencido se renueva desde la lista, lo que invalida el anterior.
- **Exportaciones:** los CSV descargados anteponen `'` a las celdas que empiezan con `= + - @`, para que Excel no las ejecute como fórmulas.

## Código

| Parte | Archivo |
| --- | --- |
| Lectura del CSV, columnas y reglas por fila (puro) | `lib/member-import-model.ts` |
| Contexto de la base, revisión y creación | `lib/member-import.ts` |
| Ruta `POST /api/members/import` (`mode: preview \| apply`) | `app/api/members/import/route.ts` |
| Pantalla | `app/member-import.tsx`, `app/member-import.css` |
| Pruebas | `scripts/member-import.test.ts`, e2e «clients are imported in bulk…» en `e2e/tests/desk.spec.ts` |

`parseBody` acepta un límite mayor solo para esta ruta. Las demás siguen con 100.000.
