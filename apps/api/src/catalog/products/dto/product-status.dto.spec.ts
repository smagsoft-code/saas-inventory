import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ProductCatalogQueryDto } from '../../../reports/products/dto/product-catalog-query.dto';
import { ListProductsQueryDto } from './list-products-query.dto';
import { UpdateProductDto } from './update-product.dto';

/** There is no "draft" product state any more (migration 0046): only active / discontinued. */
describe('product status DTOs', () => {
  it.each([
    ['UpdateProductDto', UpdateProductDto, 'status'],
    ['ListProductsQueryDto', ListProductsQueryDto, 'status'],
    ['ProductCatalogQueryDto', ProductCatalogQueryDto, 'productStatus'],
  ] as const)('%s accepts active and discontinued and rejects draft', async (_name, cls, field) => {
    for (const value of ['active', 'discontinued']) {
      expect(await validate(plainToInstance(cls as never, { [field]: value }) as object)).toEqual([]);
    }
    const errors = await validate(plainToInstance(cls as never, { [field]: 'draft' }) as object);
    expect(errors.map((e) => e.property)).toContain(field);
  });
});
