# QA credentials: rotation (COMPLETED 2026-10-30) and prevention

**Status (2026-10-30): the rotation of the QA administrator's access was COMPLETED (Option 1) and verified as far as stated in §8. The exposure of the historical literals in published Git history is NOT resolved.**
The plan of §§1–7 was written in B4.11.5.6, before anything was executed; §8 records what was actually done, how it was verified and what was not. No password, hash or token appears in this document.
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
| **1. Replace the QA admin (recommended) — USED** | With the current admin create a **new** administrator user (`POST /users`: new e-mail, new strong password, role Administrador). Log in as the new one, and have it **disable** the old user (`PATCH /users/:id` → `disabled`; the old admin cannot change its own status). Point `QA_ADMIN_EMAIL`/`QA_ADMIN_PASSWORD` at the new account | Uses only existing application flows; reversible; no hash edited; the old credential can no longer enter the tenant (login and every request re-check the user's status). The old identity row and its hash remain in the database and in backups |
| 2. Fresh development database | New empty data directory; `dev-server` registers the admin with a new `QA_ADMIN_PASSWORD`; re-seed | Cleanest for the credential, but destroys the QA dataset (or needs the old one kept as a backup); heavy |
| 3. Build a change-password feature | A new endpoint (own phase, probably an ADR, tests, security review) | The proper fix, outside this block's scope |
| 4. Edit the hash in PostgreSQL | — | **Excluded** by the owner's decision; no procedure is designed |

## 4. Procedure for Option 1 (owner executes; every step needs separate authorization) — executed on 2026-10-30, see §8

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

Publishing the local commits does not depend on the rotation: the working tree and the new documents contain no literal, so publishing them adds no exposure. It also removes none: the rotation (§8) lowers
what the literals can be used for in the QA tenant, but they stay in the already published history. Remaining risks with the history preserved: the public history keeps both literals; anything that reused them
stays exposed until it is changed; backups keep the old hash and a restore reactivates the old tenant user. This document and the corrected register entry belong to the documentation commit.

## 7. Authorizations (each independent)

1. Commit this documentation correction. 2. Implement the secret scanning / hook / tests of §5 *(implemented locally in B4.11.5.7–.10)*. 3. Execute the rotation of §4 *(executed by the owner on 2026-10-30; §8)*. 4. Publish commits *(not authorised yet)*. 5. Any rewrite of history *(not authorised)*.

## 8. Result of the rotation (B4.11.5.14 / B4.11.5.15, 2026-10-30)

**What was done** (by the owner through the web application, following §4 — Option 1; the assistant had no credentials and read no `.env`):
1. A new administrator was created with **Usuarios → Nuevo**: an identifier that had never been used, a new password generated and held only by the owner, and the **Administrador** role, in `qa-dev-tenant` only (no SuperAdmin, no other tenant).
2. The owner logged in as the new administrator and checked that it worked.
3. The git-ignored local `.env` was updated with the new `QA_ADMIN_EMAIL` and `QA_ADMIN_PASSWORD` (names only here; nothing was read, copied or printed by the assistant).
4. The **previous tenant user was disabled** by the new administrator (reversible; not deleted). Its global identity and any other membership were left alone.

**How it was verified**
- `seed:qa --check` (run with `QA_SEED_TENANT_SLUG=qa-dev-tenant`) authenticated with the new configuration and confirmed that the session and `GET /tenant` both report `qa-dev-tenant`, active. It performs the login and
  GET requests only. **The login updated `last_login_at` of the new identity and created a session** (the tool says so itself). **No business data was modified**: the totals read afterwards were unchanged
  (58 products, 298 movements, 54 orders).
- That run also listed 9 records of the tenant that match the seed's categories/products/customer by name or code but are not the seed's; this is the seed's own refusal rule for a *writing* run and is unrelated to the
  rotation. Nothing was changed.
- **Reported by the owner and not independently verified by a tool:** the new user is active with the Administrador role, and the previous user appears as disabled in the Users list. Per the rules of the exercise the
  retired credential was **never used** to log in (to test whether it "still works"), so the disabled state rests on the owner's confirmation and on the login rule documented in §3/§4 (the tenant rejects a user that is not active).

**A mistake worth keeping:** the first `--check` failed locally with `QA_ADMIN_EMAIL is not a valid address` before any request was made. The application accepts any identifier of 10 or more characters as the login ("Usuario"),
but `tools/pg-verify/qa-credentials.ts` requires one that **contains an `@`** and no whitespace. The identifier configured for the seed has to satisfy both; once corrected, the check authenticated. (Relaxing the tool's rule would
be a separate code change; it was not made.)

**What this does NOT change — keep reading these as open risks**
- Both historical literals remain in commits already published to `origin/develop`; rotation lowers what they can be used for in this tenant, it does not remove them from Git history, forks, caches or clones. The history was not rewritten.
- The old identity and its hash still exist in the database and in every backup. **A restore of a backup taken before the rotation reactivates the old tenant user**: disable it again (step 6 of §4) after any restore.
- If either historical password was reused elsewhere, change it there; whether that happened is unknown.
- The CI job and the pre-commit hook that guard against new leaks are implemented locally only (not run on GitHub; the hook is opt-in per clone); the twelve local commits are not published.
