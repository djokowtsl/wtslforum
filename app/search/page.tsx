import Link from 'next/link';
import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { searchSite } from '@/lib/search';
import { tourLabel } from '@/lib/wtsl';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Search' };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const results = await safe(() => searchSite(q), { discussions: [], articles: [], players: [], tournaments: [] });
  const total = results.discussions.length + results.articles.length + results.players.length + results.tournaments.length;

  return (
    <>
      <PageHero eyebrow="Search" title={q ? `Results for "${q}"` : 'Search the forum'}>
        Discussions, articles, players and tournaments.
      </PageHero>
      <main className="page-shell" style={{ paddingTop: 10 }}>
        {!q ? (
          <div className="forum-list"><div className="empty"><strong>Type something to search</strong>Use the search box in the header.</div></div>
        ) : total === 0 ? (
          <div className="forum-list"><div className="empty"><strong>No results for "{q}"</strong>Try a different name or keyword.</div></div>
        ) : (
          <>
            {results.discussions.length > 0 && (
              <section className="section-block">
                <div className="section-heading"><h2>Discussions</h2><span>{results.discussions.length}</span></div>
                <div className="forum-list">
                  {results.discussions.map((d) => (
                    <Link key={d.id} href={`/discussions/${d.slug || d.id}`} className="search-row">
                      <strong>{d.title}</strong>
                      <span>{d.snippet}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            {results.articles.length > 0 && (
              <section className="section-block">
                <div className="section-heading"><h2>Articles</h2><span>{results.articles.length}</span></div>
                <div className="forum-list">
                  {results.articles.map((a) => (
                    <Link key={a.slug} href={`/articles/${a.slug}`} className="search-row">
                      <strong>{a.title}</strong>
                      <span>{a.excerpt}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            {results.players.length > 0 && (
              <section className="section-block">
                <div className="section-heading"><h2>Players</h2><span>{results.players.length}</span></div>
                <div className="forum-list">
                  {results.players.map((p) => (
                    <Link key={`${p.id}-${p.tour}`} href={`/players/${p.id}?tour=${encodeURIComponent(p.tour)}`} className="search-row">
                      <strong>{p.name}</strong>
                      <span>{tourLabel(p.tour)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            {results.tournaments.length > 0 && (
              <section className="section-block">
                <div className="section-heading"><h2>Tournaments</h2><span>{results.tournaments.length}</span></div>
                <div className="forum-list">
                  {results.tournaments.map((t) => (
                    <Link key={t.slug} href={`/tournaments/${t.slug}`} className="search-row">
                      <strong>{t.name}</strong>
                      <span>{tourLabel(t.tour)} · {t.status}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
