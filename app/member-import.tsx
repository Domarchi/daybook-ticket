'use client';
import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, KeyRound } from 'lucide-react';
import { daybookFetch } from '@/lib/browser-request';
import {
  IMPORT_MAX_CHARS,
  IMPORT_MAX_ROWS,
  importLinksCsv,
  importProblemsCsv,
  importReady,
  importTemplateCsv,
  type ImportedInvitation,
  type ImportPreview,
} from '@/lib/member-import-model';
import { EQUIPMENT_KINDS, equipmentKindLabel } from '@/lib/client-equipment-model';
import './member-import.css';

type Run = (action: () => Promise<unknown>, message: string) => Promise<boolean>;
type Created = { invitations: ImportedInvitation[]; expiresAt: string; companiesCreated: string[] };
class ImportRequestError extends Error {
  constructor(
    message: string,
    public redirectTo?: string,
    public preview?: ImportPreview,
  ) {
    super(message);
  }
}

async function send<T>(body: { mode: 'preview' | 'apply'; csv: string; createMissingCompanies: boolean }): Promise<T> {
  const response = await daybookFetch('/api/members/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result: Record<string, unknown> = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ImportRequestError(
      typeof result.error === 'string' ? result.error : 'No se pudo revisar el archivo.',
      typeof result.redirectTo === 'string' ? result.redirectTo : undefined,
      result.preview as ImportPreview | undefined,
    );
  return result as T;
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * «Importar clientes» (Fase 7): a CSV with one employee and their equipment per row. The file is checked first and
 * nothing is created until the admin confirms; then every invitation is created at once and the links are offered as a
 * CSV to hand out. No mail is sent.
 */
export function MemberImportPanel({ busy, run, onClose }: { busy: boolean; run: Run; onClose: () => void }) {
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null),
    [createMissingCompanies, setCreateMissing] = useState(false),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [created, setCreated] = useState<Created | null>(null),
    [error, setError] = useState<{ message: string; redirectTo?: string } | null>(null),
    [working, setWorking] = useState(false),
    fileInput = useRef<HTMLInputElement>(null),
    disabled = busy || working;

  const fail = (reason: unknown) => {
    if (reason instanceof ImportRequestError) {
      setError({ message: reason.message, redirectTo: reason.redirectTo });
      if (reason.preview) setPreview(reason.preview);
    } else setError({ message: reason instanceof Error ? reason.message : 'No se pudo revisar el archivo.' });
  };
  const review = async () => {
    if (!csv) return;
    setWorking(true);
    setError(null);
    try {
      setPreview(await send<ImportPreview>({ mode: 'preview', csv: csv.text, createMissingCompanies }));
    } catch (reason) {
      fail(reason);
    } finally {
      setWorking(false);
    }
  };
  const apply = async () => {
    if (!csv || !preview) return;
    setWorking(true);
    setError(null);
    try {
      const result = await send<Created>({ mode: 'apply', csv: csv.text, createMissingCompanies });
      setCreated(result);
      // Refreshes the access list and confirms; the invitations already exist.
      await run(async () => undefined, `${result.invitations.length} invitaciones creadas`);
    } catch (reason) {
      fail(reason);
    } finally {
      setWorking(false);
    }
  };
  const reset = () => {
    setCsv(null);
    setPreview(null);
    setCreated(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <section className="panel member-import" aria-labelledby="member-import-title">
      <div className="section-head">
        <h2 id="member-import-title">Importar clientes desde una planilla</h2>
        <FileSpreadsheet size={18} aria-hidden="true" />
      </div>
      {created ? (
        <div className="member-import-result" role="status">
          <p className="member-import-done">
            <CheckCircle2 size={18} aria-hidden="true" />
            Se crearon {created.invitations.length} invitaciones
            {created.companiesCreated.length ? ` y ${created.companiesCreated.length} empresas` : ''}. Los enlaces
            vencen el {new Date(created.expiresAt).toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' })}.
          </p>
          <p className="member-import-warning">
            <KeyRound size={16} aria-hidden="true" />
            Cada enlace permite crear la cuenta de esa persona. Entrégalo solo a ella, por un canal interno, y no
            publiques ni reenvíes el archivo completo. Si un enlace vence, renuévalo desde la lista.
          </p>
          <div className="member-import-actions">
            <button
              type="button"
              className="primary"
              onClick={() =>
                download('daybook-enlaces-de-invitacion.csv', importLinksCsv(created.invitations, created.expiresAt))
              }
            >
              <Download size={15} aria-hidden="true" />
              Descargar enlaces (CSV)
            </button>
            <button type="button" className="secondary" onClick={reset}>
              Importar otro archivo
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="member-import-intro">
            Una fila por persona con nombre, correo, empresa, ID del equipo, tipo, N° de serie y, si la sabes, marca y
            modelo. Primero se revisa el archivo y no se crea nada hasta que confirmes. No se envían correos: al final
            descargas los enlaces de invitación para repartirlos. Hasta {IMPORT_MAX_ROWS} personas por archivo.
          </p>
          <p className="member-import-kinds">Tipos de equipo: {EQUIPMENT_KINDS.map(kind => kind.label).join(', ')}.</p>
          <div className="member-import-controls">
            <button
              type="button"
              className="secondary"
              onClick={() => download('daybook-plantilla-clientes.csv', importTemplateCsv())}
            >
              <Download size={15} aria-hidden="true" />
              Descargar plantilla
            </button>
            <label className="member-import-file">
              Archivo CSV
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                disabled={disabled}
                onChange={async event => {
                  const file = event.target.files?.[0];
                  setPreview(null);
                  setError(null);
                  if (!file) return setCsv(null);
                  if (file.size > IMPORT_MAX_CHARS * 2) {
                    setCsv(null);
                    return setError({
                      message: 'El archivo es demasiado grande. Divídelo en partes de hasta 500 personas.',
                    });
                  }
                  setCsv({ name: file.name, text: await file.text() });
                }}
              />
            </label>
            <label className="member-import-check">
              <input
                type="checkbox"
                checked={createMissingCompanies}
                disabled={disabled}
                onChange={event => {
                  setCreateMissing(event.target.checked);
                  setPreview(null);
                }}
              />
              Crear las empresas que falten
            </label>
            <button type="button" className="primary" disabled={disabled || !csv} onClick={() => void review()}>
              <FileUp size={15} aria-hidden="true" />
              {working ? 'Revisando…' : 'Revisar archivo'}
            </button>
          </div>
          {error && (
            <p role="alert" className="member-import-error">
              {error.message}
              {error.redirectTo && (
                <>
                  {' '}
                  <a href={error.redirectTo}>Verificar mi identidad</a>
                </>
              )}
            </p>
          )}
          {preview && <ImportPreviewView preview={preview} disabled={disabled} onApply={() => void apply()} />}
        </>
      )}
    </section>
  );
}

function ImportPreviewView({
  preview,
  disabled,
  onApply,
}: {
  preview: ImportPreview;
  disabled: boolean;
  onApply: () => void;
}) {
  const { summary } = preview,
    ready = importReady(preview);
  if (preview.fileProblems.length)
    return (
      <div className="member-import-problems" role="alert">
        <p>
          <AlertTriangle size={16} aria-hidden="true" />
          No se pudo leer el archivo:
        </p>
        <ul>
          {preview.fileProblems.map(problem => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="member-import-preview">
      <p className="member-import-summary" role="status">
        {summary.valid} de {summary.total} filas listas · {summary.newEquipment} equipos nuevos ·{' '}
        {summary.existingEquipment} ya en el inventario
        {summary.newCompanies.length ? ` · empresas nuevas: ${summary.newCompanies.join(', ')}` : ''}
      </p>
      {preview.ignoredColumns.length > 0 && (
        <p className="member-import-note">Columnas que no se usan: {preview.ignoredColumns.join(', ')}.</p>
      )}
      <div className="member-import-table-wrap">
        <table className="member-import-table">
          <caption className="sr-only">Revisión del archivo, fila por fila</caption>
          <thead>
            <tr>
              <th scope="col">Línea</th>
              <th scope="col">Persona</th>
              <th scope="col">Empresa</th>
              <th scope="col">Equipo</th>
              <th scope="col">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map(row => (
              <tr key={row.line} className={row.problems.length ? 'has-problems' : undefined}>
                <td>{row.line}</td>
                <td>
                  <strong>{row.name || '—'}</strong>
                  <small>{row.email || '—'}</small>
                </td>
                <td>{row.company || '—'}</td>
                <td>
                  <strong>{row.assetTag || '—'}</strong>
                  <small>
                    {[
                      row.kind ? equipmentKindLabel(row.kind) : null,
                      row.model || null,
                      row.serial ? `Serie ${row.serial}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </td>
                <td>
                  {row.problems.length ? (
                    <ul className="member-import-row-problems">
                      {row.problems.map(problem => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="member-import-ok">Lista{row.notes.length ? `. ${row.notes.join(' ')}` : ''}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ready ? (
        <div className="member-import-actions">
          <button type="button" className="primary" disabled={disabled} onClick={onApply}>
            Crear {summary.total} invitaciones
          </button>
          <p className="member-import-note">Se crean todas juntas o ninguna. No se envía ningún correo.</p>
        </div>
      ) : (
        <div className="member-import-actions">
          <p className="member-import-note">
            {summary.withProblems === 1 ? 'Hay 1 fila' : `Hay ${summary.withProblems} filas`} con problemas. Corrígelas
            en la planilla y vuelve a cargar el archivo: no se crea ninguna invitación mientras haya problemas.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => download('daybook-problemas-importacion.csv', importProblemsCsv(preview))}
          >
            <Download size={15} aria-hidden="true" />
            Descargar problemas (CSV)
          </button>
        </div>
      )}
    </div>
  );
}
