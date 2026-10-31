import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadQaAdmin, parseEnvText, QA_PASSWORD_MIN_LENGTH, QaCredentialsError } from './qa-credentials';

// A throwaway value built at run time, used only to prove it is never echoed. It is not a credential of any system.
const SAMPLE = `t${'x'.repeat(QA_PASSWORD_MIN_LENGTH)}-sample`;

describe('loadQaAdmin', () => {
  it('works with only the password set and fills the non-secret defaults', () => {
    const qa = loadQaAdmin({ QA_ADMIN_PASSWORD: SAMPLE });
    assert.equal(qa.password, SAMPLE);
    assert.equal(qa.email, 'qa-admin@dev.local');
    assert.equal(qa.companyName, 'QA Dev Tenant');
    assert.equal(qa.fullName, 'QA Admin');
  });
  it('lets the non-secret values be overridden', () => {
    const qa = loadQaAdmin({ QA_ADMIN_PASSWORD: SAMPLE, QA_ADMIN_EMAIL: 'other@dev.local', QA_ADMIN_COMPANY_NAME: 'X', QA_ADMIN_FULL_NAME: 'Y' });
    assert.deepEqual([qa.email, qa.companyName, qa.fullName], ['other@dev.local', 'X', 'Y']);
  });
  it('fails safely, naming only the variable, when the password is missing or empty', () => {
    for (const env of [{}, { QA_ADMIN_PASSWORD: '' }]) {
      assert.throws(() => loadQaAdmin(env), (error: unknown) => error instanceof QaCredentialsError && error.message.includes('QA_ADMIN_PASSWORD'));
    }
  });
  it('never has a default password', () => {
    assert.throws(() => loadQaAdmin({ QA_ADMIN_EMAIL: 'qa-admin@dev.local' }), QaCredentialsError);
  });
  it('rejects too short and too long passwords without echoing them', () => {
    for (const password of ['short', 'y'.repeat(129)]) {
      assert.throws(
        () => loadQaAdmin({ QA_ADMIN_PASSWORD: password }),
        (error: unknown) => error instanceof QaCredentialsError && !error.message.includes(password),
      );
    }
  });
  it('rejects an invalid email without echoing the password', () => {
    assert.throws(
      () => loadQaAdmin({ QA_ADMIN_PASSWORD: SAMPLE, QA_ADMIN_EMAIL: 'not-an-email' }),
      (error: unknown) => error instanceof QaCredentialsError && !error.message.includes(SAMPLE),
    );
  });
});

describe('parseEnvText', () => {
  it('reads KEY=VALUE lines and skips comments and blanks', () => {
    assert.deepEqual(parseEnvText('# c\n\nA=1\r\nB = two \n#C=3\nbad line\n'), { A: '1', B: 'two' });
  });
});
