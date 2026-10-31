# QA credentials: rotation plan and prevention (B4.11.5.6 — PREPARED, NOT EXECUTED)

**Status (2026-10-30): nothing in this document has been carried out. No password was rotated, no hash was touched, no service was contacted, no secret was read.**
Decision of the owner behind it: keep the Git history (no `git filter-repo`/BFG), rotate through the application, never edit hashes in PostgreSQL by hand, keep
`app_qa_readonly` `NOLOGIN` without a password, and keep this separate from migrations `0051`/`0052`. Context and evidence:
[pending-register.md `OBS-DEV-CREDENTIAL-IN-SPEC`](../roadmap/pending-register.md). No credential value, fragment or derived value appears here.

## 1. What is exposed (from the local Git audit, B4.11.5.5)

Two **distinct** dev-only password literals are in the history that `origin/develop` contains: **A** (`docs/ui-ux/UI-UX-SPEC-001.md`, `1283de8` … `2ccdd1b`) and **B**
(`tools/pg-verify/dev-server.ts`, `seed-qa-data.ts`, from `4c1e31a`; still in HEAD). Which of them (if either) is the *current* password of `qa-admin@dev.local`, whether they
were reused elsewhere, and whether they still work are **unknown** and must not be tested by logging in with them. Visibility of the GitHub repository: the register records that
the owner made it public (2026-10-29); not verified from the local repository.

## 2. Where `QA_ADMIN_PASSWORD` is used (static review; `.env` not read)

| Where | What it does | When |
|---|---|---|
| `tools/pg-verify/qa-credentials.ts` (`loadQaAdmin`) | Requires it (12–128 chars, no default); error messages name the variable, never the value | Whenever a tool builds the QA admin |
| `tools/pg-verify/dev-server.ts` (`registerQaAdmin`) | `POST /api/v1/auth/register` with `QA_ADMIN_EMAIL` / `QA_ADMIN_PASSWORD` | **Only on the first start of a new, empty data directory** (`action === 'initialize'`); never on later starts; the value is not printed |
| `tools/pg-verify/seed-qa-data.ts` (via `readToolEnv`) | Logs in as that user through the API before seeding | **Every** seed run (`--check`, `--create`, normal) |
| `tools/pg-verify/README.md`, `docs/architecture/environments.md`, `.env.example` (`QA_ADMIN_PASSWORD=` empty), `CLAUDE.md` | Documentation only | — |

- The variable is **not** the password of an existing identity: it is (a) the value used to *create* the identity in a new cluster and (b) the value the seed *presents*. After the
  account exists, only (b) matters, so a stale value makes the seed fail with a login error; it never changes the account.
- **Observed side effect:** `dev-server.ts` passes `{ ...process.env, ...fileEnv }` to every child it starts (migrate, role bootstrap, the S3 shim, the API, the Web dev server), so
  `QA_ADMIN_PASSWORD` reaches processes that do not need it. Nothing prints it. **Fixed in B4.11.5.7, completed in B4.11.5.8 and B4.11.5.10:** `tools/pg-verify/child-env.ts` gives each of the five children an explicit allow-list of variables (the first version only removed this one), the PostgreSQL processes started by `embedded-postgres` get only operating-system essentials, and `QA_ADMIN_PASSWORD` is deleted from `process.env` once the registration step, which runs inside `dev-server.ts`, has read it. It remains in the parent's memory until exit. See [secret-scanning.md](secret-scanning.md).
- Hashes live in the database and in every backup of it; they were not inspected.

## 3. The constraint that shapes the procedure

**The application has no way to change the password of an existing active identity.** `UpdateUserDto` excludes `email` and password on purpose; a credential is set at
registration (`AuthService.register`), at user creation by an administrator (`POST /users`, which creates the login with a password) or through an invitation
(`acceptInvitation`, only for `pending_credential` identities); `register` on an existing identity does not overwrite its password. There is no reset or change-password endpoint, and no
endpoint to disable an *identity* (only the tenant-level user, `PATCH /users/:id` with `status = disabled`). So "rotate through the normal flow" is not a single action today.

