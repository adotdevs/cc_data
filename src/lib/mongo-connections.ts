import { MongoClient, ObjectId, type Document, type Filter } from 'mongodb';
import {
  extractCardsFromUser,
  serializeMongoValue,
  type ConnectionStatusInfo,
  type UserSearchRecord,
} from './card-utils';
import { maskMongoUriHost, readCustomConnections } from './connection-store';

export interface ConfiguredConnection {
  key: string;
  label: string;
  uri: string;
  source: 'env' | 'custom';
  maskedHost: string;
}

const FRIENDLY_LABELS: Record<string, string> = {
  MONGODB_URI_BLOCKVAULT_CRM: 'blockvault-crm',
  MONGODB_URI_BLOCKVAULT: 'blockvault',
  MONGODB_URI_SAFELEDGER: 'safeledger',
  MONGODB_URI_CALLMATRIX_CRM: 'callmatrixCrm',
  MONGODB_URI_AICALZ_CRM: 'aicalzCrm',
  MONGODB_URI_BETABASE: 'betabase',
  MONGODB_URI_LOCALDB: 'localdb',
  MONGODB_URI_FINTCX: 'fintcx',
  MONGODB_URI_SANTANDER_CUSTODIA: 'SantanderCustodia',
  MONGODB_URI_CALLMINDTECH_CRM: 'callMindTechCrm',
  MONGODB_URI_BETABASE_CRM: 'betabasecrm',
  MONGODB_URI_PRAGROUPLTD: 'pragroupltd',
  MONGODB_URI_VOCALEDGE_CRM: 'vocaledgecrm',
  MONGODB_URI_CBPAYM_PUS6Y: 'cluster0.pus6y.mongodb.net',
};

const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);
const USER_COLLECTION_PATTERN = /user/i;
const EXCLUDED_USER_COLLECTIONS = new Set([
  'usercoins',
  'usercoin',
  'userrestrictions',
  'userrestriction',
]);

interface CachedClientEntry {
  promise: Promise<MongoClient>;
  failedAt?: number;
}

const globalForMongo = globalThis as typeof globalThis & {
  __ccDataMongoPool?: Map<string, CachedClientEntry>;
};

function getClientPool(): Map<string, CachedClientEntry> {
  if (!globalForMongo.__ccDataMongoPool) {
    globalForMongo.__ccDataMongoPool = new Map();
  }
  return globalForMongo.__ccDataMongoPool;
}

export function getConfiguredConnections(): ConfiguredConnection[] {
  const seenUris = new Set<string>();
  const connections: ConfiguredConnection[] = [];

  for (const [key, rawValue] of Object.entries(process.env)) {
    if (!key.startsWith('MONGODB_URI_')) continue;
    const uri = rawValue?.trim();
    if (!uri || seenUris.has(uri)) continue;
    seenUris.add(uri);

    const label =
      FRIENDLY_LABELS[key] ??
      key
        .replace(/^MONGODB_URI_/, '')
        .toLowerCase()
        .replace(/_/g, '-');

    connections.push({
      key,
      label,
      uri,
      source: 'env',
      maskedHost: maskMongoUriHost(uri),
    });
  }

  for (const custom of readCustomConnections()) {
    const uri = custom.uri.trim();
    if (!uri || seenUris.has(uri)) continue;
    seenUris.add(uri);
    connections.push({
      key: custom.key,
      label: custom.label,
      uri,
      source: 'custom',
      maskedHost: maskMongoUriHost(uri),
    });
  }

  return connections.sort((a, b) => a.label.localeCompare(b.label));
}

export async function removeCachedClient(key: string): Promise<void> {
  const pool = getClientPool();
  const existing = pool.get(key);
  if (!existing) return;
  pool.delete(key);
  try {
    const client = await existing.promise;
    await client.close();
  } catch {
    // ignore errors from failed client
  }
}

export async function testMongoConnection(uri: string): Promise<{
  ok: boolean;
  latencyMs: number;
  databases: string[];
  totalUsers: number;
  cardUsers: number;
  error?: string;
}> {
  const started = Date.now();
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 8000,
    maxPoolSize: 2,
  });

  try {
    await client.connect();
    const databases = await listAccessibleDatabases(client);
    const cardFilter = buildCardNumberFilter();
    let totalUsers = 0;
    let cardUsers = 0;

    await Promise.all(
      databases.map(async (dbName) => {
        const db = client.db(dbName);
        const collections = await db.listCollections().toArray();
        const userCols = collections
          .map((c) => c.name)
          .filter(
            (name) =>
              USER_COLLECTION_PATTERN.test(name) &&
              !EXCLUDED_USER_COLLECTIONS.has(name.toLowerCase())
          );

        await Promise.all(
          userCols.map(async (colName) => {
            const col = db.collection(colName);
            const [totalCount, cardCount] = await Promise.all([
              col.estimatedDocumentCount(),
              col.countDocuments(cardFilter),
            ]);
            totalUsers += totalCount;
            cardUsers += cardCount;
          })
        );
      })
    );

    return {
      ok: true,
      latencyMs: Date.now() - started,
      databases,
      totalUsers,
      cardUsers,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      databases: [],
      totalUsers: 0,
      cardUsers: 0,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  } finally {
    await client.close().catch(() => {});
  }
}

