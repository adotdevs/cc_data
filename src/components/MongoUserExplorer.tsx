'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CreditCard,
  Database,
  RefreshCw,
  Search,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { ConnectionStatusInfo, UserSearchRecord } from '@/lib/card-utils';
import { CopyButton } from './CopyButton';
import { UserCardRecord } from './UserCardRecord';

interface SearchResponse {
  connections: ConnectionStatusInfo[];
  users: UserSearchRecord[];
  meta: {
    totalMatched: number;
    totalCardHolders: number;
    onlineConnections: number;
    totalConnections: number;
    queriedAt: string;
  };
  error?: string;
}

async function fetchSearchResults(
  q: string,
  conn: string,
  cardOnly: boolean,
  signal: AbortSignal
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q,
    connection: conn,
    onlyWithCard: String(cardOnly),
  });
  const res = await fetch(`/api/users?${params.toString()}`, {
    signal,
    cache: 'no-store',
  });
  const json = (await res.json()) as SearchResponse;
  if (!res.ok) {
    throw new Error(json.error ?? `Request failed with status ${res.status}`);
  }
  return json;
}

export function MongoUserExplorer() {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedConnection, setSelectedConnection] = useState<string>('all');
  const [onlyWithCard, setOnlyWithCard] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setDebouncedQuery(searchInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();

    fetchSearchResults(debouncedQuery, selectedConnection, onlyWithCard, controller.signal)
      .then((json) => {
        if (!controller.signal.aborted) {
          setError(null);
          setData(json);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError' || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load MongoDB data');
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, selectedConnection, onlyWithCard, refreshTick]);

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setDebouncedQuery(searchInput);
    setRefreshTick((t) => t + 1);
  }

  function handleSelectConnection(key: string) {
    setLoading(true);
    setError(null);
    setSelectedConnection(key);
  }

  function handleToggleOnlyWithCard(checked: boolean) {
    setLoading(true);
    setError(null);
    setOnlyWithCard(checked);
  }

  function handleRefresh() {
    setLoading(true);
    setError(null);
    setRefreshTick((t) => t + 1);
  }

  const totalCardUsersAcrossClusters = useMemo(() => {
    if (!data) return 0;
    return data.connections.reduce((sum, c) => sum + c.cardUsers, 0);
  }, [data]);

  const totalUsersAcrossClusters = useMemo(() => {
    if (!data) return 0;
    return data.connections.reduce((sum, c) => sum + c.totalUsers, 0);
  }, [data]);

  const allUsersJson = useMemo(() => {
    if (!data?.users?.length) return '';
    return JSON.stringify(
      data.users.map((u) => ({
        connection: u.connectionLabel,
        database: u.database,
        collection: u.collection,
        cards: u.cards,
        user: u.data,
      })),
      null,
      2
    );
  }, [data]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Hero & Search Header */}
      <header className="border-b border-slate-800/80 bg-gradient-to-b from-slate-900 to-slate-950">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                <Database className="h-3.5 w-3.5" />
                Multi-Cluster MongoDB User & Card Explorer
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Connected MongoDB Cardholder Search
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Searches users across all configured <code className="font-mono text-slate-300">MONGODB_URI_*</code> connections and displays complete user profiles when a <code className="font-mono text-emerald-300">cardNumber</code> is present.
              </p>
            </div>

            {/* Summary KPIs */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-2.5">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">
                  Connections
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold text-white">
                  <Wifi className="h-4 w-4 text-emerald-400" />
                  {data ? `${data.meta.onlineConnections} / ${data.meta.totalConnections}` : '—'}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-2.5">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">
                  Cardholders
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold text-emerald-300">
                  <CreditCard className="h-4 w-4" />
                  {data ? totalCardUsersAcrossClusters : '—'}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-2.5">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">
                  Total Users
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold text-cyan-300">
                  <Users className="h-4 w-4" />
                  {data ? totalUsersAcrossClusters : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Search Form & Filter Controls */}
          <form onSubmit={handleFormSubmit} className="mt-6 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search by name, email, phone, cardNumber, cardName, country, or _id..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-10 pr-10 text-sm text-white placeholder-slate-500 shadow-inner focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => setSearchInput('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 cursor-pointer"
                >
                  <Search className="h-4 w-4" />
                  Search
                </button>
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={loading}
                  title="Refresh live data"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Filter Toggles & Bulk Copy */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2 text-xs font-medium text-slate-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyWithCard}
                  onChange={(e) => handleToggleOnlyWithCard(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
                />
                <span>
                  Only show users with <code className="font-mono text-emerald-300">cardNumber</code>
                </span>
              </label>

              <div className="flex items-center gap-2">
                {data && (
                  <span className="text-xs text-slate-400">
                    Showing <strong className="text-white">{data.users.length}</strong>{' '}
                    {onlyWithCard ? 'cardholder' : 'user'}
                    {data.users.length === 1 ? '' : 's'}
                  </span>
                )}
                {allUsersJson && (
                  <CopyButton
                    value={allUsersJson}
                    label="Copy All Results (JSON)"
                    variant="secondary"
                  />
                )}
              </div>
            </div>
          </form>

          {/* Connection Status Pills */}
          {data && (
            <div className="mt-5">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Configured MongoDB Connections ({data.meta.onlineConnections} online,{' '}
                {data.meta.totalConnections - data.meta.onlineConnections} offline)
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectConnection('all')}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium border transition cursor-pointer ${
                    selectedConnection === 'all'
                      ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                      : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <span>All Connections</span>
                  <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px]">
                    {totalCardUsersAcrossClusters}
                  </span>
                </button>

                {data.connections.map((conn) => {
                  const isSelected = selectedConnection === conn.key;
                  return (
                    <button
                      key={conn.key}
                      type="button"
                      onClick={() => handleSelectConnection(conn.key)}
                      title={
                        conn.connected
                          ? `${conn.label} · Online (${conn.latencyMs}ms) · DBs: ${conn.databases.join(', ') || 'none'} · ${conn.totalUsers} users (${conn.cardUsers} with cardNumber)`
                          : `${conn.label} · Offline: ${conn.error ?? 'Unreachable'}`
                      }
                      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium border transition cursor-pointer ${
                        isSelected
                          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                          : conn.connected
                            ? 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
                            : 'border-red-950/70 bg-red-950/20 text-slate-400 hover:border-red-900/70'
                      }`}
                    >
                      {conn.connected ? (
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      ) : (
                        <WifiOff className="h-3 w-3 text-red-400" />
                      )}
                      <span>{conn.label}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                          conn.cardUsers > 0
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-black/30 text-slate-400'
                        }`}
                      >
                        {conn.connected ? conn.cardUsers : 'off'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div>
              <div className="font-semibold">Error querying MongoDB</div>
              <div className="mt-0.5 text-red-300/90">{error}</div>
            </div>
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-4">
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="h-56 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/50"
              />
            ))}
          </div>
        ) : data && data.users.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-10 text-center">
            <CreditCard className="mx-auto h-10 w-10 text-slate-600" />
            <h2 className="mt-3 text-lg font-semibold text-white">
              No matching {onlyWithCard ? 'users with cardNumber' : 'users'} found
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {debouncedQuery
                ? `No records matched "${debouncedQuery}"${selectedConnection !== 'all' ? ' in the selected connection' : ''}.`
                : 'No users with a cardNumber were found in the selected filter.'}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              {onlyWithCard && (
                <button
                  type="button"
                  onClick={() => handleToggleOnlyWithCard(false)}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                >
                  Search all users (including without cardNumber)
                </button>
              )}
              {(debouncedQuery || selectedConnection !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setError(null);
                    setSearchInput('');
                    setDebouncedQuery('');
                    setSelectedConnection('all');
                  }}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  Reset filters
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : 'opacity-100'}`}>
            {data?.users.map((record) => (
              <UserCardRecord key={record.uid} record={record} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

