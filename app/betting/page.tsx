import type { Metadata } from 'next';
import PageHero from '@/components/PageHero';
import { PublicFixturesProvider } from '@/components/PublicLiveData';
import { BettingBoardPanels, MyBettingPanel } from '@/components/BettingPanels';
import { wtslCore } from '@/lib/wtsl-core';
import { getSession } from '@/lib/auth';
import { initialPublicFixtures } from '@/lib/publicPageData';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Virtual Betting fixtures' };

export default async function Betting() {
  const [user, initialFixtures] = await Promise.all([
    getSession(),
    initialPublicFixtures(),
  ]);
  const [balanceResult, betsResult] = user && wtslCore.configured()
    ? await Promise.allSettled([
        wtslCore.balance(user.discordId),
        wtslCore.bets(user.discordId),
      ])
    : [null, null];
  const balanceStatus = !user
    ? 'unauthorized'
    : balanceResult?.status === 'fulfilled' && balanceResult.value
      ? 'ready'
      : 'unavailable';
  const ledgerStatus = !user
    ? 'unauthorized'
    : betsResult?.status === 'fulfilled' && Array.isArray(betsResult.value)
      ? 'ready'
      : 'unavailable';
  const account = balanceResult?.status === 'fulfilled' ? balanceResult.value : null;
  const bets = betsResult?.status === 'fulfilled' && Array.isArray(betsResult.value) ? betsResult.value : [];

  return (
    <PublicFixturesProvider initialFeed={initialFixtures}>
      <>
        <PageHero eyebrow="WTSL Forum" title="Virtual Betting">Follow live odds across the tour. Virtual bets are placed in Discord — use the button to jump straight there.</PageHero>
        <main className="container">
          {!wtslCore.configured() && <div className="notice warn" style={{ marginBottom: 22 }}>The WTSL Core API is not configured on this deployment, so odds and account data can&apos;t load right now.</div>}
          <MyBettingPanel
            initialBalanceStatus={balanceStatus}
            initialAccount={account}
            initialLedgerStatus={ledgerStatus}
            initialBets={bets}
            initialCheckedAt={balanceStatus === 'ready' || ledgerStatus === 'ready' ? new Date().toISOString() : undefined}
          />
          <BettingBoardPanels />
        </main>
      </>
    </PublicFixturesProvider>
  );
}
