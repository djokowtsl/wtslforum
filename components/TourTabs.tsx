import Link from 'next/link';
import { TOURS, type TourCode } from '@/lib/wtsl';

/** Pill tab bar for switching between WTSL tours (ATP, WTA, Doubles, Coop, Created Characters). */
export default function TourTabs({ basePath, current, extraParams }: { basePath: string; current: TourCode; extraParams?: Record<string, string> }) {
  const extra = extraParams ? `&${new URLSearchParams(extraParams).toString()}` : '';
  return (
    <div className="tour-tabs" role="tablist" aria-label="Tour">
      {TOURS.map((t) => (
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
