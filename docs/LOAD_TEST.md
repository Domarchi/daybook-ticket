# Prueba de carga del lanzamiento (Fase 7, L5)

Responde si la base actual, el proyecto Neon `daybook-ticket` con **0,25 CU fijas y 1 GB**, aguanta a 300 personas usando Daybook a la vez.

## Cómo se mide

`scripts/load-test.mjs` corre **solo en este computador**:
- se niega a correr con una base o una app que no sean locales, o con claves de proveedores;
- borra la base que recibe;
- nunca toca producción.

1. **Base local en Docker con los recursos de Neon:** `--cpus 0.25 --memory 1g`, Postgres 17.
2. **Preparación con el flujo real:** reconstruye el esquema con las migraciones reales y activa a la propietaria, a 300 clientes y a 10 agentes con sus enlaces de invitación (`sign-up` por HTTP, como la página de acceso). Siembra 3.000 tickets con mensajes y un equipo por cliente.
3. **Simulación de los navegadores:**
   - una «ola de las 9:00»: todos abren el espacio en los primeros 30 s;
   - luego cada pestaña consulta `/api/tickets/updates` al ritmo de `lib/poll-schedule.ts`: 20 % activas (cada 5 s), 50 % inactivas (15 s) y 30 % muy inactivas u ocultas (30 s);
   - los agentes, siempre activos (5 s);
   - unos 10 tickets nuevos por minuto creados por clientes.

```sh
docker run -d --rm --name daybook-load-pg --cpus 0.25 --memory 1g \
  -e POSTGRES_USER=daybook_load -e POSTGRES_PASSWORD=daybook-load-disposable -e POSTGRES_DB=daybook_load \
  -p 127.0.0.1:55463:5432 postgres:17
export DATABASE_URL='postgresql://daybook_load:daybook-load-disposable@127.0.0.1:55463/daybook_load?sslmode=disable'
export BETTER_AUTH_SECRET=daybook-load-disposable-secret-not-for-production DAYBOOK_SITE_URL=http://127.0.0.1:5191
npm run build && npx next start -H 127.0.0.1 -p 5191 &   # en otra terminal
DAYBOOK_LOAD_TEST=1 DAYBOOK_LOAD_BASE_URL=http://127.0.0.1:5191 \
  DAYBOOK_LOAD_PG_CONTAINER=daybook-load-pg DAYBOOK_LOAD_PG_CPUS=0.25 \
  node scripts/load-test.mjs --users 300 --agents 10 --seconds 180 --tickets 3000
```

No corras otras tareas pesadas en el mismo computador durante la prueba: le quitan CPU a la app y distorsionan las latencias. Una primera corrida hecha al mismo tiempo que las pruebas unitarias dio un percentil 95 de 1,8 s y se descartó.

## Resultado (18 nov 2026, `main` = `3619084`)

300 clientes, 10 agentes y 180 s de simulación: **4.951 solicitudes (27,5 por segundo), 0 errores.**

| Solicitud | Cantidad | Mediana | p95 | p99 | Máx. |
| --- | --- | --- | --- | --- | --- |
| `GET /api/tickets/updates` (consulta periódica) | 4.309 | 6 ms | 11 ms | 24 ms | 105 ms |
| `GET /api/workspace` (abrir, ola de las 9:00) | 310 | 9 ms | 49 ms | 100 ms | 156 ms |
| `GET /api/equipment/mine` | 300 | 5 ms | 10 ms | 89 ms | 92 ms |
| `POST /api/tickets` | 31 | 28 ms | 53 ms | 62 ms | 62 ms |

**CPU de la base:**
- en promedio, **45 %** del límite de 0,25 CPU;
- en el peor momento, durante la ola de apertura, **86 %**;
- memoria usada: 72 MiB de 1 GiB.

Las latencias son del servidor local. En Vercel se suma la red entre la función y Neon, normalmente unos milisegundos en la misma región, y el arranque en frío de las funciones.

## Conclusiones

1. **0,25 CU alcanza para 300 personas** con el uso simulado, aunque con poco margen en el pico de las 9:00 (86 %). Si se suman más personas o más pestañas activas a la vez, conviene permitir que el cómputo crezca, por ejemplo con autoescalado hasta 0,5 o 1 CU. Esa es una decisión de plan de la persona responsable.
2. **El cómputo pasa el día despierto.** Con gente conectada, la consulta periódica no deja que Neon se suspenda, así que el consumo mensual depende de **las horas activas**, no de la cantidad de personas. Este mes, hasta el 18 de noviembre, el proyecto lleva unas 234 horas activo (unas 58 CU-h a 0,25 CU). Hay que comparar ese ritmo con el cómputo mensual que incluye el plan en la consola de Neon antes del lanzamiento.
3. **El almacenamiento no es el límite:** 3.000 tickets con sus mensajes son pocos MB frente a 1 GB. Los adjuntos van a Vercel Blob, no a la base.
4. **Mejora posible sin cambiar de plan:** que la consulta periódica responda «sin cambios» (`ETag`/`304`) cuando nada cambió. Eso reduce el trabajo de la base en las pestañas inactivas, que son la mayoría (plan de calidad, A1).
