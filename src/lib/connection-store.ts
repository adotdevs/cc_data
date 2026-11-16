import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface StoredCustomConnection {
  key: string;
  label: string;
  uri: string;
  createdAt: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'custom-connections.json');

export function validateMongoUri(rawUri: string): { valid: boolean; uri: string; error?: string } {
  const uri = rawUri.trim();
  if (!uri) {
    return { valid: false, uri, error: 'Connection string is required.' };
  }
  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    return {
      valid: false,
      uri,
      error: 'Connection string must start with mongodb:// or mongodb+srv://',
    };
  }
  // Verify there is a host segment after protocol (and optional credentials@)
  const afterProtocol = uri.replace(/^mongodb(\+srv)?:\/\//i, '');
  const hostAndPath = afterProtocol.includes('@')
    ? afterProtocol.slice(afterProtocol.lastIndexOf('@') + 1)
    : afterProtocol;
  const hostPart = hostAndPath.split('/')[0]?.split('?')[0]?.trim();
  if (!hostPart) {
    return { valid: false, uri, error: 'Missing cluster host in MongoDB URI.' };
  }
  return { valid: true, uri };
}

export function maskMongoUriHost(uri: string): string {
  const afterProtocol = uri.replace(/^mongodb(\+srv)?:\/\//i, '');
  const hostAndPath = afterProtocol.includes('@')
    ? afterProtocol.slice(afterProtocol.lastIndexOf('@') + 1)
    : afterProtocol;
  return hostAndPath.split('?')[0] || 'mongodb';
}

export function deriveLabelFromUri(uri: string): string {
  const masked = maskMongoUriHost(uri);
  const [hostPart, dbPart] = masked.split('/');
  const cleanHost = hostPart.split(',')[0]?.split(':')[0] || 'mongo';
  if (dbPart && !['admin', 'test', 'local'].includes(dbPart.toLowerCase())) {
    return `${dbPart} (${cleanHost})`;
  }
  return cleanHost;
}

export function readCustomConnections(): StoredCustomConnection[] {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredCustomConnection =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as StoredCustomConnection).key === 'string' &&
        typeof (item as StoredCustomConnection).label === 'string' &&
        typeof (item as StoredCustomConnection).uri === 'string'
    );
  } catch {
    return [];
  }
}

export function writeCustomConnections(items: StoredCustomConnection[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(items, null, 2), 'utf8');
}

export function createCustomConnectionEntry(labelInput: string | undefined, uri: string): StoredCustomConnection {
  const trimmedLabel = labelInput?.trim();
  const label = trimmedLabel || deriveLabelFromUri(uri);
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  const key = `CUSTOM_URI_${slug || 'db'}_${randomUUID().slice(0, 8)}`;

  return {
    key,
    label,
    uri,
    createdAt: new Date().toISOString(),
  };
}

