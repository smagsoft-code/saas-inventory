import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_TEMPLATES } from '@saas-inventory/shared';
import ExcelJS from 'exceljs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPlatformIntegrationTestsEnabled } from '../database/helpers';
import { buildMultipartUpload } from '../import/multipart';
import { makeClient, setIntegrationEnv, type Session } from '../sales/sales-harness';
import { expectDenied, pdfText, uniq, xlsxText } from './iso-helpers';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * FASE 19 — the NON-commercial references of the inventory ledger: transfer codes, Excel-import numbers and the free text
 * (`reason`) of manual receipts / adjustments, as served by `GET /inventory/movements`, `GET /reports/kardex` and its xlsx / pdf
 * export. `FINDING-LEDGER-REFERENCE-LEAK` scoped the order / return references by seller; this file asks whether the rest leaks
 * anything a caller could not already read elsewhere, or anything commercial.
 *
 * Questions, answered by the assertions below:
 *  - a transfer movement shows "Transferencia #<code>" — the same code `GET /inventory/transfers` (also `inventory.view`) returns —
 *    and never the transfer's free-text `notes`;
 *  - an import movement shows "Importación #N" and neither the import's reason text, the job uuid nor the file name, to anyone who
 *    lacks `import.execute` (the permission that lets a caller list import jobs);
 *  - the typed `reason` of a manual adjustment is shown as written (it is the stock operator's own text, the audit trail of the
 *    adjustment) — the test pins that behaviour, and pins that a masked order movement never leaks its typed reason.
 */
