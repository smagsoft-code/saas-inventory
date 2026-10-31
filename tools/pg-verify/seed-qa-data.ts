/**
 * QA seed — NOT part of the application runtime, NOT the CI verification harness. Command-line wrapper of `qa-seed.ts` (D-8E.26-B4.1).
 *
 * It populates the QA tenant that YOU name in QA_SEED_TENANT_SLUG (no default, no automatic choice) with one realistic, connected dataset:
 * warehouses/locations, categories, products with variants, stock, product images, QR codes, customers, orders in different statuses,
 * returns and transfers. It goes through the REAL HTTP API only (never a direct database connection), logs in as QA_ADMIN_EMAIL /
 * QA_ADMIN_PASSWORD, and verifies that the session and `GET /tenant` both report exactly that tenant, active.
 *
 * Modes (see tools/pg-verify/README.md):
 *   --check            inspection with GET requests only (plus the login POST); writes no seed data, the login does create a session.
 *   --create --yes     only for a tenant with no operational data.
 *   --yes              normal run: creates only what is missing; never updates, deletes, reactivates, or touches identities/passwords.
 * Writing needs --yes. The API must be on 127.0.0.1/localhost; there is no way to point it at a remote host, and the HTTP client
 * (qa-http-client.ts) never follows a redirect, so a local service cannot forward the credentials elsewhere.
 * --check writes no seed data; the login it needs may update last-login metadata and create a session.
 *
 * Usage: QA_SEED_TENANT_SLUG=<slug> pnpm --filter @saas-inventory/pg-verify seed:qa --check
 *        (the development server, dev-server.ts, must already be running)
 */
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQaAdmin, readToolEnv } from './qa-credentials';
import { createHttpClient } from './qa-http-client';
import { runQaSeed } from './qa-seed';
import { parseSeedArgs, resolveSeedConfig, SeedGuardError } from './qa-seed-guards';

async function main(): Promise<void> {
  // Everything that can refuse runs before the first request: flags, tenant slug, loopback URL, --yes, credentials.
  const args = parseSeedArgs(process.argv.slice(2));
  const env = readToolEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'), process.env);
  const config = resolveSeedConfig(env, args);
  const qa = loadQaAdmin(env);
  // --check gets a read-only client: GET plus the login POST, so even an upload would be refused at the network edge (B1).
  const http = createHttpClient(config.apiBase, undefined, { readOnly: config.mode === 'check' });
  const placeholderPng = buildPlaceholderPng();
  await runQaSeed({
    api: http.api,
    login: () => http.api('POST', '/api/v1/auth/login', { email: qa.email, password: qa.password }),
    uploadImage: (productId) => http.upload(productId, placeholderPng),
    config,
    log: (line) => console.log(line),
  });
}

/** Hand-rolled minimal valid PNG (IHDR/IDAT/IEND + table-based CRC32) — a flat `#2F6FED` square,
 * same approach `seed-test-product-images.ts` uses, so this script has no image-library dependency
 * for a one-off dev seed. */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function buildPlaceholderPng(size = 128): Buffer {
  const [r, g, b] = [0x2f, 0x6f, 0xed];
  const rowBytes = size * 3;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixelStart = rowStart + 1 + x * 3;
      raw[pixelStart] = r;
      raw[pixelStart + 1] = g;
      raw[pixelStart + 2] = b;
    }
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = deflateSync(raw);
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

main().catch((error: unknown) => {
  // A refusal of the guards prints only its message (it names no secret); anything else prints the message, not the stack of a request.
  console.error(error instanceof SeedGuardError ? `
qa-seed refused: ${error.message}` : `
qa-seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
