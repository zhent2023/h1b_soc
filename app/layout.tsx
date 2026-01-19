import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Sans, Space_Grotesk } from 'next/font/google';

import './globals.css';
import { TranscriptStateProvider } from './transcript-state';

const displayFont = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '600', '700'],
});

const bodyFont = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'H1B SOC',
  description: 'SOC lookup and wage tooling',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>
        <TranscriptStateProvider>{children}</TranscriptStateProvider>
      </body>
    </html>
  );
}
