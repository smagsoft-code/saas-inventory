# Secret scanning (B4.11.5.7)

**Status: implemented and tested locally; the CI job has NOT been run on GitHub.** (B4.11.5.8 added the per-process environment allow-lists described at the end.) Context: two dev-only passwords reached the Git history
([pending-register `OBS-DEV-CREDENTIAL-IN-SPEC`](../roadmap/pending-register.md), [rotation plan](qa-credential-rotation.md)). This control makes a *new* one much harder to
commit. It does not remove the old ones and it does not replace the rotation, which is a separate phase.

## What it is

`tools/secret-scan/` — plain Node (>= 20), **no dependencies** (so it runs in CI and in a Git hook without `pnpm install`):

| File | Role |
|---|---|
| `scan.mjs` | Rules, exclusions, the three scan modes, the allowlist |
| `cli.mjs` | Command line, report, exit codes |
| `secret-scan.test.mjs` | 22 tests of the scanner (temporary repositories, fictitious random secrets) |
| `repo.test.mjs` | 3 preventive tests on this repository |
| `../../.githooks/pre-commit` | The hook (runs the `staged` mode) |
| `../../.secret-scan-allow.json` | Reviewed exceptions (no values) |

## Running it

```bash
pnpm secret-scan                    # the working tree (files Git knows or would add; never .env)
pnpm secret-scan:staged             # exactly what is staged for the next commit
node tools/secret-scan/cli.mjs --mode range --from <rev> --to <rev>    # every line added by every commit in from..to
node tools/secret-scan/cli.mjs --mode working-tree --paths tools,apps,docs
pnpm test:secret-scan               # the scanner's own tests (25)
```

Exit code **0** clean (suspects only), **1** a confirmed finding (any finding with `--strict`), **2** usage, configuration or internal error (including a stale allowlist entry).

## The report never contains a value

Each finding is `CONFIRMED|suspect  <severity>  <rule>  <path>:<line>` and nothing else. A rule answers with a verdict; the matched text is dropped before a finding object exists, so there
is no value to leak through a log, a JSON dump or a stack trace. Errors print the kind of error and a system code, never a message that could contain content. The tests assert this: no
fragment of a random secret appears in the report, in the structured result, in the real process output, in an allowlist-error, or in a rejected commit. To check it yourself, plant a
random string behind an assignment in a scratch repository and grep the output for it.

## Rules

| Rule | Detects | Confidence |
|---|---|---|
| `secret-assignment`, `secret-assignment-bare` | a name that **ends in** password / passwd / pwd / passphrase / secret / token / api-key / access-key / secret-key / private-key / credential, assigned a quoted literal (or `NAME=value` in env, shell, YAML, Markdown) of 8+ characters that is not a placeholder | `confirmed` when the value has 3+ character classes (or 24+ chars with 2+); `suspect` otherwise |
| `login-pair` | documentation prose of the form ``Login: `user` / `value` `` | same |
| `url-credentials` | `scheme://user:password@host` with a non-placeholder password | confirmed |
| `bearer-token` | `Bearer <20+ chars>` | confirmed |
| `private-key` | a `BEGIN … PRIVATE KEY` header | confirmed |
| `jwt` | three-part `eyJ…` token | confirmed |
| `aws-access-key-id`, `github-token`, `slack-token`, `google-api-key`, `stripe-live-key`, `generic-sk-key`, `npm-token` | provider key shapes | confirmed |
| `sensitive-file-env`, `-password`, `-key`, `-dump` | a **file name**: `.env*` (except `.env.example`), `*.pw`, `*.pem/*.key/*.p12/…`, `id_rsa…`, `*.dump/*.bak/*.sql.gz`. The content is never opened | confirmed |

**Not findings:** an empty value, `CHANGE_ME` / `REPLACE_ME` / `example` / `placeholder` / `dummy` / `fake` / `redacted` / `xxxx` markers, `${VAR}` / `$VAR` / `<…>` / `{{…}}` references,
`process.env…`, common weak words (`password`, `secret`, `postgres`, `admin` …), sentences (values with spaces), identifier-like values (`platform_refresh_token`, `ConfirmPassword`),
ALL_CAPS environment-variable names, and names with no assignment (types, parameters, comparisons).

