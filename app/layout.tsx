import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed, Inter } from 'next/font/google';
import { ForumHeader } from '@/components/ForumHeader';
import { ForumFooter } from '@/components/ForumFooter';
import { ThemeBootstrapScript } from '@/components/ThemeToggle';

const display = Barlow_Condensed({ subsets: ['latin'], weight: ['700', '800'], style: ['normal', 'italic'], variable: '--font-display-loaded', display: 'swap' });
const body = Inter({ subsets: ['latin'], variable: '--font-body-loaded', display: 'swap' });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://wtslforum.vercel.app';
const siteDescription = 'The community home of the World Tennis Simulation League';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'WTSL Forum — World Tennis Simulation League', template: '%s · WTSL Forum' },
  description: siteDescription,
  openGraph: { siteName: 'WTSL Forum', type: 'website', description: siteDescription },
};

export const viewport: Viewport = { themeColor: '#030a18' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <head>
        <ThemeBootstrapScript />
      </head>
      <body>
        <ForumHeader />
        {children}
        <ForumFooter />
      </body>
    </html>
  );
}
