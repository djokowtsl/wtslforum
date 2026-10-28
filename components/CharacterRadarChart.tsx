'use client';

import { useMemo } from 'react';
import styles from './CharacterMetricCharts.module.css';
import {
  radarCoordinates,
  radarProfileValues,
} from '@/lib/characterMetricChartGeometry.mjs';

type CharacterChartRow = {
  character: string;
  metrics: Record<string, number | string | null>;
};

const VIEW_WIDTH = 680;
const VIEW_HEIGHT = 500;
const CENTER_X = 340;
const CENTER_Y = 230;
const RADIUS = 140;
const LABEL_RADIUS = 195;
const GRID_LEVELS = [25, 50, 75, 100];

function polygonPoints(points: { x: number; y: number }[]) {
  return points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function labelLines(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return words;
  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint).join(' '), words.slice(midpoint).join(' ')];
}

function formatMetricValue(value: number, metric: string) {
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(value);
  return metric.toLowerCase() === 'topspin' ? `${formatted}%` : formatted;
}

export default function CharacterRadarChart({
  characters,
  metricNames,
  selectedCharacter,
  tour,
}: {
  characters: CharacterChartRow[];
  metricNames: string[];
  selectedCharacter: string;
  tour: 'all' | 'atp' | 'wta';
}) {
  const metrics = useMemo(
    () => radarProfileValues(characters, selectedCharacter, metricNames),
    [characters, metricNames, selectedCharacter],
  );
  const axisEnds = radarCoordinates(
    metrics.map(() => 100),
    CENTER_X,
    CENTER_Y,
    RADIUS,
  );
  const labelPositions = radarCoordinates(
    metrics.map(() => 100),
    CENTER_X,
    CENTER_Y,
    LABEL_RADIUS,
  );
  const shape = radarCoordinates(
    metrics.map(({ score }) => score),
    CENTER_X,
    CENTER_Y,
    RADIUS,
  );
  const tourLabel = tour === 'all' ? 'ATP + WTA' : tour.toUpperCase();
  const chartLabel = `${selectedCharacter} radar profile: ${metrics
    .map(({ name, value }) => `${name} ${formatMetricValue(value, name)}`)
    .join(', ')}`;

  return (
    <article className={`${styles.card} ${styles.radarCard}`}>
      <div className={styles.cardHeading}>
        <div>
          <span className="panel-label">CHARACTER RADAR</span>
          <h3>Character stat profile</h3>
        </div>
        {selectedCharacter && (
          <span className={styles.pointCount}>{selectedCharacter}</span>
        )}
      </div>

      {metrics.length < 3 ? (
        <p className={styles.status} role="status">
          A radar profile is unavailable for {selectedCharacter || 'the selected character'}.
        </p>
      ) : (
        <>
          <p className={styles.radarNote}>
            The shape scales each measure across the {tourLabel} roster; labels show the
            character’s original values.
          </p>
          <figure className={styles.radarFigure}>
            <svg
              className={styles.radarChart}
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              role="img"
              aria-label={chartLabel}
            >
              <title>{`${selectedCharacter} character stat profile`}</title>
              <desc>
                A radar chart of {metrics.length} measures, scaled within the {tourLabel} roster.
              </desc>

              {GRID_LEVELS.map((level) => (
                <polygon
                  key={`ring-${level}`}
                  className={styles.radarRing}
                  points={polygonPoints(radarCoordinates(
                    metrics.map(() => level),
                    CENTER_X,
                    CENTER_Y,
                    RADIUS,
                  ))}
                />
              ))}

              {axisEnds.map((point, index) => (
                <line
                  key={`axis-${metrics[index].name}`}
                  className={styles.radarAxis}
                  x1={CENTER_X}
                  y1={CENTER_Y}
                  x2={point.x}
                  y2={point.y}
                />
              ))}

              <polygon
                className={styles.radarShape}
                points={polygonPoints(shape)}
              />

              {metrics.map((metric, index) => {
                const point = labelPositions[index];
                const anchor = point.x > CENTER_X + 16
                  ? 'start'
                  : point.x < CENTER_X - 16
                    ? 'end'
                    : 'middle';
                const lines = labelLines(metric.name);
                const labelY = point.y - (lines.length > 1 ? 10 : 0);
                const valueY = labelY + lines.length * 18 + 8;

                return (
                  <g key={metric.name}>
                    {lines.map((line, lineIndex) => (
                      <text
                        key={`${metric.name}-${lineIndex}`}
                        className={styles.radarLabel}
                        x={point.x}
                        y={labelY + lineIndex * 18}
                        textAnchor={anchor}
                      >
                        {line}
                      </text>
                    ))}
                    <text
                      className={styles.radarValue}
                      x={point.x}
                      y={valueY}
                      textAnchor={anchor}
                    >
                      {formatMetricValue(metric.value, metric.name)}
                    </text>
                  </g>
                );
              })}
            </svg>
            <figcaption className={styles.radarNote}>
              Values use the same measures as the roster charts.
            </figcaption>
          </figure>
        </>
      )}
    </article>
  );
}
