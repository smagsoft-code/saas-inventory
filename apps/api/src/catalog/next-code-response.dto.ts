import { ApiProperty } from '@nestjs/swagger';

/** The next automatic code of a per-tenant sequence (`PRD-001`, `CAT-001`, …). A *preview*: the real
 * one is assigned atomically when the record is created without a code, so two people creating at the
 * same time never collide. */
export class NextCodeResponseDto {
  @ApiProperty({ type: String, example: 'PRD-001' })
  code!: string;
}
