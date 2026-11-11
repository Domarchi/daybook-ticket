import {
  FAULT_GROUPS,
  type FaultElementId,
  type FaultGroupId,
  type RequirementId,
  type TicketCategory,
} from './ticket-category-model';

/**
 * Suggests a category from what the person wrote, with fixed keyword rules. It runs on the server, sends the text
 * nowhere and needs no provider. The result is a suggestion: a person can correct it, and a correction always wins.
 *
 * Any other classifier (for example one backed by a language model, if that is ever authorised) can replace this
 * one as long as it keeps the `TicketClassifier` signature.
 */
export type ClassificationInput = { subject?: string | null; body?: string | null };
export type Classification = TicketCategory & {
  /** "high" when one category clearly wins; "low" when the text says little or two categories are close. */
  confidence: 'high' | 'low';
  /** The words that decided, as written in the rules, to show why ("impresora, tóner"). */
  matched: string[];
  source: 'bot';
};
export type TicketClassifier = (input: ClassificationInput) => Classification;

/** Long messages add little: the subject and the first part of the body carry the request. */
const MAX_TEXT = 5000;

/** Lower case, no accents, letters and digits only: "¿Contraseña?" and "contrasena" match. */
export function normalizeForMatching(text: string): string {
  return text
    .slice(0, MAX_TEXT)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type Term = { label: string; weight: number; pattern: RegExp };
/** Words are matched whole; a trailing "*" also matches longer words ("imprim*" → imprimir, imprime). */
function terms(weight: number, ...words: string[]): Term[] {
  return words.map(word => {
    const prefix = word.endsWith('*');
    const text = normalizeForMatching(prefix ? word.slice(0, -1) : word);
    return {
      label: word.replace(/\*$/, ''),
      weight,
      pattern: new RegExp(`(?:^| )${text}${prefix ? '[a-z0-9]*' : ''}(?= |$)`),
    };
  });
}

type FaultKey = `${FaultGroupId}` | `${FaultGroupId}:${FaultElementId}`;
const FAULT_RULES: Partial<Record<FaultKey, Term[]>> = {
  'equipment:monitor': [...terms(2, 'monitor*', 'pantalla*'), ...terms(1, 'hdmi', 'displayport', 'parpade*')],
  'equipment:computer': [
    ...terms(2, 'computador*', 'computadora*', 'notebook*', 'laptop*', 'portatil*', 'pc', 'cpu', 'pantallazo azul'),
    ...terms(2, 'disco duro', 'memoria ram'),
    ...terms(1, 'no enciende', 'no prende', 'se reinicia', 'bateria'),
  ],
  'equipment:keyboard': terms(2, 'teclado*', 'tecla', 'teclas'),
  'equipment:mouse': [...terms(2, 'mouse', 'raton'), ...terms(1, 'cursor', 'puntero')],
  'equipment:printer': [
    ...terms(2, 'impresora*', 'imprim*', 'impresion*', 'toner', 'escaner', 'escane*', 'plotter'),
    ...terms(2, 'fotocopiadora*', 'multifuncional*'),
    ...terms(1, 'papel atascado', 'atasco', 'cartucho*', 'tinta'),
  ],
  'equipment:docking': terms(3, 'docking', 'dock', 'estacion de acoplamiento', 'replicador de puertos'),
  'equipment:phone': terms(3, 'celular*', 'telefono movil', 'telefono celular', 'smartphone', 'iphone', 'android'),
  'equipment:other_device': [
    ...terms(2, 'audifono*', 'auricular*', 'headset', 'camara*', 'webcam', 'microfono*', 'parlante*', 'altavoz'),
    ...terms(2, 'proyector*', 'cargador*', 'ups', 'telefono fijo', 'tablet*'),
  ],
  equipment: terms(1, 'periferico*', 'hardware'),
  'connectivity:internet': [...terms(3, 'internet'), ...terms(2, 'fibra optica', 'modem'), ...terms(1, 'navegar')],
  'connectivity:mobile_network': terms(
    3,
    'datos moviles',
    'senal',
    '4g',
    '5g',
    '3g',
    'chip',
    'sim',
    'tarjeta sim',
    'roaming',
    'plan de datos',
    'cobertura',
  ),
  'connectivity:computer_network': [
    ...terms(3, 'cable de red', 'punto de red', 'vpn', 'red interna', 'intranet', 'ethernet', 'lan'),
    ...terms(2, 'switch', 'direccion ip', 'ip', 'dns', 'servidor*'),
    ...terms(1, 'red'),
  ],
  'connectivity:wifi': terms(3, 'wifi', 'wi fi', 'wireless', 'inalambric*', 'access point'),
  connectivity: terms(1, 'conexion', 'conect*', 'desconect*', 'router'),
  access: [
    ...terms(3, 'contrasena*', 'password', 'usuario bloqueado', 'cuenta bloqueada'),
    ...terms(2, 'clave*', 'bloquead*', 'desbloque*', 'no puedo entrar', 'no puedo ingresar', 'login'),
    ...terms(2, 'iniciar sesion', 'inicio de sesion', 'mfa', 'autenticador', 'doble factor', 'codigo de verificacion'),
    ...terms(2, 'restablecer', 'credencial*'),
    ...terms(1, 'acceso', 'acceder', 'ingresar', 'caducad*', 'expir*'),
  ],
  microsoft_apps: [
    ...terms(3, 'outlook', 'teams', 'excel', 'word', 'powerpoint', 'onedrive', 'sharepoint', 'onenote'),
    ...terms(3, 'office', 'microsoft', 'office 365', 'microsoft 365', 'm365', 'o365'),
    ...terms(2, 'windows', 'exchange'),
    ...terms(1, 'edge', 'correo*'),
  ],
  other_apps: [
    ...terms(3, 'sap', 'zoom', 'chrome', 'google', 'gmail', 'adobe', 'acrobat', 'whatsapp', 'antivirus', 'autocad'),
    ...terms(3, 'erp', 'crm', 'firefox', 'slack', 'dropbox', 'java'),
    ...terms(1, 'programa*', 'aplicacion*', 'software', 'app', 'sistema'),
  ],
  daybook_apps: terms(3, 'daybook', 'day book'),
};

const REQUIREMENT_RULES: Partial<Record<RequirementId, Term[]>> = {
  user_accounts: terms(
    3,
    'crear usuario',
    'crear cuenta',
    'nueva cuenta',
    'cuenta nueva',
    'nuevo usuario',
    'usuario nuevo',
    'cuenta de usuario',
    'cuenta de correo',
    'correo nuevo',
    'nuevo correo',
    'crear correo',
    'casilla de correo',
    'alta de usuario',
    'dar de alta',
    'baja de usuario',
    'dar de baja',
    'desactivar cuenta',
    'eliminar cuenta',
    'nuevo colaborador',
    'nueva colaboradora',
    'nuevo empleado',
    'nueva empleada',
    'nuevo funcionario',
    'nueva funcionaria',
  ),
  applications: [...terms(3, 'instal*', 'licencia*'), ...terms(2, 'acceso a la aplicacion', 'acceso al sistema')],
  folder_permissions: [
    ...terms(3, 'carpeta compartida', 'acceso a la carpeta', 'directorio compartido', 'unidad de red'),
    ...terms(2, 'permiso*', 'carpeta*'),
  ],
};

/** Signs that something broke, as opposed to a plain request. */
const FAILURE = terms(
  1,
  'no funciona',
  'no anda',
  'no sirve',
  'falla*',
  'error*',
  'no enciende',
  'no prende',
  'no carga',
  'no abre',
  'no imprime',
  'no conecta',
  'se cae',
  'se cayo',
  'lento*',
  'problema*',
  'roto',
  'rota',
  'danad*',
  'no responde',
  'se cierra',
  'se congela',
  'pegad*',
  'no puedo',
  'no me deja',
  'no aparece',
  'no detecta',
  'no reconoce',
  'sin senal',
  'sin internet',
  'intermitente',
  'bloquead*',
  'olvide',
  'no recuerdo',
  'caduc*',
  'no llega',
  'no sincroniza',
  'no envia',
  'no recibe',
  'pantallazo',
);
/** Signs of a request. */
const REQUEST = terms(
  1,
  'necesit*',
  'solicit*',
  'requier*',
  'requerim*',
  'quisiera',
  'pedir',
  'pido',
  'me pueden dar',
  'me podrian dar',
  'habilitar*',
  'crear',
  'instalar',
  'asignar',
  'agregar',
);

/** When two groups score the same, the more specific one wins. */
const GROUP_PRIORITY: FaultGroupId[] = [
  'access',
  'daybook_apps',
  'microsoft_apps',
  'other_apps',
  'connectivity',
  'equipment',
  'other',
];

type Scored = { score: number; matched: string[] };
function score(rules: Term[], subject: string, body: string): Scored {
  let total = 0;
  const matched: string[] = [];
  for (const term of rules) {
    // A word in the subject counts double: the subject is where people name the problem.
    const weight = term.pattern.test(subject) ? term.weight * 2 : term.pattern.test(body) ? term.weight : 0;
    if (weight) {
      total += weight;
      matched.push(term.label);
    }
  }
  return { score: total, matched };
}
const mentions = (rules: Term[], text: string) => rules.some(term => term.pattern.test(text));

export const classifyTicketText: TicketClassifier = input => {
  const subject = normalizeForMatching(input.subject ?? '');
  const body = normalizeForMatching(input.body ?? '');
  const all = `${subject} ${body}`.trim();
  const failure = mentions(FAILURE, all);
  const request = mentions(REQUEST, all);

  // What failed: every element adds to its group; the best group wins, then its best element.
  type GroupScore = { score: number; matched: string[]; elements: Map<FaultElementId, number> };
  const groups = new Map<FaultGroupId, GroupScore>();
  for (const [key, rules] of Object.entries(FAULT_RULES) as [FaultKey, Term[]][]) {
    const [group, element] = key.split(':') as [FaultGroupId, FaultElementId | undefined];
    const result = score(rules, subject, body);
    if (!result.score) continue;
    const entry: GroupScore = groups.get(group) ?? { score: 0, matched: [], elements: new Map() };
    entry.score += result.score;
    entry.matched.push(...result.matched);
    if (element) entry.elements.set(element, (entry.elements.get(element) ?? 0) + result.score);
    groups.set(group, entry);
  }
  const ranked = [...groups.entries()].sort(
    ([a, x], [b, y]) => y.score - x.score || GROUP_PRIORITY.indexOf(a) - GROUP_PRIORITY.indexOf(b),
  );

  // What is requested: strong phrases decide on their own; weaker ones need a request.
  let requirement: RequirementId | null = null,
    requirementWords: string[] = [];
  const requirements = (Object.entries(REQUIREMENT_RULES) as [RequirementId, Term[]][])
    .map(([id, rules]) => ({ id, ...score(rules, subject, body) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = requirements[0];
  if (best && (best.score >= 3 || request)) {
    requirement = best.id;
    requirementWords = best.matched;
  } else if (request && !failure && groups.has('equipment')) requirement = 'equipment';
  else if (request && !failure) requirement = 'other';

  // A plain request ("necesito un monitor adicional") names hardware or an app, but nothing failed.
  const top = ranked[0];
  let fault: TicketCategory['fault'] = null,
    faultWords: string[] = [];
  if (!(requirement && !failure)) {
    if (top) {
      const [group, entry] = top;
      const order = (FAULT_GROUPS.find(item => item.id === group)?.elements ?? []).map(item => item.id as string);
      const element =
        [...entry.elements.entries()].sort(([a, x], [b, y]) => y - x || order.indexOf(a) - order.indexOf(b))[0]?.[0] ??
        null;
      fault = { group, element };
      faultWords = entry.matched;
    } else fault = { group: 'other', element: null };
  }

  const second = ranked[1]?.[1].score ?? 0;
  const confident = fault
    ? Boolean(top) && top[1].score >= 3 && top[1].score >= second * 1.5
    : Boolean(best && best.score >= 3);
  return {
    fault,
    requirement,
    confidence: confident ? 'high' : 'low',
    matched: [...new Set([...faultWords, ...requirementWords])],
    source: 'bot',
  };
};
