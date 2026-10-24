import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AcceptInvitationDto } from './accept-invitation.dto';
import { RegisterDto } from './register.dto';

async function errorsFor<T extends object>(cls: new () => T, payload: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, payload));
  return errors.map((e) => e.property);
}

const company = { companyName: 'Acme', email: 'a@acme.test', fullName: 'Ana Admin' };

describe('company-creation password has no rule beyond "not empty"', () => {
  it.each(['1', 'abc', 'sin-numeros-ni-mayusculas', '          ', 'x'.repeat(1024)])('register accepts %j', async (password) => {
    expect(await errorsFor(RegisterDto, { ...company, password })).toEqual([]);
  });

  it('register still refuses an empty or missing password, and a hash-DoS sized one', async () => {
    expect(await errorsFor(RegisterDto, { ...company, password: '' })).toEqual(['password']);
    expect(await errorsFor(RegisterDto, company)).toEqual(['password']);
    expect(await errorsFor(RegisterDto, { ...company, password: 'x'.repeat(1025) })).toEqual(['password']);
  });

  it('accepting an invitation follows the same rule', async () => {
    const token = 't'.repeat(32);
    expect(await errorsFor(AcceptInvitationDto, { token, password: '1' })).toEqual([]);
    expect(await errorsFor(AcceptInvitationDto, { token, password: '' })).toEqual(['password']);
  });
});
