'use client';

import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

interface IntegrationsConfig {
  ghl: { enabled: boolean; webhookUrl: string };
  sheetsWebhook: { enabled: boolean; webhookUrl: string };
  googleSheets: {
    enabled: boolean;
    spreadsheetId: string;
    sheetName: string;
    connected: boolean;
    connectedEmail: string;
  };
}

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
        type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      {message}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <span
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-brand-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className="text-sm font-medium text-gray-700">{label}</span>
    </label>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-gray-200 rounded-xl p-5 bg-white space-y-4">
      <div>
        <h3 className="text-base font-medium text-gray-900">{title}</h3>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      </div>
      {children}
    </div>
  );
}

const inputCls =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

export default function IntegrationsPage() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [ghlEnabled, setGhlEnabled] = useState(false);
  const [ghlUrl, setGhlUrl] = useState('');
  const [swEnabled, setSwEnabled] = useState(false);
  const [swUrl, setSwUrl] = useState('');
  const [gsEnabled, setGsEnabled] = useState(false);
  const [gsSpreadsheet, setGsSpreadsheet] = useState('');
  const [gsSheetName, setGsSheetName] = useState('');

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: config } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.get<IntegrationsConfig>('/integrations').then((r) => r.data),
  });

  useEffect(() => {
    if (!config) return;
    setGhlEnabled(config.ghl.enabled);
    setGhlUrl(config.ghl.webhookUrl);
    setSwEnabled(config.sheetsWebhook.enabled);
    setSwUrl(config.sheetsWebhook.webhookUrl);
    setGsEnabled(config.googleSheets.enabled);
    setGsSpreadsheet(config.googleSheets.spreadsheetId);
    setGsSheetName(config.googleSheets.sheetName);
  }, [config]);

  // Surface the outcome of the Google OAuth redirect (?gsheets_connected / ?gsheets_error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('gsheets_connected')) {
      showToast('Google Sheets connected', 'success');
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('gsheets_error')) {
      showToast(`Google Sheets connection failed (${params.get('gsheets_error')})`, 'error');
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put('/integrations', {
        ghl: { enabled: ghlEnabled, webhookUrl: ghlUrl.trim() },
        sheetsWebhook: { enabled: swEnabled, webhookUrl: swUrl.trim() },
        googleSheets: {
          enabled: gsEnabled,
          spreadsheetId: gsSpreadsheet.trim(),
          sheetName: gsSheetName.trim(),
        },
      }),
    onSuccess: (res) => {
      if (res.error) return showToast(res.error.message, 'error');
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      showToast('Integrations saved', 'success');
    },
    onError: () => showToast('Could not save integrations', 'error'),
  });

  const testMutation = useMutation({
    mutationFn: () => api.post<{ dispatched: boolean; targets: string[] }>('/integrations/test'),
    onSuccess: (res) => {
      if (res.error) return showToast(res.error.message, 'error');
      const targets = res.data?.targets ?? [];
      showToast(
        targets.length ? `Test lead sent to: ${targets.join(', ')}` : 'No integrations are enabled yet',
        targets.length ? 'success' : 'error',
      );
    },
    onError: () => showToast('Test dispatch failed', 'error'),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.post('/integrations/google-sheets/disconnect'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      showToast('Google Sheets disconnected', 'success');
    },
  });

  const connected = config?.googleSheets.connected ?? false;
  const connectedEmail = config?.googleSheets.connectedEmail ?? '';

  return (
    <>
      {toast && <Toast {...toast} />}

      <div className="max-w-2xl space-y-6">
        <div>
          <h3 className="text-base font-medium text-gray-900">Lead integrations</h3>
          <p className="text-sm text-gray-500 mt-1">
            Send every new lead straight into your CRM. Each integration fires the moment a widget
            submission comes in.
          </p>
        </div>

        {/* ── GoHighLevel ── */}
        <Section
          title="GoHighLevel (GHL)"
          description={
            <>
              In GHL, create an <strong>Inbound Webhook</strong> trigger and paste its URL here. We
              POST a JSON body with the lead&apos;s name, phone, email, zip, estimate, and answers.
            </>
          }
        >
          <Toggle checked={ghlEnabled} onChange={setGhlEnabled} label="Send new leads to GHL" />
          <input
            type="url"
            value={ghlUrl}
            onChange={(e) => setGhlUrl(e.target.value)}
            placeholder="https://services.leadconnectorhq.com/hooks/..."
            className={inputCls}
          />
        </Section>

        {/* ── Google Sheets via webhook ── */}
        <Section
          title="Google Sheets — webhook"
          description={
            <>
              The no-setup option: deploy a Google Apps Script Web App (or use a Zapier/Make hook)
              and paste its URL. We POST each lead as JSON for your script to append as a row.
            </>
          }
        >
          <Toggle checked={swEnabled} onChange={setSwEnabled} label="Send new leads to this webhook" />
          <input
            type="url"
            value={swUrl}
            onChange={(e) => setSwUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            className={inputCls}
          />
        </Section>

        {/* ── Google Sheets native OAuth ── */}
        <Section
          title="Google Sheets — direct connection"
          description={
            <>
              Connect your Google account and we&apos;ll append each lead as a new row via the Sheets
              API — no scripting required.
            </>
          }
        >
          {connected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Connected{connectedEmail ? ` as ${connectedEmail}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  className="text-sm text-gray-400 hover:text-red-500 transition-colors disabled:opacity-60"
                >
                  Disconnect
                </button>
              </div>
              <Toggle checked={gsEnabled} onChange={setGsEnabled} label="Append new leads to my sheet" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Spreadsheet URL or ID
                </label>
                <input
                  type="text"
                  value={gsSpreadsheet}
                  onChange={(e) => setGsSpreadsheet(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tab name <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={gsSheetName}
                  onChange={(e) => setGsSheetName(e.target.value)}
                  placeholder="Sheet1"
                  className={inputCls}
                />
              </div>
            </div>
          ) : (
            <a
              href={`${API_URL}/integrations/google-sheets/connect`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors"
            >
              Connect Google Sheets
            </a>
          )}
        </Section>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save integrations'}
          </button>
          <button
            type="button"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            {testMutation.isPending ? 'Sending…' : 'Send test lead'}
          </button>
        </div>
      </div>
    </>
  );
}