**Test files** (`*.test.*`, `*.spec.*`, `test/`, `__tests__/`, fixtures): assignments, URLs and bearer values found there are reported as `suspect`, never `confirmed`, because test code carries
synthetic credentials by design. Private-key headers, JWTs and provider-key shapes stay `confirmed` everywhere. Consequence: a *real* password pasted into a test would only be a suspect — see
the limitations.

## Modes and what each one reads

| Mode | Used by | Reads |
|---|---|---|
| `working-tree` | `pnpm secret-scan`, CI | the files listed by `git ls-files --cached --others --exclude-standard` (so anything ignored, such as `.env`, is never even listed), read from disk |
| `staged` | the pre-commit hook | the **blobs in the index** (`git cat-file blob :0:<path>`), for added/copied/modified/renamed paths; a deleted path has nothing to read; the working file is never opened |
| `range` | CI | the **added lines** of **each commit** in `from..to` (`git show --unified=0`, first parent for merges), with their real line numbers; a secret added early and removed later is still found |

**Exclusions are decided from the path before any content is requested** (and a test proves excluded paths are never opened): `node_modules`, `.git`, `.turbo`, `.next`, `dist`, `coverage`,
`.pnpm-store`, `.dev-pgdata`, `.verify-pgdata`, `s3data`, `scratchpad`, `Backups`/`backups`, `restore-test`, `DevData`; generated `database/migrations/meta/*_snapshot.json`; binary
extensions and any file with a NUL byte; files over 1 MB (counted and reported as skipped). `.env` variants, `*.pw`, key and dump files are not read: their *name* is the finding.

## Exceptions

1. **Inline:** `// secret-scan:allow <reason of 10+ characters>` on the line or the line above. A marker without a reason does not count (and is reported).
2. **File:** an entry in `.secret-scan-allow.json`:
   ```json
   { "version": 1, "entries": [ { "path": "apps/x/src/y.spec.ts", "rule": "jwt", "line": 33, "reason": "why it is not a credential (15+ chars)", "reviewedIn": "pr:123" } ] }
   ```
   `line` is optional. **No field can hold a value**: an unknown field is a configuration error (exit 2). An entry that matches nothing in a full `working-tree` scan is stale and fails the run.
   Current entries: one synthetic JWT-shaped fixture in `error-sanitizer.spec.ts` (its payload has a single `sub` claim and its signature is shorter than a real HS256 one).

## Integration

