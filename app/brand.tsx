/**
 * El logo de la familia Daybook, con el marcado común de @daybook/design/marca.css:
 * Parte Diario, Travel y Ticket miden lo mismo y se leen como una misma batería
 * de herramientas. El símbolo viene del CSS (cambia solo con el tema) y DAYBOOK /
 * TICKET son texto; el nombre accesible lo da aria-label.
 *
 * - `dark`: sobre fondo oscuro en los dos temas (el riel, la cabecera del portal).
 * - `compact`: solo el símbolo; `large` lo lleva a 56 px (la tarjeta de entrada).
 */
export default function Brand({
  dark = false,
  compact = false,
  large = false,
}: {
  dark?: boolean;
  compact?: boolean;
  large?: boolean;
}) {
  const onDark = dark ? ' db-on-dark' : '';
  if (compact)
    return <span className={`db-mark${large ? ' db-mark--large' : ''}${onDark}`} role="img" aria-label="Daybook" />;
  return (
    <span className={`db-lockup${onDark}`} role="img" aria-label="Daybook Ticket">
      <span className="db-mark" aria-hidden="true" />
      <span className="db-lockup__type" aria-hidden="true">
        <span className="db-lockup__name">Daybook</span>
        <span className="db-lockup__product">Ticket</span>
      </span>
    </span>
  );
}
