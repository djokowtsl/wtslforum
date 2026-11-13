import { notFound } from 'next/navigation';
import { isForumMaintenanceActive } from '@/lib/dmoCommentaryMaintenance.mjs';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Scheduled maintenance · WTSL Forum',
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  if (!isForumMaintenanceActive()) notFound();
  return null;
}
