import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoClient } from 'mongodb';

export interface StoredCustomConnection {
  key: string;
  label: string;
  uri: string;
  createdAt: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const LOCAL_STORE_PATH = path.join(DATA_DIR, 'custom-connections.json');
const TMP_STORE_PATH = path.join(os.tmpdir(), 'cc-data-custom-connections.json');
const STORAGE_DB_NAME = 'cc_dashboard_config';
const STORAGE_COLLECTION_NAME = 'custom_connections';

let cachedLocalWritable: boolean | null = null;

function isServerlessOrReadOnly(): boolean {
  if (process.env.MONGODB_URI_STORAGE?.trim()) return true;
  if (process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME) return true;
  if (cachedLocalWritable !== null) return !cachedLocalWritable;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    cachedLocalWritable = true;
    return false;
  } catch {
    cachedLocalWritable = false;
    return true;
  }
}

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

export function createCustomConnectionEntry(
  labelInput: string | undefined,
  uri: string
): StoredCustomConnection {
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

function readJsonFile(filePath: string): StoredCustomConnection[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
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

function writeJsonFile(filePath: string, items: StoredCustomConnection[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf8');
}

function getStorageCandidateUris(): string[] {
  const candidates: string[] = [];
  const dedicated = process.env.MONGODB_URI_STORAGE?.trim();
  if (dedicated) candidates.push(dedicated);

  for (const [key, rawValue] of Object.entries(process.env)) {
    if (!key.startsWith('MONGODB_URI_') || key === 'MONGODB_URI_STORAGE') continue;
    const uri = rawValue?.trim();
    if (!uri) continue;
    if (uri.includes('localhost') || uri.includes('127.0.0.1')) continue;
    if (!candidates.includes(uri)) candidates.push(uri);
  }
  return candidates;
}

async function withMongoStorageCollection<T>(
  fn: (col: ReturnType<ReturnType<MongoClient['db']>['collection']>) => Promise<T>
): Promise<T | null> {
  const candidates = getStorageCandidateUris();
  for (const uri of candidates) {
    let client: MongoClient | null = null;
    try {
      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 3500,
        connectTimeoutMS: 3500,
        socketTimeoutMS: 6000,
        maxPoolSize: 2,
      });
      await client.connect();
      const col = client.db(STORAGE_DB_NAME).collection(STORAGE_COLLECTION_NAME);
      return await fn(col);
    } catch {
      // Try next reachable cluster
    } finally {
      if (client) await client.close().catch(() => {});
    }
  }
  return null;
}

export async function readCustomConnections(): Promise<StoredCustomConnection[]> {
  if (!isServerlessOrReadOnly()) {
    return readJsonFile(LOCAL_STORE_PATH);
  }

  const fromDb = await withMongoStorageCollection(async (col) => {
    const docs = await col.find({}).toArray();
    return docs
      .map((doc) => ({
        key: String(doc.key ?? ''),
        label: String(doc.label ?? ''),
        uri: String(doc.uri ?? ''),
        createdAt: String(doc.createdAt ?? ''),
      }))
      .filter((item) => item.key && item.label && item.uri);
  });

  if (fromDb !== null) {
    return fromDb;
  }

  return readJsonFile(TMP_STORE_PATH);
}

export async function addCustomConnection(
  entry: StoredCustomConnection
): Promise<{ storage: 'file' | 'mongodb' | 'tmp' }> {
  if (!isServerlessOrReadOnly()) {
    try {
      const list = readJsonFile(LOCAL_STORE_PATH);
      list.push(entry);
      writeJsonFile(LOCAL_STORE_PATH, list);
      return { storage: 'file' };
    } catch {
      cachedLocalWritable = false;
    }
  }

  const savedToDb = await withMongoStorageCollection(async (col) => {
    await col.insertOne({ ...entry });
    return true;
  });

  if (savedToDb) {
    return { storage: 'mongodb' };
  }

  const tmpList = readJsonFile(TMP_STORE_PATH);
  tmpList.push(entry);
  writeJsonFile(TMP_STORE_PATH, tmpList);
  return { storage: 'tmp' };
}

export async function removeCustomConnection(key: string): Promise<boolean> {
  if (!isServerlessOrReadOnly()) {
    try {
      const list = readJsonFile(LOCAL_STORE_PATH);
      const next = list.filter((c) => c.key !== key);
      if (next.length === list.length) return false;
      writeJsonFile(LOCAL_STORE_PATH, next);
      return true;
    } catch {
      cachedLocalWritable = false;
    }
  }

  const deletedFromDb = await withMongoStorageCollection(async (col) => {
    const res = await col.deleteOne({ key });
    return res.deletedCount > 0;
  });

  if (deletedFromDb !== null) {
    return deletedFromDb;
  }

  const tmpList = readJsonFile(TMP_STORE_PATH);
  const nextTmp = tmpList.filter((c) => c.key !== key);
  if (nextTmp.length === tmpList.length) return false;
  writeJsonFile(TMP_STORE_PATH, nextTmp);
  return true;
}