async function getConnectedClient(conn: ConfiguredConnection): Promise<MongoClient> {
  const pool = getClientPool();
  const existing = pool.get(conn.key);
  const now = Date.now();

  if (existing && (!existing.failedAt || now - existing.failedAt < 15_000)) {
    return existing.promise;
  }

  const client = new MongoClient(conn.uri, {
    serverSelectionTimeoutMS: 4500,
    connectTimeoutMS: 4500,
    socketTimeoutMS: 8000,
    maxPoolSize: 5,
  });

  const entry: CachedClientEntry = {
    promise: client.connect().catch((err) => {
      entry.failedAt = Date.now();
      throw err;
    }),
  };

  pool.set(conn.key, entry);
  return entry.promise;
}

async function listAccessibleDatabases(client: MongoClient): Promise<string[]> {
  try {
    const { databases } = await client.db().admin().listDatabases();
    return databases
      .map((d) => d.name)
      .filter((name) => !SYSTEM_DATABASES.has(name));
  } catch {
    const defaultDb = client.db().databaseName;
    return defaultDb && !SYSTEM_DATABASES.has(defaultDb) ? [defaultDb] : [];
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildCardNumberFilter(): Filter<Document> {
  return {
    $or: [
      { cardNumber: { $exists: true, $nin: [null, ''] } },
      { 'card.cardNumber': { $exists: true, $nin: [null, ''] } },
      { 'card.number': { $exists: true, $nin: [null, ''] } },
      { 'cards.cardNumber': { $exists: true, $nin: [null, ''] } },
      { 'cards.number': { $exists: true, $nin: [null, ''] } },
      { 'cryptoCard.cardNumber': { $exists: true, $nin: [null, ''] } },
      { 'cryptoCard.number': { $exists: true, $nin: [null, ''] } },
      { 'payments.cardNumber': { $exists: true, $nin: [null, ''] } },
      { 'payments.card.cardNumber': { $exists: true, $nin: [null, ''] } },
      { 'payments.card.number': { $exists: true, $nin: [null, ''] } },
    ],
  };
}

export function buildUserQueryFilter(searchText: string, onlyWithCard: boolean): Filter<Document> {
  const clauses: Filter<Document>[] = [];

  if (onlyWithCard) {
    clauses.push(buildCardNumberFilter());
  }

  const trimmed = searchText.trim();
  if (trimmed.length > 0) {
    const escaped = escapeRegex(trimmed);
    const regex = { $regex: escaped, $options: 'i' };
    const orFields: Filter<Document>[] = [
      { firstName: regex },
      { lastName: regex },
      { name: regex },
      { email: regex },
      { phone: regex },
      { country: regex },
      { city: regex },
      { address: regex },
      { postalCode: regex },
      { note: regex },
      { referralCode: regex },
      { cardNumber: regex },
      { 'card.cardNumber': regex },
      { 'cards.cardNumber': regex },
      { 'cryptoCard.cardNumber': regex },
      { 'payments.cardNumber': regex },
      { 'payments.card.cardNumber': regex },
      { 'payments.card.cardName': regex },
      { 'payments.card.cardCategory': regex },
      {
        $expr: {
          $regexMatch: {
            input: {
              $cond: [
                { $in: [{ $type: '$phone' }, ['string', 'int', 'long', 'double', 'decimal']] },
                { $toString: '$phone' },
                '',
              ],
            },
            regex: escaped,
            options: 'i',
          },
        },
      },
    ];

    // Also allow searching full name like "John Doe" across firstName + lastName
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      orFields.push({
        $and: [
          { firstName: { $regex: escapeRegex(parts[0]), $options: 'i' } },
          { lastName: { $regex: escapeRegex(parts.slice(1).join(' ')), $options: 'i' } },
        ],
      });
    }

    // Allow stripped-space card number search (e.g. searching "41112222" against "4111 2222 ...")
    const digitsOnly = trimmed.replace(/\s+/g, '');
    if (/^\d{3,}$/.test(digitsOnly) && digitsOnly !== trimmed) {
      const spacedPattern = digitsOnly.split('').join('\\s*');
      const cardRegex = { $regex: spacedPattern, $options: 'i' };
      orFields.push(
        { cardNumber: cardRegex },
        { 'card.cardNumber': cardRegex },
        { 'cards.cardNumber': cardRegex },
        { 'cryptoCard.cardNumber': cardRegex },
        { 'payments.card.cardNumber': cardRegex }
      );
    }

    if (ObjectId.isValid(trimmed)) {
      orFields.push({ _id: new ObjectId(trimmed) });
    }

    clauses.push({ $or: orFields });
  }

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

export interface SearchAcrossConnectionsParams {
  query?: string;
  connectionKey?: string;
  onlyWithCard?: boolean;
  limitPerCollection?: number;
}

export interface SearchAcrossConnectionsResult {
  connections: ConnectionStatusInfo[];
  users: UserSearchRecord[];
  meta: {
    totalMatched: number;
    totalCardHolders: number;
    onlineConnections: number;
    totalConnections: number;
    queriedAt: string;
  };
}

export async function searchUsersAcrossConnections({
  query = '',
  connectionKey = 'all',
  onlyWithCard = true,
  limitPerCollection = 60,
}: SearchAcrossConnectionsParams): Promise<SearchAcrossConnectionsResult> {
  const configured = getConfiguredConnections();
  const cardFilter = buildCardNumberFilter();
  const userFilter = buildUserQueryFilter(query, onlyWithCard);

  const perConnectionResults = await Promise.all(
    configured.map(async (conn): Promise<{
      status: ConnectionStatusInfo;
      records: UserSearchRecord[];
    }> => {
      const started = Date.now();
      const status: ConnectionStatusInfo = {
        key: conn.key,
        label: conn.label,
        source: conn.source,
        maskedHost: conn.maskedHost,
        connected: false,
        latencyMs: 0,
        databases: [],
        totalUsers: 0,
        cardUsers: 0,
      };
      const records: UserSearchRecord[] = [];

      try {
        const client = await getConnectedClient(conn);
        const dbNames = await listAccessibleDatabases(client);
        status.connected = true;
        status.databases = dbNames;

        const shouldCollectRecords =
          connectionKey === 'all' || connectionKey === conn.key;

        await Promise.all(
          dbNames.map(async (dbName) => {
            const db = client.db(dbName);
            const collections = await db.listCollections().toArray();
            const userCols = collections
              .map((c) => c.name)
              .filter(
                (name) =>
                  USER_COLLECTION_PATTERN.test(name) &&
                  !EXCLUDED_USER_COLLECTIONS.has(name.toLowerCase())
              );

            await Promise.all(
              userCols.map(async (colName) => {
                const col = db.collection(colName);
                const [totalCount, cardCount, docs] = await Promise.all([
                  col.estimatedDocumentCount(),
                  col.countDocuments(cardFilter),
                  shouldCollectRecords
                    ? col
                        .find(userFilter)
                        .sort({ createdAt: -1, _id: -1 })
                        .limit(limitPerCollection)
                        .toArray()
                    : Promise.resolve([]),
                ]);

                status.totalUsers += totalCount;
                status.cardUsers += cardCount;

                for (const rawDoc of docs) {
                  const serialized = serializeMongoValue(rawDoc) as Record<string, unknown>;
                  const cards = extractCardsFromUser(serialized);
                  if (onlyWithCard && cards.length === 0) continue;

                  records.push({
                    uid: `${conn.key}:${dbName}.${colName}:${String(serialized._id ?? Math.random())}`,
                    connectionKey: conn.key,
                    connectionLabel: conn.label,
                    database: dbName,
                    collection: colName,
                    hasCardNumber: cards.length > 0,
                    cards,
                    data: serialized,
                  });
                }
              })
            );
          })
        );
      } catch (err) {
        status.connected = false;
        status.error = err instanceof Error ? err.message : 'Connection failed';
      } finally {
        status.latencyMs = Date.now() - started;
      }

      return { status, records };
    })
  );

  const connections = perConnectionResults.map((r) => r.status);
  const users = perConnectionResults.flatMap((r) => r.records);

  // Sort cardholders first, then newest createdAt
  users.sort((a, b) => {
    if (a.hasCardNumber !== b.hasCardNumber) {
      return a.hasCardNumber ? -1 : 1;
    }
    const aTime = typeof a.data.createdAt === 'string' ? Date.parse(a.data.createdAt) : 0;
    const bTime = typeof b.data.createdAt === 'string' ? Date.parse(b.data.createdAt) : 0;
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });

  return {
    connections,
    users,
    meta: {
      totalMatched: users.length,
      totalCardHolders: users.filter((u) => u.hasCardNumber).length,
      onlineConnections: connections.filter((c) => c.connected).length,
      totalConnections: connections.length,
      queriedAt: new Date().toISOString(),
    },
  };
}

