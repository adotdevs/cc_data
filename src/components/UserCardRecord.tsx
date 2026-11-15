'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Database,
  Globe,
  Mail,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  formatCardNumberDisplay,
  formatUserSummaryText,
  getCardExpiryStatus,
  getDisplayName,
  type ExtractedCard,
  type UserSearchRecord,
} from '@/lib/card-utils';
import { CopyButton } from './CopyButton';

interface UserCardRecordProps {
  record: UserSearchRecord;
  visibleCards?: ExtractedCard[];
  hiddenExpiredCount?: number;
}

function formatScalar(val: unknown): string {
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function formatDate(val: unknown): string {
  if (typeof val !== 'string' || !val) return '—';
  const parsed = Date.parse(val);
  if (!Number.isFinite(parsed)) return val;
  return new Date(parsed).toLocaleString();
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatCardCopyBundle(card: ExtractedCard): string {
  const lines = [
    card.cardCategory ? `Category: ${card.cardCategory}` : null,
    card.cardName ? `Card Name: ${card.cardName}` : null,
    `Card Number: ${card.cardNumber}`,
    card.cardExpiry ? `Expiry: ${card.cardExpiry}` : null,
    card.cardCvv ? `CVV: ${card.cardCvv}` : null,
    card.cardNotes ? `Notes: ${card.cardNotes}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function FieldRow({
  label,
  value,
  mono = false,
  copyValue,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyValue?: string;
}) {
  const canCopy = copyValue !== undefined && copyValue !== '' && copyValue !== '—';
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/60 px-3 py-2 border border-slate-800/80">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {label}
        </div>
        <div
          className={`mt-0.5 truncate text-sm text-slate-100 ${mono ? 'font-mono' : ''}`}
          title={value}
        >
          {value}
        </div>
      </div>
      {canCopy && (
        <CopyButton
          value={copyValue}
          label={label}
          variant="icon"
          title={`Copy ${label}`}
        />
      )}
    </div>
  );
}

export function UserCardRecord({
  record,
  visibleCards,
  hiddenExpiredCount = 0,
}: UserCardRecordProps) {
  const [showRawJson, setShowRawJson] = useState(false);
  const d = record.data;
  const displayName = getDisplayName(d);
  const cardsToShow = visibleCards ?? record.cards;
  const fullJson = JSON.stringify(d, null, 2);
  const summaryText = formatUserSummaryText(record, cardsToShow);

  const addressLine = [d.address, d.city, d.postalCode, d.country]
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
    .map((v) => String(v).trim())
    .join(', ');

  const cryptoStatus =
    d.cryptoCard && typeof d.cryptoCard === 'object'
      ? (d.cryptoCard as Record<string, unknown>).status
      : undefined;

  const submitDocStatus =
    d.submitDoc && typeof d.submitDoc === 'object'
      ? (d.submitDoc as Record<string, unknown>).status
      : undefined;

  const extraKeys = Object.keys(d).filter(
    (k) =>
      ![
        '_id',
        'firstName',
        'lastName',
        'name',
        'email',
        'phone',
        'address',
        'city',
        'postalCode',
        'country',
        'role',
        'currency',
        'progress',
        'verified',
        'kyc',
        'online',
        'createdAt',
        'lastOnline',
        'lastActivity',
        'note',
        'referralCode',
        'affiliateStatus',
        'AiTradingPercentage',
        'cryptoCard',
        'submitDoc',
        'payments',
        '__v',
      ].includes(k)
  );

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/80 shadow-xl shadow-black/25 overflow-hidden transition-colors hover:border-slate-700">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800/90 bg-slate-950/60 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/25 to-cyan-500/20 border border-emerald-500/30 font-semibold text-emerald-300">
            {getInitials(displayName)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-white">
                {displayName}
              </h2>
              {cardsToShow.length > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300 border border-emerald-500/30">
                  <CreditCard className="h-3 w-3" />
                  {cardsToShow.length} {cardsToShow.length === 1 ? 'Card' : 'Cards'}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-400 border border-slate-700">
                  No Active Card
                </span>
              )}
              {hiddenExpiredCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300 border border-amber-500/25">
                  {hiddenExpiredCount} expired hidden
                </span>
              )}
              {d.verified === true && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-300 border border-sky-500/30">
                  <CheckCircle2 className="h-3 w-3" />
                  Verified
                </span>
              )}
              {d.kyc === true && (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-300 border border-violet-500/30">
                  <ShieldCheck className="h-3 w-3" />
                  KYC
                </span>
              )}
              {d.online === true && (
                <span className="inline-flex items-center gap-1 rounded-full bg-lime-500/15 px-2 py-0.5 text-xs font-medium text-lime-300 border border-lime-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-lime-400 animate-pulse" />
                  Online
                </span>
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5 font-medium text-cyan-300">
                <Database className="h-3.5 w-3.5" />
                {record.connectionLabel}
              </span>
              <span className="font-mono text-slate-500">
                {record.database}.{record.collection}
              </span>
              {typeof d.role === 'string' && d.role && (
                <span className="inline-flex items-center gap-1 text-slate-300">
                  <User className="h-3 w-3 text-slate-400" />
                  {d.role}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Top Copy Actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <CopyButton
            value={summaryText}
            label="Copy Summary"
            variant="secondary"
          />
          <CopyButton
            value={fullJson}
            label="Copy Full JSON"
            variant="primary"
          />
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-5">
        {/* Card Number Showcase */}
        {cardsToShow.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <CreditCard className="h-4 w-4" />
                Card Details
              </h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {cardsToShow.map((card, idx) => {
                const expiryStatus = getCardExpiryStatus(card.cardExpiry);
                const isExpired = expiryStatus === 'expired';
                return (
                <div
                  key={`${card.sourcePath}-${idx}`}
                  className={`relative overflow-hidden rounded-xl border p-4 shadow-lg ${
                    isExpired
                      ? 'border-red-500/30 bg-gradient-to-br from-slate-950 via-slate-900 to-red-950/35'
                      : 'border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-block rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300 border border-emerald-500/25">
                          {card.cardCategory || 'Card'}
                        </span>
                        {expiryStatus === 'expired' ? (
                          <span className="inline-block rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300 border border-red-500/30">
                            Expired
                          </span>
                        ) : expiryStatus === 'valid' ? (
                          <span className="inline-block rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300 border border-sky-500/25">
                            Valid
                          </span>
                        ) : (
                          <span className="inline-block rounded bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border border-slate-700">
                            No Expiry
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-slate-500">
                        {card.sourcePath}
                      </div>
                    </div>
                    <CopyButton
                      value={formatCardCopyBundle(card)}
                      label="Copy Card"
                      variant="subtle"
                    />
                  </div>

                  {/* Card Number */}
                  <div className="mt-4 flex items-center justify-between gap-2 rounded-lg bg-black/35 px-3 py-2.5 border border-white/10">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">
                        Card Number
                      </div>
                      <div className="font-mono text-base sm:text-lg font-semibold tracking-wider text-white">
                        {formatCardNumberDisplay(card.cardNumber)}
                      </div>
                    </div>
                    <CopyButton
                      value={card.cardNumber}
                      label="Number"
                      variant="primary"
                    />
                  </div>

                  {/* Holder / Expiry / CVV */}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="col-span-3 sm:col-span-1 rounded-lg bg-black/25 px-2.5 py-2 border border-white/5 flex items-center justify-between gap-1">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">
                          Holder
                        </div>
                        <div className="truncate text-xs font-medium text-slate-100" title={card.cardName}>
                          {card.cardName || '—'}
                        </div>
                      </div>
                      {card.cardName && (
                        <CopyButton value={card.cardName} label="Holder" variant="icon" />
                      )}
                    </div>

                    <div className="rounded-lg bg-black/25 px-2.5 py-2 border border-white/5 flex items-center justify-between gap-1">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">
                          Expiry
                        </div>
                        <div className="font-mono text-xs font-medium text-slate-100">
                          {card.cardExpiry || '—'}
                        </div>
                      </div>
                      {card.cardExpiry && (
                        <CopyButton value={card.cardExpiry} label="Expiry" variant="icon" />
                      )}
                    </div>

                    <div className="rounded-lg bg-black/25 px-2.5 py-2 border border-white/5 flex items-center justify-between gap-1">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">
                          CVV
                        </div>
                        <div className="font-mono text-xs font-medium text-slate-100">
                          {card.cardCvv || '—'}
                        </div>
                      </div>
                      {card.cardCvv && (
                        <CopyButton value={card.cardCvv} label="CVV" variant="icon" />
                      )}
                    </div>
                  </div>

                  {card.cardNotes && (
                    <div className="mt-2.5 rounded-lg bg-black/25 px-2.5 py-1.5 text-xs text-slate-300 border border-white/5">
                      <span className="text-slate-500">Notes: </span>
                      {card.cardNotes}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Complete User Identity & Contact Grid */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-cyan-400" />
              Contact & Location
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <FieldRow
                label="Email"
                value={formatScalar(d.email)}
                copyValue={d.email ? String(d.email) : undefined}
              />
              <FieldRow
                label="Phone"
                value={formatScalar(d.phone)}
                mono
                copyValue={d.phone !== undefined && d.phone !== null ? String(d.phone) : undefined}
              />
              <FieldRow
                label="First Name"
                value={formatScalar(d.firstName)}
                copyValue={d.firstName ? String(d.firstName) : undefined}
              />
              <FieldRow
                label="Last Name"
                value={formatScalar(d.lastName)}
                copyValue={d.lastName ? String(d.lastName) : undefined}
              />
              <div className="sm:col-span-2">
                <FieldRow
                  label="Full Address"
                  value={addressLine || '—'}
                  copyValue={addressLine || undefined}
                />
              </div>
              <FieldRow
                label="User _id"
                value={formatScalar(d._id)}
                mono
                copyValue={d._id ? String(d._id) : undefined}
              />
              <FieldRow
                label="Country / Currency"
                value={`${formatScalar(d.country)} · ${formatScalar(d.currency)}`}
              />
            </div>
          </div>

          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-cyan-400" />
              Account & Activity
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <FieldRow label="Crypto Card Status" value={formatScalar(cryptoStatus)} />
              <FieldRow label="KYC / Doc Status" value={formatScalar(submitDocStatus)} />
              <FieldRow label="Progress" value={d.progress !== undefined ? `${d.progress}%` : '—'} />
              <FieldRow label="AI Trading %" value={formatScalar(d.AiTradingPercentage)} />
              <FieldRow
                label="Referral Code"
                value={formatScalar(d.referralCode)}
                mono
                copyValue={d.referralCode ? String(d.referralCode) : undefined}
              />
              <FieldRow
                label="Payments Count"
                value={Array.isArray(d.payments) ? String(d.payments.length) : '0'}
              />
              <FieldRow label="Created At" value={formatDate(d.createdAt)} />
              <FieldRow label="Last Activity" value={formatDate(d.lastActivity)} />
            </div>
            {typeof d.note === 'string' && d.note.trim() !== '' && (
              <div className="rounded-lg bg-slate-900/60 px-3 py-2 border border-slate-800/80 text-xs text-slate-300">
                <span className="font-semibold uppercase tracking-wider text-slate-400 mr-2">
                  Note:
                </span>
                {d.note}
              </div>
            )}
          </div>
        </div>

        {/* Additional Fields Summary + Expandable Complete Raw JSON */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800/80">
            <button
              type="button"
              onClick={() => setShowRawJson((prev) => !prev)}
              className="inline-flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
            >
              {showRawJson ? (
                <ChevronUp className="h-4 w-4 text-emerald-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-emerald-400" />
              )}
              <span>
                {showRawJson ? 'Hide' : 'View'} Complete User Document ({Object.keys(d).length} fields
                {extraKeys.length > 0 ? `, including ${extraKeys.slice(0, 4).join(', ')}${extraKeys.length > 4 ? '…' : ''}` : ''})
              </span>
            </button>
            <CopyButton
              value={fullJson}
              label="Copy Complete Data"
              variant="subtle"
            />
          </div>

          {showRawJson && (
            <pre className="max-h-[420px] overflow-auto p-4 text-xs font-mono leading-relaxed text-emerald-200/90 bg-slate-950">
              {fullJson}
            </pre>
          )}
        </div>
      </div>
    </article>
  );
}
