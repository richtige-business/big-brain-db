import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Big Brain DB',
  description: 'Agent-first Markdown brain database with graph view, collaboration, and MCP access',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
