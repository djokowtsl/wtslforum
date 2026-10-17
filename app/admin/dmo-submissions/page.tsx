import { redirect } from 'next/navigation';
import PageHero from '@/components/PageHero';
import DmoDeliveryRetryButton from '@/components/DmoDeliveryRetryButton';
import DmoSubmissionTagEditor from '@/components/DmoSubmissionTagEditor';
import { getSession } from '@/lib/auth';
import { listDmoSubmissions } from '@/lib/dmo-submissions';

export const dynamic = 'force-dynamic';

export default async function AdminDmoSubmissions() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  if (!user.isAdmin) redirect('/');
  const submissions = await listDmoSubmissions(250);

  return (
    <>
      <PageHero eyebrow="Staff" title="DMO submissions">
        Private match recordings submitted through Discord and the Forum.
      </PageHero>
      <main className="container">
        <div style={{ display: 'grid', gap: 14 }}>
          {submissions.length === 0 ? (
            <div className="notice">No DMO submissions have been received yet.</div>
          ) : submissions.map((submission) => {
            const id = Number(submission.id);
            const submissionDate = submission.submission_date instanceof Date
              ? submission.submission_date.toISOString().slice(0, 10)
              : String(submission.submission_date).slice(0, 10);
            const displayDate = new Date(`${submissionDate}T00:00:00Z`).toLocaleDateString('en-GB', {
              timeZone: 'UTC',
              dateStyle: 'medium',
            });
            return (
              <article className="admin-card" key={id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0 }}>{submission.tournament} — {submission.round_name}</h3>
                  <span className="notice">Submission date: {displayDate}</span>
                </div>
                <p style={{ margin: '10px 0 6px' }}>
                  <strong>{submission.player1}</strong> vs <strong>{submission.player2}</strong>
                </p>
                <p className="notice" style={{ marginBottom: 12 }}>
                  Submitted by {submission.account_name || submission.submitter_name}
                  {submission.submitter_discord_id ? ` · Discord ${submission.submitter_discord_id}` : ''}
                  {' · '}Source: {submission.source === 'discord' ? 'Discord' : 'Forum'}
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <DmoSubmissionTagEditor
                    id={id}
                    tournament={submission.tournament}
                    roundName={submission.round_name}
                    player1={submission.player1}
                    player2={submission.player2}
                    submissionDate={submissionDate}
                  />
                  {submission.private_blob_pathname && (
                    <a className="btn btn-sm" href={`/api/admin/dmo-submissions/${id}/file`}>
                      Download {submission.file_name || '.dmo file'}
                    </a>
                  )}
                  {submission.external_url && (
                    <a className="btn btn-sm btn-ghost" href={submission.external_url} target="_blank" rel="noreferrer">
                      Open recording link
                    </a>
                  )}
                  <span className="notice">
                    Discord delivery: {submission.discord_delivery_status}
                    {submission.discord_message_id ? ` · message ${submission.discord_message_id}` : ''}
                  </span>
                  {submission.source === 'forum' && submission.discord_delivery_status !== 'sent' && (
                    <DmoDeliveryRetryButton id={id} />
                  )}
                </div>
                {submission.discord_delivery_error && submission.discord_delivery_status !== 'sent' && (
                  <p className="notice" style={{ marginTop: 12 }}>{submission.discord_delivery_error}</p>
                )}
              </article>
            );
          })}
        </div>
      </main>
    </>
  );
}
