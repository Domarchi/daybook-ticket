# Seguridad y confianza: entrega 6

Esta entrega mantiene Better Auth 1.7.15 y añade TOTP, recuperación y verificación reciente. No activa ninguna política, no cambia credenciales existentes ni contrata proveedores.

## Integración

- `SecurityCenter({ memberId?, returnTo? })` permite enrolar el autenticador, confirmar custodia de códigos, verificar identidad, gestionar sesiones propias y exportar el negocio. `/security` está disponible aun cuando la política exija un segundo factor para entrar al panel.
- `SecurityHealthPanel({ memberId })` muestra correo, recepción, programador, respaldos y auditoría administrativa. El propietario y administradores pueden consultarlo.
- Los errores 428 incluyen `redirectTo: /security`. El transporte compartido conserva la respuesta original, valida que el destino sea una página local conocida y abre la verificación sin reintentar la operación. Una respuesta JSON incompleta nunca confirma una operación de seguridad ni descarta el formulario de enrolamiento.
- `requireAccess` devuelve `sessionId` y aplica la obligación de MFA. La opción interna `allowSecuritySetup` se usa únicamente en estado y enrolamiento, nunca para acceder a tickets. `lockAccess` vuelve a comprobar la política en solicitudes interactivas, con bloqueo compartido contra cambios concurrentes.
- `requireFreshSecurity` exige contraseña verificada hace no más de cinco minutos y, si la cuenta usa MFA, segundo factor reciente. Aplica a permisos, configuración sensible, sesiones y exportaciones.

## Doble factor

El plugin oficial cifra el secreto TOTP y los diez códigos de recuperación. El código de aplicación se verifica antes de activar el factor. No se usan SMS, proveedores de QR ni dispositivos de confianza. La interfaz muestra una clave de configuración manual solo durante el enrolamiento; el usuario la introduce en su aplicación y conserva personalmente sus códigos.

La política del equipo comienza desactivada. Solo el propietario puede activarla con identidad reciente, autenticador verificado y custodia de recuperación confirmada. La activación invalida la garantía MFA de las demás sesiones de equipo: deben realizar el desafío antes de volver a consultar información. Los clientes no reciben una obligación adicional. Los endpoints de autenticación rechazan desactivar un factor cuando un espacio exige MFA al usuario.

Una sesión creada por un desafío pendiente no se acepta como autenticada. Tras completar enrolamiento, la garantía se vincula a la sesión nueva, nunca al token de la sesión retirada. Una reautenticación de una sesión existente no se confunde con un nuevo ingreso mediante contraseña. Los intentos de verificación tienen límites persistentes y los códigos de recuperación se consumen una sola vez.

Los endpoints de gestión devuelven identificadores opacos, navegador y sistema. Nunca entregan tokens de sesión ni direcciones IP. La API pública de Better Auth elimina los bearer tokens de sus respuestas JSON y conserva sus cookies seguras.

## Exportación y recuperación

- `/api/security/export` crea `daybook.business-export.v1`, cifrado con clave elegida por el administrador. Lee una lista positiva de tablas del negocio; excluye identidades globales, contraseñas/hash, TOTP, códigos de recuperación, sesiones, invitaciones, capacidades de respuesta, suscripciones push y payloads operativos de correo. No es un archivo de recuperación de identidades o plataforma.
- `/api/backups` y sus respaldos automáticos quedan reservados al propietario de la plataforma Daybook; un propietario de otro negocio debe usar la exportación anterior. La entrega de espacios independientes reemplazará este límite legado por su concesión explícita de operador.
- El respaldo operativo conserva también TOTP y su configuración; las garantías de sesiones no son portables. El operador debe custodiar **la clave original de Better Auth** fuera del archivo, además de la clave del respaldo. Sin ella, los secretos del autenticador cifrados por el plugin no pueden descifrarse. La recuperación no desactiva MFA ni incorpora un acceso alternativo.
- Los archivos anteriores sin el campo `twoFactorEnabled` siguen siendo compatibles y adoptan su valor predeterminado. Los perfiles de tablas se verifican junto a las huellas del archivo. Nunca se restaura sobre datos existentes.

## Auditoría

`securityAudit` solo admite inserciones. Un trigger rechaza cambios y eliminaciones; no existe una API para alterarlo. Registra actor, acción, identificador objetivo validado y fecha, sin contraseñas, códigos, contenido de tickets ni IP. Permisos y configuración se registran dentro de sus transacciones. El estado operativo expone códigos clasificados y totales del espacio, nunca mensajes crudos de proveedor.

## Comprobaciones

- Pruebas unitarias de límites de verificación, desafíos por rol, sesiones, selección segura de columnas y cifrado de exportación.
- Recorrido real del plugin instalado sobre un adaptador en memoria: enrolamiento, rotación, ingreso pendiente, código incorrecto, ingreso correcto y recuperación de un solo uso. Sin red ni base externa.
- `scripts/check-security-database.mjs`: prueba coordinada en QA con fixtures ficticios, transacción exterior y rollback final. Cubre activación, sesión anterior, cliente sin obligación, conflicto de versiones, aislamiento de sesiones, auditoría inmutable, exportación sin credenciales y revocación. No ejecutarlo contra producción ni en paralelo con otras pruebas que escriban QA.
- El enrolamiento de personas reales se realiza por ellas mismas después de revisar y publicar esta entrega. Nunca guardar claves, códigos, capturas de enrolamiento o estados de autenticación en artefactos del PR.

