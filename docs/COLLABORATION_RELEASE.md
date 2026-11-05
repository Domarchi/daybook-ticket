# Entrega 1: colaboración y presentación

## Comportamiento

El equipo y los clientes pueden citar mensajes autorizados y volver al original, incluso fuera del lote de conversación cargado. Las notas solo se citan dentro de otras notas. Las menciones identifican cuentas activas del equipo y generan avisos privados. Seguir un ticket suma sus actualizaciones públicas sin cambiar responsable ni quitar destinatarios obligatorios.

La búsqueda consulta todo el historial autorizado. La galería pagina archivos y filtra por nombre, tipo y fechas de Santiago; conserva las rutas privadas de vista previa y descarga. Listado, contexto, búsqueda y entrega de avisos vuelven a comprobar pertenencia y permisos.

Se añaden selector claro/oscuro/automático por cuenta, negro neutro y dorado, y detalles del ticket plegables en móvil. El texto de los borradores continúa separado por cuenta, rol y ticket. Las referencias de cita y selección de menciones se conservan mientras está abierto el editor; al recargar se recupera el texto y debe elegirse de nuevo la referencia.

## Preparación y conservación

La migración aditiva `0007_collaboration` agrega referencias opcionales y cuatro tablas. No cambia contraseñas, miembros, estados, vencimientos ni mensajes anteriores. No genera menciones o seguidores retroactivos. Los nuevos campos opcionales no cambian las claves de reintento antiguas. Los respaldos aceptan perfiles por conjuntos exactos de tablas y restauran citas con clave diferida.

Todas las funciones nuevas nacen desactivadas. Un administrador habilita «Conversaciones colaborativas» después de revisar. La obligación de MFA es una política independiente y no se desactiva con este panel.

## Evidencias de QA

- 252 pruebas unitarias; lint, tipos y compilación de producción.
- Ocho grupos de pruebas de base, con rollback y sin correo/push real: citas y audiencia, menciones, reintentos, revocación, búsqueda, archivos, seguidores y preferencias aisladas.
- Ensayo y aplicación serial de la migración en QA: 39 tablas y 506 filas preexistentes con huellas idénticas de todas sus columnas originales.
- Ticket ficticio #379: nota privada no consultable por cliente; reenvío de respuesta con el mismo `operationId` devuelve el mensaje original; búsqueda completa y contexto anterior a los 50 mensajes recientes comprobados por HTTP y navegador.
- Revisión de escritorio y 390×844: claro/oscuro, búsqueda, salto al original, cita privada abre nota y desaparece al volver a respuesta pública, galería y detalles plegables. Sin desbordamiento horizontal.

Las capturas locales se guardan en `outputs/evolution-01/`. Las pruebas usan únicamente `.env.test.local`, cuentas `example.test` y registros de prueba. La programación y los proveedores externos permanecen desactivados.

## Publicación y reversión

1. Revisar PR, CI del commit exacto y Preview protegida. No publicar una rama posterior antes de revisar sus dependencias.
2. En la ventana de publicación autorizada, crear respaldo cifrado y verificar recuperación y archivos privados. Registrar inventarios y huellas sin extraer contenido sensible.
3. Ensayar la migración acumulada sobre QA, aplicar únicamente el prefijo revisado con un operador que valide el destino, diario y hashes; comparar las columnas y filas preexistentes dentro de la misma transacción. No usar un operador histórico de otra migración para saltarse estas comprobaciones.
4. Publicar el commit revisado con funciones pausadas, comprobar acceso, conversación, descarga y salud, y habilitar colaboración explícitamente.
5. Para detener la función, apagar su interruptor. Para volver a la aplicación anterior, promover el despliegue anterior conservando las tablas aditivas; no ejecutar migraciones destructivas ni restaurar una copia antigua sobre nuevos tickets.

Esta entrega no publica producción, cambia DNS, activa MFA ni habilita negocios comerciales.

## Candidato revisable

Código validado localmente en `9f7efa1`: `npm run check` final aprobado (252 pruebas), segunda pasada de lint sin advertencias, ocho grupos QA con rollback y recorrido HTTP/visual de #379. Este registro autenticado solicita únicamente la construcción del Preview protegido de la entrega 1. Producción y proveedores reales siguen sin cambios.

## Ensayo de recuperación ampliado

El primer CI detectó un error de limpieza del ensayo: las preferencias se identifican por `userId`, no por `ownerId`. Se corrigió el alcance de limpieza y se añadieron fixtures de cita, seguimiento y tema. La recuperación QA posterior pasó con 40 tablas, dos archivos privados, claves foráneas reales, huellas exactas y limpieza completa de cuentas/esquemas ficticios. No hubo envíos externos.
