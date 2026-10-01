import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';

/** ADR-0036 §10: motivo obligatorio, para ambos modos (read/write) — la UI de plataforma
 * siempre lo pide, aunque el guard únicamente lo exige de forma estructural (NOT NULL) sin
 * distinguir por modo a nivel de base de datos. */
export class StartSupportSessionDto {
  @ApiProperty({ enum: ['read', 'write'] })
  @IsIn(['read', 'write'])
  mode!: 'read' | 'write';

  @ApiProperty({ type: String, minLength: 3, maxLength: 500 })
  @IsString()
  @Length(3, 500)
  reason!: string;
}
