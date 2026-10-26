import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { AttributesService } from './attributes.service';
import {
  AttributeDefinitionResponseDto,
  CreateAttributeDefinitionDto,
  UpdateAttributeDefinitionDto,
} from './dto/attribute-definition.dto';
import { AttributeOptionResponseDto, CreateAttributeOptionDto, UpdateAttributeOptionDto } from './dto/attribute-option.dto';
import { MeasurementUnitResponseDto } from './dto/measurement-unit-response.dto';

/**
 * `attribute_definitions`/`attribute_options` administration (§6-§9) — reads ride on `products.view`
 * (the general catalog-view permission, per database.md's "read access rides on whatever view
 * permission already gates that kind of list" convention); writes require `catalog.attributes.manage`
 * (grouped, per database.md, since one role configures all three governance tables together).
 */
@ApiTags('catalog-attributes')
@Controller()
export class AttributesController {
  constructor(private readonly attributesService: AttributesService) {}

  @Get('attribute-definitions')
  @RequirePermissions('products.view')
  @ApiOkResponse({ type: AttributeDefinitionResponseDto, isArray: true })
  async listDefinitions(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: string,
  ): Promise<AttributeDefinitionResponseDto[]> {
    return this.attributesService.listDefinitions(tenantId, status);
  }

  @Post('attribute-definitions')
  @RequirePermissions('catalog.attributes.manage')
  @ApiCreatedResponse({ type: AttributeDefinitionResponseDto })
  async createDefinition(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateAttributeDefinitionDto,
  ): Promise<AttributeDefinitionResponseDto> {
    return this.attributesService.createDefinition(tenantId, dto);
  }

  @Patch('attribute-definitions/:id')
  @RequirePermissions('catalog.attributes.manage')
  @ApiOkResponse({ type: AttributeDefinitionResponseDto })
  async updateDefinition(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttributeDefinitionDto,
  ): Promise<AttributeDefinitionResponseDto> {
    return this.attributesService.updateDefinition(tenantId, id, dto);
  }

  @Get('attribute-definitions/:id/options')
  @RequirePermissions('products.view')
  @ApiOkResponse({ type: AttributeOptionResponseDto, isArray: true })
  async listOptions(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) definitionId: string,
  ): Promise<AttributeOptionResponseDto[]> {
    return this.attributesService.listOptions(tenantId, definitionId);
  }

  @Post('attribute-definitions/:id/options')
  @RequirePermissions('catalog.attributes.manage')
  @ApiCreatedResponse({ type: AttributeOptionResponseDto })
  async createOption(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) definitionId: string,
    @Body() dto: CreateAttributeOptionDto,
  ): Promise<AttributeOptionResponseDto> {
    return this.attributesService.createOption(tenantId, definitionId, dto);
  }

  @Patch('attribute-definitions/:id/options/:optionId')
  @RequirePermissions('catalog.attributes.manage')
  @ApiOkResponse({ type: AttributeOptionResponseDto })
  async updateOption(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) definitionId: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @Body() dto: UpdateAttributeOptionDto,
  ): Promise<AttributeOptionResponseDto> {
    return this.attributesService.updateOption(tenantId, definitionId, optionId, dto);
  }

  @Get('measurement-units')
  @ApiOkResponse({ type: MeasurementUnitResponseDto, isArray: true })
  async listUnits(@CurrentTenant() tenantId: string): Promise<MeasurementUnitResponseDto[]> {
    return this.attributesService.listUnits(tenantId);
  }
}
