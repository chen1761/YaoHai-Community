import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { hashPassword, verifyPassword } from './auth.js';

export const BUSINESS_COLLECTIONS = Object.freeze([
  'settings', 'products', 'inquiries', 'customers', 'reminders', 'audit_logs',
]);

const EXPORTABLE_SETTING_KEYS = new Set([
  'theme', 'locale', 'onboardingCompleted', 'provider', 'model', 'baseUrl', 'site_name',
]);
const EXPORTABLE_FIELDS = Object.freeze({
  products: ['id', 'name', 'description', 'price', 'currency', 'category', 'imageUrl', 'active'],
  inquiries: ['id', 'customerId', 'subject', 'message', 'status', 'createdAt'],
  customers: ['id', 'name', 'email', 'phone', 'address', 'notes'],
  reminders: ['id', 'title', 'description', 'dueAt', 'completed'],
  audit_logs: ['action', 'created_at', 'actor'],
});
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function createStore(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (row_id INTEGER PRIMARY KEY, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inquiries (row_id INTEGER PRIMARY KEY, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customers (row_id INTEGER PRIMARY KEY, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reminders (row_id INTEGER PRIMARY KEY, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_logs (row_id INTEGER PRIMARY KEY, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS local_users (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_sessions (
      id_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
  `);

  const store = {
    setInternalSetting(key, value) {
      database.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json').run(key, JSON.stringify(value));
    },
    getInternalSetting(key) {
      const row = database.prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
      return row ? JSON.parse(row.value_json) : undefined;
    },
    getPublicProviderConfig() {
      const value = this.getInternalSetting('ai_provider_config');
      if (!value) return { provider: null, model: null, baseUrl: null, configured: false, maskedKey: null };
      return { provider: value.provider, model: value.model, baseUrl: value.baseUrl, configured: true, maskedKey: '********' };
    },
    async createOwner(username, password) {
      if (typeof username !== 'string' || username.trim() === '') {
        throw new TypeError('Username is required');
      }
      if (database.prepare('SELECT 1 FROM local_users LIMIT 1').get()) return false;
      const passwordHash = await hashPassword(password);
      try {
        database.prepare(
          'INSERT INTO local_users (id, username, password_hash) VALUES (1, ?, ?)',
        ).run(username.trim(), passwordHash);
        return true;
      } catch (error) {
        if (error.code === 'ERR_SQLITE_ERROR') return false;
        throw error;
      }
    },

    async authenticate(username, password) {
      const user = typeof username === 'string'
        ? database.prepare('SELECT password_hash FROM local_users WHERE username = ?').get(username)
        : undefined;
      const fallback = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);
      const valid = await verifyPassword(password, user?.password_hash ?? fallback);
      if (!user || !valid) return null;

      const sessionId = randomBytes(32).toString('hex');
      const expiresAt = Date.now() + SESSION_TTL_MS;
      database.prepare('DELETE FROM local_sessions WHERE expires_at <= ?').run(Date.now());
      database.prepare('INSERT INTO local_sessions (id_hash, expires_at) VALUES (?, ?)')
        .run(hashSessionId(sessionId), expiresAt);
      return { sessionId, expiresAt };
    },

    isSessionValid(sessionId) {
      if (!/^[0-9a-f]{64}$/.test(sessionId ?? '')) return false;
      const row = database.prepare(
        'SELECT expires_at FROM local_sessions WHERE id_hash = ?',
      ).get(hashSessionId(sessionId));
      return Boolean(row && row.expires_at > Date.now());
    },

    revokeSession(sessionId) {
      if (/^[0-9a-f]{64}$/.test(sessionId ?? '')) {
        database.prepare('DELETE FROM local_sessions WHERE id_hash = ?')
          .run(hashSessionId(sessionId));
      }
    },

    exportBusinessData() {
      return Object.fromEntries(BUSINESS_COLLECTIONS.map((collection) => [
        collection,
        readCollection(database, collection).flatMap((record) => projectForExport(collection, record)),
      ]));
    },

    replaceBusinessData(data) {
      validateBackup(data);
      inTransaction(database, () => replaceCollections(database, data));
    },

    restoreBusinessData(data) {
      validateBackup(data);
      inTransaction(database, () => {
        replaceCollections(database, data);
        insertRecord(database, 'audit_logs', {
          action: 'backup_restored',
          created_at: new Date().toISOString(),
        });
      });
    },

    close() {
      database.close();
    },
  };

  return store;
}

function hashSessionId(sessionId) {
  return createHash('sha256').update(sessionId).digest('hex');
}

function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Backup must be an object');
  }
  const keys = Object.keys(data);
  const unknown = keys.filter((key) => !BUSINESS_COLLECTIONS.includes(key));
  const missing = BUSINESS_COLLECTIONS.filter((key) => !keys.includes(key));
  if (unknown.length) throw new TypeError(`Unknown backup collection: ${unknown[0]}`);
  if (missing.length) throw new TypeError(`Missing backup collection: ${missing[0]}`);
  for (const collection of BUSINESS_COLLECTIONS) {
    if (!Array.isArray(data[collection])) {
      throw new TypeError(`Backup collection must be an array: ${collection}`);
    }
    for (const record of data[collection]) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new TypeError(`Invalid record in collection: ${collection}`);
      }
    }
  }
}

function readCollection(database, collection) {
  if (collection === 'settings') {
    return database.prepare('SELECT key, value_json FROM settings ORDER BY key').all()
      .map(({ key, value_json: valueJson }) => ({ key, value: JSON.parse(valueJson) }));
  }
  return database.prepare(`SELECT data_json FROM ${collection} ORDER BY row_id`).all()
    .map(({ data_json: dataJson }) => JSON.parse(dataJson));
}

function projectForExport(collection, record) {
  if (collection === 'settings') {
    if (!EXPORTABLE_SETTING_KEYS.has(record.key) || !isScalar(record.value)) return [];
    return [{ key: record.key, value: record.value }];
  }

  const fields = EXPORTABLE_FIELDS[collection];
  return [Object.fromEntries(fields.flatMap((field) => {
    if (!Object.hasOwn(record, field)) return [];
    const value = sanitizeExportValue(record[field]);
    return value === undefined ? [] : [[field, value]];
  }))];
}

function isScalar(value) {
  return value === null || ['string', 'boolean', 'number'].includes(typeof value);
}

function sanitizeExportValue(value) {
  if (isScalar(value)) return value;
  if (Array.isArray(value)) {
    return value.every(isScalar) ? value : undefined;
  }
  if (value && typeof value === 'object') {
    // Inspect nested keys before rejecting the whole complex field.
    if (containsSensitiveKey(value)) return undefined;
    return undefined;
  }
  return undefined;
}

function containsSensitiveKey(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nestedValue]) => {
    const normalizedKey = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
    return /^(?:apikey|encrypted|credential|password|session|token|secret)/.test(normalizedKey)
      || containsSensitiveKey(nestedValue);
  });
}

function replaceCollections(database, data) {
  for (const collection of BUSINESS_COLLECTIONS) {
    database.exec(`DELETE FROM ${collection}`);
    for (const record of data[collection]) insertRecord(database, collection, record);
  }
}

function insertRecord(database, collection, record) {
  if (collection === 'settings') {
    if (typeof record.key !== 'string' || record.key === '') {
      throw new TypeError('Setting key is required');
    }
    database.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)')
      .run(record.key, JSON.stringify(record.value));
    return;
  }
  database.prepare(`INSERT INTO ${collection} (data_json) VALUES (?)`).run(JSON.stringify(record));
}

function inTransaction(database, action) {
  database.exec('BEGIN IMMEDIATE');
  try {
    action();
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