- **CI** (`.github/workflows/ci.yml`, job `secret-scan`; permissions stay the workflow's `contents: read`; no secret, no install, no artifact): checkout with `fetch-depth: 0`; the scanner's tests; the
  `range` scan of `PR base..PR head` (pull request) or `before..sha` (push); then the `working-tree` scan. If no usable base exists (new branch, rewritten history) the range scan is **announced as
  skipped** with a warning, never passed silently, and the tree scan still runs. A confirmed finding fails the job.
- **Hook:** Git hooks are not installed by cloning. Once per clone: `pnpm hooks:install` (`git config core.hooksPath .githooks`). The hook runs the `staged` mode, does not touch the index, adds no
  file, never reads `.env`, and exits non-zero on a confirmed finding. The only way around it is Git's own `git commit --no-verify`; the script adds no other switch. On Unix the file needs its
  executable bit (`git update-index --chmod=+x .githooks/pre-commit` when it is first committed; on Windows Git runs it through its own `sh`).
- **Tests:** `pnpm test:secret-scan`. `repo.test.mjs` fails if `tools/`, `apps/` or `docs/` gain a confirmed finding, if any file Git knows has a sensitive name, or if a secret-looking key of
  `.env.example` has a non-placeholder value.

## What it does NOT do (limitations)

- **Pattern based, not exhaustive.** It misses a secret that matches no rule: a plain low-entropy password in prose, a value split over lines, a base64 blob under a non-secret name, or any key it
  does not know. It is a net against the common accident, not a proof of absence.
- **Prose mentions are only partly covered.** ``Login: `x` / `y` `` is a rule; a password quoted in the middle of a sentence is not (the historical text in the register is such a case).
- **Test files are downgraded** (see above): a real credential placed in a test is a *suspect*, which does not fail the build. Review the suspect list (`pnpm secret-scan` prints it).
- **History is not scanned in CI** beyond the commits of the range under review. The 2026-10-29 push already contains the two historical literals; the scanner does not fix that. Run
  `--mode range --from <root commit> --to HEAD` for a one-off audit (locations only): it reports exactly the three known places (`UI-UX-SPEC-001.md` line 19, `dev-server.ts` line 44,
  `seed-qa-data.ts` line 24 — the literal in the register's prose is not caught).
- **A reviewed allowlist entry is trusted** until someone removes it.
- Not covered by ESLint/TypeScript (plain `.mjs`, outside the pnpm workspaces so as not to touch the lockfile); it is covered by its own tests and by `node --check`.

## Related control: each child process of `dev-server.ts` gets only the variables it needs (B4.11.5.7 → B4.11.5.8)

**History of this control.** B4.11.5.7 removed `QA_ADMIN_PASSWORD` from the environment of the children but still passed everything else (a deny-list). That was a recorded deviation from least
privilege; **B4.11.5.8 closes it**: `tools/pg-verify/child-env.ts` now holds an explicit allow-list **per process** and `dev-server.ts` builds each child's environment from it, right before that child
starts. `process.env` and the parsed `.env` are merged only to look names up (`available`); the merge itself is never passed to anything.

**Where the lists live.** One place: `CHILD_ENV_SPECS` and `SYSTEM_BASELINE` in `tools/pg-verify/child-env.ts`. Nothing is duplicated elsewhere; this page only names the variables.

**How to read a list.** *required*: absent or empty stops the step with an error that names the variable (never a value). *one of*: at least one name of the group. *optional*: passed when present.
Names are matched without regard to letter case (Windows) and keep the casing found; values are passed unchanged.

| Process (how it starts) | Required | Optional (passed when present) | Evidence (static; no `.env` opened) |
|---|---|---|---|
| `migrate` (`db:migrate` → `migrate.ts` → `migration-runner`) | `MIGRATOR_EXPECTED_DATABASE` (dev-server sets it from the bootstrap URL when absent); one of `MIGRATOR_BOOTSTRAP_DATABASE_URL` / `MIGRATOR_DATABASE_URL` | `MIGRATOR_INCREMENTAL_DATABASE_URL`, `MIGRATOR_INCREMENTAL_LOGIN`, `MIGRATOR_INCREMENTAL_PASSWORD`, `MIGRATOR_LOCK_TIMEOUT_SECONDS` | `migration-integrity/config.ts` reads exactly these seven; the runner reads no other variable |
| `bootstrap-roles` (`db:bootstrap-dev-roles`) | `APP_TENANT_PASSWORD`, `APP_PLATFORM_PASSWORD`, `APP_PUBLIC_RESOLVER_PASSWORD`; one of the two migrator URLs | `APP_EVENT_PROCESSOR_PASSWORD`, `APP_IMPORT_WORKER_PASSWORD` | `bootstrap-dev-roles.ts` (`getRequiredEnvVar` ×3, `getOptionalEnvVar` ×2) + `getBootstrapDatabaseUrl` |
| `s3-shim` (`scratchpad/dev-s3-shim.mjs`, local and git-ignored) | — | `S3_ENDPOINT` | its only `process.env` read |
| `api` (`nest start --watch` → `main.ts`, `AppModule`) | `DATABASE_URL`, `APP_PLATFORM_DATABASE_URL`, `APP_PUBLIC_RESOLVER_DATABASE_URL` (providers built at boot), `JWT_SECRET`, `JWT_REFRESH_SECRET` (auth config) | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (read on first use of object storage, not at boot); `PORT`, `CORS_ORIGINS`, `NODE_ENV`, `COOKIE_DOMAIN`, `APP_URL`; `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`, `SELECTION_TOKEN_TTL_SECONDS`, `INVITATION_TOKEN_TTL_SECONDS`, `SUPPORT_SESSION_TTL_SECONDS`; `ARGON2_MEMORY_COST_KIB`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`, `AUTH_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_TTL_SECONDS`; `QR_PUBLIC_RATE_LIMIT_MAX`, `QR_PUBLIC_RATE_LIMIT_TTL_SECONDS`; `IMPORT_BATCH_SIZE`, `IMPORT_MAX_FILE_SIZE_BYTES`, `IMPORT_MAX_ROWS`, `IMPORT_SYNC_ROW_THRESHOLD`; `N8N_EVENTS_ENABLED`, `N8N_EVENTS_WEBHOOK_URL`, `N8N_EVENTS_AUTH_TOKEN`, `N8N_EVENTS_TIMEOUT_MS` | every `getRequiredEnvVar` / `getOptionalEnvVar` / `process.env` call in `apps/api/src` (non-test) and `packages/config`; `DatabaseModule` factories; `auth-config.ts`; `object-storage.service.ts` (lazy `getClient`); `EventProcessorModule` factory (`n8n-delivery.config.ts`) |
| `web` (`next dev`) | — | `API_URL`, `NEXT_PUBLIC_API_URL`, `NODE_ENV`, `NEXT_TELEMETRY_DISABLED` | `next.config.ts`, `src/lib/api/client.ts`, `public-url.ts` (the only `process.env` reads; no other `NEXT_PUBLIC_*` name exists in `src`) |

**System baseline (every process):** operating-system and toolchain essentials such as `PATH`, `PATHEXT`, `COMSPEC`, `SYSTEMROOT`, `WINDIR`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`/`TMP`, `LANG`, `TERM`, `NODE_OPTIONS`,
`PNPM_HOME` (full list: `SYSTEM_BASELINE`). They are names without any application setting; a test fails if one looks like a credential.

**Deliberately NOT passed to any child:** `QA_ADMIN_PASSWORD` (a module-load check refuses a list that contains it), `QA_ADMIN_EMAIL`, `QA_SEED_*`, `DEV_PGDATA_DIR` (tool-only), `PLATFORM_ADMIN_*` (used by the
`seed:platform-admin` script, not by these processes), `REDIS_URL` (no code reads it), `PG*` (the `postgres` driver would let a stray `PGPASSWORD`/`PGSSLMODE` override a URL), registry/npm tokens, proxies and `AWS_*`.
**Narrowed compared with before:** the API no longer receives `MIGRATOR_*` (the superuser URL) or `APP_*_PASSWORD`; `PORT` no longer reaches the Web; the S3 shim receives one variable instead of everything.
`APP_IMPORT_WORKER_DATABASE_URL`, `APP_EVENT_PROCESSOR_DATABASE_URL`, `IMPORT_WORKER_*` and `EVENT_PROCESSOR_*` are read only by the worker deployables (`pollOnce` / `runOnce`), which `dev-server.ts` does not start.

**`QA_ADMIN_PASSWORD`** is read by `dev-server.ts` alone: `loadQaAdmin` takes it (from `.env` or the shell) for the registration of the QA administrator on the first start of a new, empty data
directory. It is on no child list, so none of the five children receives it, and right after it is read `scrubParentOnlyVariables()` deletes it from `process.env`, so nothing the parent launches later can
inherit it either (B4.11.5.10). The value stays in memory in the parent (`qaAdmin`, and the lookup copy `available`, which is never passed to anything) until the process exits. No child is told where `.env` is
(the children never read the repository `.env` themselves: only `process.env`; one exception below).

### The PostgreSQL server (`initdb`, `postgres`) — B4.11.5.10

**What was wrong.** B4.11.5.8 covered the five processes `dev-server.ts` spawns, but the PostgreSQL server is started by the `embedded-postgres` library, which runs `initdb` and `postgres` with
`{ ...process.env, LC_MESSAGES }` (`node_modules/embedded-postgres/dist/index.js`, two sites) and has no option to change that. A `QA_ADMIN_PASSWORD` defined in the **shell** (not only in `.env`) therefore reached
the database server, together with every other variable of the shell. The earlier statements that the variable "stays in `dev-server.ts` alone" were true of the five children, not of this one.

**What is done now** (`tools/pg-verify/child-env.ts`, `dev-server.ts`; nothing inside `node_modules` is touched, so it survives a reinstall):
1. `POSTGRES_PROFILE` — an allow-list with **only the operating-system essentials** (`OS_BASELINE`: `PATH`, `PATHEXT`, `COMSPEC`, `SYSTEMROOT`, `WINDIR`, `TEMP`/`TMP`/`TMPDIR`, `HOME`, `USERPROFILE`, `APPDATA`,
   locale and terminal names, …). It contains no `PG*` (a stray `PGPASSWORD`/`PGDATA`/`PGOPTIONS` would be honoured by `initdb` and the server), no Node/pnpm settings, no application variable and no
   `QA_ADMIN_PASSWORD`. PostgreSQL needs nothing else from the environment here: data directory, port, user, authentication and the password file are passed as arguments or a file, and the library adds `LC_MESSAGES`.
2. `withChildProcessEnv('postgres', available, () => prepareDevCluster(...))` puts that environment in `process.env` for exactly the cluster preparation (which is where the library launches both processes, and where
   its own database client connects) and restores the **original** `process.env` object afterwards, also if the call throws.
3. `scrubParentOnlyVariables()` removes the parent-only variable from `process.env` once it has been read (so even the library's shutdown helper, `taskkill`, cannot inherit it).

**Evidence (no PostgreSQL started).** `child-env.test.ts` launches a real `node` with the library's own expression (`Object.assign({}, process.env, { LC_MESSAGES })`), once as `initdb` and once as `postgres`, while
the swap is active and with `QA_ADMIN_PASSWORD`, an unknown variable, `PGPASSWORD`, a JWT secret and a database URL all present in the environment: the child sees exactly the operating-system essentials that exist, plus
`LC_MESSAGES`, plus what Windows itself supplies to any process (measured by a control launch) — and, without the swap, the same launch **does** leak the variable. Other tests: the original `process.env` object comes back
(also after a failure), `scrubParentOnlyVariables` is idempotent and reports names only, nothing is Windows-specific (names of both families are listed, only existing ones are passed), `dev-server.ts` reads the QA
admin, scrubs, then wraps the single `prepareDevCluster` call (static order check), and a static check that the installed library still builds its environment from `process.env` at both sites and has no environment option
(if an upgrade changes that, the test fails and this mechanism must be reviewed).

**Limits (stated, not hidden).**
- **PostgreSQL was not started** to prove the minimal environment is enough; that would have meant running the server. If some machine needs another essential for `initdb`/`postgres`, the start fails with the server's
  own error and the name is added to `OS_BASELINE`, with a reason. The Windows list is the least certain part.
- While the swap is active the whole Node process sees the minimal `process.env`. `dev-server.ts` does nothing else concurrently at that point, and the library's own client uses explicit connection options; any other
  code added inside that call must not rely on `process.env`.
- **Other launchers of `embedded-postgres` are not changed:** `tools/pg-verify/_dev-start-postgres-only.mjs` (parses `.env` into a local object, never into `process.env`), `verify-real-postgres.ts` and the embedded tests
  start the library with plain inheritance, so a variable defined in the **shell** reaches their PostgreSQL. `QA_ADMIN_PASSWORD` is not used by any of them; the exposure is limited to whatever the shell already holds.
  Using `withChildProcessEnv` there would be a small separate change to files outside this fix.
- A secret already present in the shell of the person who runs `dev-server.ts` remains in that shell and in the parent process's memory; nothing here changes that.

**Add a variable.** Put the name on the list of *the process that reads it* in `CHILD_ENV_SPECS` (`required` only if its absence must stop that step), with a comment naming the file that reads it; add or extend a test in
`child-env.test.ts`; update this table. A variable on no list simply does not arrive. To give a process an extra value that does not come from the environment (the way `MIGRATOR_EXPECTED_DATABASE` is derived), pass it as an
`override`; an override of a name that is not on that process's list is refused.
**Check that nothing unauthorised is passed:** `node --import tsx --test tools/pg-verify/child-env.test.ts` (it builds each environment from a world that contains every listed name plus unrelated and secret-looking ones, with
fictitious values, and compares the result with the list; one case starts a real `node` and a real `pnpm --version` through the shell with the minimal environment).

**Limitations of the static inventory.**
- The lists come from reading code; a variable read through a path this review did not follow would be silently missing. The effect is a process that falls back to a default or fails with its own clear
  "missing variable" error — never a leak. The remedy is to add the name to that process's list. An isolated dry run that records which variables each process *asks for* has not been done (it would mean starting them).
- The **system baseline cannot be proven complete** by reading code: an unusual machine may need another operating-system variable (a corporate proxy, a custom CA bundle: `NODE_EXTRA_CA_CERTS`, `HTTP(S)_PROXY`, `SSL_CERT_FILE`
  are *not* passed). It was checked here only on this machine: `pnpm --version` starts through the shell with the minimal environment (test above); the full `dev-server` was not run.
- **Children can read files themselves.** Next.js loads its own `apps/web/.env*` files if any exist; the lists govern the environment variables a child inherits, not files a child opens. No `.env` of the repository root is read by any child
  (only `dev-server.ts` and the seed read it).
- `NODE_OPTIONS` is passed (it is not a credential) and could carry flags a developer set on purpose.
- Behaviour of the five steps is unchanged except that a missing *required* variable now stops that step with a `ChildEnvError` (naming the variable) before the child is spawned.
