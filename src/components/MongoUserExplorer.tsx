'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CreditCard,
  Database,
  Filter,
  LogOut,
  RefreshCw,
  RotateCcw,
  Search,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  getCardExpiryStatus,
  isCardComplete,
  type CardValidityFilter,
  type ConnectionStatusInfo,
  type ExtractedCard,
  type UserSearchRecord,
} from '@/lib/card-utils';
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

class UnauthorizedError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'UnauthorizedError';
  }
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
  if (res.status === 401) {
    throw new UnauthorizedError();
  }
  const json = (await res.json()) as SearchResponse;
  if (!res.ok) {
    throw new Error(json.error ?? `Request failed with status ${res.status}`);
  }
  return json;
}

type UserStatusFilter = 'all' | 'verified' | 'kyc' | 'online';

export function MongoUserExplorer() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedConnection, setSelectedConnection] = useState<string>('all');
  const [onlyWithCard, setOnlyWithCard] = useState(true);

  // Client-side card & user filters
  const [cardValidity, setCardValidity] = useState<CardValidityFilter>('valid');
  const [requireCompleteCard, setRequireCompleteCard] = useState(true);
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [userStatusFilter, setUserStatusFilter] = useState<UserStatusFilter>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');

  const [refreshTick, setRefreshTick] = useState(0);
  const [locking, setLocking] = useState(false);
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
        if (err instanceof UnauthorizedError) {
          router.refresh();
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load MongoDB data');
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, selectedConnection, onlyWithCard, refreshTick, router]);

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

  async function handleLock() {
    setLocking(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.refresh();
      setLocking(false);
    }
  }

  function resetAllFilters() {
    setCardValidity('valid');
    setRequireCompleteCard(true);
    setBrandFilter('all');
    setUserStatusFilter('all');
    setCountryFilter('all');
    if (searchInput || debouncedQuery || selectedConnection !== 'all' || !onlyWithCard) {
      setLoading(true);
      setError(null);
      setSearchInput('');
      setDebouncedQuery('');
      setSelectedConnection('all');
      setOnlyWithCard(true);
    }
  }

  // Dynamic brand and country options from loaded users
  const availableBrands = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const u of data.users) {
      for (const c of u.cards) {
        if (c.cardCategory?.trim()) {
          set.add(c.cardCategory.trim().toLowerCase());
        }
      }
    }
    return [...set].sort();
  }, [data]);

  const availableCountries = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, string>();
    for (const u of data.users) {
      const raw = typeof u.data.country === 'string' ? u.data.country.trim() : '';
      if (raw) {
        const key = raw.toLowerCase();
        if (!map.has(key)) map.set(key, raw);
      }
    }
    return [...map.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([key, label]) => ({ key, label }));
  }, [data]);

  // Apply card-level & user-level filters
  const filteredResults = useMemo(() => {
    if (!data) {
      return {
        items: [] as Array<{
          record: UserSearchRecord;
          visibleCards: ExtractedCard[];
          hiddenExpiredCount: number;
        }>,
        totalVisibleCards: 0,
        totalExpiredHidden: 0,
      };
    }

    let totalVisibleCards = 0;
    let totalExpiredHidden = 0;
    const items: Array<{
      record: UserSearchRecord;
      visibleCards: ExtractedCard[];
      hiddenExpiredCount: number;
    }> = [];

    for (const record of data.users) {
      const d = record.data;

      // User status filter
      if (userStatusFilter === 'verified' && d.verified !== true) continue;
      if (userStatusFilter === 'kyc' && d.kyc !== true) continue;
      if (userStatusFilter === 'online' && d.online !== true) continue;

      // Country filter
      if (countryFilter !== 'all') {
        const c = typeof d.country === 'string' ? d.country.trim().toLowerCase() : '';
        if (c !== countryFilter) continue;
      }

      // Filter the user's cards
      let hiddenExpiredForUser = 0;
      const visibleCards = record.cards.filter((card) => {
        const expiryStatus = getCardExpiryStatus(card.cardExpiry);

        if (cardValidity === 'valid' && expiryStatus === 'expired') {
          hiddenExpiredForUser += 1;
          return false;
        }
        if (cardValidity === 'expired' && expiryStatus !== 'expired') {
          return false;
        }
        if (requireCompleteCard && !isCardComplete(card)) {
          return false;
        }
        if (brandFilter !== 'all') {
          const cat = card.cardCategory?.trim().toLowerCase() ?? '';
          if (cat !== brandFilter) return false;
        }
        return true;
      });

      totalExpiredHidden += hiddenExpiredForUser;

      // If filtering for cardholders / card filters, skip users with 0 matching cards
      const hasActiveCardFilter =
        onlyWithCard ||
        cardValidity !== 'all' ||
        requireCompleteCard ||
        brandFilter !== 'all';

      if (hasActiveCardFilter && visibleCards.length === 0) {
        continue;
      }

      totalVisibleCards += visibleCards.length;
      items.push({
        record,
        visibleCards,
        hiddenExpiredCount: hiddenExpiredForUser,
      });
    }

    return { items, totalVisibleCards, totalExpiredHidden };
  }, [
    data,
    userStatusFilter,
    countryFilter,
    cardValidity,
    requireCompleteCard,
    brandFilter,
    onlyWithCard,
  ]);

  const totalCardUsersAcrossClusters = useMemo(() => {
    if (!data) return 0;
    return data.connections.reduce((sum, c) => sum + c.cardUsers, 0);
  }, [data]);

  const totalUsersAcrossClusters = useMemo(() => {
    if (!data) return 0;
    return data.connections.reduce((sum, c) => sum + c.totalUsers, 0);
  }, [data]);

  const allUsersJson = useMemo(() => {
    if (!filteredResults.items.length) return '';
    return JSON.stringify(
      filteredResults.items.map(({ record, visibleCards }) => ({
        connection: record.connectionLabel,
        database: record.database,
        collection: record.collection,
        cards: visibleCards,
        user: record.data,
      })),
      null,
      2
    );
  }, [filteredResults.items]);

  const hasCustomFilter =
    cardValidity !== 'valid' ||
    !requireCompleteCard ||
    brandFilter !== 'all' ||
    userStatusFilter !== 'all' ||
    countryFilter !== 'all' ||
    selectedConnection !== 'all' ||
    Boolean(debouncedQuery) ||
    !onlyWithCard;

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
                Searches users across all configured{' '}
                <code className="font-mono text-slate-300">MONGODB_URI_*</code> connections and
                displays complete user profiles with active card filtering.
              </p>
            </div>

            {/* Summary KPIs + Lock */}
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

              <button
                type="button"
                onClick={handleLock}
                disabled={locking}
                title="Lock dashboard (sign out)"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-3 text-xs font-semibold text-slate-200 transition hover:border-red-500/40 hover:bg-red-950/30 hover:text-red-200 cursor-pointer disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                <span>Lock</span>
              </button>
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

            {/* Card & User Filters Panel */}
            <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Filter className="h-3.5 w-3.5 text-emerald-400" />
                  Card & User Filters
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {data && (
                    <span className="text-xs text-slate-400">
                      Showing{' '}
                      <strong className="text-white">{filteredResults.items.length}</strong>{' '}
                      user{filteredResults.items.length === 1 ? '' : 's'} (
                      <strong className="text-emerald-300">
                        {filteredResults.totalVisibleCards}
                      </strong>{' '}
                      card{filteredResults.totalVisibleCards === 1 ? '' : 's'}
                      {filteredResults.totalExpiredHidden > 0
                        ? `, ${filteredResults.totalExpiredHidden} expired hidden`
                        : ''}
                      )
                    </span>
                  )}
                  {hasCustomFilter && (
                    <button
                      type="button"
                      onClick={resetAllFilters}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset
                    </button>
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

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Expiry Validity Filter */}
                <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950/80 p-0.5 text-xs">
                  {(
                    [
                      { id: 'valid', label: 'Valid Only (Hide Expired)' },
                      { id: 'all', label: 'All Cards' },
                      { id: 'expired', label: 'Expired Only' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCardValidity(opt.id)}
                      className={`rounded-md px-2.5 py-1.5 font-medium transition cursor-pointer ${
                        cardValidity === opt.id
                          ? 'bg-emerald-500 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Brand Filter */}
                <select
                  aria-label="Filter by card brand"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="all">All Brands</option>
                  {availableBrands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand.toUpperCase()}
                    </option>
                  ))}
                </select>

                {/* User Status Filter */}
                <select
                  aria-label="Filter by user status"
                  value={userStatusFilter}
                  onChange={(e) => setUserStatusFilter(e.target.value as UserStatusFilter)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="all">All User Statuses</option>
                  <option value="verified">Verified Only</option>
                  <option value="kyc">KYC Approved</option>
                  <option value="online">Online Now</option>
                </select>

                {/* Country Filter */}
                <select
                  aria-label="Filter by country"
                  value={countryFilter}
                  onChange={(e) => setCountryFilter(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="all">All Countries</option>
                  {availableCountries.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>

                {/* Require CVV & Expiry */}
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs font-medium text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={requireCompleteCard}
                    onChange={(e) => setRequireCompleteCard(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span>Complete cards only (CVV + Expiry)</span>
                </label>

                {/* Require cardNumber */}
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs font-medium text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={onlyWithCard}
                    onChange={(e) => handleToggleOnlyWithCard(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span>
                    Only with <code className="font-mono text-emerald-300">cardNumber</code>
                  </span>
                </label>
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
        ) : data && filteredResults.items.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-10 text-center">
            <CreditCard className="mx-auto h-10 w-10 text-slate-600" />
            <h2 className="mt-3 text-lg font-semibold text-white">
              No matching {onlyWithCard ? 'users with active cards' : 'users'} found
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {debouncedQuery
                ? `No records matched "${debouncedQuery}" under the current filters.`
                : 'No records matched the active card/user filters.'}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              {cardValidity === 'valid' && (
                <button
                  type="button"
                  onClick={() => setCardValidity('all')}
                  className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 cursor-pointer"
                >
                  Include expired cards
                </button>
              )}
              {onlyWithCard && (
                <button
                  type="button"
                  onClick={() => handleToggleOnlyWithCard(false)}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                >
                  Search all users (including without cardNumber)
                </button>
              )}
              {hasCustomFilter && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  Reset filters
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : 'opacity-100'}`}>
            {filteredResults.items.map(({ record, visibleCards, hiddenExpiredCount }) => (
              <UserCardRecord
                key={record.uid}
                record={record}
                visibleCards={visibleCards}
                hiddenExpiredCount={hiddenExpiredCount}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
