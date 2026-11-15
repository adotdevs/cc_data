export interface ExtractedCard {
  sourcePath: string;
  cardNumber: string;
  cardName?: string;
  cardCategory?: string;
  cardExpiry?: string;
  cardCvv?: string;
  cardNotes?: string;
  createdAt?: string;
}

export interface UserSearchRecord {
  uid: string;
  connectionKey: string;
  connectionLabel: string;
  database: string;
  collection: string;
  hasCardNumber: boolean;
  cards: ExtractedCard[];
  data: Record<string, unknown>;
}

export interface ConnectionStatusInfo {
  key: string;
  label: string;
  connected: boolean;
  error?: string;
  latencyMs: number;
  databases: string[];
  totalUsers: number;
  cardUsers: number;
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function toCardString(val: unknown): string | undefined {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    return String(val);
  }
  return undefined;
}

export function serializeMongoValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeMongoValue(item));
  }

  if (typeof value === 'object') {
    const maybeBson = value as {
      _bsontype?: string;
      toHexString?: () => string;
      toString?: () => string;
    };

    if (maybeBson._bsontype === 'ObjectId' && typeof maybeBson.toHexString === 'function') {
      return maybeBson.toHexString();
    }
    if (
      maybeBson._bsontype &&
      typeof maybeBson.toString === 'function' &&
      maybeBson._bsontype !== 'Object'
    ) {
      return maybeBson.toString();
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeMongoValue(v);
    }
    return out;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return value;
}

function extractFromCardObject(
  obj: Record<string, unknown>,
  sourcePath: string
): ExtractedCard | null {
  const num =
    toCardString(obj.cardNumber) ??
    toCardString(obj.number) ??
    toCardString(obj.pan);

  if (!num) return null;

  return {
    sourcePath,
    cardNumber: num,
    cardName: toCardString(obj.cardName) ?? toCardString(obj.holderName) ?? toCardString(obj.name),
    cardCategory: toCardString(obj.cardCategory) ?? toCardString(obj.brand) ?? toCardString(obj.type),
    cardExpiry: toCardString(obj.cardExpiry) ?? toCardString(obj.expiry) ?? toCardString(obj.exp),
    cardCvv: toCardString(obj.cardCvv) ?? toCardString(obj.cvv) ?? toCardString(obj.cvc),
    cardNotes: toCardString(obj.cardNotes) ?? toCardString(obj.notes),
    createdAt: toCardString(obj.createdAt),
  };
}

