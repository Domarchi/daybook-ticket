'use client';
/**
 * The download under Bita's answer about a company (feature 5). It is the official monthly report of the Reports
 * screen: one click creates it (`POST /api/reports/monthly`, the same call and rules as that screen, kept there as a
 * private snapshot) and downloads its PDF. Bita only offers the button; the person's click is what creates the report.
 * A second click downloads the same report again instead of creating another one.
 */
import { readDaybookJson } from '@/lib/browser-json';
import { daybookFetch } from '@/lib/browser-request';
import { monthLabel, type ReportOffer } from '@/lib/assistant-ui';
import { Download, LoaderCircle } from 'lucide-react';
import { useRef, useState } from 'react';

const isCreated = (value: unknown): value is { id: string } =>
  !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';

export function BitaReportDownload({ offer }: { offer: ReportOffer }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [note, setNote] = useState('');
  const reportId = useRef<string | null>(null);
  const label = `${offer.companyName} · ${monthLabel(offer.month)}`;

  const download = async () => {
    if (state === 'busy') return;
    setState('busy');
    setNote('');
    try {
      if (!reportId.current) {
        const created = await readDaybookJson(
          await daybookFetch('/api/reports/monthly', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operationId: crypto.randomUUID(),
              companyId: offer.companyId,
              month: offer.month,
              includeTests: false,
            }),
          }),
          { validate: isCreated },
        );
        reportId.current = created.id;
      }
      const response = await daybookFetch(`/api/reports/monthly/${reportId.current}/download?format=pdf`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : 'No se pudo descargar el informe.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `daybook-informe-${offer.month}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNote('Informe descargado. También queda guardado en Informes, en la ficha de la empresa.');
      setState('done');
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : 'No se pudo descargar el informe.');
      setState('failed');
    }
  };

  return (
    <div className="bita-report">
      <button type="button" className="secondary" onClick={() => void download()} disabled={state === 'busy'}>
        {state === 'busy' ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
        {state === 'busy' ? 'Preparando el PDF…' : `Descargar el informe PDF de ${label}`}
      </button>
      {note && (
        <p
          className={state === 'failed' ? 'bita-report-note failed' : 'bita-report-note'}
          role={state === 'failed' ? 'alert' : 'status'}
        >
          {note}
        </p>
      )}
    </div>
  );
}
