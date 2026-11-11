import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTicketText, normalizeForMatching } from '../lib/ticket-classifier';
import {
  FAULT_GROUPS,
  REQUIREMENTS,
  faultLabel,
  isValidFault,
  requirementLabel,
  type FaultElementId,
  type FaultGroupId,
  type RequirementId,
} from '../lib/ticket-category-model';

/**
 * Hand-written examples of how people describe problems, with the category a person would choose.
 * `fault: null` means nothing failed (a plain request). `element` is checked only when given.
 * This corpus is ours, so the score below is an upper bound: real tickets will show what is missing.
 */
type Case = {
  subject: string;
  body?: string;
  fault: { group: FaultGroupId; element?: FaultElementId | null } | null;
  requirement: RequirementId | null;
};
const CORPUS: Case[] = [
  // Equipos y periféricos
  { subject: 'El monitor no enciende', fault: { group: 'equipment', element: 'monitor' }, requirement: null },
  {
    subject: 'Pantalla parpadea',
    body: 'La segunda pantalla parpadea cada pocos minutos.',
    fault: { group: 'equipment', element: 'monitor' },
    requirement: null,
  },
  {
    subject: 'Mi computador está muy lento y se reinicia',
    fault: { group: 'equipment', element: 'computer' },
    requirement: null,
  },
  { subject: 'Pantallazo azul en el notebook', fault: { group: 'equipment', element: 'computer' }, requirement: null },
  { subject: 'El notebook no prende', fault: { group: 'equipment', element: 'computer' }, requirement: null },
  { subject: 'Teclado con teclas pegadas', fault: { group: 'equipment', element: 'keyboard' }, requirement: null },
  { subject: 'El mouse no funciona', fault: { group: 'equipment', element: 'mouse' }, requirement: null },
  {
    subject: 'El cursor se mueve solo',
    body: 'El ratón inalámbrico falla.',
    fault: { group: 'equipment', element: 'mouse' },
    requirement: null,
  },
  {
    subject: 'No puedo imprimir',
    body: 'La impresora del segundo piso no imprime.',
    fault: { group: 'equipment', element: 'printer' },
    requirement: null,
  },
  { subject: 'Impresora sin tóner', fault: { group: 'equipment', element: 'printer' }, requirement: null },
  {
    subject: 'Papel atascado en la multifuncional',
    fault: { group: 'equipment', element: 'printer' },
    requirement: null,
  },
  {
    subject: 'El escáner no envía los documentos al correo',
    fault: { group: 'equipment', element: 'printer' },
    requirement: null,
  },
  {
    subject: 'La docking no reconoce los monitores',
    fault: { group: 'equipment', element: 'docking' },
    requirement: null,
  },
  {
    subject: 'Celular corporativo con la pantalla rota',
    fault: { group: 'equipment', element: 'phone' },
    requirement: null,
  },
  { subject: 'El iPhone no carga', fault: { group: 'equipment', element: 'phone' }, requirement: null },
  {
    subject: 'Audífonos no funcionan en las reuniones',
    fault: { group: 'equipment', element: 'other_device' },
    requirement: null,
  },
  { subject: 'La cámara web no se detecta', fault: { group: 'equipment', element: 'other_device' }, requirement: null },
  {
    subject: 'Proyector de la sala de reuniones dañado',
    fault: { group: 'equipment', element: 'other_device' },
    requirement: null,
  },
  // Conectividad
  {
    subject: 'Sin internet en toda la oficina',
    fault: { group: 'connectivity', element: 'internet' },
    requirement: null,
  },
  {
    subject: 'Internet muy lento desde la mañana',
    fault: { group: 'connectivity', element: 'internet' },
    requirement: null,
  },
  {
    subject: 'El celular no tiene señal',
    body: 'Sin señal 4G en terreno.',
    fault: { group: 'connectivity', element: 'mobile_network' },
    requirement: null,
  },
  {
    subject: 'Se acabaron los datos móviles del plan',
    fault: { group: 'connectivity', element: 'mobile_network' },
    requirement: null,
  },
  {
    subject: 'La VPN se desconecta cada rato',
    fault: { group: 'connectivity', element: 'computer_network' },
    requirement: null,
  },
  {
    subject: 'No funciona el punto de red de mi escritorio',
    fault: { group: 'connectivity', element: 'computer_network' },
    requirement: null,
  },
  {
    subject: 'No puedo ver el servidor de archivos',
    fault: { group: 'connectivity', element: 'computer_network' },
    requirement: null,
  },
  { subject: 'El WiFi se cae', fault: { group: 'connectivity', element: 'wifi' }, requirement: null },
  {
    subject: 'No me conecta a la red inalámbrica de invitados',
    fault: { group: 'connectivity', element: 'wifi' },
    requirement: null,
  },
  // Acceso y contraseñas
  { subject: 'Olvidé mi contraseña', fault: { group: 'access' }, requirement: null },
  {
    subject: 'Usuario bloqueado',
    body: 'Me equivoqué varias veces con la clave.',
    fault: { group: 'access' },
    requirement: null,
  },
  { subject: 'No puedo iniciar sesión en el computador', fault: { group: 'access' }, requirement: null },
  { subject: 'Mi contraseña caducó', fault: { group: 'access' }, requirement: null },
  { subject: 'No me llega el código de verificación', fault: { group: 'access' }, requirement: null },
  { subject: 'Restablecer la clave de Outlook', fault: { group: 'access' }, requirement: null },
  // Aplicaciones Microsoft
  { subject: 'Outlook no sincroniza los correos', fault: { group: 'microsoft_apps' }, requirement: null },
  { subject: 'Excel se cierra solo al abrir una planilla', fault: { group: 'microsoft_apps' }, requirement: null },
  { subject: 'Teams no tiene audio en las llamadas', fault: { group: 'microsoft_apps' }, requirement: null },
  { subject: 'OneDrive no sube los archivos', fault: { group: 'microsoft_apps' }, requirement: null },
  { subject: 'Error al abrir documentos en Word', fault: { group: 'microsoft_apps' }, requirement: null },
  { subject: 'Windows pide actualizar y queda pegado', fault: { group: 'microsoft_apps' }, requirement: null },
  // Aplicaciones No Microsoft
  { subject: 'SAP muestra un error al contabilizar', fault: { group: 'other_apps' }, requirement: null },
  { subject: 'Zoom se congela en las reuniones', fault: { group: 'other_apps' }, requirement: null },
  { subject: 'Adobe Acrobat no abre los PDF', fault: { group: 'other_apps' }, requirement: null },
  { subject: 'Chrome no carga ninguna página', fault: { group: 'other_apps' }, requirement: null },
  { subject: 'El antivirus bloquea un programa', fault: { group: 'other_apps' }, requirement: null },
  // Aplicaciones DayBook
  { subject: 'Daybook no carga la bandeja', fault: { group: 'daybook_apps' }, requirement: null },
  { subject: 'Error al guardar una nota en DayBook', fault: { group: 'daybook_apps' }, requirement: null },
  // Otros
  {
    subject: 'Ayuda por favor',
    body: 'Tengo un problema y no sé a quién recurrir.',
    fault: { group: 'other', element: null },
    requirement: null,
  },
  {
    subject: 'Consulta general',
    body: 'Algo no anda bien desde ayer.',
    fault: { group: 'other', element: null },
    requirement: null,
  },
  // Requerimientos sin falla
  { subject: 'Necesito un monitor adicional', fault: null, requirement: 'equipment' },
  { subject: 'Solicito un notebook para el nuevo practicante', fault: null, requirement: 'equipment' },
  { subject: 'Requiero un mouse inalámbrico', fault: null, requirement: 'equipment' },
  {
    subject: 'Crear usuario para nueva colaboradora',
    body: 'Ingresa el lunes a finanzas.',
    fault: null,
    requirement: 'user_accounts',
  },
  { subject: 'Dar de baja la cuenta de un ex funcionario', fault: null, requirement: 'user_accounts' },
  { subject: 'Necesito una casilla de correo para recepción', fault: null, requirement: 'user_accounts' },
  { subject: 'Instalar AutoCAD en mi equipo', fault: null, requirement: 'applications' },
  { subject: 'Solicito licencia de Office para la nueva área', fault: null, requirement: 'applications' },
  {
    subject: 'Necesito acceso a la carpeta compartida de Contabilidad',
    fault: null,
    requirement: 'folder_permissions',
  },
  { subject: 'Permisos de escritura en la unidad de red', fault: null, requirement: 'folder_permissions' },
  { subject: 'Necesito que me cambien de escritorio', fault: null, requirement: 'other' },
  // Falla y requerimiento a la vez
  {
    subject: 'No puedo entrar a la carpeta compartida de Ventas',
    fault: { group: 'access' },
    requirement: 'folder_permissions',
  },
  {
    subject: 'Se venció la licencia y Excel no abre',
    fault: { group: 'microsoft_apps' },
    requirement: 'applications',
  },
];

