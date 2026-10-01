import Link from 'next/link';
import type { Metadata } from 'next';
import PageHero from '@/components/PageHero';

export const metadata: Metadata = { title: 'About' };

export default function About() {
  return (
    <>
      <PageHero eyebrow="About" title="The WTSL Forum">A clubhouse for the people behind the World Tennis Simulation League.</PageHero>
      <main className="container narrow">
        <div className="prose">
          <p>The World Tennis Simulation League runs its tour, rankings and results on the official WTSL site. This community site sits alongside it — a place to talk about what happens on the tour, keep the stories and history of the league, and bring players and fans together in one spot.</p>
          <div className="feature-grid">
            <div className="feature"><b>Discuss</b><span>Match talk, tournament threads, TE4 gameplay and league history, sorted into boards.</span></div>
            <div className="feature"><b>Follow</b><span>Tournaments, players, Tour Elo, results and fixtures, read from WTSL data rather than retyped by hand.</span></div>
            <div className="feature"><b>Celebrate</b><span>Long-form articles and community awards that keep the league's best moments on record.</span></div>
          </div>

          <h2>How it works</h2>
          <p>You sign in with Discord — no new password, and only your public Discord name and avatar are used. Tournament and player information comes from WTSL itself, so what you see here matches the tour. Forum accounts, threads, replies and articles are kept separately, in the community's own database.</p>

          <h2>Get started</h2>
          <div className="feature-grid">
            <div className="feature">
              <b>1. Log in with Discord</b>
              <span>No new account or password — <a href="/api/auth/discord">log in with Discord</a> and you're set up on the forum.</span>
            </div>
            <div className="feature">
              <b>2. Verify your player profile</b>
              <span>
                If you compete on WTSL, link your Discord account to your official player profile from your{' '}
                <Link href="/profile">profile page</Link>. Just search for your name, pick yourself from the results,
                and an admin will review it.
              </span>
            </div>
            <div className="feature">
              <b>3. Repeat per tour</b>
              <span>Play more than one tour? Verify ATP, WTA, Doubles, Coop and Created separately — each has its own status and can be reviewed independently.</span>
            </div>
          </div>

          <h2>Official, but independent</h2>
          <p>This is a community-run companion site. The official WTSL site remains the home of the tour, draws and rankings — <a href="https://www.playwtsl.com/TE4" target="_blank" rel="noreferrer">visit it here</a>. WTSL and the WTSL logo belong to the World Tennis Simulation League.</p>

          <h2>Get involved</h2>
          <p>Log in with Discord, introduce yourself in a board, and read the <Link href="/rules">community rules</Link>. Want to write for the Articles section? Ask an admin on Discord.</p>
        </div>
      </main>
    </>
  );
}
