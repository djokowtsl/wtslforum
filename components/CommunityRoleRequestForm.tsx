'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  FORUM_ROLE_LABELS,
  MANUAL_FORUM_ROLE_KEYS,
  type ForumRoleRequestStatus,
  type ManualForumRoleKey,
} from '@/lib/forumRoles';

type RequestState = Partial<Record<ManualForumRoleKey, ForumRoleRequestStatus>>;

export default function CommunityRoleRequestForm({
  initialRequests,
}: {
  initialRequests: RequestState;
}) {
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests);
  const [busyRole, setBusyRole] = useState<ManualForumRoleKey | null>(null);
  const [message, setMessage] = useState('');

  async function requestRole(roleKey: ManualForumRoleKey) {
    setBusyRole(roleKey);
    setMessage('');
    try {
      const response = await fetch('/api/profile/community-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleKey }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error || 'Unable to request this role.');
        return;
      }
      setRequests((current) => ({ ...current, [roleKey]: 'pending' }));
      setMessage(`${FORUM_ROLE_LABELS[roleKey]} request sent for admin review.`);
      router.refresh();
    } catch {
      setMessage('Network problem — please try again.');
    } finally {
      setBusyRole(null);
    }
  }

  return (
    <div className="community-role-request-list">
      {MANUAL_FORUM_ROLE_KEYS.map((roleKey) => {
        const status = requests[roleKey];
        return (
          <div className="community-role-request" key={roleKey}>
            <div>
              <strong>{FORUM_ROLE_LABELS[roleKey]}</strong>
              <small>
                {status === 'approved'
                  ? 'Verified'
                  : status === 'pending'
                    ? 'Awaiting admin review'
                    : status === 'rejected'
                      ? 'Not approved — you may request again'
                      : 'Request this tag for your profile'}
              </small>
            </div>
            {status !== 'approved' && status !== 'pending' && (
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={busyRole !== null}
                onClick={() => requestRole(roleKey)}
              >
                {busyRole === roleKey
                  ? 'Sending…'
                  : status === 'rejected'
                    ? 'Request again'
                    : 'Request verification'}
              </button>
            )}
          </div>
        );
      })}
      {message && <p className="notice" role="status" aria-live="polite">{message}</p>}
    </div>
  );
}