Fuentes: [2FA de Better Auth](https://better-auth.com/docs/plugins/2fa), [sesiones de Better Auth](https://better-auth.com/docs/concepts/session-management).

Validación local de la entrega: `npm run check` superó lint, 257 pruebas unitarias, tipos y compilación. `git diff --check` y el análisis sintáctico del script de QA también pasaron. No se ejecutaron pruebas contra la base, no se enviaron correos/push y no se activó la obligación de MFA. La revisión visual conjunta y el recorrido del script de QA se realizan después de integrar las entregas en la vista previa protegida.

Integración con las entregas 1–3: Seguridad está disponible en navegación y perfil de equipo y clientes. La verificación reciente con contraseña también está disponible sin enrolar MFA; si el equipo lo exige, esa comprobación nunca sustituye el desafío del autenticador. Salud y auditoría solo aparecen para administración al preparar el interruptor visual; la política MFA se aplica siempre desde el servidor.

Los perfiles de respaldo se comparan por el conjunto exacto de nombres, incluyendo perfiles antiguos del mismo tamaño. La compatibilidad de columnas conserva `replyToMessageId`, `sourceMessageId`, `serviceReminderId`, `contractId` y el valor por defecto de `authUser.twoFactorEnabled`. Un archivo con factores incoherentes se rechaza. Antes de abrir SQL o copiar archivos, la restauración comprueba criptográficamente cada secreto y los códigos con la clave original de autenticación; si falta o no corresponde, se detiene sin desactivar MFA.

La exportación de negocio incluye los dominios de colaboración, organización y contexto de servicios; no incorpora preferencias globales de identidad. Las respuestas 428 solo pueden abrir páginas locales de verificación, sin reintentos automáticos ni pérdida del cuerpo original de error.

Reversión: después de enrolar cualquier cuenta, una versión anterior que no conozca Better Auth 2FA podría omitir su desafío. La reversión compatible conserva el plugin, la validación de sesión/MFA del servidor y sus tablas, aunque se pause el resto de funciones o su interfaz. Solo antes del primer enrolamiento y sin políticas activas puede evaluarse volver a un build previo, comprobando primero esos estados. Nunca bajar `twoFactorEnabled`, borrar factores o cambiar la clave original para facilitar una reversión.

El simulacro acumulado de recuperación añade factores cifrados reales con Better Auth, custodia confirmada, una política obligatoria y su auditoría únicamente al manifest ficticio y al esquema aislado de destino. Comprueba clave ausente/incorrecta antes de SQL o archivos y conserva los factores, política y flag visual de seguridad tras recuperar. No inserta auditoría pública ni desactiva su trigger; limpia tablas globales por userId y elimina solo los esquemas ficticios de recuperación. La ejecución de QA corresponde al coordinador.

Integración acumulada con las entregas 1–5: respaldo actual de 74 tablas, incluidos conocimiento, informes, automatizaciones y los cuatro conjuntos de seguridad. Se conservan por nombre exacto los perfiles históricos de 30, 36, 40 (colaboración o seguridad), 45, 57, 61, 65 y 70 tablas. La exportación del negocio incluye esos dominios sin cuentas globales, preferencias de identidad ni payloads operativos de correo. SQL 0012 mantiene su hash revisado y su fecha normalizada `1793912005000` en el operador de prefijos.

Los cambios de funciones, avisos contractuales y reglas/plantillas/configuración de automatización registran auditoría administrativa sin contenido. La verificación reciente cubre las rutas reales de activación, tanto heredadas como bajo un espacio explícito. La salud operativa distingue avisos y recordatorios, garantías y renovaciones, y reglas internas; los errores se presentan como códigos clasificados.

Las descargas y vistas previas comprueban los permisos actuales antes y después de consultar el almacenamiento privado. El segundo control vuelve a verificar pertenencia, rol, empresa, tipo de archivo, política MFA, vigencia de la sesión y pausa de contratos. Si cambian permisos o metadatos, el flujo se cancela sin entregar bytes; se mantienen tamaño y cabeceras privadas. Las pruebas locales simulan cada revocación durante la lectura remota, sin base ni proveedores.

## Evidencia acumulada del coordinador

Código integrado `24e61e6` (misma implementación comprobada en `2d5e887`, con la evidencia de E5 añadida): lint, tipos, **363 pruebas unitarias** y compilación aprobados. El ensayo y la aplicación de 0012 en QA conservaron **73 tablas y 676 filas** originales; hash y fecha quedan fijados en el operador revisado.

QA pasó nueve grupos de política, identidad reciente, sesiones propias, auditoría inalterable y exportación sin credenciales. Se comprobó por separado que no quedaron organizaciones ni cuentas de esa suite. El recorrido HTTP real del entorno ficticio rechazó prueba ausente y contraseña incorrecta, confirmó la contraseña correcta, permitió el control sensible, ocultó tokens de sesión y mantuvo privados auditoría/salud. La política de MFA del espacio de demostración siguió apagada; no se enroló ni modificó ninguna cuenta real.

La recuperación de **74 tablas y tres archivos** conservó autenticador cifrado, códigos y custodia, política y demás historial. Una clave original de autenticación ausente o incorrecta se rechazó antes de abrir SQL o copiar archivos. Conocimiento y trabajos quedaron pausados, MFA se conservó y todas las fixtures/esquemas se limpiaron. No hubo entregas externas.

Revisión visual: escritorio y móvil 390×844 sin desbordamiento, negro Daybook, estado de verificación, obligación gradual, controles de sesiones y exportación. Vista previa protegida: https://daybook-ticket-evolution-06-qa-domarchi.vercel.app/ . Programadores y envíos externos apagados. La publicación productiva y el enrolamiento personal requieren la revisión posterior prevista en el plan.
