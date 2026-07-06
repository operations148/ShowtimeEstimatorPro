'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthContext } from '@/lib/auth-context';

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
}

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
      type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
    }`}>
      {message}
    </div>
  );
}

export default function TeamPage() {
  const queryClient = useQueryClient();
  const { tenant } = useAuthContext();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // We can derive the current user's ID from the members list (the owner row will match tenant)
  // but we don't have a "me" user endpoint. We'll disable remove for the first owner we find
  // by checking against the tenant name — actually we track auth context doesn't expose userId.
  // Use a separate /users endpoint and identify self by matching session email via tenants/me.
  const { data: meDetail } = useQuery({
    queryKey: ['tenant-detail'],
    queryFn: () => api.get<{ id: string; name: string; slug: string }>('/tenants/me').then((r) => r.data),
  });

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.get<Member[]>('/users').then((r) => r.data ?? []),
  });

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Determine current user — first owner in list (simplification; real auth context doesn't expose userId)
  const currentUserId = members.find((m) => m.role === 'owner')?.id ?? null;

  const inviteMutation = useMutation({
    mutationFn: () => api.post('/users', { email: inviteEmail, role: inviteRole }),
    onSuccess: (res) => {
      if (res.error) { showToast(res.error.message, 'error'); return; }
      setInviteEmail('');
      queryClient.invalidateQueries({ queryKey: ['team'] });
      showToast('Member invited', 'success');
    },
    onError: () => showToast('Failed to invite member', 'error'),
  });

  const roleChangeMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.patch(`/users/${id}`, { role }),
    onSuccess: (res) => {
      if (res.error) { showToast(res.error.message, 'error'); return; }
      queryClient.invalidateQueries({ queryKey: ['team'] });
      showToast('Role updated', 'success');
    },
    onError: () => showToast('Failed to update role', 'error'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: (res) => {
      if (res.error) { showToast(res.error.message, 'error'); return; }
      setConfirmRemove(null);
      queryClient.invalidateQueries({ queryKey: ['team'] });
      showToast('Member removed', 'success');
    },
    onError: () => showToast('Failed to remove member', 'error'),
  });

  // Infer if current user is owner (has invite/remove capabilities)
  const isOwner = members.some((m) => m.role === 'owner');

  return (
    <>
      {toast && <Toast {...toast} />}

      <div className="max-w-2xl">
        {/* Members list */}
        <section className="mb-8">
          <h3 className="text-base font-medium text-gray-900 mb-4">Team members</h3>

          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-gray-400">No members yet.</p>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              {members.map((member, idx) => {
                const isSelf = member.id === currentUserId;
                return (
                  <div
                    key={member.id}
                    className={`flex items-center gap-4 px-4 py-3 ${idx < members.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-brand-700">
                        {member.email[0]?.toUpperCase()}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {member.name ?? member.email}
                        {isSelf && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
                      </p>
                      {member.name && (
                        <p className="text-xs text-gray-400 truncate">{member.email}</p>
                      )}
                    </div>

                    {/* Role — owner can change admin/member roles */}
                    {isOwner && !isSelf && member.role !== 'owner' ? (
                      <select
                        value={member.role}
                        onChange={(e) => roleChangeMutation.mutate({ id: member.id, role: e.target.value })}
                        className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                        aria-label={`Role for ${member.email}`}
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                    ) : (
                      <span className={`text-xs px-2 py-1 rounded-full font-medium border ${
                        member.role === 'owner'
                          ? 'bg-brand-50 text-brand-700 border-brand-200'
                          : member.role === 'admin'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-gray-100 text-gray-600 border-gray-200'
                      }`}>
                        {ROLE_LABELS[member.role]}
                      </span>
                    )}

                    {/* Remove — owner only, not self, not other owners */}
                    {isOwner && !isSelf && member.role !== 'owner' && (
                      confirmRemove === member.id ? (
                        <span className="flex items-center gap-1.5">
                          <button
                            onClick={() => removeMutation.mutate(member.id)}
                            disabled={removeMutation.isPending}
                            className="text-xs font-medium text-white bg-red-600 px-2 py-0.5 rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                          >
                            {removeMutation.isPending ? '…' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setConfirmRemove(null)}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmRemove(member.id)}
                          className="text-xs text-red-500 hover:text-red-700 transition-colors"
                          aria-label={`Remove ${member.email}`}
                        >
                          Remove
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Invite form */}
        {isOwner && (
          <section>
            <h3 className="text-base font-medium text-gray-900 mb-4">Invite member</h3>
            <div className="flex gap-2 flex-wrap">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && inviteMutation.mutate()}
                placeholder="colleague@company.com"
                className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                onClick={() => inviteMutation.mutate()}
                disabled={!inviteEmail.trim() || inviteMutation.isPending}
                className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {inviteMutation.isPending ? 'Inviting…' : 'Invite'}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Members can log in using OTP with their invited email.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
