import Link from 'next/link';
import { TOURS, type TourCode } from '@/lib/wtsl';

/** Pill tab bar for switching between WTSL tours (ATP, WTA, Doubles, Coop, Created Characters).
 * `exclude` lets a page hide tours that don't make sense for it — e.g. Statistics has no
 * individual per-player stats for the Coop tour, so that tab would just be a dead end there. */
export default function TourTabs({ basePath, current, extraParams, exclude }: { basePath: string; current: TourCode; extraParams?: Record<string, string>; exclude?: TourCode[] }) {
  const extra = extraParams ? `&${new URLSearchParams(extraParams).toString()}` : '';
  const tours = exclude?.length ? TOURS.filter((t) => !exclude.includes(t.code)) : TOURS;
  return (
    <div className="tour-tabs" role="tablist" aria-label="Tour">
      {tours.map((t) => (
        <Link
          key={t.code}
          href={`${basePath}?tour=${encodeURIComponent(t.code)}${extra}`}
          className={`tour-tab${t.code === current ? ' active' : ''}`}
          aria-selected={t.code === current}
          role="tab"
        >
          {t.short}
        </Link>
      ))}
    </div>
  );
}
