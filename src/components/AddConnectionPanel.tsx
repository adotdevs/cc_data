'use client';

import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  Plus,
  X,
} from 'lucide-react';

interface AddConnectionPanelProps {
  onClose: () => void;
  onSaved: (newConnectionKey: string) => void;
  onUnauthorized: () => void;
}

interface TestFeedback {
  ok: boolean;
  message: string;
  canSaveOffline?: boolean;
}

export function AddConnectionPanel({
  onClose,
  onSaved,
  onUnauthorized,
}: AddConnectionPanelProps) {
  const [name, setName] = useState('');
  const [uri, setUri] = useState('');
  const [showUri, setShowUri] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<TestFeedback | null>(null);

  async function handleTest() {
    if (!uri.trim() || testing || saving) return;
    setTesting(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, uri, action: 'test' }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const json = (await res.json()) as {
        ok?: boolean;
        latencyMs?: number;
        databases?: string[];
        totalUsers?: number;
        cardUsers?: number;
        error?: string;
      };

      if (res.ok && json.ok) {
        const dbs = json.databases?.length ? json.databases.join(', ') : 'none';
        setFeedback({
          ok: true,
          message: `Connected in ${json.latencyMs}ms · DBs: ${dbs} · ${json.totalUsers ?? 0} users (${json.cardUsers ?? 0} with cardNumber)`,
        });
      } else {
        setFeedback({
          ok: false,
          message: json.error ?? 'Connection test failed',
          canSaveOffline: true,
        });
      }
    } catch {
      setFeedback({
        ok: false,
        message: 'Network error while testing connection',
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(allowOffline = false) {
    if (!uri.trim() || saving || testing) return;
    setSaving(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          uri,
          action: 'save',
          allowOffline,
        }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        canSaveOffline?: boolean;
        connection?: { key: string; label: string };
      };

      if (!res.ok || !json.ok || !json.connection) {
        setFeedback({
          ok: false,
          message: json.error ?? 'Failed to save connection',
          canSaveOffline: json.canSaveOffline,
        });
        return;
      }

      setName('');
      setUri('');
      onSaved(json.connection.key);
    } catch {
      setFeedback({
        ok: false,
        message: 'Network error while saving connection',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-slate-900/95 p-4 sm:p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Database className="h-4 w-4 text-emerald-400" />
            Add MongoDB Connection
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Saved connections persist on the server alongside <code className="font-mono text-slate-300">.env.local</code> and are searched immediately.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close add connection form"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label
            htmlFor="conn-name"
            className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5"
          >
            Name (optional)
          </label>
          <input
            id="conn-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. my-new-crm"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
          />
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor="conn-uri"
            className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5"
          >
            MongoDB Connection String
          </label>
          <div className="relative">
            <input
              id="conn-uri"
              type={showUri ? 'text' : 'password'}
              value={uri}
              onChange={(e) => {
                setUri(e.target.value);
                setFeedback(null);
              }}
              placeholder="mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/data"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-3 pr-10 font-mono text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
            />
            <button
              type="button"
              onClick={() => setShowUri((s) => !s)}
              aria-label={showUri ? 'Hide URI' : 'Show URI'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              {showUri ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
            feedback.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/30 bg-red-950/40 text-red-200'
          }`}
        >
          <div className="flex items-start gap-2">
            {feedback.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            )}
            <span>{feedback.message}</span>
          </div>

          {!feedback.ok && feedback.canSaveOffline && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave(true)}
              className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 cursor-pointer disabled:opacity-50"
            >
              Save Anyway (Offline)
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={!uri.trim() || testing || saving}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlugZap className="h-3.5 w-3.5 text-cyan-400" />
          )}
          <span>{testing ? 'Testing...' : 'Test Connection'}</span>
        </button>

        <button
          type="button"
          onClick={() => void handleSave(false)}
          disabled={!uri.trim() || saving || testing}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-40 cursor-pointer"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          <span>{saving ? 'Connecting & Saving...' : 'Save & Connect'}</span>
        </button>
      </div>
    </div>
  );
}