| Option | What it is | Verdict |
|---|---|---|
| **1. Replace the QA admin (recommended)** | With the current admin create a **new** administrator user (`POST /users`: new e-mail, new strong password, role Administrador). Log in as the new one, and have it **disable** the old user (`PATCH /users/:id` → `disabled`; the old admin cannot change its own status). Point `QA_ADMIN_EMAIL`/`QA_ADMIN_PASSWORD` at the new account | Uses only existing application flows; reversible; no hash edited; the old credential can no longer enter the tenant (login and every request re-check the user's status). The old identity row and its hash remain in the database and in backups |
| 2. Fresh development database | New empty data directory; `dev-server` registers the admin with a new `QA_ADMIN_PASSWORD`; re-seed | Cleanest for the credential, but destroys the QA dataset (or needs the old one kept as a backup); heavy |
| 3. Build a change-password feature | A new endpoint (own phase, probably an ADR, tests, security review) | The proper fix, outside this block's scope |
| 4. Edit the hash in PostgreSQL | — | **Excluded** by the owner's decision; no procedure is designed |

## 4. Procedure for Option 1 (owner executes; every step needs separate authorization)

**Before**
1. Back up the development database first (verified restore). A restored backup brings the old user back as active: after any restore, repeat step 6.
2. Generate a new password (password manager, ≥ 20 random characters, never reused, never typed into a chat, a file in the repository or a shell history).
3. Confirm who else uses the QA login (people, scripts, n8n, browsers with saved passwords) and plan to change them together.

**Execute**
4. Log in to the web UI as the current QA admin. Users → create the new administrator (new e-mail, e.g. a different `@dev.local` address, the new password, role Administrador). A `409` means the e-mail is taken in this tenant: choose another. Use an e-mail that has **no identity yet** anywhere: identities are global and find-or-create never overwrites an existing credential (`IdentitiesRepository.findOrCreate`), so reusing an e-mail that already exists would silently keep *its* old password instead of the new one.
5. Log out; log in as the new administrator (proves the credential and the role before anything is disabled).
6. As the new administrator, open the old user and set it to **disabled**. Do not delete it: orders, movements and audit rows refer to it.
7. Update the **git-ignored** `.env` (`QA_ADMIN_EMAIL`, `QA_ADMIN_PASSWORD`) and any process environment that sets them. Restart the development tools only if they started with the old values (the API does not use the variable).

**Verify (by the owner, never with the retired password in a script)**
8. The new login works; `seed:qa --check` with the new variables logs in. The retired account is refused (the tenant rejects a user that is not active) and its existing sessions stop working at the next request.
9. Nothing outside the QA tenant changed: `muebleria-elegante` and the suspended `qa-dev-tenant-3d3920` are not touched (the old e-mail may also be a disabled membership of the latter; leave it).

**Recovery**
- Step 4 fails (permission, validation, `409`): nothing changed; fix and retry. Step 5 fails: **do not disable the old user**; investigate (role, status, rate-limit window — wait it out).
- The old user was disabled by mistake or the new one cannot work: any administrator re-enables it (`PATCH` → `active`) — reversible.
- No administrator can log in: do **not** edit hashes. Use a platform support session (ADR-0036) to inspect users, restore from the verified backup, or fall back to Option 2.
- The seed fails with a login error after rotating: `.env` / process environment still holds the old values.
- A new cluster cannot be initialised: `QA_ADMIN_PASSWORD` must be set (12–128 characters) before `dev` is started; the error names only the variable.

**What changes / what does not.** Seeds and local tools: only the variable values. Sessions of the retired user: invalidated. Backups: untouched, and they keep the retired hash (keep their ACL restriction; do not publish them). CI: unaffected (it creates its own throw-away servers). Migrations `0051`/`0052` and `app_qa_readonly`: unaffected (still `NOLOGIN`, no password).

## 5. Prevention — what exists and what does not

**Exists:** `QA_ADMIN_PASSWORD` is required from the environment with no default and never printed (`qa-credentials.ts`, with unit tests); `.env` is git-ignored; `.env.example` holds empty or
obvious placeholders for every secret-looking key (checked statically; JWT/refresh secrets, S3 keys, n8n token and the `*_PASSWORD` values are empty, and the database URLs carry a placeholder
password); the working tree no longer contains either literal.

**Implemented in B4.11.5.7 (tested locally; the CI job has not run on GitHub):** the scanner `tools/secret-scan/` (modes `working-tree`, `staged`, `range`), the CI job `secret-scan`, the `.githooks/pre-commit` hook (enabled per clone with `pnpm hooks:install`), the preventive tests and the child-environment isolation. Details and limits: [secret-scanning.md](secret-scanning.md).

**Still missing:** the hook is opt-in per clone; prose that mentions a password inside a sentence is not detected; test files only raise *suspects*; nothing scans the history that is already published.

**Original proposals (items 1–4 are now implemented as described in secret-scanning.md; item 5 stands):**
1. **CI scan.** A job with `contents: read` that scans the added lines of the pull request / push range, with a pinned scanner (or a small repository script) configured to **redact** matches, print only `file:line` and the rule name, and exit non-zero on a finding. Detect: password-like assignments to non-placeholder literals, `scheme://user:password@` URLs, private-key headers, JWTs, provider keys. Explicit allowlist, each entry with a reason (migration SHA-256 digests, the pinned image digest, deliberately fake test vectors, the placeholder URLs of `.env.example`).
2. **Pre-commit.** A committed hook directory (`core.hooksPath`) running the same scan on `git diff --cached` added lines only; never reads `.env`; prints no values; the allowlist is the same file.
3. **Preventive test.** A unit test over tracked files under `tools/`, `apps/` and `docs/` that fails on a password-like key assigned a quoted literal of 8+ characters that is not a placeholder or an allowlisted vector; plus a test that every secret-looking key of `.env.example` is empty or a placeholder. It must contain no real value (no list of known leaked ones).
4. **Child environment.** Give each process `dev-server.ts` starts only the variables it needs (done in B4.11.5.8 as an explicit allow-list per process, not a deny-list; extended in B4.11.5.10 to the PostgreSQL server that `embedded-postgres` starts, and the variable is removed from `process.env` once read).
5. **History.** Keep it; a scanner on the full history is a one-off audit if the owner wants it, not a CI gate.

## 6. Publication

Rotation does not have to precede the push of the 53 local files: the working tree contains no literal and the new documents contain none, so publishing them does not add exposure. It also
does not remove any: only rotation reduces it. This document and the corrected register entry belong to the documentation commit. Remaining risks with the history preserved: the public history
keeps both literals; anything that reused them stays exposed until rotated; backups keep the old hash.

## 7. Authorizations (each independent)

1. Commit this documentation correction. 2. Implement the secret scanning / hook / tests of §5. 3. Execute the rotation of §4 (or choose Option 2/3). 4. Publish commits. 5. Any rewrite of history.
