'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  value: string;
  label?: string;
  copiedLabel?: string;
  variant?: 'primary' | 'secondary' | 'subtle' | 'icon';
  className?: string;
  title?: string;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  variant = 'secondary',
  className = '',
  title,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!value) return;
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  }

  const baseStyles =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50';

  const variantStyles: Record<NonNullable<CopyButtonProps['variant']>, string> = {
    primary: copied
      ? 'bg-emerald-500 text-slate-950 px-3 py-1.5 text-xs shadow-sm'
      : 'bg-emerald-500/90 hover:bg-emerald-400 text-slate-950 px-3 py-1.5 text-xs shadow-sm',
    secondary: copied
      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2.5 py-1.5 text-xs'
      : 'bg-slate-800/80 hover:bg-slate-700/90 text-slate-200 border border-slate-700 px-2.5 py-1.5 text-xs',
    subtle: copied
      ? 'bg-emerald-500/20 text-emerald-300 px-2 py-1 text-xs'
      : 'bg-white/10 hover:bg-white/20 text-slate-200 px-2 py-1 text-xs',
    icon: copied
      ? 'text-emerald-400 bg-emerald-500/15 p-1.5'
      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800 p-1.5',
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title ?? (copied ? copiedLabel : `Copy ${label}`)}
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0" />
      )}
      {variant !== 'icon' && <span>{copied ? copiedLabel : label}</span>}
    </button>
  );
}

