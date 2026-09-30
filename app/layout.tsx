import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed, Inter } from 'next/font/google';
import { ForumHeader } from '@/components/ForumHeader';
import { ForumFooter } from '@/components/ForumFooter';

const display = Barlow_Condensed({ subsets: ['latin'], weight: ['700', '800'], style: ['normal', 'italic'], variable: '--font-display-loaded', display: 'swap' });
const body = Inter({ subsets: ['latin'], variable: '--font-body-loaded', display: 'swap' });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://wtslforum.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'WTSL Community — World Tennis Simulation League', template: '%s · WTSL Community' },
  description: 'The community home of the World Tennis Simulation League: discussions, match talk, tournaments, players, articles and awards.',
  openGraph: { siteName: 'WTSL Community', type: 'website' },
};

export const viewport: Viewport = { themeColor: '#030a18' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <ForumHeader />
        {children}
        <ForumFooter />
      </body>
    </html>
  );
}
