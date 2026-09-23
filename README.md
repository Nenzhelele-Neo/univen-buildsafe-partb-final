# UNIVEN BuildSafe — MySQL version

BuildSafe is a campus construction-awareness system for viewing projects, publishing notices, reporting hazards, and planning safer routes around the University of Venda campus. The existing frontend and API URLs are preserved.

## Requirements

- Node.js **22 or newer**, with npm. Node's built-in `.env` loader is used.
- MySQL **8.0 or newer**, running locally or on a reachable host.
- A MySQL account with access to the chosen database.
- Internet access for Leaflet's CDN assets and OpenStreetMap tiles.

## Clean-clone setup

1. Open a terminal in the repository and install the locked dependencies:

   ```powershell
   cd backend
   npm ci
   ```

   `npm install` is also supported when deliberately updating dependencies; commit the resulting lockfile changes.

2. Create a local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

   On macOS/Linux, use `cp .env.example .env`. Edit `backend/.env` and set your own MySQL credentials. This file is ignored by Git. Do not put real credentials in source files or commit them.

   | Variable | Default / purpose |
   | --- | --- |
   | `DB_HOST` | `localhost` |
   | `DB_PORT` | `3306` |
   | `DB_USER` | `buildsafe` |
   | `DB_PASSWORD` | Empty by default; supply your local account's password |
   | `DB_NAME` | `buildDB`; letters, numbers, and underscores only |
   | `PORT` | `3000`; HTTP listening port |

   Shell environment variables take precedence over `.env`. The environment file is resolved relative to `backend`, regardless of the shell's working directory. Quote passwords containing `#` or spaces.

3. If you do not already have a database account, connect with a MySQL administrator (`mysql -u root -p`) and run the following, substituting your own password. Match the database/user names to `.env`:

   ```sql
   CREATE DATABASE IF NOT EXISTS buildDB
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'buildsafe'@'localhost' IDENTIFIED BY 'REPLACE_WITH_YOUR_LOCAL_PASSWORD';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, INDEX
     ON buildDB.* TO 'buildsafe'@'localhost';
   ```

   For a remote MySQL server, its administrator must provision the appropriate account host and network access. An existing account can be used instead; do not recreate it.

4. Create the schema and import the optional bundled demo data:

   ```powershell
   npm run db:setup
   ```

   Equivalent explicit sequence:

   ```powershell
   npm run db:schema
   npm run db:seed
   ```

   The schema command creates `DB_NAME` if permitted and missing, then applies `database/schema.sql`. It verifies required columns, ID types, generated IDs, date/geometry types, indexes, foreign keys, and InnoDB support. MySQL DDL commits independently; seeding is a separate transaction.

   **Existing hybrid databases:** back up the database first. This bootstrap does not drop, rebuild, or automatically alter existing tables. An incompatible legacy schema produces an error. Use a new `DB_NAME` for a clean setup, or explicitly upgrade the backed-up schema before importing existing data. The bundled seed files cannot recover records that exist only in an old database.

5. Start the application:

   ```powershell
   npm start
   ```

   Open `http://localhost:3000` (or the configured `PORT`). Startup verifies database connectivity and schema compatibility. Do not open the HTML files directly; Express serves the frontend and APIs together.

## Demo accounts

After seeding:

- Admin: `admin@univen.ac.za` / `admin123`
- Student: `student@univen.ac.za` / `student123`

These are demonstration accounts. This migration preserves the existing plaintext-password login and browser-side role checks; server-side authentication/authorization and HTML escaping remain separate security work before deployment with real users.

## Storage and relationships

MySQL is the authoritative store for users, projects, reports, announcements, campus locations, and routes. Application requests do not read or write the seed files.

- `backend/data/*.json` are optional seed/reference inputs only. They are intentionally retained.
- Uploaded JPEG/PNG/WebP report images remain files in `backend/uploads/`; SQL stores their `/uploads/...` URLs. The folder is created on startup and must be writable.
- Back up the database **and** upload folder together. Git excludes uploaded images.
- SQL dates are returned as `YYYY-MM-DD`; API properties retain their existing camelCase names.
- BIGINT IDs accommodate historical timestamp IDs; new records use auto-incremented IDs.
- Projects and announcements have unique nullable source-report foreign keys. Report publication pointers are polymorphic references maintained inside transactions, avoiding circular foreign keys.
- Approval, editing, category changes, rejection, completion, and deletion update reports and linked publications atomically. Deleting a report-linked project also removes its source report, matching the existing admin UI.
- Photos are deleted only after database deletion commits and no SQL record references them. A filesystem cleanup failure may leave an orphaned file for manual cleanup; it does not undo committed SQL changes.

## Seed and import behavior

`npm run db:seed` imports all six seed files in one transaction. It preserves categories, coordinates, photo URLs, publication fields/links, campus location types, and route geometry/affected areas.

- The empty object in the supplied project seed is skipped with a warning. Other malformed records fail the import.
- Existing IDs are skipped, preserving subsequent edits. Repeating the import does not duplicate rows. Reseeding can restore deleted seed records, so use it deliberately rather than at every startup.
- A uniqueness conflict or invalid foreign key fails and rolls back the entire import. Failures return a nonzero exit code.
- One bundled legacy report is already marked Approved but has no publication metadata. It is retained with a warning. An administrator must review and publish it; the importer does not invent missing content.
- `node migrate.js` remains an alias for the full seed import after schema setup.
- `node migrate-routes.js` remains an optional transactional geometry refresh from the route seeds. Normal `db:setup` already imports geometry, so this extra command is unnecessary. It intentionally replaces existing route geometry/affected areas and fails if a route is missing.
- All seed paths are resolved from the backend directory, not the shell's working directory.

## Validation

From `backend`:

```powershell
npm run check
npm ls --all
npm test
```

`check` parses backend/frontend JavaScript, checks schema field mappings, verifies all 14 existing API contracts, and checks for runtime seed reads/writes and literal database passwords. Unit tests cover routing, seed normalization, date/coordinate validation, and transaction rollback.

For real MySQL integration tests:

```powershell
npm run test:mysql
```

Use a disposable MySQL instance/account configured through the same environment variables. This suite needs permission to create and drop a randomly named `buildsafe_test_<random>` database. It does not operate on the configured application's database. It creates a temporary upload folder and removes its own test database/files afterward. If the account lacks these permissions, use a dedicated test account; do not broaden a deployed application's privileges just for tests.

Integration coverage includes repeatable schema/seeding, rollback on seed failure, migration failure exit status, both logins, all API methods, date serialization, report photo validation/cleanup, publication lifecycle, concurrent approvals, linked project/report synchronization, and construction-aware route changes.

Also verify in a browser: Leaflet tiles load, both exact-point pickers place markers correctly, admin date inputs retain their values, and navigation/dashboard rendering are unchanged. Campus routes are approximate and may not reflect temporary access changes.

## Project structure

```text
backend/
  .env.example
  db.js                  # shared connection/configuration
  store.js               # SQL persistence and transactions
  server.js              # existing HTTP API and uploads
  routing.js             # existing campus routing algorithm
  validation.js
  database/
    schema.sql
    setup.js
    seed.js
  data/                  # optional seed/reference files
  uploads/               # local report images
  scripts/
  test/
frontend/
  css/
  js/
  *.html
```
