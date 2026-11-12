import type { Metadata } from 'next';
import { getSession } from '@/lib/auth';
import { canViewDmoVoiceDiagnostics } from '@/lib/dmoVoiceDiagnostics.mjs';
import DmoLiveViewer from '@/components/DmoLiveViewer';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: { absolute: 'Live Viewer' } };

export default async function LiveViewerPage() {
  const user = await getSession();
  return (
    <main className="live-broadcast-page">
      <DmoLiveViewer
        canWatch={Boolean(user)}
        voiceServer={process.env.NEXT_PUBLIC_VOICE_SERVER?.trim() ?? ''}
        showVoiceDiagnostics={canViewDmoVoiceDiagnostics(user)}
      />
    </main>
  );
}
