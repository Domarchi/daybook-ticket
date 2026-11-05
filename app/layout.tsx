import type { Metadata } from "next";
import "./globals.css";
import "./service-plus.css";

export const metadata: Metadata = {
  title: "Daybook Ticket — Servicios Daybook",
  description: "Daybook Ticket, el centro de atención al cliente de Servicios Daybook. Cada conversación, una solución.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Daybook Ticket", statusBarStyle: "default" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icons/daybook-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
