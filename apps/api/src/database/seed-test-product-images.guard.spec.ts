import { describe, expect, it } from 'vitest';
import {
  assertDevDatabaseTargets,
  assertDevS3Endpoint,
  assertTenantUsable,
  DEV_DATABASE_NAME,
  DEV_DATABASE_PORT,
  DEV_S3_PORT,
  ImageSeedGuardError,
  parseDatabaseTarget,
  parseImageSeedArgs,
  planImageInserts,
  QA_IMAGE_SEED_ALLOWLIST,
  resolveImageSeedTarget,
} from './seed-test-product-images.guard';

// Pure functions only: no database, no storage, no network. The passwords in the URLs below are placeholders, not credentials.

const YES = { yes: true };
const platformUrl = (port = 55432, db = DEV_DATABASE_NAME, host = '127.0.0.1', extra = ''): string => `postgresql://app_platform:pw@${host}:${String(port)}/${db}${extra}`;
const appUrl = (port = 55432, db = DEV_DATABASE_NAME, host = '127.0.0.1', extra = ''): string => `postgresql://app_tenant:pw@${host}:${String(port)}/${db}${extra}`;
const refused = (fn: () => void, re?: RegExp): void => {
  expect(fn).toThrow(ImageSeedGuardError);
  if (re) expect(fn).toThrow(re);
};

describe('resolveImageSeedTarget', () => {
  it('requires SEED_TENANT_SLUG: there is no default slug (the old default "qa-tenant" is gone)', () => {
    expect(() => resolveImageSeedTarget({}, YES)).toThrow(/SEED_TENANT_SLUG is not set/);
    expect(() => resolveImageSeedTarget({ SEED_TENANT_SLUG: '   ' }, YES)).toThrow(ImageSeedGuardError);
    expect(() => resolveImageSeedTarget({ SEED_TENANT_SLUG: 'qa-tenant' }, YES)).toThrow(/not on the QA allowlist/);
  });

  it('12. rejects every tenant outside the allowlist, and muebleria-elegante by name', () => {
    expect(QA_IMAGE_SEED_ALLOWLIST).toEqual(['qa-dev-tenant']);
    for (const slug of ['muebleria-elegante', 'demo', 'empresa-2', 'qa-dev-tenant-3d3920', 'qa-dev-tenant2', 'QA-DEV-TENANT']) {
      expect(() => resolveImageSeedTarget({ SEED_TENANT_SLUG: slug }, YES), slug).toThrow(ImageSeedGuardError);
    }
    expect(() => resolveImageSeedTarget({ SEED_TENANT_SLUG: 'muebleria-elegante' }, YES)).toThrow(/protected/);
  });

  it('accepts the allowlisted QA tenant only with --yes', () => {
    expect(resolveImageSeedTarget({ SEED_TENANT_SLUG: 'qa-dev-tenant' }, YES)).toEqual({ slug: 'qa-dev-tenant' });
    expect(() => resolveImageSeedTarget({ SEED_TENANT_SLUG: 'qa-dev-tenant' }, { yes: false })).toThrow(/--yes/);
  });

  it('no environment variable can extend the allowlist', () => {
    expect(() => resolveImageSeedTarget({ SEED_TENANT_SLUG: 'other', QA_SEED_ALLOWED_TENANTS: 'other', SEED_ALLOWLIST: 'other' }, YES)).toThrow(/allowlist/);
  });
});

describe('parseImageSeedArgs', () => {
  it('accepts only --yes', () => {
    expect(parseImageSeedArgs([])).toEqual({ yes: false });
    expect(parseImageSeedArgs(['--yes'])).toEqual({ yes: true });
    expect(() => parseImageSeedArgs(['--force'])).toThrow(ImageSeedGuardError);
  });
});

