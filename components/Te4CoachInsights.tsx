'use client';

import { useEffect, useState } from 'react';
import {
  parseTe4CoachInsightDetail,
  parseTe4CoachInsightIndex,
  type Te4CoachInsight,
  type Te4CoachInsightDetail,
  type Te4CoachInsightIndex,
} from '@/lib/te4CoachInsights';
import { buildTe4CoachInsightEmbedUrl } from '@/lib/te4CoachEmbed';
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
    const controller = new AbortController();
    setDetail(null);
    setDetailError('');
    setLoadingDetail(true);
    void fetch(`${COACH_API}/${encodeURIComponent(selectedId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
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
  const embedUrl = selected ? buildTe4CoachInsightEmbedUrl(selected.id) : null;

  return (
    <section className={styles.section} id="coach-insights" aria-labelledby="coach-insights-title">
      <div className={styles.heading}>
        <div>
          <span className={styles.kicker}>SHARED TE4 COACH DATA</span>
          <h2 id="coach-insights-title">What the shots show</h2>
        </div>
        <a href="https://replays.knowthew.net/all/" target="_blank" rel="noopener noreferrer">
          Explore the shot library <span aria-hidden="true">↗</span>
        </a>
      </div>

      {indexError ? (
        <p className={styles.status} role="status">
          {indexError}{' '}
          <a href="https://replays.knowthew.net/all/" target="_blank" rel="noopener noreferrer">
            Open TE4 Coach
          </a>
        </p>
      ) : !index ? (
        <p className={styles.status} role="status">Loading shared insights…</p>
      ) : (
        <>
          {index.everyone && (
            <p className={styles.corpus}>
              Updated {formatDate(index.everyone.asOf)} · {numberLabel(index.everyone.matches)} matches ·{' '}
              {numberLabel(index.everyone.players)} players · {numberLabel(index.everyone.shots)} shots
            </p>
          )}

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
                <h3>{selected.question}</h3>
                {detail ? (
                  <>
                    <p className={styles.sentence}>{detail.sentence}</p>
                    <p className={styles.sample}>
                      {numberLabel(detail.shots)} shots · {numberLabel(detail.matches)} matches · data through {formatDate(detail.asOf)}
                    </p>
                    <p className={styles.caveat}>{detail.caveat}</p>
                  </>
                ) : loadingDetail ? (
                  <p className={styles.status} role="status">Loading the insight and its sample details…</p>
                ) : detailError ? (
                  <p className={styles.status} role="status">{detailError} The provider’s chart remains available below.</p>
                ) : null}
              </div>
              {embedUrl && (
                <iframe
                  className={styles.embed}
                  src={embedUrl}
                  title={`TE4 Coach insight: ${selected.question}`}
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              )}
            </div>
          )}
          <p className={styles.disclaimer}>
            These figures describe associations across shared matches, not proof of cause. The provider marks small samples and supplies the caveat with each insight.
          </p>
        </>
      )}
    </section>
  );
}
