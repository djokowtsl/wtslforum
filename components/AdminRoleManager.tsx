'use client';

import { useMemo, useState } from 'react';

type Member = { id: number; display_name: string; username: string; is_admin: boolean; is_moderator: boolean; bootstrap_admin: boolean; bootstrap_moderator: boolean };

export default function AdminRoleManager({ initialMembers }: { initialMembers: Member[] }) {
  const [members, setMembers] = useState(initialMembers);
  const [filter, setFilter] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? members.filter((member) => `${member.display_name} ${member.username}`.toLowerCase().includes(query)) : members;
  }, [filter, members]);

  function setRole(id: number, role: 'is_admin' | 'is_moderator', value: boolean) {
    setMembers((current) => current.map((member) => member.id === id ? { ...member, [role]: value } : member));
  }

  async function save(member: Member) {
    setBusyId(member.id);
    setMessage('');
    try {
      const response = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.id, isAdmin: member.is_admin, isModerator: member.is_moderator }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(result.error || 'Unable to update this member.'); return; }
      setMessage(`Roles saved for ${member.display_name}.`);
    } catch {
      setMessage('Network problem — please try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="role-manager">
      <label className="role-search">Find a forum account<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search display name or Discord username" /></label>
      {!filtered.length ? <p className="notice">No matching members.</p> : filtered.map((member) => (
        <section className="role-member" key={member.id}>
          <div className="role-member-name">
            <strong>{member.display_name}</strong>
            <span>@{member.username}{member.bootstrap_admin ? ' · configured bootstrap admin' : ''}{member.bootstrap_moderator ? ' · configured moderator' : ''}</span>
          </div>
          <label><input type="checkbox" checked={member.is_admin} disabled={member.bootstrap_admin} onChange={(event) => setRole(member.id, 'is_admin', event.target.checked)} /> Admin</label>
          <label><input type="checkbox" checked={member.is_moderator} disabled={member.bootstrap_moderator} onChange={(event) => setRole(member.id, 'is_moderator', event.target.checked)} /> Moderator</label>
          <button className="btn btn-sm" type="button" disabled={busyId === member.id} onClick={() => save(member)}>{busyId === member.id ? 'Saving…' : 'Save roles'}</button>
        </section>
      ))}
      {message && <p className="notice" role="status">{message}</p>}
    </div>
  );
}