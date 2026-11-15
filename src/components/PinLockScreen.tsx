'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Delete, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';

interface PinLockScreenProps {
  onUnlocked?: () => void;
}

export function PinLockScreen({ onUnlocked }: PinLockScreenProps) {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  async function submitPin(pinValue: string) {
    if (pinValue.length < 4 || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinValue }),
      });
      const json = (await res.json()) as { authenticated?: boolean; error?: string };

      if (!res.ok || !json.authenticated) {
        setError(json.error ?? 'Invalid PIN');
        setDigits(['', '', '', '']);
        window.setTimeout(() => inputRefs.current[0]?.focus(), 20);
        return;
      }

      if (onUnlocked) {
        onUnlocked();
      }
      router.refresh();
    } catch {
      setError('Network error while verifying PIN');
    } finally {
      setSubmitting(false);
    }
  }

  function handleDigitChange(index: number, rawValue: string) {
    const cleaned = rawValue.replace(/\D/g, '');
    if (!cleaned) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      return;
    }

    // Handle pasting multiple digits
    if (cleaned.length > 1) {
      const chars = cleaned.slice(0, 4).split('');
      const next = ['', '', '', ''];
      chars.forEach((c, i) => {
        next[i] = c;
      });
      setDigits(next);
      const focusIdx = Math.min(chars.length, 3);
      inputRefs.current[focusIdx]?.focus();
      if (chars.length === 4) {
        void submitPin(next.join(''));
      }
      return;
    }

    const next = [...digits];
    next[index] = cleaned;
    setDigits(next);
    setError(null);

    if (index < 3) {
      inputRefs.current[index + 1]?.focus();
    } else {
      void submitPin(next.join(''));
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        const next = [...digits];
        next[index - 1] = '';
        setDigits(next);
        inputRefs.current[index - 1]?.focus();
      } else {
        const next = [...digits];
        next[index] = '';
        setDigits(next);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 3) {
      inputRefs.current[index + 1]?.focus();
    } else if (e.key === 'Enter') {
      void submitPin(digits.join(''));
    }
  }

  function handleKeypadPress(digit: string) {
    if (submitting) return;
    const emptyIdx = digits.findIndex((d) => d === '');
    if (emptyIdx === -1) return;
    const next = [...digits];
    next[emptyIdx] = digit;
    setDigits(next);
    setError(null);
    if (emptyIdx === 3) {
      void submitPin(next.join(''));
    } else {
      inputRefs.current[emptyIdx + 1]?.focus();
    }
  }

  function handleKeypadBackspace() {
    if (submitting) return;
    const lastFilledIdx = [...digits].reverse().findIndex((d) => d !== '');
    if (lastFilledIdx === -1) return;
    const idx = 3 - lastFilledIdx;
    const next = [...digits];
    next[idx] = '';
    setDigits(next);
    inputRefs.current[idx]?.focus();
  }

  const pinValue = digits.join('');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-7 shadow-2xl shadow-black/50">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-white">
            MongoDB Cardholder Vault
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter the 4-digit access PIN to view connected user and card data.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPin(pinValue);
          }}
          className="mt-6 space-y-5"
        >
          <div className="flex items-center justify-center gap-3">
            {digits.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => {
                  inputRefs.current[idx] = el;
                }}
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={4}
                autoFocus={idx === 0}
                autoComplete="one-time-code"
                aria-label={`PIN digit ${idx + 1}`}
                value={digit}
                disabled={submitting}
                onChange={(e) => handleDigitChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                className="h-14 w-14 rounded-xl border border-slate-700 bg-slate-950 text-center font-mono text-2xl font-bold text-white shadow-inner focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
              />
            ))}
          </div>

          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => setShowPin((s) => !s)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              {showPin ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span>{showPin ? 'Hide PIN' : 'Show PIN'}</span>
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-950/40 px-3.5 py-2.5 text-center text-xs font-medium text-red-300">
              {error}
            </div>
          )}

          {/* Numeric Keypad */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
              <button
                key={n}
                type="button"
                disabled={submitting}
                onClick={() => handleKeypadPress(n)}
                className="rounded-xl border border-slate-800 bg-slate-950/80 py-3 font-mono text-base font-semibold text-slate-200 transition hover:border-slate-700 hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setDigits(['', '', '', '']);
                setError(null);
                inputRefs.current[0]?.focus();
              }}
              className="rounded-xl border border-slate-800 bg-slate-950/60 py-3 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleKeypadPress('0')}
              className="rounded-xl border border-slate-800 bg-slate-950/80 py-3 font-mono text-base font-semibold text-slate-200 transition hover:border-slate-700 hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              0
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleKeypadBackspace}
              aria-label="Backspace"
              className="flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950/60 py-3 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
            >
              <Delete className="h-4 w-4" />
            </button>
          </div>

          <button
            type="submit"
            disabled={pinValue.length < 4 || submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>{submitting ? 'Verifying PIN...' : 'Unlock Dashboard'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

