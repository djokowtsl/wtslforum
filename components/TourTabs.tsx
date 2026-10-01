import Link from 'next/link';
import { TOURS, type TourCode } from '@/lib/wtsl';

/** Pill tab bar for switching between WTSL tours (ATP, WTA, Doubles, Coop, Created Characters). */
export default function TourTabs({ basePath, current }: { basePath: string; current: TourCode }) {
  return (
    <div className="tour-tabs" role="tablist" aria-label="Tour">
      {TOURS.map((t) => (
        <Link
          key={t.code}
          href={`${basePath}?tour=${encodeURIComponent(t.code)}`}
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
