import { BadRequestException, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ProductImageResponseDto } from './dto/product-image-response.dto';
import { ProductImagesService } from './product-images.service';

/** Reads the required `file` part plus an optional `productVariantId` text field off a multipart
 * request — `@fastify/multipart`'s own `request.parts()`, the same pattern
 * `ImportJobsController.readUploadParts` established (no class-validator DTO can see a multipart
 * body). `productVariantId` scopes the image to one variant (e.g. a bed's own material/color
 * photo) instead of the whole product; omitted, the image is product-wide as before. */
async function readImageUpload(
  request: FastifyRequest,
): Promise<{ buffer: Buffer; mimeType: string; productVariantId?: string }> {
  let buffer: Buffer | undefined;
  let mimeType = '';
  let productVariantId: string | undefined;
  for await (const part of request.parts()) {
    if (part.type === 'file' && part.fieldname === 'file') {
      mimeType = part.mimetype;
      buffer = await part.toBuffer();
    } else if (part.type === 'field' && part.fieldname === 'productVariantId' && typeof part.value === 'string' && part.value) {
      productVariantId = part.value;
    }
  }
  if (!buffer) {
    throw new BadRequestException('No file was uploaded (expected a multipart "file" field).');
  }
  return { buffer, mimeType, ...(productVariantId ? { productVariantId } : {}) };
}

/**
 * `product_images` (OUI-006). Same permission split as the rest of the products surface —
 * `products.view` to see/download, `products.manage` to upload/delete. Nested under `/products`
 * but a separate controller class from `ProductsController` (a distinct storage dependency,
 * `ObjectStorageService`, deliberately not threaded into that already-large class).
 */
@ApiTags('products')
@Controller('products/:productId/images')
export class ProductImagesController {
  constructor(private readonly productImagesService: ProductImagesService) {}

  @Get()
  @RequirePermissions('products.view')
  @ApiOkResponse({ type: ProductImageResponseDto, isArray: true })
  async list(
    @CurrentTenant() tenantId: string,
    @Param('productId') productId: string,
  ): Promise<ProductImageResponseDto[]> {
    return this.productImagesService.list(tenantId, productId);
  }

  @Post()
  @RequirePermissions('products.manage')
  @ApiCreatedResponse({ type: ProductImageResponseDto })
  async upload(
    @CurrentTenant() tenantId: string,
    @Param('productId') productId: string,
    @Req() request: FastifyRequest,
  ): Promise<ProductImageResponseDto> {
    const { productVariantId, ...file } = await readImageUpload(request);
    return this.productImagesService.upload(tenantId, productId, file, productVariantId);
  }

  @Get(':imageId')
  @RequirePermissions('products.view')
  async getImage(
    @CurrentTenant() tenantId: string,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const { buffer, mimeType } = await this.productImagesService.getImageBinary(tenantId, productId, imageId);
    void reply.header('Content-Type', mimeType);
    // A day is plenty — an image is replaced by uploading a new one (a new id/URL), never mutated
    // in place, so caching the old URL aggressively is safe.
    void reply.header('Cache-Control', 'private, max-age=86400');
    return buffer;
  }

  @Delete(':imageId')
  @RequirePermissions('products.manage')
  @HttpCode(204)
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ): Promise<void> {
    await this.productImagesService.delete(tenantId, productId, imageId);
  }
}
