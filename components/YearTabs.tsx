import Link from 'next/link';

/** Pill tab bar for filtering a list by year/season — mirrors TourTabs. Always includes an "All"
 * pill first so the default (no `year` param) still shows everything. */
export default function YearTabs({ basePath, years, current, paramName = 'year', extraParams }: {
  basePath: string;
  years: string[];
  current?: string;
  paramName?: string;
  extraParams?: Record<string, string>;
}) {
  const base = extraParams && Object.keys(extraParams).length ? `${basePath}?${new URLSearchParams(extraParams).toString()}` : basePath;
  const extra = extraParams ? `&${new URLSearchParams(extraParams).toString()}` : '';
  return (
    <div className="tour-tabs year-tabs" role="tablist" aria-label="Year">
      <Link
        href={base}
        className={`tour-tab${!current ? ' active' : ''}`}
        aria-selected={!current}
        role="tab"
      >
        All
      </Link>
      {years.map((y) => (
        <Link
          key={y}
          href={`${basePath}?${paramName}=${encodeURIComponent(y)}${extra}`}
          className={`tour-tab${y === current ? ' active' : ''}`}
          aria-selected={y === current}
          role="tab"
        >
          {y}
        </Link>
      ))}
    </div>
  );
}
