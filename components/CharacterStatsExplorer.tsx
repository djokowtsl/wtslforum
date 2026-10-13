'use client';

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatOrdinalRank,
  type CharacterPickRanking,
} from '@/lib/characterPickPopularity';
import { characterCategoryScores } from '@/lib/characterProfileGroups.mjs';
import { buildCharacterProfileSummary } from '@/lib/characterProfileSummary.mjs';
import {
  buildSizeMechanicsInsight,
  buildStrokeSetupLabels,
  buildStrokeMechanicsInsight,
} from '@/lib/characterProfileMechanics.mjs';
import SearchableDropdown from '@/components/SearchableDropdown';

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
  pick_ranking?: CharacterPickRanking | null;
};

const tourOptions: { value: Tour; label: string }[] = [
  { value: 'atp', label: 'ATP' },
  { value: 'wta', label: 'WTA' },
  { value: 'all', label: 'ATP + WTA' },
];
const groupNames = ['Groundstrokes', 'Serve', 'Net & Feel', 'Movement & Variety'];
const uninformativeRelativeStrengths = new Set(['slice serve', 'topspin serve', 'twist serve']);
const excludedRatingAttributes = new Set(['boomboomserver', 'ontimeserver']);

function isExcludedRatingAttribute(attribute: unknown) {
  const normalized = String(attribute ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return excludedRatingAttributes.has(normalized);
}

function statsWithoutExcludedAttributes(value: unknown): Stat[] {
  return Array.isArray(value)
    ? (value as Stat[]).filter((stat) => !isExcludedRatingAttribute(stat.attribute))
    : [];
}

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

function percentileDescription(stat: Stat) {
  const percentile = normalizedPercentile(stat.percentile);
  return percentile === null ? null : `${formatOrdinalRank(percentile)} percentile`;
}

function splitTraitDescription(value: string) {
  const separator = value.indexOf(':');
  return separator > 0
    ? { name: value.slice(0, separator).trim(), description: value.slice(separator + 1).trim() }
    : { name: 'Documented mechanic', description: value.trim() };
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

function normalizedPercentile(percentile: Stat['percentile']) {
  if (percentile === null || percentile === undefined || !Number.isFinite(Number(percentile))) {
    return null;
  }
  return Math.round(Math.max(0, Math.min(1, Number(percentile))) * 100);
}

function StatBar({ stat }: { stat: Stat }) {
  const score = normalizedPercentile(stat.percentile);
  const rankContext = stat.rank == null
    ? 'Rank unavailable.'
    : `Ranked #${stat.rank}${stat.count ? ` of ${stat.count} characters` : ''}.`;
  const tooltip = `${score === null ? 'Normalized score unavailable.' : `Normalized score ${score} out of 100.`} ${rankContext}`;
  return (
    <div
      className="character-stat-meter"
      role={score === null ? 'img' : 'meter'}
      tabIndex={0}
      aria-label={tooltip}
      aria-valuemin={score === null ? undefined : 0}
      aria-valuemax={score === null ? undefined : 100}
      aria-valuenow={score ?? undefined}
      aria-valuetext={score === null ? undefined : tooltip}
      title={tooltip}
    >
      <span
        className="character-stat-meter-fill"
        style={{ width: `${score ?? 0}%` }}
        aria-hidden="true"
      />
      <span className="character-stat-meter-label">
        <span>{score === null ? '—' : `${score}/100`}</span>
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
          <div className="character-table-scroll character-attribute-table-scroll">
            <table className="character-stat-table character-attribute-table">
              <thead>
                <tr><th>Attribute</th><th>Value</th><th>Normalized score</th></tr>
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
          <ul className="character-attribute-card-list">
            {grouped[group].map((stat) => (
              <li className="character-attribute-card" key={stat.attribute}>
                <div className="character-attribute-card-heading">
                  <h4>{stat.attribute}</h4>
                  <div className="character-attribute-rating">
                    <span>Rating</span>
                    <b>{formatValue(stat.value, stat.attribute === 'Topspin' ? '%' : '')}</b>
                  </div>
                </div>
                <div className="character-attribute-percentile">
                  <div className="character-attribute-percentile-heading">
                    <span>Normalized score</span>
                  </div>
                  <StatBar stat={stat} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StatHighlights({ title, stats, tone }: { title: string; stats: Stat[]; tone: 'positive' | 'caution' }) {
  return (
    <section className={`character-highlight-card character-highlight-${tone}`}>
      <h3>{title}</h3>
      <p className="character-rating-explainer">
        The number beside each stat is its raw value; the bar is its normalized roster score (0–100).
      </p>
      {stats.length ? (
        <ul className="character-highlight-list">
          {stats.slice(0, 5).map((stat) => (
            <li key={stat.attribute}>
              <span>
                {stat.attribute}
                <small>{percentileDescription(stat) || 'Roster percentile unavailable'}</small>
              </span>
              <b>{formatValue(stat.value, stat.attribute.toLowerCase() === 'topspin' ? '%' : '/100')}</b>
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
            <p className="character-max-serve">
              Average maximal serve speed (not absolute peak):{' '}
              {formatValue(stat.max_serve_speed_kmh, ' km/h')}
            </p>
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
  const selectedMechanics = selectedIsFirst ? comparison.first_mechanics : comparison.second_mechanics;
  const otherMechanics = selectedIsFirst ? comparison.second_mechanics : comparison.first_mechanics;
  const selectedGuidance = selectedIsFirst ? comparison.first_guidance : comparison.second_guidance;
  const otherGuidance = selectedIsFirst ? comparison.second_guidance : comparison.first_guidance;
  const other = selectedIsFirst ? comparison.second : comparison.first;
  const selectedChoice = selectedGuidance?.why_select || selectedGuidance?.benefit;
  const otherChoice = otherGuidance?.why_select || otherGuidance?.benefit;
  const edgeList = (items: any[]) => (Array.isArray(items) ? items : [])
    .filter((item) => !isExcludedRatingAttribute(item?.attribute))
    .map((item) => {
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
          {selectedMechanics?.length > 0 && (
            <ul>{selectedMechanics.map((line: string, index: number) => <li key={index}>{line}</li>)}</ul>
          )}
        </div>
        <div className="character-edge">
          <h3>{other}</h3>
          {otherEdges?.length ? <ul>{edgeList(otherEdges)}</ul> : <p>No higher attributes.</p>}
          {otherMechanics?.length > 0 && (
            <ul>{otherMechanics.map((line: string, index: number) => <li key={index}>{line}</li>)}</ul>
          )}
        </div>
      </div>
      {(typeof selectedChoice === 'string' && selectedChoice.trim()) ||
      (typeof otherChoice === 'string' && otherChoice.trim()) ? (
        <div className="character-comparison-choices">
          {typeof selectedChoice === 'string' && selectedChoice.trim() && (
            <p><b>Choose {selected} if:</b> {selectedChoice}</p>
          )}
          {typeof otherChoice === 'string' && otherChoice.trim() && (
            <p><b>Choose {other} instead if:</b> {otherChoice}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function PickHistory({
  profile,
  available,
  ranking,
}: {
  profile: Record<string, any>;
  available: boolean | null | undefined;
  ranking?: CharacterPickRanking | null;
}) {
  const pickCount = Number(profile.pick_count ?? 0);
  const rosterCount = Number(ranking?.character_count ?? profile.roster_count ?? 0);
  const tourLabel = String(profile.sex || profile.tour || '').toLowerCase() === 'wta' ? 'WTA' : 'ATP';
  const hasPublishedPickHistory = tourLabel === 'ATP';
  const rankLabel = ranking
    ? ranking.tied
      ? 'Tied for ' + formatOrdinalRank(ranking.rank) + ' most picked character'
      : ranking.rank === 1
        ? 'Most picked character'
        : formatOrdinalRank(ranking.rank) + ' most picked character'
    : null;

  return (
    <section className="panel character-picks-panel">
      <div className="character-section-heading">
        <div><span className="panel-label">OFFICIAL WTSL RESULTS</span><h2>Pick popularity</h2></div>
        <strong className="character-pick-total">{available && hasPublishedPickHistory ? pickCount : '—'}<small>recorded picks</small></strong>
      </div>
      <div className="character-pick-rank">
        {rankLabel ? (
          <>
            <strong>{rankLabel}</strong>
          </>
        ) : (
          <p>
            {!hasPublishedPickHistory
              ? 'WTSL does not publish WTA character pick totals.'
              : !available
                ? 'Pick history unavailable.'
                : pickCount > 0
                  ? "WTSL's official popularity rank is not available right now."
                  : 'No picks recorded.'}
          </p>
        )}
      </div>
      {available && hasPublishedPickHistory && Array.isArray(profile.top_pickers) && profile.top_pickers.length ? (
        <>
          <p className="character-pickers-label">Players who picked this character</p>
          <ol className="character-pickers">
            {profile.top_pickers.map(([name, count]: [string, number]) => (
              <li key={name}><span>{name}</span><b>{count} {count === 1 ? 'pick' : 'picks'}</b></li>
            ))}
          </ol>
        </>
      ) : null}
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
  const guidance = profile.selection_guidance || {};
  const mechanics = profile.mechanics_insights || {};
  const strokeSetupLabels = buildStrokeSetupLabels(profile);
  const sizeInsight = buildSizeMechanicsInsight(profile.height, profile.weight);
  const strokeInsight = buildStrokeMechanicsInsight(profile);
  const insightRows = [
    ['Serve', mechanics.serve],
    ['Groundstrokes', mechanics.groundstrokes],
    ['Court speed', mechanics.surface_fit],
    ['Size & reach', sizeInsight],
    ['Stroke setup', strokeInsight],
    ['Counterplay', mechanics.counter],
    ['Net play', mechanics.net],
    ['Shot variety', mechanics.variation],
  ].filter(([, text]) => typeof text === 'string' && text.trim());
  const advantages = Array.isArray(guidance.advantages) ? guidance.advantages : [];
  const vulnerabilities = Array.isArray(guidance.vulnerabilities) ? guidance.vulnerabilities : [];
  const topEdges = statsWithoutExcludedAttributes(guidance.top_edges);
  const documentedEdges = Array.isArray(guidance.documented_edges) ? guidance.documented_edges : [];
  const documentedTalents = Array.isArray(guidance.documented_talents) ? guidance.documented_talents : [];
  const documentedExposures = Array.isArray(guidance.documented_exposures) ? guidance.documented_exposures : [];
  const technicalInteractions = Array.isArray(profile.technical_interactions)
    ? profile.technical_interactions
    : [];
  const attributes = statsWithoutExcludedAttributes(profile.stats);
  const characterSummary = buildCharacterProfileSummary(
    profile.character,
    attributes,
  );
  const categoryScores = characterCategoryScores(guidance.group_scores, attributes);
  const strongestGroup = String(guidance.strongest_group || categoryScores[0]?.name || '');
  const weakestGroup = String(
    guidance.weakest_group || categoryScores[categoryScores.length - 1]?.name || '',
  );
  const combined = statsWithoutExcludedAttributes(profile.combined_ratings);
  const relativeStrengths = statsWithoutExcludedAttributes(profile.strengths).filter((stat) =>
    !uninformativeRelativeStrengths.has(stat.attribute.trim().toLowerCase()),
  );
  const relativeWeaknesses = statsWithoutExcludedAttributes(profile.weaknesses);
  const traitNotes = [
    ...documentedEdges,
    ...documentedTalents,
    ...documentedExposures,
  ]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(splitTraitDescription);
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
    attribute &&
      data.ranking &&
      data.ranking.attribute === attribute &&
      !isExcludedRatingAttribute(data.ranking.attribute),
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
            {strokeSetupLabels.map((label) => <span key={label}>{label}</span>)}
          </div>
          {characterSummary && (
            <div className="character-profile-summary">
              <span className="panel-label">SUMMARY</span>
              <p className="character-style-description">{characterSummary}</p>
            </div>
          )}
          {official.profile_url && (
            <a href={official.profile_url} target="_blank" rel="noreferrer">
              {official.source === profile.sex ? `Official ${profile.sex} profile` : 'Player profile'} ↗
            </a>
          )}
        </div>
      </section>

      <PickHistory
        profile={profile}
        available={data.picks_available}
        ranking={data.pick_ranking}
      />
      {comparisonMatches && comparison && (
        <Comparison comparison={comparison} selected={profile.character} />
      )}
      {rankingMatches && <RankedAttribute ranking={data.ranking!} character={profile.character} />}

      {categoryScores.length > 0 && (
        <section className="panel character-category-panel">
          <div className="character-section-heading">
            <div><span className="panel-label">ROSTER COMPARISON</span><h2>Category profile</h2></div>
            {Number.isSafeInteger(Number(profile.roster_count)) && Number(profile.roster_count) > 0 && (
              <p>Compared with {profile.roster_count} {profile.sex} characters</p>
            )}
          </div>
          <p className="character-rating-explainer">
            Each category is the average percentile of its rankable attributes in this roster,
            not an average of raw ratings.
          </p>
          <div className="character-category-grid">
            {categoryScores.map((category) => {
              const isStrongest = category.name === strongestGroup;
              const isWeakest = category.name === weakestGroup;
              return (
                <article
                  className={`character-category-card${isStrongest ? ' strongest' : ''}${isWeakest && !isStrongest ? ' weakest' : ''}`}
                  key={category.name}
                >
                  <div className="character-category-heading">
                    <h3>{category.name}</h3>
                    <strong>{formatOrdinalRank(category.score)}<small> percentile</small></strong>
                  </div>
                  <div
                    className="character-category-meter"
                    role="meter"
                    aria-label={`${category.name}: ${formatOrdinalRank(category.score)} percentile`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={category.score}
                  >
                    <span style={{ width: `${category.score}%` }} />
                  </div>
                  {category.edges.length > 0 && (
                    <p>{category.edges.slice(0, 2).map((stat) => stat.attribute).join(' · ')}</p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="character-highlight-grid">
        <StatHighlights title="Relative strengths" stats={relativeStrengths} tone="positive" />
        <StatHighlights title="Relative weaknesses" stats={relativeWeaknesses} tone="caution" />
      </div>

      <div className="notice warn character-ai-insight-warning" role="note">
        <span aria-hidden="true">AI</span>
        <span>
          <strong>AI insight warning:</strong> Tactical explanations, selection guidance, and game
          plans are AI-generated recommendations, not verified match statistics or guaranteed outcomes.
        </span>
      </div>

      {(guidance.style_mechanics || guidance.acceleration_mechanics || traitNotes.length > 0 ||
        technicalInteractions.length > 0) && (
        <section className="panel character-trait-panel">
          <div className="character-section-heading">
            <div><span className="panel-label">DOCUMENTED CHARACTER SHEET</span><h2>Style &amp; traits</h2></div>
          </div>
          <ul className="character-trait-list">
            {guidance.style_mechanics && (
              <li><b>Style · {profile.style}</b><span>{guidance.style_mechanics}</span></li>
            )}
            {guidance.acceleration_mechanics && (
              <li><b>Acceleration · {profile.acceleration}</b><span>{guidance.acceleration_mechanics}</span></li>
            )}
            {traitNotes.map(({ name, description }, index) => (
              <li key={`${name}-${index}`}><b>{name}</b><span>{description}</span></li>
            ))}
          </ul>
          {technicalInteractions.length > 0 && (
            <details className="character-mechanics-details">
              <summary>Technical skill interactions</summary>
              <ul>
                {technicalInteractions.map(([name, description]: [string, string]) => (
                  <li key={name}><b>{name}</b><span>{description}</span></li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {(insightRows.length > 0 || advantages.length > 0 || vulnerabilities.length > 0) && (
        <section className="panel character-guidance-panel">
          <div className="character-section-heading">
            <div><span className="panel-label">TE4 MECHANICS</span><h2>Technical summary</h2></div>
          </div>
          {insightRows.length > 0 && (
            <div className="character-insight-grid">
              {insightRows.map(([title, text]) => (
                <article key={String(title)}><h3>{title}</h3><p>{String(text)}</p></article>
              ))}
            </div>
          )}
          {(advantages.length > 0 || vulnerabilities.length > 0) && (
            <div className="character-guidance-columns">
              {advantages.length > 0 && (
                <div><h3>Advantages</h3><ul>{advantages.map((item: string, index: number) => <li key={index}>{item}</li>)}</ul></div>
              )}
              {vulnerabilities.length > 0 && (
                <div><h3>Trade-offs</h3><ul>{vulnerabilities.map((item: string, index: number) => <li key={index}>{item}</li>)}</ul></div>
              )}
            </div>
          )}
        </section>
      )}

      {(guidance.why_select || guidance.benefit || guidance.best_for || topEdges.length > 0 ||
        guidance.game_plan || guidance.why_not_select || guidance.tradeoff) && (
        <div className="character-guidance-columns character-selection-guidance">
          {(guidance.why_select || guidance.benefit || guidance.best_for || topEdges.length > 0) && (
            <section className="character-selection-card">
              <span className="panel-label">WHY SELECT {profile.sex === 'WTA' ? 'HER' : 'HIM'}</span>
              <h3>{guidance.strongest_label || 'Roster strengths'}</h3>
              {(guidance.why_select || guidance.benefit) && (
                <p>{guidance.why_select || guidance.benefit}</p>
              )}
              {guidance.best_for && <p><b>Best for:</b> {guidance.best_for}</p>}
              {topEdges.length > 0 && (
                <div className="character-selection-edges">
                  <b>Roster evidence</b>
                  <ul>
                    {topEdges.slice(0, 5).map((stat) => (
                      <li key={stat.attribute}>
                        <span>
                          {stat.attribute} · {formatValue(
                            stat.value,
                            stat.attribute.toLowerCase() === 'topspin' ? '%' : '/100',
                          )}
                          <small>{percentileDescription(stat) || 'Percentile unavailable'}</small>
                        </span>
                        <StatBar stat={stat} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
          {(guidance.game_plan || guidance.why_not_select || guidance.tradeoff) && (
            <section className="character-selection-card">
              <span className="panel-label">HOW TO USE {profile.sex === 'WTA' ? 'HER' : 'HIM'}</span>
              <h3>Game plan</h3>
              {guidance.game_plan && <p>{guidance.game_plan}</p>}
              {(guidance.why_not_select || guidance.tradeoff) && (
                <p><b>Why not select:</b> {guidance.why_not_select || guidance.tradeoff}</p>
              )}
            </section>
          )}
        </div>
      )}

      <section className="character-profile-method-note" aria-label="How to read this profile">
        <div><b>Roster comparisons</b><p>Standouts, drawbacks, and category scores compare this character with the selected tour roster. Category scores average rankable attribute percentiles, not raw ratings.</p></div>
        <div><b>Mechanics explanations</b><p>Technical notes use the character’s own ratings and documented TE4 mechanics; they are not comparisons with other players.</p></div>
        <div><b>Point-event statistics</b><p>Winners, unforced errors, and rally length are not estimated without point-level match data.</p></div>
      </section>

      <section className="panel character-detail-panel">
        <div className="character-section-heading">
          <div><span className="panel-label">COMBINED SKILLS</span><h2>Ratings</h2></div>
        </div>
        <p className="character-rating-explainer">
          The number is the raw rating; the bar is its normalized roster score (0–100).
        </p>
        <CombinedSkills stats={combined} />
      </section>

      <section className="panel character-detail-panel">
        <div className="character-section-heading">
          <div><span className="panel-label">ATTRIBUTES</span><h2>Attribute rankings</h2></div>
        </div>
        <StatTable stats={attributes} />
      </section>

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
  const initialCharacterSelection =
    initialNames.includes(initialCharacter) ? initialCharacter : initialNames[0] || '';
  const [character, setCharacter] = useState(initialCharacterSelection);
  const characterRef = useRef(initialCharacterSelection);
  const [draftCharacter, setDraftCharacter] = useState(initialCharacterSelection);
  const [compare, setCompare] = useState('');
  const [draftCompare, setDraftCompare] = useState('');
  const [attribute, setAttribute] = useState('');
  const [draftAttribute, setDraftAttribute] = useState('');
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState('');
  const [data, setData] = useState<CharacterPayload | null>(null);
  const [loading, setLoading] = useState(initialNames.length > 0);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const requestNumber = useRef(0);
  const dataRef = useRef(data);
  const currentRoster = roster.tour === tour ? roster : null;
  const names = currentRoster?.names || [];
  const attributes = (currentRoster?.attributes || [])
    .filter((name) => !isExcludedRatingAttribute(name));
  const currentProfile =
    data?.tour === tour && data.profile?.character === character ? data : null;
  const filteredNames = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? names.filter((name) => name.toLowerCase().includes(query)) : names;
  }, [names, search]);
  const hasPendingSearch =
    Boolean(search.trim()) &&
    search.trim().toLowerCase() !== character.toLowerCase();
  const hasPendingChanges =
    hasPendingSearch ||
    draftCharacter !== character ||
    draftCompare !== compare ||
    draftAttribute !== attribute;
  const isLoadingDifferentCharacter = hasPendingSearch || draftCharacter !== character;

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentRoster || names.length === 0) {
      setSearchError('The selected roster is not available yet.');
      return;
    }

    const query = search.trim();
    const exactMatch = query
      ? names.find((name) => name.toLowerCase() === query.toLowerCase())
      : null;
    if (query && !exactMatch) {
      setSearchError(filteredNames.length
        ? 'Choose a full character name from the roster results.'
        : 'No character in this roster matches your search.');
      return;
    }

    const nextCharacter = exactMatch || draftCharacter || character;
    if (!names.includes(nextCharacter)) {
      setSearchError('Choose a character from the selected roster.');
      return;
    }
    if (draftCompare && (draftCompare === nextCharacter || !names.includes(draftCompare))) {
      setSearchError(draftCompare === nextCharacter
        ? 'Choose a different character to compare.'
        : 'Choose a comparison character from the selected roster.');
      return;
    }
    if (draftAttribute && !attributes.includes(draftAttribute)) {
      setSearchError('Choose an attribute from the selected roster.');
      return;
    }

    characterRef.current = nextCharacter;
    setCharacter(nextCharacter);
    setDraftCharacter(nextCharacter);
    setCompare(draftCompare);
    setAttribute(draftAttribute);
    setSearch('');
    setSearchError('');
  }

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (tour === roster.tour) return;
    const controller = new AbortController();
    setRosterLoading(true);
    setError('');
    setSearchError('');
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
        const nextCharacter = result.names.includes(characterRef.current)
          ? characterRef.current
          : result.names[0] || '';
        characterRef.current = nextCharacter;
        setCharacter(nextCharacter);
        setDraftCharacter(nextCharacter);
        setCompare('');
        setDraftCompare('');
        setAttribute('');
        setDraftAttribute('');
        setSearch('');
        setSearchError('');
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

        <form className="character-search-form" onSubmit={handleSearchSubmit}>
          <div className="character-control-grid">
            <div className="character-control">
              <label htmlFor="character-roster-search">Search roster</label>
              <SearchableDropdown
                id="character-roster-search"
                options={names}
                value={search}
                onChange={(value) => {
                  const exactMatch = names.find((name) => name.toLowerCase() === value.trim().toLowerCase());
                  setSearch(value);
                  setDraftCharacter(exactMatch || '');
                  setSearchError('');
                }}
                placeholder="Search names"
                loading={rosterLoading}
                disabled={!currentRoster}
                invalid={Boolean(searchError)}
                describedBy={searchError ? 'character-search-error' : undefined}
                showAllOnFocus
                showDropdownIndicator
                dropdownLabel="roster characters"
              />
            </div>
            <div className="character-control">
              <label htmlFor="character-compare-search">Compare with</label>
              <SearchableDropdown
                id="character-compare-search"
                options={names.filter((name) => name !== (draftCharacter || character))}
                value={draftCompare}
                onChange={(value) => {
                  setDraftCompare(value);
                  setSearchError('');
                }}
                placeholder="No comparison (optional)"
                loading={rosterLoading}
                disabled={!currentRoster || !character}
                invalid={Boolean(searchError)}
                describedBy={searchError ? 'character-search-error' : undefined}
                showAllOnFocus
                showDropdownIndicator
                dropdownLabel="comparison characters"
                emptyOptionLabel="No comparison"
              />
            </div>
            <div className="character-control">
              <label htmlFor="character-attribute-rank">Rank an attribute</label>
              <select
                id="character-attribute-rank"
                value={draftAttribute}
                onChange={(event) => {
                  setDraftAttribute(event.target.value);
                  setSearchError('');
                }}
                disabled={!currentRoster}
              >
                <option value="">No attribute ranking</option>
                {attributes.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          </div>
          <div className="character-search-actions">
            <p className="character-search-help">
              {isLoadingDifferentCharacter
                ? 'Choose a character from the roster to load it.'
                : 'Adjust the comparison or ranking options, then apply them.'}
            </p>
            <button type="submit" disabled={!currentRoster || !hasPendingChanges}>
              {isLoadingDifferentCharacter ? 'Load character' : 'Apply options'}
            </button>
          </div>
          {searchError && <p id="character-search-error" className="character-search-error" role="alert">{searchError}</p>}
        </form>

        {rosterLoading && <p className="character-loading-note" role="status">Loading roster…</p>}
        <div className="character-roster-heading">
          <h2>Character roster</h2>
          <span aria-live="polite">
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
                className={draftCharacter === name ? 'selected' : ''}
                aria-pressed={draftCharacter === name}
                onClick={() => {
                  characterRef.current = name;
                  setCharacter(name);
                  setDraftCharacter(name);
                  setSearch(name);
                  setSearchError('');
                  if (compare === name) setCompare('');
                  if (draftCompare === name) setDraftCompare('');
                }}
              >
                {name}
              </button>
            )) : <p className="character-muted">No characters match this search.</p>}
          </div>
        ) : (
          <p className="character-muted">The selected roster is not available right now.</p>
        )}
        {character && (
          <p className="character-search-current" aria-live="polite">
            Currently viewing <strong>{character}</strong>. You can search for another character at any time.
          </p>
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
        <p className="character-loading-note" role="status">Applying options…</p>
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
