# Daybook Ticket: confiabilidad y atención compartida

Base publicada: `dfa3839d9a066631e8afd0ee5b5648369fd03fac`.
Rama aislada: `codex/daybook-ticket-reliability`.

## Entrega autorizada: puntos 1 a 6

1. Correo entrante durable con estados, errores clasificados, recuperación y reintento administrativo seguro.
2. Cuentas cliente y tickets de prueba marcados explícitamente; exclusión predeterminada de métricas y satisfacción, con filtro para incluirlos. No se infieren pruebas por correo, asunto o puntaje.
3. Respaldos automáticos cifrados de datos y archivos privados, verificación posterior a la carga, retención segura, cuotas y estado administrativo. Desactivados hasta comprobar configuración y cuota. Claves de QA y producción separadas.
4. Adjuntos de correo importados al almacenamiento privado con validación de contenido, tamaño, permisos, cuotas e idempotencia.
5. Presencia y redacción del equipo por ticket, sin contenido de borradores y con caducidad corta; no bloquea respuestas.
6. Portal con progreso público y conversaciones más claras en móvil; limpieza de texto citado en correo, sin exponer notas internas.

## Conservación y límites

Migración aditiva `0006_reliability`. No borrar ni recrear datos ni inventar historial. Usuarios, contraseñas, sesiones, empresas, tickets, mensajes, archivos y claves de envío permanecen. Las marcas de prueba empiezan en falso. No modificar Consorcio C17 ni sus servicios, DNS, planes o repositorios.

Trabajar y probar únicamente con `.env.test.local`, Neon QA aislado y datos ficticios. Pruebas que muten QA en serie. No enviar correos ni push reales. No modificar dependencias compartidas por el enlace `node_modules`.

Los avisos existentes siguen usando el programador actual. Los trabajos de recepción y respaldo tienen endpoints privados independientes y activación explícita en el pinger; ningún respaldo consume el tiempo del proceso de recordatorios. Todo acceso autentica antes de cargar dependencias de base.

## Validación

- Migración QA: PASS; 33 tablas y 462 filas previas conservadas, mismas columnas y huellas. Sin designaciones de prueba ni historial artificial.
- Primera pasada de unidades: 205/205, sin red.
- Marca de pruebas QA: PASS; exclusión de carga, respuestas, SLA y CSAT; inclusión opcional y reversión sin eliminar historial; limpieza completa.
- Respaldo QA: PASS; snapshot y archivo privados ficticios, cifrado/lectura verificada, concurrencia, permisos, idempotencia diaria y cuotas; transporte inyectado sin servicios externos y limpieza.
- Comprobaciones integradas, revisión visual, CI y Preview: resultados en [RELIABILITY_VALIDATION.md](RELIABILITY_VALIDATION.md).

## Publicación

Esta ejecución prepara una versión revisable. No fusionar ni publicar en producción. Entregar PR, Preview protegida, evidencias, pasos de activación y reversión. La producción y sus datos quedan intactos.
