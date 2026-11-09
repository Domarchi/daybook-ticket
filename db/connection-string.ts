/**
 * pg 8 trata sslmode=prefer|require|verify-ca como alias de verify-full y avisa en cada
 * proceso de que cambiará. Declarar verify-full conserva exactamente la verificación de
 * hoy y silencia el aviso. No se toca nada más de la URL (usuario, clave, host, base,
 * channel_binding) y no se modifica una URL que ya pida la semántica libpq.
 */
export function explicitSslMode(connectionString: string): string {
  if (/[?&]uselibpqcompat=true(?=&|$)/i.test(connectionString)) return connectionString;
  return connectionString.replace(/([?&]sslmode=)(?:prefer|require|verify-ca)(?=&|$)/i, '$1verify-full');
}
