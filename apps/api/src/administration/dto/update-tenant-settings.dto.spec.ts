import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateTenantSettingsDto } from './update-tenant-settings.dto';

async function timezoneErrors(timezone: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(UpdateTenantSettingsDto, { timezone }));
  return errors.filter((e) => e.property === 'timezone').flatMap((e) => Object.keys(e.constraints ?? {}));
}

/**
 * DEFECT-TZ-DEFAULT-UNSETTABLE — `UTC` is the platform default timezone but is NOT in
 * `Intl.supportedValuesOf('timeZone')`, so it used to be rejected on update.
 */
describe('UpdateTenantSettingsDto.timezone', () => {
  it('the premise of the defect still holds on this runtime: the Intl list does not contain UTC', () => {
    // If a future Node adds UTC to the list this assertion tells us the explicit entry is redundant
    // (harmless), instead of silently hiding the reason it exists.
    expect(Intl.supportedValuesOf('timeZone')).not.toContain('UTC');
    expect(() => new Intl.DateTimeFormat('en', { timeZone: 'UTC' })).not.toThrow();
  });

  it('accepts UTC', async () => {
    expect(await timezoneErrors('UTC')).toEqual([]);
  });

  it('still accepts real IANA names', async () => {
    for (const zone of ['America/Guayaquil', 'America/Bogota', 'Europe/Madrid', 'Asia/Tokyo']) {
      expect(await timezoneErrors(zone), zone).toEqual([]);
    }
  });

  it('still rejects invalid identifiers (exact match only)', async () => {
    for (const bad of ['Mars/Phobos', 'utc', 'UTC ', ' UTC', 'UTC+5', 'Etc/UTC', 'GMT', '', 'Not/AZone', 123, {}, []]) {
      expect(await timezoneErrors(bad), JSON.stringify(bad)).toContain('isIn');
    }
  });

  it('an omitted timezone is allowed (PATCH semantics: leave it unchanged)', async () => {
    const errors = await validate(plainToInstance(UpdateTenantSettingsDto, {}));
    expect(errors.filter((e) => e.property === 'timezone')).toEqual([]);
  });
});
