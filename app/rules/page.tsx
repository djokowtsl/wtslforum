import type { Metadata } from 'next';
import PageHero from '@/components/PageHero';

export const metadata: Metadata = { title: 'Community rules' };

const RULES = [
  ['Keep it about the community', 'Discuss WTSL, matches, tournaments, Tennis Elbow and related tennis topics.'],
  ['Respect other players', 'Competitive banter is welcome. Personal harassment is not.'],
  ['No spam', 'Do not flood discussions, impersonate other players or post malicious links.'],
  ['Moderation', 'Admins may edit, hide or remove posts that break the community rules.'],
];

export default function Rules() {
  return (
    <>
      <PageHero eyebrow="Community guidelines" title="Community rules">Short and simple — so everyone can enjoy the tour.</PageHero>
      <main className="container narrow">
        {RULES.map(([t, d], i) => <div className="rule" key={t}><div className="n">{i + 1}</div><div><b>{t}</b><p>{d}</p></div></div>)}
      </main>
    </>
  );
}
