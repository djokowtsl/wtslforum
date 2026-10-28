'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import styles from './CharacterMetricCharts.module.css';
import {
  axisTicks,
  NORMALIZED_DOMAIN,
  tooltipPosition,
} from '@/lib/characterMetricChartGeometry.mjs';
import CharacterRadarChart from '@/components/CharacterRadarChart';

type Tour = 'all' | 'atp' | 'wta';

type CharacterChartRow = {
  character: string;
  metrics: Record<string, number | string | null>;
};

type CharacterChartData = {
  tour: Tour;
  metric_names: string[];
  roster_count: number;
  characters: CharacterChartRow[];
};

type Point = {
  character: string;
  value: number;
  xValue?: number;
  yValue?: number;
};

type JitteredPoint = Point & {
  x: number;
  lane: number;
};

const WIDTH = 800;
const PAIR_HEIGHT = 440;
const PAIR_MARGIN = { top: 24, right: 24, bottom: 76, left: 78 };
const SINGLE_MARGIN = { top: 34, right: 30, bottom: 72, left: 62 };
const COMBINED_SKILLS = new Set([
  'Serve Rating',
  'Forehand Rating',
  'Backhand Rating',
]);

function numericValue(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatValue(value: number, metric: string) {
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(value);
  return metric.toLowerCase() === 'topspin' ? `${formatted}%` : formatted;
}

function sortedValues(values: number[]) {
  return [...values].sort((a, b) => a - b);
}

function median(values: number[]) {
  const sorted = sortedValues(values);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rawDomain(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = min === max
    ? Math.max(Math.abs(min) * 0.05, 1)
    : (max - min) * 0.05;
  return { min: min - padding, max: max + padding };
}

function zoomedDomain(
  domain: { min: number; max: number },
  center: number,
  zoomLevel: number,
) {
  const range = (domain.max - domain.min) / 2 ** zoomLevel;
  let min = center - range / 2;
  let max = center + range / 2;
  if (min < domain.min) {
    max += domain.min - min;
    min = domain.min;
  }
  if (max > domain.max) {
    min -= max - domain.max;
    max = domain.max;
  }
  return { min, max };
}

function chartValue(value: number, values: number[], normalized: boolean) {
  if (!normalized) return value;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max === min ? 50 : ((value - min) / (max - min)) * 100;
}

function formatAxis(value: number, normalized: boolean) {
  return normalized
    ? String(Math.round(value))
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function metricOptionsMarkup(options: string[]) {
  const combined = options.filter((option) => COMBINED_SKILLS.has(option));
  const attributes = options.filter((option) => !COMBINED_SKILLS.has(option));
  return (
    <>
      {combined.length > 0 && (
        <optgroup label="Combined skill ratings">
          {combined.map((option) => <option key={option} value={option}>{option}</option>)}
        </optgroup>
      )}
      {attributes.length > 0 && (
        <optgroup label="Character attributes">
          {attributes.map((option) => <option key={option} value={option}>{option}</option>)}
        </optgroup>
      )}
    </>
  );
}

function ZoomControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const multiplier = 2 ** value;

  return (
    <label className={styles.zoomControl} htmlFor={id}>
      <span className={styles.zoomControlHeading}>
        <span>{label}</span>
        <output htmlFor={id}>{multiplier}×</output>
      </span>
      <input
        id={id}
        type="range"
        min="0"
        max="3"
        step="1"
        value={value}
        aria-label={label}
        aria-valuetext={`${multiplier} times zoom`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function VerticalZoomControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const multiplier = 2 ** value;

  return (
    <label className={styles.verticalZoomControl} htmlFor={id}>
      <span className={styles.verticalZoomLabel}>Y zoom</span>
      <input
        id={id}
        type="range"
        min="0"
        max="3"
        step="1"
        value={value}
        aria-label="Y-axis zoom"
        aria-valuetext={`${multiplier} times zoom`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output htmlFor={id}>{multiplier}×</output>
    </label>
  );
}

function PointTooltip({
  x,
  y,
  lines,
  chartHeight,
}: {
  x: number;
  y: number;
  lines: string[];
  chartHeight: number;
}) {
  const longestLine = Math.max(...lines.map((line) => line.length));
  const tooltipWidth = Math.min(Math.max(longestLine * 7 + 20, 96), 320);
  const tooltipHeight = lines.length * 15 + 14;
  const { left, top } = tooltipPosition({
    x,
    y,
    width: tooltipWidth,
    height: tooltipHeight,
    viewportWidth: WIDTH,
    viewportHeight: chartHeight,
  });

  return (
    <g className={styles.tooltip} pointerEvents="none" aria-hidden="true">
      <rect
        x={left}
        y={top}
        width={tooltipWidth}
        height={tooltipHeight}
        rx="7"
      />
      <text x={left + 10} y={top + 18}>
        {lines.map((line, index) => (
          <tspan
            key={`${index}-${line}`}
            x={left + 10}
            dy={index === 0 ? 0 : 15}
            className={index === 0 ? styles.tooltipTitle : undefined}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function ScatterPlot({
  points,
  xMetric,
  yMetric,
  normalized,
  tour,
  onSelectCharacter,
}: {
  points: Point[];
  xMetric: string;
  yMetric: string;
  normalized: boolean;
  tour: Tour;
  onSelectCharacter: (character: string) => void;
}) {
  const [activePoint, setActivePoint] = useState<Point | null>(null);
  const [xZoom, setXZoom] = useState(0);
  const [yZoom, setYZoom] = useState(0);
  const clipId = useId().replace(/:/g, '');
  const plotWidth = WIDTH - PAIR_MARGIN.left - PAIR_MARGIN.right;
  const plotHeight = PAIR_HEIGHT - PAIR_MARGIN.top - PAIR_MARGIN.bottom;
  const xValues = points.map((point) => point.xValue!);
  const yValues = points.map((point) => point.yValue!);
  const baseXDomain = normalized ? NORMALIZED_DOMAIN : rawDomain(xValues);
  const baseYDomain = normalized ? NORMALIZED_DOMAIN : rawDomain(yValues);
  const medianX = chartValue(median(xValues), xValues, normalized);
  const medianY = chartValue(median(yValues), yValues, normalized);
  const xDomain = zoomedDomain(baseXDomain, medianX, xZoom);
  const yDomain = zoomedDomain(baseYDomain, medianY, yZoom);
  const xTicks = axisTicks(xDomain, normalized);
  const yTicks = axisTicks(yDomain, normalized);
  const visiblePoints = points.filter((point) => {
    const x = chartValue(point.xValue!, xValues, normalized);
    const y = chartValue(point.yValue!, yValues, normalized);
    return x >= xDomain.min && x <= xDomain.max
      && y >= yDomain.min && y <= yDomain.max;
  });
  const xPosition = (value: number) =>
    PAIR_MARGIN.left + ((value - xDomain.min) / (xDomain.max - xDomain.min)) * plotWidth;
  const yPosition = (value: number) =>
    PAIR_MARGIN.top + plotHeight - ((value - yDomain.min) / (yDomain.max - yDomain.min)) * plotHeight;

  return (
    <>
      <div className={styles.scatterChartFrame}>
        <div className={styles.scatterPlotRow}>
          <div className={styles.yAxisZoomRail}>
            <VerticalZoomControl value={yZoom} onChange={setYZoom} />
          </div>
          <div className={styles.svgScroller}>
            <svg
              className={styles.chart}
              viewBox={`0 0 ${WIDTH} ${PAIR_HEIGHT}`}
              role="group"
              aria-label={`${points.length} characters plotted by ${xMetric} and ${yMetric}`}
            >
          <title>{`${xMetric} versus ${yMetric} for ${points.length} characters`}</title>
          <defs>
            <clipPath id={clipId}>
              <rect
                x={PAIR_MARGIN.left}
                y={PAIR_MARGIN.top}
                width={plotWidth}
                height={plotHeight}
              />
            </clipPath>
          </defs>
          {xTicks.map((tick) => (
            <g key={`x-${tick}`} className={styles.plotGrid}>
              <line
                x1={xPosition(tick)}
                x2={xPosition(tick)}
                y1={PAIR_MARGIN.top}
                y2={PAIR_HEIGHT - PAIR_MARGIN.bottom}
              />
              <text x={xPosition(tick)} y={PAIR_HEIGHT - PAIR_MARGIN.bottom + 20} textAnchor="middle">
                {formatAxis(tick, normalized)}
              </text>
            </g>
          ))}
          {yTicks.map((tick) => (
            <g key={`y-${tick}`} className={styles.plotGrid}>
              <line
                x1={PAIR_MARGIN.left}
                x2={WIDTH - PAIR_MARGIN.right}
                y1={yPosition(tick)}
                y2={yPosition(tick)}
              />
              <text x={PAIR_MARGIN.left - 12} y={yPosition(tick) + 4} textAnchor="end">
                {formatAxis(tick, normalized)}
              </text>
            </g>
          ))}
          <g clipPath={`url(#${clipId})`}>
            <line
              className={styles.median}
              x1={xPosition(medianX)}
              x2={xPosition(medianX)}
              y1={PAIR_MARGIN.top}
              y2={PAIR_HEIGHT - PAIR_MARGIN.bottom}
            />
            <line
              className={styles.median}
              x1={PAIR_MARGIN.left}
              x2={WIDTH - PAIR_MARGIN.right}
              y1={yPosition(medianY)}
              y2={yPosition(medianY)}
            />
            {visiblePoints.map((point) => {
              const x = chartValue(point.xValue!, xValues, normalized);
              const y = chartValue(point.yValue!, yValues, normalized);
              const href = `/characters?tour=${tour}&character=${encodeURIComponent(point.character)}`;
              return (
                <a
                  key={point.character}
                  className={styles.pointLink}
                  href={href}
                  aria-label={`${point.character}: ${xMetric} ${formatValue(point.xValue!, xMetric)}, ${yMetric} ${formatValue(point.yValue!, yMetric)}. Open profile.`}
                  onMouseEnter={() => setActivePoint(point)}
                  onMouseLeave={() => setActivePoint(null)}
                  onFocus={() => setActivePoint(point)}
                  onBlur={() => setActivePoint(null)}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelectCharacter(point.character);
                  }}
                >
                  <circle cx={xPosition(x)} cy={yPosition(y)} r="5" />
                  <title>
                    {`${point.character} · ${xMetric}: ${formatValue(point.xValue!, xMetric)} · ${yMetric}: ${formatValue(point.yValue!, yMetric)}`}
                  </title>
                </a>
              );
            })}
          </g>
          {activePoint && visiblePoints.some((point) => point.character === activePoint.character) && (
            <PointTooltip
              x={xPosition(chartValue(activePoint.xValue!, xValues, normalized))}
              y={yPosition(chartValue(activePoint.yValue!, yValues, normalized))}
              chartHeight={PAIR_HEIGHT}
              lines={[
                activePoint.character,
                `${xMetric}: ${formatValue(activePoint.xValue!, xMetric)}`,
                `${yMetric}: ${formatValue(activePoint.yValue!, yMetric)}`,
              ]}
            />
          )}
          <text
            className={styles.axisLabel}
            x={PAIR_MARGIN.left + plotWidth / 2}
            y={PAIR_HEIGHT - 17}
            textAnchor="middle"
          >
            {xMetric}{normalized ? ' · normalized 0–100' : ''}
          </text>
          <text
            className={styles.axisLabel}
            x="19"
            y={PAIR_MARGIN.top + plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 19 ${PAIR_MARGIN.top + plotHeight / 2})`}
          >
            {yMetric}{normalized ? ' · normalized 0–100' : ''}
          </text>
            </svg>
          </div>
        </div>
        <div className={styles.xAxisControlRow}>
          <ZoomControl label="X-axis zoom" value={xZoom} onChange={setXZoom} />
          <button
            className={styles.zoomReset}
            type="button"
            disabled={xZoom === 0 && yZoom === 0}
            onClick={() => {
              setXZoom(0);
              setYZoom(0);
            }}
          >
            Reset zoom
          </button>
        </div>
      </div>
    </>
  );
}

function jitteredPoints(points: Point[], xPosition: (value: number) => number) {
  const placed: JitteredPoint[] = [];
  const ordered = [...points].sort((a, b) =>
    a.value - b.value || a.character.localeCompare(b.character),
  );
  const step = 11;

  for (const point of ordered) {
    const x = xPosition(point.value);
    let lane = 0;
    while (true) {
      const candidate = lane === 0
        ? 0
        : (lane % 2 ? 1 : -1) * Math.ceil(lane / 2);
      const collides = placed.some((other) =>
        Math.hypot(x - other.x, (candidate - other.lane) * step) < 10,
      );
      if (!collides) {
        placed.push({ ...point, x, lane: candidate });
        break;
      }
      lane += 1;
    }
  }

  return { placed, step };
}

function SingleMetricPlot({
  points,
  metric,
  tour,
  onSelectCharacter,
}: {
  points: Point[];
  metric: string;
  tour: Tour;
  onSelectCharacter: (character: string) => void;
}) {
  const [activePoint, setActivePoint] = useState<JitteredPoint | null>(null);
  const [xZoom, setXZoom] = useState(0);
  const clipId = useId().replace(/:/g, '');
  const plotWidth = WIDTH - SINGLE_MARGIN.left - SINGLE_MARGIN.right;
  const values = points.map((point) => point.value);
  const baseDomain = rawDomain(values);
  const domain = zoomedDomain(baseDomain, median(values), xZoom);
  const xPosition = (value: number) =>
    SINGLE_MARGIN.left + ((value - domain.min) / (domain.max - domain.min)) * plotWidth;
  const visiblePoints = points.filter((point) =>
    point.value >= domain.min && point.value <= domain.max,
  );
  const { placed, step } = jitteredPoints(visiblePoints, xPosition);
  const extent = placed.reduce((max, point) => Math.max(max, Math.abs(point.lane)), 0) * step;
  const height = Math.max(300, extent * 2 + 140);
  const centerY = height / 2;
  const xTicks = axisTicks(domain, false);

  return (
    <>
      <div className={styles.singleChartFrame}>
        <div className={styles.svgScroller}>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${WIDTH} ${height}`}
          role="group"
          aria-label={`${points.length} characters plotted by ${metric}; vertical positions only separate points`}
        >
          <title>{`${metric} values for ${points.length} characters`}</title>
          <defs>
            <clipPath id={clipId}>
              <rect
                x={SINGLE_MARGIN.left}
                y={centerY - extent - 12}
                width={plotWidth}
                height={extent * 2 + 24}
              />
            </clipPath>
          </defs>
          {xTicks.map((tick) => (
            <g key={tick} className={styles.plotGrid}>
              <line
                x1={xPosition(tick)}
                x2={xPosition(tick)}
                y1={centerY - extent - 12}
                y2={centerY + extent + 12}
              />
              <text x={xPosition(tick)} y={centerY + extent + 34} textAnchor="middle">
                {formatAxis(tick, false)}
              </text>
            </g>
          ))}
          <g clipPath={`url(#${clipId})`}>
            <line
              className={styles.baseline}
              x1={SINGLE_MARGIN.left}
              x2={WIDTH - SINGLE_MARGIN.right}
              y1={centerY}
              y2={centerY}
            />
            {placed.map((point) => {
              const href = `/characters?tour=${tour}&character=${encodeURIComponent(point.character)}`;
              return (
                <a
                  key={point.character}
                  className={styles.pointLink}
                  href={href}
                  aria-label={`${point.character}: ${metric} ${formatValue(point.value, metric)}. Open profile.`}
                  onMouseEnter={() => setActivePoint(point)}
                  onMouseLeave={() => setActivePoint(null)}
                  onFocus={() => setActivePoint(point)}
                  onBlur={() => setActivePoint(null)}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelectCharacter(point.character);
                  }}
                >
                  <circle cx={point.x} cy={centerY + point.lane * step} r="5" />
                  <title>{`${point.character} · ${metric}: ${formatValue(point.value, metric)}`}</title>
                </a>
              );
            })}
          </g>
          {activePoint && visiblePoints.some((point) => point.character === activePoint.character) && (
            <PointTooltip
              x={activePoint.x}
              y={centerY + activePoint.lane * step}
              chartHeight={height}
              lines={[
                activePoint.character,
                `${metric}: ${formatValue(activePoint.value, metric)}`,
              ]}
            />
          )}
          <text
            className={styles.axisLabel}
            x={SINGLE_MARGIN.left + plotWidth / 2}
            y={height - 16}
            textAnchor="middle"
          >
            {metric}
          </text>
        </svg>
        </div>
        <div className={styles.singleXAxisControlRow}>
          <ZoomControl label="Horizontal zoom" value={xZoom} onChange={setXZoom} />
          <button
            className={styles.zoomReset}
            type="button"
            disabled={xZoom === 0}
            onClick={() => setXZoom(0)}
          >
            Reset zoom
          </button>
        </div>
      </div>
    </>
  );
}

export default function CharacterMetricCharts({
  tour,
  selectedCharacter,
  onSelectCharacter,
}: {
  tour: Tour;
  selectedCharacter: string;
  onSelectCharacter: (character: string) => void;
}) {
  const [data, setData] = useState<CharacterChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [xMetric, setXMetric] = useState('');
  const [yMetric, setYMetric] = useState('');
  const [singleMetric, setSingleMetric] = useState('');
  const [normalized, setNormalized] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    fetch(
      `/api/character-stats?tour=${encodeURIComponent(tour)}&include_chart_data=true&include_profile=false&include_official=false`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.chart_data) {
          throw new Error(
            response.status === 503
              ? 'Character chart data is temporarily unavailable.'
              : 'Could not load the character chart data.',
          );
        }
        return result.chart_data as CharacterChartData;
      })
      .then((chartData) => {
        setData(chartData);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load the charts.');
        setLoading(false);
      });
    return () => controller.abort();
  }, [tour, retry]);

  const metricNames = useMemo(
    () => (data?.metric_names || []).filter((name) =>
      !['boomboomserver', 'ontimeserver'].includes(
        name.toLowerCase().replace(/[^a-z0-9]/g, ''),
      ),
    ),
    [data],
  );

  useEffect(() => {
    if (!metricNames.length) return;
    const preferredX = metricNames.includes('Forehand Rating')
      ? 'Forehand Rating'
      : metricNames[0];
    const preferredY = metricNames.includes('Backhand Rating')
      ? 'Backhand Rating'
      : metricNames.find((name) => name !== preferredX) || preferredX;
    setXMetric((current) => metricNames.includes(current) ? current : preferredX);
    setYMetric((current) =>
      metricNames.includes(current) && current !== preferredX ? current : preferredY,
    );
    setSingleMetric((current) =>
      metricNames.includes(current) ? current : preferredX,
    );
  }, [metricNames]);

  const pairPoints = useMemo(() => {
    if (!data || !xMetric || !yMetric) return [];
    return data.characters.flatMap((character) => {
      const xValue = numericValue(character.metrics[xMetric]);
      const yValue = numericValue(character.metrics[yMetric]);
      return xValue === null || yValue === null
        ? []
        : [{ character: character.character, value: xValue, xValue, yValue }];
    });
  }, [data, xMetric, yMetric]);

  const singlePoints = useMemo(() => {
    if (!data || !singleMetric) return [];
    return data.characters.flatMap((character) => {
      const value = numericValue(character.metrics[singleMetric]);
      return value === null ? [] : [{ character: character.character, value }];
    });
  }, [data, singleMetric]);

  return (
    <section className={`panel ${styles.section}`} aria-labelledby="character-chart-heading">
      <header className={styles.heading}>
        <div>
          <span className="panel-label">ROSTER DISTRIBUTIONS</span>
          <h2 id="character-chart-heading">Explore character metrics</h2>
          <p>Plot the roster to compare character strengths and trade-offs. Select any dot to open that character’s profile.</p>
        </div>
        {data && (
          <span className={styles.rosterCount}>
            {data.roster_count} {tour === 'all' ? 'ATP + WTA' : tour.toUpperCase()} characters
          </span>
        )}
      </header>

      {loading && <p className={styles.status} role="status">Loading roster metrics…</p>}
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </div>
      )}

      {data && metricNames.length > 0 && (
        <div className={styles.chartsGrid}>
          <article className={styles.card}>
            <div className={styles.cardHeading}>
              <div>
                <span className="panel-label">TWO-METRIC SCATTER</span>
                <h3>Compare two measures</h3>
              </div>
              <span className={styles.pointCount}>{pairPoints.length} characters</span>
            </div>
            <div className={styles.controls}>
              <label>
                Horizontal axis
                <select
                  value={xMetric}
                  onChange={(event) => {
                    const nextMetric = event.target.value;
                    setXMetric(nextMetric);
                    if (yMetric === nextMetric) {
                      setYMetric(metricNames.find((name) => name !== nextMetric) || '');
                    }
                  }}
                >
                  {metricOptionsMarkup(metricNames)}
                </select>
              </label>
              <label>
                Vertical axis
                <select
                  value={yMetric}
                  onChange={(event) => setYMetric(event.target.value)}
                  disabled={metricNames.length < 2}
                >
                  {metricOptionsMarkup(metricNames.filter((name) => name !== xMetric))}
                </select>
              </label>
            </div>
            <label className={styles.normalizeToggle}>
              <input
                type="checkbox"
                checked={normalized}
                onChange={(event) => setNormalized(event.target.checked)}
              />
              Normalize each axis to 0–100
            </label>
            <p className={styles.note}>
              Normalization scales each selected metric across this roster. Use the X- and Y-axis controls to zoom independently around the medians; reset to return to the full range. Hover or focus a point for its original values.
            </p>
            {metricNames.length < 2 ? (
              <p className={styles.status}>At least two metrics are needed for this chart.</p>
            ) : pairPoints.length ? (
              <ScatterPlot
                key={JSON.stringify([tour, xMetric, yMetric, normalized])}
                points={pairPoints}
                xMetric={xMetric}
                yMetric={yMetric}
                normalized={normalized}
                tour={tour}
                onSelectCharacter={onSelectCharacter}
              />
            ) : (
              <p className={styles.status}>No characters have values for both selected measures.</p>
            )}
          </article>

          <article className={styles.card}>
            <div className={styles.cardHeading}>
              <div>
                <span className="panel-label">SINGLE-METRIC STRIP</span>
                <h3>See one measure across the roster</h3>
              </div>
              <span className={styles.pointCount}>{singlePoints.length} characters</span>
            </div>
            <label className={styles.singleSelect}>
              Measure
              <select value={singleMetric} onChange={(event) => setSingleMetric(event.target.value)}>
                {metricOptionsMarkup(metricNames)}
              </select>
            </label>
            <p className={styles.note}>
              Dots are separated vertically only to reduce overlap; vertical position is not another measure. Use horizontal zoom to inspect a narrower value range.
            </p>
            {singlePoints.length ? (
              <SingleMetricPlot
                key={JSON.stringify([tour, singleMetric])}
                points={singlePoints}
                metric={singleMetric}
                tour={tour}
                onSelectCharacter={onSelectCharacter}
              />
            ) : (
              <p className={styles.status}>No characters have values for this measure.</p>
            )}
          </article>
          <CharacterRadarChart
            characters={data.characters}
            metricNames={metricNames}
            selectedCharacter={selectedCharacter}
            tour={tour}
          />
        </div>
      )}
    </section>
  );
}