export function extractCardsFromUser(doc: Record<string, unknown>): ExtractedCard[] {
  const cards: ExtractedCard[] = [];
  const seen = new Set<string>();

  const pushCard = (card: ExtractedCard | null) => {
    if (!card) return;
    const dedupeKey = `${card.cardNumber}|${card.cardExpiry ?? ''}|${card.cardCvv ?? ''}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      cards.push(card);
    }
  };

  // 1. Top-level cardNumber
  pushCard(extractFromCardObject(doc, 'root'));

  // 2. doc.card
  if (doc.card && typeof doc.card === 'object' && !Array.isArray(doc.card)) {
    pushCard(extractFromCardObject(doc.card as Record<string, unknown>, 'card'));
  }

  // 3. doc.cryptoCard
  if (doc.cryptoCard && typeof doc.cryptoCard === 'object' && !Array.isArray(doc.cryptoCard)) {
    pushCard(extractFromCardObject(doc.cryptoCard as Record<string, unknown>, 'cryptoCard'));
  }

  // 4. doc.cards[]
  if (Array.isArray(doc.cards)) {
    doc.cards.forEach((item, idx) => {
      if (item && typeof item === 'object') {
        pushCard(extractFromCardObject(item as Record<string, unknown>, `cards[${idx}]`));
      }
    });
  }

  // 5. doc.payments[].card or doc.payments[]
  if (Array.isArray(doc.payments)) {
    doc.payments.forEach((payment, idx) => {
      if (!payment || typeof payment !== 'object') return;
      const p = payment as Record<string, unknown>;
      if (p.card && typeof p.card === 'object') {
        pushCard(extractFromCardObject(p.card as Record<string, unknown>, `payments[${idx}].card`));
      }
      pushCard(extractFromCardObject(p, `payments[${idx}]`));
    });
  }

  return cards;
}

export type CardValidityFilter = 'valid' | 'all' | 'expired';

export function parseCardExpiry(cardExpiry?: string): { month: number; year: number } | null {
  if (!cardExpiry) return null;
  const trimmed = cardExpiry.trim();

  // MM/YY, M/YY, MM/YYYY, MM-YY, MM-YYYY
  let m = trimmed.match(/^(\d{1,2})\s*[\/\-]\s*(\d{2}|\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    let year = Number(m[2]);
    if (m[2].length === 2) year += 2000;
    if (month >= 1 && month <= 12 && year >= 2000 && year <= 2199) {
      return { month, year };
    }
    return null;
  }

  // YYYY-MM or YYYY/MM
  m = trimmed.match(/^(\d{4})\s*[\/\-]\s*(\d{1,2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month >= 1 && month <= 12 && year >= 2000 && year <= 2199) {
      return { month, year };
    }
  }

  return null;
}

export function getCardExpiryStatus(
  cardExpiry?: string,
  now = new Date()
): 'valid' | 'expired' | 'unknown' {
  const parsed = parseCardExpiry(cardExpiry);
  if (!parsed) return 'unknown';

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (parsed.year < currentYear) return 'expired';
  if (parsed.year === currentYear && parsed.month < currentMonth) return 'expired';
  return 'valid';
}

export function isCardComplete(card: ExtractedCard): boolean {
  const digits = card.cardNumber.replace(/\D/g, '');
  return (
    digits.length >= 8 &&
    Boolean(card.cardExpiry && card.cardExpiry.trim().length > 0) &&
    Boolean(card.cardCvv && card.cardCvv.trim().length > 0)
  );
}

export function formatCardNumberDisplay(raw: string): string {
  const compact = raw.replace(/\s+/g, '');
  if (/^\d{12,19}$/.test(compact)) {
    return compact.replace(/(.{4})/g, '$1 ').trim();
  }
  return raw;
}

export function getDisplayName(data: Record<string, unknown>): string {
  const first = isNonEmptyString(data.firstName) ? data.firstName.trim() : '';
  const last = isNonEmptyString(data.lastName) ? data.lastName.trim() : '';
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  if (isNonEmptyString(data.name)) return data.name.trim();
  if (isNonEmptyString(data.email)) return data.email.trim();
  return String(data._id ?? 'Unknown User');
}

export function formatUserSummaryText(
  record: UserSearchRecord,
  cardsOverride?: ExtractedCard[]
): string {
  const d = record.data;
  const activeCards = cardsOverride ?? record.cards;
  const lines: string[] = [
    `Source: ${record.connectionLabel} (${record.database}.${record.collection})`,
    `User ID: ${String(d._id ?? '')}`,
    `Name: ${getDisplayName(d)}`,
  ];

  if (d.email) lines.push(`Email: ${String(d.email)}`);
  if (d.phone !== undefined && d.phone !== null && d.phone !== '') lines.push(`Phone: ${String(d.phone)}`);

  const addressParts = [d.address, d.city, d.postalCode, d.country]
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
    .map((v) => String(v).trim());
  if (addressParts.length > 0) {
    lines.push(`Address: ${addressParts.join(', ')}`);
  }

  if (activeCards.length > 0) {
    lines.push('');
    lines.push(`Cards (${activeCards.length}):`);
    activeCards.forEach((c, idx) => {
      lines.push(`  Card #${idx + 1} [${c.sourcePath}]`);
      if (c.cardCategory) lines.push(`    Category: ${c.cardCategory}`);
      if (c.cardName) lines.push(`    Card Name: ${c.cardName}`);
      lines.push(`    Card Number: ${c.cardNumber}`);
      if (c.cardExpiry) lines.push(`    Expiry: ${c.cardExpiry}`);
      if (c.cardCvv) lines.push(`    CVV: ${c.cardCvv}`);
      if (c.cardNotes) lines.push(`    Notes: ${c.cardNotes}`);
    });
  }

  return lines.join('\n');
}

