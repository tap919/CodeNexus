import type { Metadata } from 'next';
import { AuthProvider } from '@/providers/auth-provider';
import { QueryProvider } from '@/providers/query-provider';
import { WebSocketProvider } from '@/providers/ws-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'CodeNexus — Decision Cockpit',
  description: 'AI-native review, escalation, and proof platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="bg-canvas text-fg-primary antialiased font-sans" style={{ background: 'red', minHeight: '100vh' }}>
        <QueryProvider>
          <AuthProvider>
            <WebSocketProvider>
              {children}
            </WebSocketProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