// Measured 85 % (17/20) on 11 nov 2026 before any tuning; the floor only catches regressions.
const HELD_OUT_FLOOR = 80;
const accuracy = (hits: number, total: number) => Math.round((hits / total) * 1000) / 10;

test('the hand-written corpus is classified the way a person would, with few misses', () => {
  const misses: string[] = [];
  let group = 0,
    element = 0,
    elementTotal = 0,
    requirement = 0;
  for (const item of CORPUS) {
    const result = classifyTicketText({ subject: item.subject, body: item.body });
    const groupOk = item.fault === null ? result.fault === null : result.fault?.group === item.fault.group;
    if (groupOk) group++;
    if (item.fault && item.fault.element !== undefined) {
      elementTotal++;
      if (result.fault?.element === item.fault.element) element++;
    }
    if (result.requirement === item.requirement) requirement++;
    if (
      !groupOk ||
      result.requirement !== item.requirement ||
      (item.fault?.element !== undefined && result.fault?.element !== item.fault.element)
    )
      misses.push(
        `«${item.subject}» → ${faultLabel(result.fault)} / ${requirementLabel(result.requirement)} ` +
          `(esperado ${item.fault ? faultLabel({ group: item.fault.group, element: item.fault.element ?? null }) : 'Sin falla'} / ${requirementLabel(item.requirement)})`,
      );
  }
  const report = {
    casos: CORPUS.length,
    grupo: accuracy(group, CORPUS.length),
    elemento: accuracy(element, elementTotal),
    requerimiento: accuracy(requirement, CORPUS.length),
  };
  console.log(`Clasificador · ${JSON.stringify(report)}${misses.length ? `\n  ${misses.join('\n  ')}` : ''}`);
  assert.ok(report.grupo >= 90, `grupo ${report.grupo} %`);
  assert.ok(report.elemento >= 90, `elemento ${report.elemento} %`);
  assert.ok(report.requerimiento >= 90, `requerimiento ${report.requerimiento} %`);
});

