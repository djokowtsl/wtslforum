'use client';

import { useEffect, useState } from 'react';
import {
  parseTe4CoachInsightDetail,
  parseTe4CoachInsightIndex,
  type Te4CoachInsight,
  type Te4CoachInsightDetail,
  type Te4CoachInsightIndex,
} from '@/lib/te4CoachInsights';
import { buildTe4CoachInsightApiUrl } from '@/lib/te4CoachEmbed';
import styles from './Te4CoachInsights.module.css';

const COACH_API = 'https://replays.knowthew.net/api/insights';

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date);
}

function numberLabel(value: number) {
  return value.toLocaleString('en-GB');
}

export default function Te4CoachInsights() {
  const [index, setIndex] = useState<Te4CoachInsightIndex | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [indexError, setIndexError] = useState('');
  const [detail, setDetail] = useState<Te4CoachInsightDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(COACH_API, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error('Shared TE4 Coach insights are unavailable.');
        const parsed = parseTe4CoachInsightIndex(body);
        if (!parsed) throw new Error('The TE4 Coach insight list could not be read.');
        setIndex(parsed);
        setSelectedId(parsed.insights[0].id);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setIndexError(error instanceof Error ? error.message : 'Shared TE4 Coach insights are unavailable.');
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const detailUrl = buildTe4CoachInsightApiUrl(selectedId);
    if (!detailUrl) {
      setDetailError('This WTSL-only insight could not be loaded.');
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError('');
    setLoadingDetail(true);
    void fetch(detailUrl, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (
          response.status === 400
          && typeof body?.error === 'string'
          && /can't be split by mod/i.test(body.error)
        ) {
          throw new Error('This insight is not yet available for WTSL-only matches.');
        }
        if (!response.ok) throw new Error('This TE4 Coach insight could not be loaded.');
        const parsed = parseTe4CoachInsightDetail(body);
        if (!parsed || parsed.id !== selectedId) {
          throw new Error('The TE4 Coach insight response was incomplete.');
        }
        setDetail(parsed);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDetailError(error instanceof Error ? error.message : 'This TE4 Coach insight could not be loaded.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDetail(false);
      });
    return () => controller.abort();
  }, [selectedId]);

  const selected = index?.insights.find((insight) => insight.id === selectedId) ?? null;

  return (
    <section className={styles.section} id="coach-insights" aria-labelledby="coach-insights-title">
      <div className={styles.heading}>
        <div>
          <span className={styles.kicker}>WTSL MOD ONLY</span>
          <h2 id="coach-insights-title">What WTSL matches show</h2>
        </div>
      </div>

      {indexError ? (
        <p className={styles.status} role="status">{indexError}</p>
      ) : !index ? (
        <p className={styles.status} role="status">Loading WTSL-only insights…</p>
      ) : (
        <>
          <p className={styles.corpus}>
            Only matches the replay identifies as played on the WTSL mod are included. Unknown mods are excluded.
          </p>

          <div className={styles.gallery} role="group" aria-label="Choose a TE4 Coach insight">
            {index.insights.map((insight: Te4CoachInsight) => (
              <button
                className={`${styles.insightCard}${selectedId === insight.id ? ` ${styles.selected}` : ''}`}
                type="button"
                key={insight.id}
                aria-pressed={selectedId === insight.id}
                onClick={() => setSelectedId(insight.id)}
              >
                <span>{insight.question}</span>
                <span className={styles.cardAction}>View insight <span aria-hidden="true">→</span></span>
              </button>
            ))}
          </div>

          {selected && (
            <div className={styles.detail} aria-live="polite">
              <div className={styles.detailCopy}>
                <span className={styles.scopeBadge}>WTSL matches only</span>
                <h3>{selected.question}</h3>
                {detail ? (
                  <>
                    <p className={styles.sentence}>
                      These outcomes are calculated from the WTSL-only match rows shown here.
                    </p>
                    <p className={styles.sample}>
                      {numberLabel(detail.shots)} shots · {numberLabel(detail.matches)} matches · data through {formatDate(detail.asOf)}
                    </p>
                    <p className={styles.caveat}>
                      Associations are not proof of cause. Opponent, score, and other match circumstances can also affect outcomes.
                    </p>
                  </>
                ) : loadingDetail ? (
                  <p className={styles.status} role="status">Loading the WTSL-only insight…</p>
                ) : detailError ? (
                  <p className={styles.status} role="status">{detailError}</p>
                ) : null}
              </div>
              {detail && (
                <div className={styles.tableWrap}>
                  <table className={styles.insightTable} aria-label={`WTSL-only results for ${selected.question}`}>
                    <thead>
                      <tr>
                        <th scope="col">Situation</th>
                        <th scope="col">Points won</th>
                        <th scope="col">Shots missed</th>
                        <th scope="col">Relative value</th>
                        <th scope="col">Shots</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.rows.map((row, rowIndex) => (
                        <tr key={`${row.label}-${rowIndex}`}>
                          <th scope="row">{row.label}</th>
                          <td>{row.wonDisplay ?? '—'}</td>
                          <td>{row.missedDisplay ?? '—'}</td>
                          <td>{row.worthDisplay ?? '—'}</td>
                          <td>{row.shotsDisplay}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <p className={styles.disclaimer}>
            Only calculations explicitly returned for WTSL-mod matches are displayed. Insights the provider cannot split by mod show an explanation instead of results; these associations are not proof of cause.
          </p>
        </>
      )}
    </section>
  );
}
