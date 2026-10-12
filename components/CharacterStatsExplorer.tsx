'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Tour = 'all' | 'atp' | 'wta';
type Stat = {
  attribute: string;
  value: number | string | null;
  rank: number | null;
  count: number;
  percentile: number | null;
  components?: Record<string, number | string | null>;
  max_serve_speed_kmh?: number | null;
};
type CharacterPayload = {
  tour: Tour;
  names: string[];
  attributes: string[];
  profile?: Record<string, any> | null;
  official?: { profile_url?: string | null; avatar_url?: string | null; source?: string | null } | null;
  comparison?: Record<string, any> | null;
  ranking?: Record<string, any> | null;
  picks_available?: boolean | null;
};

const tourOptions: { value: Tour; label: string }[] = [
  { value: 'atp', label: 'ATP' },
  { value: 'wta', label: 'WTA' },
  { value: 'all', label: 'ATP + WTA' },
];
const groupNames = ['Groundstrokes', 'Serve', 'Net & Feel', 'Movement & Variety'];

function statGroup(attribute: string) {
  const name = attribute.toLowerCase();
  if (name.includes('serve') || name.includes('service')) return 'Serve';
  if (['volley', 'smash', 'net presence', 'ball feeling'].some((part) => name.includes(part))) {
    return 'Net & Feel';
  }
  if (['forehand', 'backhand', 'slice mastery', 'early ball'].some((part) => name.includes(part))) {
    return 'Groundstrokes';
  }
  return 'Movement & Variety';
}

function formatValue(value: unknown, suffix = '') {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (Number.isFinite(number)) {
    const text = Number.isInteger(number) ? String(number) : number.toFixed(1);
    return `${text}${suffix}`;
  }
  return `${String(value)}${suffix}`;
}

function StatBar({ stat }: { stat: Stat }) {
  const value = Math.max(0, Math.min(100, Number(stat.percentile || 0) * 100));
  return (
    <div className="character-stat-meter">
      <span
        className="character-stat-meter-fill"
        style={{ width: `${value}%` }}
        aria-hidden="true"
      />
      <span className="character-stat-meter-label">
        {stat.rank == null ? '—' : `#${stat.rank}`}
        {stat.count ? ` / ${stat.count}` : ''}
      </span>
    </div>
  );
}

