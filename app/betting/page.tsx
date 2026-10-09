import type { Metadata } from 'next';
import PageHero from '@/components/PageHero';
import WtslDataAutoRefresh from '@/components/WtslDataAutoRefresh';
import { PublicFixturesProvider } from '@/components/PublicLiveData';
import { BettingBoardPanels, MyBettingPanel } from '@/components/BettingPanels';
import { wtslCore } from '@/lib/wtsl-core';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Virtual Betting fixtures' };

export default function Betting() {
  return (
    <PublicFixturesProvider>
      <>
        <WtslDataAutoRefresh />
        <PageHero eyebrow="WTSL Forum" title="Virtual Betting">Follow live odds across the tour. Virtual bets are placed in Discord — use the button to jump straight there.</PageHero>
        <main className="container">
          {!wtslCore.configured() && <div className="notice warn" style={{ marginBottom: 22 }}>The WTSL Core API is not configured on this deployment, so odds and account data can&apos;t load right now.</div>}
          <MyBettingPanel />
          <BettingBoardPanels />
        </main>
      </>
    </PublicFixturesProvider>
  );
}
