import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import '@daybook/design/tokens.css';
import '@daybook/design/estados.css';
import './globals.css';
import './service-plus.css';
import './ticket-chat.css';
import './collaboration.css';
import './evolution-theme.css';
import './tokens.css';
import './accessibility.css';
import './mobile-inbox.css';
import './optimistic.css';
import './combobox.css';
import './settings-nav.css';
import { ThemeBootstrap } from './evolution-controls';

// Geist, the Daybook family typeface (see @daybook/design). The variables go on
// <html>: the package builds --db-font-sans on :root, which only sees <html>.
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Daybook Ticket — Servicios Daybook',
  description:
    'Daybook Ticket, el centro de atención al cliente de Servicios Daybook. Cada conversación, una solución.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Daybook Ticket', statusBarStyle: 'default' },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/icons/daybook-192.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        <ThemeBootstrap />
        {children}
      </body>
    </html>
  );
}