function StatTable({ stats }: { stats: Stat[] }) {
  const grouped = useMemo(() => {
    const result: Record<string, Stat[]> = Object.fromEntries(groupNames.map((group) => [group, []]));
    for (const stat of stats) (result[statGroup(stat.attribute)] ||= []).push(stat);
    return result;
  }, [stats]);

  return (
    <div className="character-stat-groups">
      {groupNames.map((group) => grouped[group]?.length > 0 && (
        <section className="character-stat-group" key={group}>
          <h3>{group}</h3>
          <div className="character-table-scroll">
            <table className="character-stat-table character-attribute-table">
              <thead>
                <tr><th>Attribute</th><th>Value</th><th>Percentile</th></tr>
              </thead>
              <tbody>
                {grouped[group].map((stat) => (
                  <tr key={stat.attribute}>
                    <th scope="row">{stat.attribute}</th>
                    <td>{formatValue(stat.value, stat.attribute === 'Topspin' ? '%' : '')}</td>
                    <td><StatBar stat={stat} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function StatHighlights({ title, stats, tone }: { title: string; stats: Stat[]; tone: 'positive' | 'caution' }) {
  return (
    <section className={`character-highlight-card character-highlight-${tone}`}>
      <h3>{title}</h3>
      {stats.length ? (
        <ul className="character-highlight-list">
          {stats.slice(0, 5).map((stat) => (
            <li key={stat.attribute}>
              <span>{stat.attribute}</span>
              <b>{formatValue(stat.value)} <small>#{stat.rank}</small></b>
              <StatBar stat={stat} />
            </li>
          ))}
        </ul>
      ) : <p className="character-muted">No data.</p>}
    </section>
  );
}

function CombinedSkills({ stats }: { stats: Stat[] }) {
  return (
    <div className="character-combined-grid">
      {stats.map((stat) => (
        <article className="character-combined-card" key={stat.attribute}>
          <div className="character-combined-heading">
            <h3>{stat.attribute}</h3>
            <strong>{formatValue(stat.value)}</strong>
          </div>
          <StatBar stat={stat} />
          <div className="character-component-row">
            {['Power', 'Consistency', 'Precision'].map((component) => (
              <span key={component}>
                <small>{component}</small>
                <b>{formatValue(stat.components?.[component])}</b>
              </span>
            ))}
          </div>
          {stat.max_serve_speed_kmh != null && (
            <p className="character-max-serve">Max serve {formatValue(stat.max_serve_speed_kmh, ' km/h')}</p>
          )}
        </article>
      ))}
    </div>
  );
}

function RankedAttribute({ ranking, character }: { ranking: Record<string, any>; character: string }) {
  const rows = Array.isArray(ranking.ranked) ? ranking.ranked as Record<string, any>[] : [];
  const top = rows.slice(0, 3);
  const bottom = rows.slice(-3).reverse();

  return (
    <section className="panel character-ranking-panel">
      <div className="character-section-heading">
        <div><span className="panel-label">ATTRIBUTE RANKING</span><h2>{ranking.attribute}</h2></div>
      </div>
      <div className="character-top-bottom">
        <div>
          <h3>Top characters</h3>
          {top.map((row) => <p key={row.character}><b>#{row.rank}</b> {row.character}<span>{formatValue(row.value)}</span></p>)}
        </div>
        <div>
          <h3>Bottom characters</h3>
          {bottom.map((row) => <p key={row.character}><b>#{row.rank}</b> {row.character}<span>{formatValue(row.value)}</span></p>)}
        </div>
      </div>
      <details className="character-full-ranking">
        <summary>Show full ranking ({rows.length})</summary>
        <div className="character-table-scroll">
          <table className="character-stat-table character-full-ranking-table">
            <thead><tr><th>Rank</th><th>Character</th><th>Value</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.character} className={row.character === character ? 'character-current-row' : ''}>
                  <td>#{row.rank}</td><th scope="row">{row.character}</th><td>{formatValue(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Comparison({ comparison, selected }: { comparison: Record<string, any>; selected: string }) {
  const selectedIsFirst = comparison.first === selected;
  const selectedEdges = selectedIsFirst ? comparison.first_edges : comparison.second_edges;
  const otherEdges = selectedIsFirst ? comparison.second_edges : comparison.first_edges;
  const other = selectedIsFirst ? comparison.second : comparison.first;
  const edgeList = (items: any[]) => (Array.isArray(items) ? items : []).map((item) => {
    const value = selectedIsFirst ? item.first_value : item.second_value;
    const otherValue = selectedIsFirst ? item.second_value : item.first_value;
    return (
      <li key={`${item.group}-${item.attribute}`}>
        <b>{item.attribute}</b>
        <span>
          {formatValue(value)} vs {formatValue(otherValue)} ·{' '}
          {Math.round(Math.abs(Number(item.delta || 0)) * 100)} percentile points
        </span>
      </li>
    );
  });

  return (
    <section className="panel character-comparison-panel">
      <div className="character-section-heading">
        <div><span className="panel-label">HEAD-TO-HEAD</span><h2>{selected} vs {other}</h2></div>
      </div>
      <div className="character-comparison-grid">
        <div className="character-edge character-edge-selected">
          <h3>{selected}</h3>
          {selectedEdges?.length ? <ul>{edgeList(selectedEdges)}</ul> : <p>No higher attributes.</p>}
        </div>
        <div className="character-edge">
          <h3>{other}</h3>
          {otherEdges?.length ? <ul>{edgeList(otherEdges)}</ul> : <p>No higher attributes.</p>}
        </div>
      </div>
    </section>
  );
}

function PickHistory({ profile, available }: { profile: Record<string, any>; available: boolean | null | undefined }) {
  return (
    <section className="panel character-picks-panel">
      <div className="character-section-heading">
        <div><span className="panel-label">OFFICIAL WTSL RESULTS</span><h2>Character pick history</h2></div>
        <strong className="character-pick-total">{available ? profile.pick_count ?? 0 : '—'}<small>known picks</small></strong>
      </div>
      {!available ? (
        <p className="character-muted">Pick history unavailable.</p>
      ) : profile.top_pickers?.length ? (
        <ol className="character-pickers">
          {profile.top_pickers.map(([name, count]: [string, number]) => (
            <li key={name}><span>{name}</span><b>{count} {count === 1 ? 'pick' : 'picks'}</b></li>
          ))}
        </ol>
      ) : <p className="character-muted">No picks recorded.</p>}
    </section>
  );
}

function Profile({
  data,
  compare,
  attribute,
}: {
  data: CharacterPayload;
  compare: string;
  attribute: string;
}) {
  const profile = data.profile!;
  const attributes = Array.isArray(profile.stats) ? profile.stats as Stat[] : [];
  const combined = Array.isArray(profile.combined_ratings) ? profile.combined_ratings as Stat[] : [];
  const official = data.official || {};
  const profileImage = official.avatar_url;
  const [imageFailed, setImageFailed] = useState(false);
  const comparison = data.comparison;
  const comparisonMatches = Boolean(
    compare &&
      comparison &&
      ((comparison.first === profile.character && comparison.second === compare) ||
        (comparison.second === profile.character && comparison.first === compare)),
  );
  const rankingMatches = Boolean(
    attribute && data.ranking && data.ranking.attribute === attribute,
  );

  return (
    <div className="character-profile-stack">
      <section className="panel character-profile-hero">
        <div className="character-portrait">
          {profileImage && !imageFailed
            ? <img
                src={profileImage}
                alt={`${profile.character} profile`}
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
              />
            : <span aria-hidden="true">{profile.country_flag || '🎾'}</span>}
        </div>
        <div className="character-profile-identity">
          <span className="panel-label">{profile.sex} CHARACTER PROFILE</span>
          <h2>{profile.character}</h2>
          <p className="character-profile-meta">
            {profile.country_flag} {profile.country || 'Country unavailable'}
            {' · '}{formatValue(profile.height, ' cm')}
            {' · '}{formatValue(profile.weight, ' kg')}
          </p>
          <div className="character-badges">
            <span>{profile.style}</span><span>Acceleration: {profile.acceleration}</span>
          </div>
          {official.profile_url && (
            <a href={official.profile_url} target="_blank" rel="noreferrer">
              {official.source === profile.sex ? `Official ${profile.sex} profile` : 'Player profile'} ↗
            </a>
          )}
        </div>
      </section>

      {comparisonMatches && comparison && (
        <Comparison comparison={comparison} selected={profile.character} />
      )}
      {rankingMatches && <RankedAttribute ranking={data.ranking!} character={profile.character} />}

      <div className="character-highlight-grid">
        <StatHighlights title="Relative strengths" stats={profile.strengths || []} tone="positive" />
        <StatHighlights title="Relative weaknesses" stats={profile.weaknesses || []} tone="caution" />
      </div>

      <section className="panel character-detail-panel">
        <div className="character-section-heading">
          <div><span className="panel-label">ATTRIBUTES</span><h2>Attribute rankings</h2></div>
        </div>
        <StatTable stats={attributes} />
      </section>

      <section className="panel character-detail-panel">
        <div className="character-section-heading">
          <div><span className="panel-label">COMBINED SKILLS</span><h2>Ratings</h2></div>
        </div>
        <CombinedSkills stats={combined} />
      </section>

      <PickHistory profile={profile} available={data.picks_available} />
    </div>
  );
}

export default function CharacterStatsExplorer({
  initialTour,
  initialRoster,
  initialCharacter,
}: {
  initialTour: Tour;
  initialRoster: Record<string, unknown>;
  initialCharacter: string;
}) {
  const [tour, setTour] = useState<Tour>(initialTour);
  const [roster, setRoster] = useState<CharacterPayload>(initialRoster as CharacterPayload);
  const [readyTour, setReadyTour] = useState<Tour>(initialTour);
  const initialNames = Array.isArray(initialRoster.names) ? initialRoster.names as string[] : [];
  const [character, setCharacter] = useState(
    initialNames.includes(initialCharacter) ? initialCharacter : initialNames[0] || '',
  );
  const [compare, setCompare] = useState('');
  const [attribute, setAttribute] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<CharacterPayload | null>(null);
  const [loading, setLoading] = useState(initialNames.length > 0);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const requestNumber = useRef(0);
  const dataRef = useRef(data);
  const currentRoster = roster.tour === tour ? roster : null;
  const names = currentRoster?.names || [];
  const attributes = currentRoster?.attributes || [];
  const currentProfile =
    data?.tour === tour && data.profile?.character === character ? data : null;
  const filteredNames = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? names.filter((name) => name.toLowerCase().includes(query)) : names;
  }, [names, search]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (tour === roster.tour) return;
    const controller = new AbortController();
    setRosterLoading(true);
    setError('');
    fetch(`/api/character-stats?tour=${encodeURIComponent(tour)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'roster_unavailable');
        return result as CharacterPayload;
      })
      .then((result) => {
        setRoster(result);
        setReadyTour(tour);
        setCharacter((current) => result.names.includes(current) ? current : result.names[0] || '');
        setCompare('');
        setAttribute('');
        setSearch('');
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setError('Could not load this roster.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setRosterLoading(false);
      });
    return () => controller.abort();
  }, [tour, roster.tour, retryToken]);

  useEffect(() => {
    if (!character || !currentRoster || readyTour !== tour) {
      setData(null);
      setLoading(false);
      return;
    }
    const existing = dataRef.current;
    const hasMatchingProfile =
      existing?.tour === tour && existing.profile?.character === character;
    if (hasMatchingProfile && !compare && !attribute) {
      setData((previous) => previous
        ? { ...previous, comparison: null, ranking: null }
        : previous);
      setLoading(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    const requestId = ++requestNumber.current;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ tour, character });
    if (compare && compare !== character) params.set('compare', compare);
    if (attribute) params.set('attribute', attribute);
    params.set('include_official', 'false');
    if (hasMatchingProfile) params.set('include_profile', 'false');
    fetch(`/api/character-stats?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'profile_unavailable');
        return result as CharacterPayload;
      })
      .then((result) => {
        if (requestId !== requestNumber.current) return;
        if (!hasMatchingProfile) {
          setData(result);
          return;
        }
        setData((previous) => previous?.profile
          ? {
              ...previous,
              ...result,
              profile: previous.profile,
              official: previous.official,
              picks_available: previous.picks_available,
            }
          : result);
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        if (requestId === requestNumber.current) {
          setError(hasMatchingProfile ? 'Could not update results.' : 'Could not load this character.');
        }
      })
      .finally(() => {
        if (requestId === requestNumber.current) setLoading(false);
      });
    return () => controller.abort();
  }, [tour, character, compare, attribute, currentRoster, readyTour, retryToken]);

  const profileCharacter = currentProfile?.profile?.character;
  const profileOfficial = currentProfile?.official;
  useEffect(() => {
    if (!profileCharacter || profileOfficial != null) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      tour,
      character: profileCharacter,
      include_profile: 'false',
      include_official: 'true',
    });
    fetch(`/api/character-stats?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'photo_unavailable');
        return result as CharacterPayload;
      })
      .then((result) => {
        setData((previous) => previous?.tour === tour &&
          previous.profile?.character === profileCharacter
          ? { ...previous, official: result.official || {} }
          : previous);
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setData((previous) => previous?.tour === tour &&
          previous.profile?.character === profileCharacter
          ? { ...previous, official: {} }
          : previous);
      });
    return () => controller.abort();
  }, [tour, profileCharacter, profileOfficial]);

  return (
    <div className="character-explorer">
      <section className="panel character-controls">
        <div className="character-tour-switch" role="group" aria-label="Character roster">
          {tourOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={tour === option.value ? 'active' : ''}
              aria-pressed={tour === option.value}
              onClick={() => setTour(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="character-control-grid">
          <label>
            <span>Search roster</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search names"
              disabled={!currentRoster}
            />
          </label>
          <label>
            <span>Compare with</span>
            <select value={compare} onChange={(event) => setCompare(event.target.value)} disabled={!currentRoster || !character}>
              <option value="">No comparison</option>
              {names.filter((name) => name !== character).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label>
            <span>Rank an attribute</span>
            <select value={attribute} onChange={(event) => setAttribute(event.target.value)} disabled={!currentRoster}>
              <option value="">No attribute ranking</option>
              {attributes.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>

        {rosterLoading && <p className="character-loading-note" role="status">Loading roster…</p>}
        <div className="character-roster-heading">
          <h2>Character roster</h2>
          <span>
            {filteredNames.length !== names.length
              ? `${filteredNames.length} ${filteredNames.length === 1 ? 'result' : 'results'}`
              : character
                ? `Viewing ${character}`
                : 'Select a character'}
          </span>
        </div>
        {currentRoster ? (
          <div className="character-roster-list" aria-label="Choose a character">
            {filteredNames.length ? filteredNames.map((name) => (
              <button
                type="button"
                key={name}
                className={character === name ? 'selected' : ''}
                aria-pressed={character === name}
                onClick={() => setCharacter(name)}
              >
                {name}
              </button>
            )) : <p className="character-muted">No characters match this search.</p>}
          </div>
        ) : (
          <p className="character-muted">The selected roster is not available right now.</p>
        )}
      </section>

      {error && (
        <div className="notice warn character-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setRetryToken((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}
      {loading && !currentProfile && (
        <div className="notice character-loading" role="status">
          Loading {character}…
        </div>
      )}
      {loading && currentProfile && (
        <p className="character-loading-note" role="status">Updating results…</p>
      )}
      {currentProfile && (
        <Profile
          key={`${tour}:${character}`}
          data={currentProfile}
          compare={compare}
          attribute={attribute}
        />
      )}
    </div>
  );
}