describe('assertDevDatabaseTargets: the destination is exactly the development database', () => {
  it('accepts two URLs for the same server and database when it is saas_inventory_dev on the development port', () => {
    expect(() => assertDevDatabaseTargets(platformUrl(), appUrl())).not.toThrow();
    expect(DEV_DATABASE_PORT).toBe(55432);
    // localhost and 127.0.0.1 are the same machine
    expect(() => assertDevDatabaseTargets(platformUrl(55432, DEV_DATABASE_NAME, 'localhost'), appUrl())).not.toThrow();
    // the tolerated parameters do not change the destination
    expect(() => assertDevDatabaseTargets(platformUrl(55432, DEV_DATABASE_NAME, '127.0.0.1', '?sslmode=disable'), appUrl())).not.toThrow();
  });

  it('rejects different hosts', () => {
    refused(() => assertDevDatabaseTargets(platformUrl(), appUrl(55432, DEV_DATABASE_NAME, 'example.com')), /not on this machine/);
    refused(() => assertDevDatabaseTargets(platformUrl(55432, DEV_DATABASE_NAME, '10.0.0.5'), appUrl()), /not on this machine/);
    refused(() => assertDevDatabaseTargets(platformUrl(55432, DEV_DATABASE_NAME, '127.0.0.1.evil.com'), appUrl()));
  });

  it('rejects different ports between the two URLs', () => {
    refused(() => assertDevDatabaseTargets(platformUrl(55432), appUrl(55433)), /different ports/);
  });

  it('rejects different databases between the two URLs', () => {
    refused(() => assertDevDatabaseTargets(platformUrl(55432, 'saas_inventory_dev'), appUrl(55432, 'saas_inventory_verify')), /different databases/);
  });

  it('rejects a database that is not exactly saas_inventory_dev, even if both URLs agree', () => {
    for (const db of ['saas_inventory', 'saas_inventory_verify', 'saas_inventory_dev2', 'postgres', 'SAAS_INVENTORY_DEV']) {
      refused(() => assertDevDatabaseTargets(platformUrl(55432, db), appUrl(55432, db)), /is not "saas_inventory_dev"/);
    }
  });

  it('rejects the testing, restore-test, other-cluster and service ports, and any unknown local port', () => {
    const named: Record<string, number> = { testing: 55450, restoreTest: 55470, fqCluster: 55433, other55440: 55440, installedService: 5432 };
    for (const [name, port] of Object.entries(named)) {
      refused(() => assertDevDatabaseTargets(platformUrl(port), appUrl(port)), /not the development database port/);
      expect(port, name).not.toBe(DEV_DATABASE_PORT);
    }
    for (const port of [5433, 55431, 55435, 6543, 1234, 65535]) {
      refused(() => assertDevDatabaseTargets(platformUrl(port), appUrl(port)), /not the development database port/);
    }
  });

  it('a restored copy is refused even though it holds the same tenants: it lives on its own port', () => {
    refused(() => assertDevDatabaseTargets(platformUrl(55470), appUrl(55470)));
  });

  it('rejects URLs without an explicit port, missing, malformed or not postgres', () => {
    refused(() => assertDevDatabaseTargets('postgresql://u:pw@127.0.0.1/saas_inventory_dev', appUrl()), /no explicit port/);
    refused(() => assertDevDatabaseTargets(undefined, appUrl()), /APP_PLATFORM_DATABASE_URL is not set/);
    refused(() => assertDevDatabaseTargets(platformUrl(), ''), /DATABASE_URL is not set/);
    refused(() => assertDevDatabaseTargets('not a url', appUrl()), /not a valid URL/);
    refused(() => assertDevDatabaseTargets('mysql://u:pw@127.0.0.1:55432/saas_inventory_dev', appUrl()), /not a postgres/);
  });

  it('rejects URL parameters that could change the effective destination', () => {
    for (const extra of ['?host=remote.example', '?hostaddr=10.0.0.5', '?port=5432', '?dbname=other', '?service=prod', '?options=-c%20search_path%3Dx', '?sslmode=disable&host=x']) {
      refused(() => assertDevDatabaseTargets(platformUrl(55432, DEV_DATABASE_NAME, '127.0.0.1', extra), appUrl()), /URL parameter/);
      refused(() => assertDevDatabaseTargets(platformUrl(), appUrl(55432, DEV_DATABASE_NAME, '127.0.0.1', extra)), /URL parameter/);
    }
  });

  it('rejects multi-host lists and socket-style hosts as ambiguous', () => {
    refused(() => assertDevDatabaseTargets('postgresql://u:pw@127.0.0.1:55432,remote.example:5432/saas_inventory_dev', appUrl()), /more than one host/);
    refused(() => assertDevDatabaseTargets('postgresql://u:pw@localhost,remote.example/saas_inventory_dev', appUrl()), /more than one host/);
    refused(() => assertDevDatabaseTargets('postgresql://u:pw@%2Fvar%2Frun%2Fpostgresql:55432/saas_inventory_dev', appUrl()));
    refused(() => assertDevDatabaseTargets('postgresql://u:pw@127.0.0.1:55432/saas_inventory_dev/extra', appUrl()), /exactly one database/);
  });

  it('never puts a URL or a password in an error message', () => {
    for (const bad of [platformUrl(55470), 'postgresql://user:topsecret@db.prod.example:5432/x', 'postgresql://user:topsecret@127.0.0.1:55432/x?host=y']) {
      try {
        assertDevDatabaseTargets(bad, appUrl());
        throw new Error('should have thrown');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain('topsecret');
        expect(message).not.toContain('pw@');
        expect(message).not.toContain('postgresql://');
      }
    }
  });
});

