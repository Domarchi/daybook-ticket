# Fase 3 de calidad: base de código y navegación (9–10 nov 2026)

Se construye sobre `main` con E7 ya publicada (`b0ecfb1`). Cada entrega es un PR pequeño y reversible; no hay migraciones.

## C2. `app/desk.tsx` partido en módulos

`app/desk.tsx` pasó de 61 KB a unos 12 KB y conserva solo el armazón: estado, carga de datos y manejadores. Lo demás vive en `app/desk-parts/`:

| Archivo | Contenido |
| --- | --- |
| `shared.tsx` | constantes de estado y prioridad, formato de fechas y plazos, `Avatar`, `Status`, `Priority`, `Modal`, `Empty`, `Stat`, `PageTitle` y `request` |
| `sidebar.tsx` | menú lateral |
| `inbox-view.tsx` | bandeja, filtros, tabla, selección y resumen |
| `ticket-view.tsx` | detalle del ticket |
| `section-view.tsx` | las demás secciones (seguridad, empresas, conocimiento, equipo, ajustes, ayuda…) |
| `staff-composer.tsx`, `ticket-form.tsx`, `settings-form.tsx`, `overview.tsx` | formularios y resumen que ya eran componentes aparte |

Es un movimiento mecánico: el JSX se trasladó sin cambios y recibe por propiedades lo que antes leía del cierre. El tamaño de los chunks generados no cambia y las pruebas siguen igual.

## C1. Vista y ticket en la URL

La vista y el ticket abierto dejan de ser estado interno y salen de la URL (`lib/desk-url.ts`):

| URL | Pantalla |
| --- | --- |
| `/` | bandeja |
| `/?view=overview` (y `contacts`, `knowledge`, `team`, `settings`, `portal`, `operations`, `metrics`, `service`, `reports`, `security`) | esa vista |
| `/?ticket=12` | el ticket 12 |
| `/?view=service&company=<uuid>` | una empresa en «Empresas y servicios» |

En un espacio de negocio la ruta es la misma bajo `/w/<id>`. `?serviceContext=1` sigue funcionando.

- **Atrás y Adelante** recorren las pantallas visitadas; recargar conserva dónde estabas; el enlace se puede compartir o abrir en otra pestaña.
- Se usa `window.history.pushState`, que Next sincroniza con `useSearchParams`: no hay ida y vuelta al servidor ni consultas nuevas.
- «Volver a la bandeja» vuelve atrás si el ticket se abrió desde la lista; si se abrió con un enlace directo, muestra la bandeja en el mismo sitio y no saca a la persona de la aplicación.
- Las rutas de retorno tras iniciar sesión aceptan `view` solo con valores conocidos (`lib/return-path.ts`); el resto sigue rechazándose.
- Ctrl/⌘ K ahora también cierra el ticket abierto para llevar al buscador.
- No cambia el estado de filtros ni de búsqueda (siguen en el navegador).

### No incluido
Los elementos del menú y las filas siguen siendo botones, no enlaces: no se puede abrir una vista en una pestaña nueva con clic central. Se hará junto con la bandeja móvil (C3), que toca esos mismos elementos.

## Verificación
`npm run check`: lint, 455 pruebas, tipos y build correctos. La lógica de URL y de retorno está cubierta por pruebas unitarias con un historial simulado (`scripts/desk-url.test.ts`, `scripts/check-portal-return-path.test.ts`). **No se ha recorrido en un navegador con sesión**: los Preview no tienen base de datos, y probarlo exige iniciar sesión. Queda para la revisión manual (abrir un ticket, pulsar Atrás, recargar, abrir un enlace `?ticket=` y `?view=` en otra pestaña).

## Reversión
Revertir el commit restaura el estado interno anterior; no hay datos ni migraciones.
