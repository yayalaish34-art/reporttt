import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * The application database.
 *
 * SQLite via `node:sqlite`, which ships with Node — no native module to compile,
 * which matters because this runs on Windows workstations as often as on a
 * server.
 *
 * The connection is cached on `globalThis` so Next's dev-mode module reloading
 * does not open a new handle on every edit.
 */

const DB_PATH = process.env.REPORT_DB_PATH ?? resolve(process.cwd(), 'data/reports.db');

declare global {
  // eslint-disable-next-line no-var
  var __reportDb: DatabaseSync | undefined;
}

export function db(): DatabaseSync {
  if (globalThis.__reportDb) return globalThis.__reportDb;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  const handle = new DatabaseSync(DB_PATH);

  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA foreign_keys = ON');
  migrate(handle);

  globalThis.__reportDb = handle;

  /*
   * Said once, when the connection is first opened, so it lands in the deploy log.
   * A warning that only answers when /api/health is asked is a warning nobody reads
   * until they are already looking for the cause of lost photographs.
   */
  const durability = storageDurability();
  if (!durability.durable) console.error(`אזהרת אחסון: ${durability.warning}`);

  return handle;
}

/**
 * Creates the schema.
 *
 * Plain `CREATE TABLE IF NOT EXISTS` rather than a migration framework: the
 * schema is small and the deployment is single-tenant, so a version table would
 * be more machinery than the problem needs.
 */
