import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Daybook Ticket — Servicios Daybook",
  description: "Daybook Ticket, el centro de atención al cliente de Servicios Daybook. Cada conversación, una solución.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
