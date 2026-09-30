import './globals.css';
import type { Metadata } from 'next';
import { ForumHeader } from '@/components/ForumHeader';

export const metadata: Metadata = {
  title: 'WTSL Community Forum',
  description: 'The community discussion hub for the World Tennis Simulation League.',
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body><ForumHeader />{children}<footer className="site-footer"><div><strong>WTSL COMMUNITY</strong><span>A community companion to the World Tennis Simulation League.</span></div><div className="footer-links"><a href="https://www.playwtsl.com/TE4">Official WTSL site</a><a href="/about">About</a><a href="/rules">Community rules</a></div></footer></body></html>;
}
