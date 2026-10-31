/**
 * TEST SUPPORT (D-8E.26-B4.9) — never imported by the seed CLI. It validates the bodies the seed sends against the REAL request DTOs of the backend
 * (`apps/api/src/**\/dto/*.dto.ts`), with the same options as the API's global ValidationPipe (`main.ts`: whitelist, forbidNonWhitelisted, transform).
 * B4.1–B4.7 had fakes that accepted any body; the backend rejected three of them (see QA-SEED-RUNBOOK.md §6). Using the real classes means a DTO that
 * changes is noticed by the next unit test run, not by a failed seed.
 *
 * It imports only DTO files: plain classes decorated with class-validator / class-transformer / @nestjs/swagger. No Nest module, service, repository,
 * database client or HTTP server is loaded, so nothing here can open a connection. `class-validator` and `class-transformer` are resolved from
 * `apps/api` (where the DTOs themselves resolve them); this tool package does not depend on them.
 */
import { createRequire } from 'node:module';
import './qa-contract-setup';
import { CreateAdjustmentDto } from '../../apps/api/src/inventory/movements/dto/create-adjustment.dto';
import { CreateLocationDto } from '../../apps/api/src/inventory/locations/dto/create-location.dto';
import { CreateTransferDto } from '../../apps/api/src/inventory/transfers/dto/create-transfer.dto';
import { DispatchTransferDto } from '../../apps/api/src/inventory/transfers/dto/dispatch-transfer.dto';
import { ReceiveTransferDto } from '../../apps/api/src/inventory/transfers/dto/receive-transfer.dto';
import { CreateWarehouseDto } from '../../apps/api/src/inventory/warehouses/dto/create-warehouse.dto';
import { CreateCategoryDto } from '../../apps/api/src/catalog/categories/dto/create-category.dto';
import { CreateProductDto } from '../../apps/api/src/catalog/products/dto/create-product.dto';
import { UpdateProductDto } from '../../apps/api/src/catalog/products/dto/update-product.dto';
import { UpdateVariantDto } from '../../apps/api/src/catalog/products/dto/update-variant.dto';
import { VariantFieldsDto } from '../../apps/api/src/catalog/products/dto/variant-fields.dto';
import { CreateQrCodeDto } from '../../apps/api/src/qr/qr-codes/dto/create-qr-code.dto';
import { AddCartItemDto } from '../../apps/api/src/sales/carts/dto/add-cart-item.dto';
import { CreateCartDto } from '../../apps/api/src/sales/carts/dto/create-cart.dto';
import { CreateCustomerDto } from '../../apps/api/src/sales/customers/dto/create-customer.dto';
import { ConfirmOrderDto } from '../../apps/api/src/sales/orders/dto/confirm-order.dto';
import { CreateOrderDto } from '../../apps/api/src/sales/orders/dto/create-order.dto';
import { CreateReturnDto } from '../../apps/api/src/sales/returns/dto/create-return.dto';
import { InspectReturnDto } from '../../apps/api/src/sales/returns/dto/inspect-return.dto';

export {
  AddCartItemDto,
  ConfirmOrderDto,
  CreateAdjustmentDto,
  CreateCartDto,
  CreateCustomerDto,
  CreateOrderDto,
  CreateReturnDto,
  CreateTransferDto,
  DispatchTransferDto,
  InspectReturnDto,
  ReceiveTransferDto,
};

type DtoClass = new () => object;
interface ValidationErrorLike {
  property: string;
  constraints?: Record<string, string>;
  children?: ValidationErrorLike[];
}
interface Validator {
  validateSync(value: object, options: Record<string, unknown>): ValidationErrorLike[];
}
interface Transformer {
  plainToInstance(cls: DtoClass, plain: unknown): object;
}

const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const validator = apiRequire('class-validator') as Validator;
const transformer = apiRequire('class-transformer') as Transformer;

function flatten(errors: readonly ValidationErrorLike[], prefix = ''): string[] {
  return errors.flatMap((e) => {
    const path = `${prefix}${e.property}`;
    return [...Object.values(e.constraints ?? {}).map((message) => `${path}: ${message}`), ...flatten(e.children ?? [], `${path}.`)];
  });
}

/** The messages the API's ValidationPipe would answer 400 with for this body; empty = the DTO accepts it. */
export function contractErrors(dto: DtoClass, body: unknown): string[] {
  const instance = transformer.plainToInstance(dto, body ?? {});
  // Same options as `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`; Nest also leaves forbidUnknownValues off.
  return flatten(validator.validateSync(instance, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: false }));
}

/** The request DTO of each endpoint the seed calls with a body. Endpoints the seed calls without a body (cancel, approve, prepare, resolve) have no entry. */
const ROUTES: ReadonlyArray<{ method: string; pattern: RegExp; dto: DtoClass }> = [
  { method: 'POST', pattern: /^\/api\/v1\/warehouses$/, dto: CreateWarehouseDto },
  { method: 'POST', pattern: /^\/api\/v1\/locations$/, dto: CreateLocationDto },
  { method: 'POST', pattern: /^\/api\/v1\/categories$/, dto: CreateCategoryDto },
  { method: 'POST', pattern: /^\/api\/v1\/products$/, dto: CreateProductDto },
  { method: 'PATCH', pattern: /^\/api\/v1\/products\/[^/]+$/, dto: UpdateProductDto },
  { method: 'POST', pattern: /^\/api\/v1\/products\/[^/]+\/variants$/, dto: VariantFieldsDto },
  { method: 'PATCH', pattern: /^\/api\/v1\/products\/[^/]+\/variants\/[^/]+$/, dto: UpdateVariantDto },
  { method: 'POST', pattern: /^\/api\/v1\/inventory\/adjustments$/, dto: CreateAdjustmentDto },
  { method: 'POST', pattern: /^\/api\/v1\/qr-codes$/, dto: CreateQrCodeDto },
  { method: 'POST', pattern: /^\/api\/v1\/customers$/, dto: CreateCustomerDto },
  { method: 'POST', pattern: /^\/api\/v1\/cart$/, dto: CreateCartDto },
  { method: 'POST', pattern: /^\/api\/v1\/cart\/items$/, dto: AddCartItemDto },
  { method: 'POST', pattern: /^\/api\/v1\/orders$/, dto: CreateOrderDto },
  { method: 'POST', pattern: /^\/api\/v1\/orders\/[^/]+\/confirm$/, dto: ConfirmOrderDto },
  { method: 'POST', pattern: /^\/api\/v1\/sales-returns$/, dto: CreateReturnDto },
  { method: 'POST', pattern: /^\/api\/v1\/sales-returns\/[^/]+\/inspect$/, dto: InspectReturnDto },
  { method: 'POST', pattern: /^\/api\/v1\/inventory\/transfers$/, dto: CreateTransferDto },
  { method: 'POST', pattern: /^\/api\/v1\/inventory\/transfers\/[^/]+\/dispatch$/, dto: DispatchTransferDto },
  { method: 'POST', pattern: /^\/api\/v1\/inventory\/transfers\/[^/]+\/receive$/, dto: ReceiveTransferDto },
];

export function dtoFor(method: string, pathname: string): DtoClass | undefined {
  return ROUTES.find((r) => r.method === method && r.pattern.test(pathname))?.dto;
}