test('accents, case and punctuation do not change the result', () => {
  assert.equal(normalizeForMatching('¿CONTRASEÑA bloqueada?'), 'contrasena bloqueada');
  const plain = classifyTicketText({ subject: 'contrasena bloqueada' });
  const written = classifyTicketText({ subject: '¡¡Contraseña BLOQUEADA!!' });
  assert.deepEqual(written, plain);
});

test('words are matched whole, not inside other words', () => {
  // "sim" is a SIM card; "simple" must not count as one, nor "pc" inside "pcs-algo".
  const result = classifyTicketText({ subject: 'Una consulta simple sobre el formulario' });
  assert.equal(result.fault?.group, 'other');
  assert.equal(result.confidence, 'low');
});

test('an empty or missing text still gives a valid, low-confidence suggestion', () => {
  for (const input of [{}, { subject: '' }, { subject: null, body: null }, { subject: '   ', body: '...' }]) {
    const result = classifyTicketText(input);
    assert.deepEqual(result.fault, { group: 'other', element: null });
    assert.equal(result.requirement, null);
    assert.equal(result.confidence, 'low');
    assert.deepEqual(result.matched, []);
    assert.equal(result.source, 'bot');
  }
});

test('every suggestion is a valid category and explains itself', () => {
  for (const item of CORPUS) {
    const result = classifyTicketText({ subject: item.subject, body: item.body });
    if (result.fault) assert.ok(isValidFault(result.fault.group, result.fault.element), item.subject);
    if (result.fault && result.fault.group !== 'other') assert.ok(result.matched.length > 0, item.subject);
  }
});

test('a clear case is confident and a vague one is not', () => {
  assert.equal(classifyTicketText({ subject: 'La impresora no imprime', body: 'Sin tóner.' }).confidence, 'high');
  assert.equal(classifyTicketText({ subject: 'Algo no anda' }).confidence, 'low');
});

test('the subject weighs more than a passing mention in the body', () => {
  const result = classifyTicketText({
    subject: 'Outlook no envía correos',
    body: 'Lo intenté también desde el celular y pasa lo mismo.',
  });
  assert.equal(result.fault?.group, 'microsoft_apps');
});

test('a very long body is cut, so the work per ticket is bounded', () => {
  const body = `${'texto de relleno '.repeat(2000)} impresora`;
  const result = classifyTicketText({ subject: 'Consulta', body });
  assert.equal(result.fault?.group, 'other', 'words after the first 5000 characters are ignored');
});

