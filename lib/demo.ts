import type { TicketPriority, TicketStatus } from './types';

export interface DemoTicket {
  key: string;
  subject: string;
  requesterName: string;
  requesterEmail: string;
  department: string;
  assignee: string;
  priority: TicketPriority;
  status: TicketStatus;
  ageHours: number;
  body: string;
  followup?: { author: string; body: string; kind: 'reply' | 'note' };
}
export const DEMO_TICKETS: DemoTicket[] = [
  {key:'access',subject:'No puedo acceder a mi cuenta',requesterName:'María Fernández',requesterEmail:'maria@ejemplo.test',department:'Soporte técnico',assignee:'Camila Torres',priority:'urgent',status:'open',ageHours:5,body:'Hola equipo, desde esta mañana no puedo entrar a mi cuenta. Al iniciar sesión aparece un mensaje de error, aunque ya restablecí mi contraseña. Necesito acceder para cerrar el informe del mes. ¿Me pueden ayudar?',followup:{author:'Camila Torres',body:'Revisé los accesos recientes. Voy a comprobar el estado de la cuenta antes de solicitar un nuevo restablecimiento.',kind:'note'}},
  {key:'invoice',subject:'Corrección de datos en la factura',requesterName:'Andrés Muñoz',requesterEmail:'andres@ejemplo.test',department:'Facturación',assignee:'Valentina Soto',priority:'normal',status:'pending',ageHours:3,body:'Necesitamos actualizar la razón social de nuestra última factura. ¿Qué información debemos enviar para solicitar la corrección?',followup:{author:'Valentina Soto',body:'Hola Andrés. Puedes indicarnos el número de factura y los datos de facturación correctos en esta conversación para revisarlos.',kind:'reply'}},
  {key:'export',subject:'La exportación de reportes queda cargando',requesterName:'Sofía Herrera',requesterEmail:'sofia@ejemplo.test',department:'Soporte técnico',assignee:'Diego Rojas',priority:'high',status:'open',ageHours:6,body:'Cuando intento exportar el reporte mensual a CSV el indicador se queda cargando y nunca se descarga el archivo. Sucede con el rango del mes completo.'},
  {key:'team',subject:'Agregar usuarios a nuestro equipo',requesterName:'Tomás Silva',requesterEmail:'tomas@ejemplo.test',department:'Ventas',assignee:'',priority:'normal',status:'open',ageHours:1.5,body:'Estamos incorporando a tres personas al equipo. Quisiera saber cómo ampliar el plan y gestionar sus accesos.'},
  {key:'integration',subject:'Consulta sobre integración con nuestro CRM',requesterName:'Daniela Reyes',requesterEmail:'daniela@ejemplo.test',department:'Ventas',assignee:'',priority:'low',status:'open',ageHours:2,body:'Nos gustaría centralizar la información de los clientes. ¿Existe una API para integrar el producto con nuestro CRM?'},
  {key:'notifications',subject:'No recibo las notificaciones del sistema',requesterName:'Felipe Castro',requesterEmail:'felipe@ejemplo.test',department:'Soporte técnico',assignee:'Diego Rojas',priority:'high',status:'pending',ageHours:7,body:'Dejé de recibir las notificaciones de actividad. Revisé la carpeta de spam y no hay mensajes nuevos.',followup:{author:'Diego Rojas',body:'Hola Felipe, revisamos la configuración de notificaciones. Confírmanos si recibes la próxima actualización para cerrar la revisión.',kind:'reply'}},
  {key:'password',subject:'Ayuda para restablecer mi contraseña',requesterName:'Laura Morales',requesterEmail:'laura@ejemplo.test',department:'Soporte técnico',assignee:'Camila Torres',priority:'normal',status:'resolved',ageHours:22,body:'Olvidé mi contraseña y necesito recuperar el acceso a mi cuenta.',followup:{author:'Camila Torres',body:'Laura confirmó que pudo recuperar el acceso y actualizar su contraseña. Solicitud resuelta.',kind:'note'}},
  {key:'payment',subject:'Confirmación de pago de la suscripción',requesterName:'Javier Pinto',requesterEmail:'javier@ejemplo.test',department:'Facturación',assignee:'Valentina Soto',priority:'normal',status:'resolved',ageHours:28,body:'Realizamos el pago de este mes y necesitamos confirmar que la suscripción sigue activa.',followup:{author:'Valentina Soto',body:'Hola Javier. El pago fue registrado correctamente y la suscripción está activa. Gracias por contactarnos.',kind:'reply'}},
];
export const DEMO_ARTICLES = [
  {title:'Cómo crear tu primera solicitud de soporte',category:'Primeros pasos',body:'1. Selecciona «Nuevo ticket» en la bandeja.\n\n2. Completa tu nombre, correo y el asunto de la solicitud.\n\n3. Describe qué ocurrió, qué esperabas que sucediera y los pasos para reproducir el problema. No incluyas contraseñas ni datos de tarjetas.\n\n4. Elige el departamento y guarda el ticket.\n\nDesde el detalle puedes consultar el estado y el historial de la solicitud.',published:true},
  {title:'Recuperar el acceso a tu cuenta',category:'Cuenta y acceso',body:'Si olvidaste tu contraseña, abre la pantalla de inicio de sesión del servicio y selecciona la opción para recuperarla.\n\nComprueba que escribiste correctamente el correo de la cuenta y revisa la carpeta de correo no deseado.\n\nSi el enlace expiró, solicita uno nuevo. Nunca compartas tu contraseña con soporte.\n\nSi el problema continúa, crea un ticket e indica el mensaje de error que aparece.',published:true},
  {title:'Actualizar tus datos de facturación',category:'Facturación',body:'Para corregir una factura, crea una solicitud dirigida a Facturación e incluye el número de documento y los datos que deben corregirse.\n\nNuestro equipo revisará la solicitud y te indicará los siguientes pasos.\n\nNo envíes números completos de tarjetas ni credenciales bancarias.',published:true},
  {title:'Guía interna: criterios de prioridad',category:'Equipo de soporte',body:'Urgente: interrupción completa del servicio o acceso bloqueado con impacto inmediato.\n\nAlta: función importante afectada sin alternativa adecuada.\n\nNormal: solicitud habitual o incidencia con una solución alternativa.\n\nBaja: consultas generales y sugerencias de mejora.\n\nLos plazos se calculan en horas continuas desde la creación del ticket.',published:false},
];