describe('parseDatabaseTarget', () => {
  it('returns the verified host/port/database and normalises localhost', () => {
    expect(parseDatabaseTarget(appUrl(), 'X')).toEqual({ host: '127.0.0.1', port: 55432, database: DEV_DATABASE_NAME });
    expect(parseDatabaseTarget(appUrl(55432, DEV_DATABASE_NAME, 'LOCALHOST'), 'X').host).toBe('127.0.0.1');
  });
});

describe('assertDevS3Endpoint', () => {
  it('accepts exactly the local dev S3 shim', () => {
    expect(DEV_S3_PORT).toBe(9000);
    expect(() => assertDevS3Endpoint('http://127.0.0.1:9000')).not.toThrow();
    expect(() => assertDevS3Endpoint('http://localhost:9000/')).not.toThrow();
  });
  it('rejects a remote endpoint', () => {
    for (const url of ['https://s3.amazonaws.com', 'https://bucket.s3.us-east-1.amazonaws.com:9000', 'http://minio:9000', 'http://10.0.0.5:9000', 'http://127.0.0.1.evil.com:9000']) {
      refused(() => assertDevS3Endpoint(url), /not on this machine/);
    }
  });
  it('rejects a local endpoint on the wrong port, or without an explicit port', () => {
    for (const port of ['9001', '9100', '4000', '55432']) refused(() => assertDevS3Endpoint(`http://127.0.0.1:${port}`), /not the dev S3 shim port/);
    refused(() => assertDevS3Endpoint('http://127.0.0.1'), /no explicit port/);
    refused(() => assertDevS3Endpoint('http://127.0.0.1:80'), /no explicit port/); // 80 is the http default: URL drops it, so it cannot be verified
  });
  it('rejects ambiguous or credentialed endpoints, malformed or missing values', () => {
    refused(() => assertDevS3Endpoint('http://key:secret@127.0.0.1:9000'), /credentials/);
    refused(() => assertDevS3Endpoint('http://127.0.0.1:9000/bucket'), /bare origin/);
    refused(() => assertDevS3Endpoint('http://127.0.0.1:9000/?x=1'), /bare origin/);
    refused(() => assertDevS3Endpoint('ftp://127.0.0.1:9000'), /http\(s\)/);
    refused(() => assertDevS3Endpoint('nonsense'), /not a valid URL/);
    refused(() => assertDevS3Endpoint(undefined), /not set/);
    refused(() => assertDevS3Endpoint(''), /not set/);
  });
  it('does not echo the endpoint or its credentials', () => {
    try {
      assertDevS3Endpoint('http://AKIAEXAMPLE:topsecret@s3.remote.example:9000');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('topsecret');
      expect((error as Error).message).not.toContain('AKIAEXAMPLE');
    }
  });
});

describe('assertTenantUsable', () => {
  it('requires an existing, active tenant', () => {
    expect(assertTenantUsable({ id: 't1', status: 'active' }, 'qa-dev-tenant')).toEqual({ id: 't1' });
    expect(() => assertTenantUsable(undefined, 'qa-dev-tenant')).toThrow(/No tenant found/);
    expect(() => assertTenantUsable({ id: 't1', status: 'suspended' }, 'qa-dev-tenant')).toThrow(/not active/);
  });
});

describe('planImageInserts', () => {
  it('13. never plans an image for a product that already has one', () => {
    const plan = planImageInserts([
      { id: 'a', imageCount: 1 },
      { id: 'b', imageCount: 0 },
      { id: 'c', imageCount: 3 },
    ]);
    expect(plan).toEqual({ toInsert: ['b'], skipped: 2 });
  });
  it('plans nothing when every product has an image, so a repeat run writes nothing', () => {
    expect(planImageInserts([{ id: 'a', imageCount: 1 }, { id: 'b', imageCount: 2 }])).toEqual({ toInsert: [], skipped: 2 });
    expect(planImageInserts([])).toEqual({ toInsert: [], skipped: 0 });
  });
});
