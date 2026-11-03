import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Daybook Ticket',
    short_name: 'Daybook Ticket',
    description: 'Tickets y conversaciones de soporte de Servicios Daybook.',
    lang: 'es',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#050609',
    theme_color: '#050609',
    icons: [
      { src: '/icons/daybook-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/daybook-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