function migrate(handle: DatabaseSync): void {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      bytes        BLOB    NOT NULL,
      size         INTEGER NOT NULL,
      sha256       TEXT    NOT NULL,
      note         TEXT    NOT NULL DEFAULT '',
      uploaded_at  TEXT    NOT NULL,
      is_active    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS customers (
      id            TEXT PRIMARY KEY,
      kind          TEXT NOT NULL CHECK (kind IN ('company', 'private')),
      contact_name  TEXT NOT NULL DEFAULT '',
      contact_title TEXT NOT NULL DEFAULT '',
      company_name  TEXT NOT NULL DEFAULT '',
      address_line  TEXT NOT NULL DEFAULT '',
      city          TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      email         TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signatures (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      bytes        BLOB NOT NULL,
      content_type TEXT NOT NULL,
      width        INTEGER NOT NULL,
      height       INTEGER NOT NULL,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id           TEXT PRIMARY KEY,
      reference    TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL DEFAULT '',
      data         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS photos (
      id           TEXT PRIMARY KEY,
      report_id    TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      bytes        BLOB NOT NULL,
      content_type TEXT NOT NULL,
      width        INTEGER NOT NULL,
      height       INTEGER NOT NULL,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS radon_reports (
      id           TEXT PRIMARY KEY,
      reference    TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL DEFAULT '',
      data         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asbestos_reports (
      id           TEXT PRIMARY KEY,
      reference    TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL DEFAULT '',
      data         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    /**
     * Photographs belonging to an asbestos opinion.
     *
     * A second table rather than reusing "photos", whose report_id is a foreign
     * key onto "reports" — an asbestos photo stored there would be rejected
     * outright, and dropping the constraint to make room for it would give up
     * the cascade that cleans up after a deleted radiation report.
     */
    CREATE TABLE IF NOT EXISTS asbestos_photos (
      id           TEXT PRIMARY KEY,
      report_id    TEXT NOT NULL REFERENCES asbestos_reports(id) ON DELETE CASCADE,
      bytes        BLOB NOT NULL,
      content_type TEXT NOT NULL,
      width        INTEGER NOT NULL,
      height       INTEGER NOT NULL,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mold_reports (
      id           TEXT PRIMARY KEY,
      reference    TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL DEFAULT '',
      data         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    /** Photographs belonging to a mould report — its own table, as for asbestos. */
    CREATE TABLE IF NOT EXISTS mold_photos (
      id           TEXT PRIMARY KEY,
      report_id    TEXT NOT NULL REFERENCES mold_reports(id) ON DELETE CASCADE,
      bytes        BLOB NOT NULL,
      content_type TEXT NOT NULL,
      width        INTEGER NOT NULL,
      height       INTEGER NOT NULL,
      created_at   TEXT NOT NULL
    );

    /**
     * Laboratory e-mails from Hayes already turned into a report, by message id.
     *
     * The CRM polls every mailbox with an overlapping window, and the same e-mail
     * reaches several mailboxes — so the same PDF arrives here many times. One row per
     * e-mail is what makes the second arrival a no-op instead of a second report.
     */
    CREATE TABLE IF NOT EXISTS mold_intake (
      message_id   TEXT PRIMARY KEY,
      report_id    TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    /**
     * Indoor-air-quality reports — the fifth department.
     *
     * Same five-column shape as the other four — one row per report, data as JSON.
     */
    CREATE TABLE IF NOT EXISTS iaq_reports (
      id           TEXT PRIMARY KEY,
      reference    TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL DEFAULT '',
      data         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    /** Photographs belonging to an IAQ report — its own table, as for the others. */
    CREATE TABLE IF NOT EXISTS iaq_photos (
      id           TEXT PRIMARY KEY,
      report_id    TEXT NOT NULL REFERENCES iaq_reports(id) ON DELETE CASCADE,
      bytes        BLOB NOT NULL,
      content_type TEXT NOT NULL,
      width        INTEGER NOT NULL,
      height       INTEGER NOT NULL,
      created_at   TEXT NOT NULL
    );

    /**
     * The licensed inspectors available to a radiation survey.
     *
     * A directory rather than fields typed per report: the same handful of people carry
     * out every survey the company issues, and their permit numbers and expiry dates are
     * copied off a licence — retyped per report they drift, and a wrong permit number on
     * a compliance document is the kind of error a regulator notices.
     *
     * One row per person per permit class, because a person licensed for both ELF and RF
     * holds two separate permits with two numbers and two expiry dates.
     */
    CREATE TABLE IF NOT EXISTS inspectors (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      title              TEXT NOT NULL DEFAULT 'בודק קרינה',
      permit_type        TEXT NOT NULL DEFAULT '',
      permit_number      TEXT NOT NULL DEFAULT '',
      permit_validity    TEXT NOT NULL DEFAULT '',
      signature_id       TEXT REFERENCES signatures(id) ON DELETE SET NULL,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_inspectors_name ON inspectors(name);
    CREATE INDEX IF NOT EXISTS idx_mold_photos_report ON mold_photos(report_id);
    CREATE INDEX IF NOT EXISTS idx_mold_updated ON mold_reports(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_iaq_photos_report ON iaq_photos(report_id);
    CREATE INDEX IF NOT EXISTS idx_iaq_updated ON iaq_reports(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asbestos_photos_report ON asbestos_photos(report_id);
    CREATE INDEX IF NOT EXISTS idx_photos_report ON photos(report_id);
    CREATE INDEX IF NOT EXISTS idx_reports_updated ON reports(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_radon_updated ON radon_reports(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asbestos_updated ON asbestos_reports(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_name);
    CREATE INDEX IF NOT EXISTS idx_customers_contact ON customers(contact_name);
    CREATE INDEX IF NOT EXISTS idx_signatures_label ON signatures(label);
  `);

  /**
   * Templates belong to a survey kind.
   *
   * Radon is a second report with its own Word template, and both have to be
   * active at once — activating one must not deactivate the other. Added as a
   * column rather than a second table so the upload, history and rollback code
   * stays one implementation.
   *
   * Everything already stored predates radon, so it is radiation.
   */
  const columns = handle.prepare(`PRAGMA table_info(templates)`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === 'kind')) {
    handle.exec(`ALTER TABLE templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'radiation'`);
    // The old index allowed exactly one active row in the whole table.
    handle.exec(`DROP INDEX IF EXISTS idx_templates_active`);
  }

  // One active template per kind, enforced in the index rather than in
  // application code so a concurrent write cannot produce two.
  handle.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_active_kind
       ON templates(kind, is_active) WHERE is_active = 1`,
  );
}

/** ISO timestamp, the single format used for every stored date. */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Whether what this app stores will survive a restart.
 *
 * Everything the app owns — the reports, the uploaded photographs, the active
 * templates, the signatures — lives in the one SQLite file at `DB_PATH`. On a
 * workstation that is the project directory and durable by definition. In a
 * container it is durable only if that path is a mounted volume, and if it is not
 * then every deploy silently starts from an empty database.
 *
 * That failure is invisible while the container is up, which is what makes it worth
 * reporting: reports save, photographs upload, thumbnails render. The damage shows up
 * only afterwards, and shows up *sideways* — the report still lists its photographs
 * and produces a document with none in it, because the captions live in the report's
 * own JSON and only the image bytes were lost. Somebody then asks why the radiation
 * report came out without pictures, and nothing anywhere says the database was reset.
 *
 * Heuristic rather than certain: there is no way to ask the filesystem whether a path
 * is a mounted volume. What can be told is whether this looks like a container that
 * was never given one — a known platform environment, with the database sitting
 * inside the application directory rather than at a path someone chose. That is
 * exactly the default configuration, and it is the one that loses data.
 */
export function storageDurability(): { path: string; durable: boolean; warning?: string } {
  // Set by the platforms this is deployed to. Locally none of these exist.
  const containerised = Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_PUBLIC_DOMAIN ||
      process.env.RENDER ||
      process.env.FLY_APP_NAME,
  );
  if (!containerised) return { path: DB_PATH, durable: true };

  // An explicit path outside the working directory is someone having pointed this at
  // a volume on purpose. The default — `./data` under the app — is the one that goes.
  const underAppDirectory = DB_PATH.startsWith(resolve(process.cwd()));
  if (!underAppDirectory) return { path: DB_PATH, durable: true };

  return {
    path: DB_PATH,
    durable: false,
    warning:
      `מסד הנתונים נמצא ב-${DB_PATH}, בתוך תיקיית האפליקציה. בפריסה בקונטיינר התיקייה הזו נמחקת בכל דיפלוי, ` +
      'ואיתה הדוחות, התמונות והתבניות. יש להגדיר volume קבוע ולהצביע אליו עם REPORT_DB_PATH.',
  };
}