describe.skipIf(!appPlatformIntegrationTestsEnabled)('ledger — transfer / import references and typed reasons (integration, FASE 19)', () => {
  let app: NestFastifyApplication;
  let c: ReturnType<typeof makeClient>;

  let admin: Session;
  let seller: Session;
  let supervisor: Session;
  let bodega: Session;
  let noPerm: Session;
  let foreignAdmin: Session;

  let locA = '';
  let locB = '';
  let variantX = '';
  let variantY = '';
  let transferId = '';
  let transferCode = '';
  let jobId = '';
  const stamp = () => uniq().replace(/[^a-z0-9]/gi, '');
  const NOTES = `NOTA-TRASLADO-${stamp()}`.toUpperCase();
  const TYPED = `AJUSTE-CLIENTE-SINT-${stamp()}`.toUpperCase();
  const FILE = `archivo-${stamp()}.xlsx`;

  const post = (s: Session, url: string, payload?: unknown, extra: Record<string, string> = {}) =>
    c.inject({ method: 'POST', url, headers: c.writeHeaders(s, extra), ...(payload !== undefined ? { payload } : {}) });
  const get = (s: Session | undefined, url: string) => c.inject({ method: 'GET', url, headers: s ? c.readHeaders(s) : {} });
  const json = <T>(res: LightMyRequestResponse): T => JSON.parse(res.body) as T;

  beforeAll(async () => {
    setIntegrationEnv();
    const { buildImportTestApp } = await import('../import/import-test-app');
    app = await buildImportTestApp();
    await app.init();
    c = makeClient(app);

    admin = await c.registerTenant(`Iso Ops ${stamp()}`, `iso-ops-${stamp()}@example.com`);
    const wh = await c.createWarehouse(admin, `ISOOW-${stamp()}`);
    locA = await c.createLocation(admin, wh, `ISOOA-${stamp()}`);
    locB = await c.createLocation(admin, wh, `ISOOB-${stamp()}`);
    ({ variantId: variantX } = await c.createProductVariant(admin, { sku: `ISOOX-${stamp()}`.toUpperCase(), maxPrice: 120, basePrice: 100, minPrice: 80 }));
    await c.receiveStock(admin, variantX, locA, 100);

    await c.createRole(admin, 'Vendedor ops', [...new Set(DEFAULT_ROLE_TEMPLATES.Vendedor.permissionCodes)]);
    seller = await c.createAndLoginAs(admin, `${stamp()}-seller@example.com`, 'Vendedor ops');
    await c.setUserLocations(admin, seller.user.id, [locA, locB]);
    supervisor = await c.createAndLoginAs(admin, `${stamp()}-supervisor@example.com`, 'Supervisor');
    bodega = await c.createAndLoginAs(admin, `${stamp()}-bodega@example.com`, 'Bodega');
    await c.createRole(admin, 'Sin permisos ops', []);
    noPerm = await c.createAndLoginAs(admin, `${stamp()}-noperm@example.com`, 'Sin permisos ops');
    foreignAdmin = await c.registerTenant(`Iso Ops X ${stamp()}`, `iso-opsx-${stamp()}@example.com`);

    // a manual adjustment with a hand-typed reason that names a (synthetic) customer
    const adj = await post(admin, '/api/v1/inventory/adjustments', { productVariantId: variantX, locationId: locA, movementType: 'ADJUSTMENT_IN', quantity: 3, reason: TYPED });
    expect(adj.statusCode, adj.body).toBe(201);

    // a transfer A -> B with free-text notes, taken through the whole lifecycle
    const created = await post(admin, '/api/v1/inventory/transfers', { sourceLocationId: locA, destinationLocationId: locB, notes: NOTES, items: [{ productVariantId: variantX, quantityRequested: 10 }] });
    expect(created.statusCode, created.body).toBe(201);
    transferId = json<{ id: string }>(created).id;
    for (const step of ['approve', 'prepare']) expect((await post(admin, `/api/v1/inventory/transfers/${transferId}/${step}`)).statusCode, step).toBe(200);
    expect((await post(admin, `/api/v1/inventory/transfers/${transferId}/dispatch`, {})).statusCode).toBe(200);
    const detail = await get(admin, `/api/v1/inventory/transfers/${transferId}`);
    const body = json<{ code?: string; transferCode?: string; items: Array<{ id: string }> }>(detail);
    transferCode = String(body.code ?? body.transferCode ?? '');
    expect(transferCode, 'fixture: transfer code').toBeTruthy();
    const received = await post(admin, `/api/v1/inventory/transfers/${transferId}/receive`, { items: [{ transferItemId: body.items[0]!.id, quantityReceived: 10 }] }, { 'idempotency-key': randomUUID() });
    expect(received.statusCode, received.body).toBe(200);

    // an Excel import that creates variant Y with initial stock
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Import');
    const importedSku = `ISOOY-${stamp()}`.toUpperCase();
    sheet.addRow(['SKU', 'Nombre', 'Precio Max', 'Precio Base', 'Precio Min', 'Cantidad']);
    sheet.addRow([importedSku, 'Producto importado', 150, 120, 100, 25]);
    const mapping = JSON.stringify({ SKU: 'sku', Nombre: 'name', 'Precio Max': 'maxPrice', 'Precio Base': 'basePrice', 'Precio Min': 'minPrice', Cantidad: 'quantity' });
    const { body: multipart, contentType } = buildMultipartUpload({ filename: FILE, contentType: XLSX_MIME, fileContent: Buffer.from(await wb.xlsx.writeBuffer()), fields: { columnMapping: mapping, defaultLocationId: locA } });
    const up = await c.inject({ method: 'POST', url: '/api/v1/imports', headers: { ...c.writeHeaders(admin), 'content-type': contentType }, body: multipart });
    expect(up.statusCode, up.body).toBe(201);
    jobId = json<{ id: string }>(up).id;
    expect((await post(admin, `/api/v1/imports/${jobId}/validate`)).statusCode).toBe(201);
    expect((await post(admin, `/api/v1/imports/${jobId}/confirm`)).statusCode).toBe(201);
    const rows = await get(admin, `/api/v1/imports/${jobId}/rows`);
    variantY = json<{ data: Array<{ matchedProductVariantId: string }> }>(rows).data[0]!.matchedProductVariantId;
    expect(variantY, 'fixture: imported variant').toBeTruthy();
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  type Row = { id: string; movementType: string; referenceType?: string; referenceId?: string; reason?: string; referenceLabel?: string; actorId?: string };
  const movementsUrl = (variantId: string) => `/api/v1/inventory/movements?productVariantId=${variantId}&pageSize=100`;
  const kardexUrl = (variantId: string) => `/api/v1/reports/kardex?productVariantId=${variantId}&locationId=${locA}`;
  const exportUrl = (variantId: string, format: 'xlsx' | 'pdf', location = locA) => `/api/v1/reports/kardex/export?format=${format}&productVariantId=${variantId}&locationId=${location}`;
  const viewers = (): Array<[string, Session]> => [['Vendedor', seller], ['Supervisor', supervisor], ['Bodega', bodega], ['Administrador', admin]];

  it('ISO-LED-08 transfer movements: the label carries the transfer code (also served by /inventory/transfers), never the free-text notes', async () => {
    // the code is not restricted information: any inventory.view holder reads it from the transfer list and detail
    for (const [name, who] of viewers()) {
      const list = await get(who, '/api/v1/inventory/transfers?pageSize=100');
      expect(list.statusCode, `${name} list`).toBe(200);
      expect(list.body.includes(transferCode), `${name}: code in /inventory/transfers`).toBe(true);
    }
    for (const [name, who] of viewers()) {
      const res = await get(who, movementsUrl(variantX));
      expect(res.statusCode, `${name}: ${res.body}`).toBe(200);
      const rows = json<{ data: Row[] }>(res).data.filter((r) => r.referenceType === 'transfer' || r.referenceType === 'transfer_receipt');
      expect(rows.length, `${name}: transfer rows (reservation, release, out, in)`).toBeGreaterThanOrEqual(2);
      for (const row of rows) {
        expect(row.reason, `${name}: transfer movement has no typed reason`).toBeUndefined();
        expect(row.referenceLabel, `${name}: label`).toBe(`Transferencia #${transferCode}`);
      }
      expect(res.body.toUpperCase().includes(NOTES), `${name}: transfer notes in movements`).toBe(false);
    }
  });

  it('ISO-LED-09 Kardex JSON / xlsx / pdf of a transferred variant: transfer code yes, notes no, same for every viewer', async () => {
    for (const [name, who] of viewers()) {
      for (const location of [locA, locB]) {
        const json_ = await get(who, `/api/v1/reports/kardex?productVariantId=${variantX}&locationId=${location}`);
        expect(json_.statusCode, `${name} json`).toBe(200);
        expect(json_.body.toUpperCase().includes(NOTES), `${name}: notes in Kardex json`).toBe(false);
        const xlsx = await get(who, exportUrl(variantX, 'xlsx', location));
        expect(xlsx.statusCode, `${name} xlsx`).toBe(200);
        const xt = await xlsxText(xlsx.rawPayload);
        expect(xt.includes(transferCode.toLowerCase()), `${name}: transfer code in xlsx (${location === locA ? 'source' : 'destination'})`).toBe(true);
        expect(xt.includes(NOTES.toLowerCase()), `${name}: notes in xlsx`).toBe(false);
        const pdf = await get(who, exportUrl(variantX, 'pdf', location));
        expect(pdf.statusCode, `${name} pdf`).toBe(200);
        const pt = pdfText(pdf.rawPayload);
        expect(pt.includes('transferencia'), `${name}: pdf text extracted (non-empty, has the transfer label)`).toBe(true);
        expect(pt.includes(NOTES.toLowerCase()), `${name}: notes in pdf`).toBe(false);
      }
    }
  });

  it('ISO-LED-10 import movements: "Importación #N" only — no job uuid, no file name, no import reason — in movements, Kardex json, xlsx and pdf', async () => {
    for (const [name, who] of viewers()) {
      const res = await get(who, movementsUrl(variantY));
      expect(res.statusCode, `${name}: ${res.body}`).toBe(200);
      const rows = json<{ data: Row[] }>(res).data.filter((r) => r.referenceType === 'import_job');
      expect(rows.length, `${name}: import rows`).toBeGreaterThanOrEqual(1);
      for (const row of rows) {
        expect(row.referenceLabel, `${name}: label`).toMatch(/^Importación #\d+$/);
        expect(row.reason, `${name}: import reason (embeds the job uuid)`).toBeUndefined();
      }
      expect(res.body.includes(jobId), `${name}: import job uuid in movements`).toBe(false);
      expect(res.body.toLowerCase().includes(FILE.toLowerCase()), `${name}: import file name in movements`).toBe(false);

      const kardex = await get(who, kardexUrl(variantY));
      expect(kardex.statusCode, `${name} kardex`).toBe(200);
      expect(kardex.body.includes(jobId), `${name}: job uuid in Kardex json`).toBe(false);
      const xt = await xlsxText((await get(who, exportUrl(variantY, 'xlsx'))).rawPayload);
      expect(xt.includes(jobId.toLowerCase()), `${name}: job uuid in xlsx`).toBe(false);
      expect(xt.includes('importación #'), `${name}: xlsx has the import label`).toBe(true);
      const pt = pdfText((await get(who, exportUrl(variantY, 'pdf'))).rawPayload);
      expect(pt.includes(jobId.toLowerCase()), `${name}: job uuid in pdf`).toBe(false);
      expect(pt.includes('importaci'), `${name}: pdf has the import label`).toBe(true);
    }
  });

  it('ISO-LED-11 typed reason of a manual adjustment is shown as written to every ledger reader (operator audit trail) — pinned, and absent from masked order rows', async () => {
    for (const [name, who] of viewers()) {
      const res = await get(who, movementsUrl(variantX));
      const row = json<{ data: Row[] }>(res).data.find((r) => r.reason === TYPED);
      expect(row, `${name}: adjustment reason visible`).toBeDefined();
      expect(row!.movementType).toBe('ADJUSTMENT_IN');
      const xt = await xlsxText((await get(who, exportUrl(variantX, 'xlsx'))).rawPayload);
      expect(xt.includes(TYPED.toLowerCase()), `${name}: reason in xlsx`).toBe(true);
    }
  });

  it('ISO-LED-12 no permission / anonymous / other tenant: the same routes serve nothing', async () => {
    for (const url of [movementsUrl(variantX), kardexUrl(variantX), exportUrl(variantX, 'xlsx'), exportUrl(variantX, 'pdf'), '/api/v1/inventory/transfers', `/api/v1/inventory/transfers/${transferId}`, '/api/v1/inventory/transfers/export?format=xlsx']) {
      expectDenied(await get(noPerm, url), [403], `no permission ${url}`);
      expectDenied(await get(undefined, url), [401], `anonymous ${url}`);
    }
    expectDenied(await get(foreignAdmin, `/api/v1/inventory/transfers/${transferId}`), [404], 'foreign transfer by id');
    expectDenied(await get(seller, '/api/v1/inventory/transfers/not-a-uuid'), [400], 'malformed transfer id');
    const foreign = await get(foreignAdmin, movementsUrl(variantX));
    if (foreign.statusCode === 200) expect(json<{ data: unknown[] }>(foreign).data).toHaveLength(0);
    for (const marker of [transferCode, NOTES, TYPED, jobId]) expect(foreign.body.toUpperCase().includes(marker.toUpperCase()), `foreign movements leak ${marker}`).toBe(false);
    const foreignKardex = await get(foreignAdmin, kardexUrl(variantX));
    for (const marker of [transferCode, NOTES, TYPED]) expect(foreignKardex.body.toUpperCase().includes(marker.toUpperCase()), `foreign kardex leaks ${marker}`).toBe(false);
    // import jobs stay an import.execute surface: the seller cannot list them, so the job uuid is not reachable another way
    expectDenied(await get(seller, '/api/v1/imports'), [403], 'seller lists import jobs');
    expectDenied(await get(seller, `/api/v1/imports/${jobId}`), [403], 'seller reads an import job');
  });
});
