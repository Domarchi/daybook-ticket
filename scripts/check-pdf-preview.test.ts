import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PdfAttachmentPreview } from '../app/attachments';

const attachment = { id: '00000000-0000-4000-8000-000000000123', name: 'Documento privado.pdf', size: 120, contentType: 'application/pdf' };
test('PDF preview without native support shows an explanation and protected download instead of an empty iframe', () => {
  const html = renderToStaticMarkup(createElement(PdfAttachmentPreview, { attachment, fileUrl: 'blob:https://portal.example.test/private', nativePdfViewer: false }));
  assert.ok(!html.includes('<iframe'));
  assert.ok(html.includes('Este navegador no permite mostrar el documento aquí'));
  assert.ok(html.includes(`/api/attachments/${attachment.id}/download`));
  assert.ok(html.includes('Descargar PDF'));
  assert.ok(!html.includes('blob:'));
});
test('native PDF preview uses the browser viewer with no referrer, an accessible title and protected fallback', () => {
  const html = renderToStaticMarkup(createElement(PdfAttachmentPreview, { attachment, fileUrl: 'blob:https://portal.example.test/private', nativePdfViewer: true }));
  assert.ok(html.includes('<iframe'));
  assert.ok(!html.includes('sandbox='), 'A sandbox blocks the browser PDF plugin.');
  assert.ok(html.includes('referrerPolicy="no-referrer"'));
  assert.ok(html.includes("camera &#x27;none&#x27;"));
  assert.ok(html.includes('title="Vista previa de Documento privado.pdf"'));
  assert.ok(html.includes('Si el documento no se muestra'));
  assert.ok(html.includes(`/api/attachments/${attachment.id}/download`));
  assert.ok(!html.includes('allow-scripts'));
});