test('the taxonomy matches the agreed list', () => {
  assert.deepEqual(
    FAULT_GROUPS.map(group => group.label),
    [
      'Equipos y periféricos',
      'Conectividad',
      'Acceso y contraseñas',
      'Aplicaciones Microsoft',
      'Aplicaciones No Microsoft',
      'Aplicaciones DayBook',
      'Otros',
    ],
  );
  assert.deepEqual(
    FAULT_GROUPS[0].elements.map(element => element.label),
    ['Monitor', 'Computador', 'Teclado', 'Mouse', 'Impresora', 'Docking', 'Celular', 'Otro'],
  );
  assert.deepEqual(
    FAULT_GROUPS[1].elements.map(element => element.label),
    ['Servicios Internet', 'Redes móviles', 'Red computacional', 'Red WiFi'],
  );
  assert.deepEqual(
    REQUIREMENTS.map(requirement => requirement.label),
    ['Equipos', 'Cuentas de usuarios', 'Aplicaciones', 'Permisos de carpetas', 'Otros'],
  );
  assert.equal(isValidFault('equipment', 'wifi'), false, 'an element belongs to its own group');
  assert.equal(isValidFault('access', null), true);
  assert.equal(isValidFault('nope', null), false);
});

/**
 * Held-out examples, written after the rules and on purpose in other words (colloquial, typos, indirect).
 * The rules were NOT tuned for them: their score is the honest estimate. The threshold only guards against
 * getting worse; improve the rules with real tickets, then raise it.
 */
const HELD_OUT: Case[] = [
  { subject: 'no me abre el correo', fault: { group: 'microsoft_apps' }, requirement: null },
  { subject: 'el compu no da imagen', fault: { group: 'equipment' }, requirement: null },
  {
    subject: 'se me trabó la impresora de nuevo',
    fault: { group: 'equipment', element: 'printer' },
    requirement: null,
  },
  { subject: 'no hay red en la sala 3', fault: { group: 'connectivity' }, requirement: null },
  { subject: 'me sale clave incorrecta todo el rato', fault: { group: 'access' }, requirement: null },
  { subject: 'la planilla de excel quedó corrupta', fault: { group: 'microsoft_apps' }, requirement: null },
  { subject: 'no puedo compartir pantalla en teams', fault: { group: 'microsoft_apps' }, requirement: null },
  { subject: 'el wifi del 4to piso anda pésimo', fault: { group: 'connectivity', element: 'wifi' }, requirement: null },
  { subject: 'mi teléfono no recibe llamadas', fault: { group: 'equipment', element: 'phone' }, requirement: null },
  { subject: 'el teclado del notebook escribe letras repetidas', fault: { group: 'equipment' }, requirement: null },
  {
    subject: 'se cortó la conexión a internet',
    fault: { group: 'connectivity', element: 'internet' },
    requirement: null,
  },
  { subject: 'no puedo entrar al sistema contable', fault: { group: 'access' }, requirement: null },
  { subject: 'el ERP se queda cargando', fault: { group: 'other_apps' }, requirement: null },
  { subject: 'la bandeja de daybook muestra tickets duplicados', fault: { group: 'daybook_apps' }, requirement: null },
  { subject: 'favor crear correo para practicante', fault: null, requirement: 'user_accounts' },
  { subject: 'necesitamos 3 notebooks para los nuevos', fault: null, requirement: 'equipment' },
  { subject: 'me pueden dar permiso para la carpeta de RRHH', fault: null, requirement: 'folder_permissions' },
  { subject: 'instalen zoom en el pc de recepción', fault: null, requirement: 'applications' },
  { subject: 'hay que bloquear la cuenta de una persona que se fue', fault: null, requirement: 'user_accounts' },
  { subject: 'la pantalla quedó negra', fault: { group: 'equipment', element: 'monitor' }, requirement: null },
];

test('held-out phrasings: the honest estimate, guarded against regressions', () => {
  const misses: string[] = [];
  let hits = 0;
  for (const item of HELD_OUT) {
    const result = classifyTicketText({ subject: item.subject, body: item.body });
    const ok =
      (item.fault === null ? result.fault === null : result.fault?.group === item.fault.group) &&
      result.requirement === item.requirement &&
      (item.fault?.element === undefined || result.fault?.element === item.fault.element);
    if (ok) hits++;
    else
      misses.push(
        `«${item.subject}» → ${faultLabel(result.fault)} / ${requirementLabel(result.requirement)} ` +
          `(esperado ${item.fault ? faultLabel({ group: item.fault.group, element: item.fault.element ?? null }) : 'Sin falla'} / ${requirementLabel(item.requirement)})`,
      );
  }
  const score = accuracy(hits, HELD_OUT.length);
  console.log(
    `Clasificador (frases nuevas) · ${hits}/${HELD_OUT.length} = ${score} %${misses.length ? `\n  ${misses.join('\n  ')}` : ''}`,
  );
  assert.ok(score >= HELD_OUT_FLOOR, `frases nuevas ${score} %`);
});
