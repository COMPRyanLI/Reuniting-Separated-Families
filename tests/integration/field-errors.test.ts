import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ids, useHarness } from '../support/harness.js';

const h = useHarness();
const API = '/api/v1';
const key = () => `k-${randomUUID()}`;

// Found in the 200% zoom review: an empty contact code said "Enter the secret." next to a field
// labelled "Contact code". Each secret-like field names itself, so the error identifies its field.
describe('UX-01 field errors name the field they belong to', () => {
  it('contact code, recovery secret and assistance secret each have their own message', async () => {
    const maya = await h.login('maya');
    const request = await maya.post(`${API}/requests`, { routeType: 'CODE', contactCode: '', introduction: 'Hello' }, { 'Idempotency-Key': key() });
    expect(request.status).toBe(422);
    expect(request.body.error.fieldErrors).toContainEqual({ path: 'contactCode', message: 'Enter the contact code.' });

    const recover = await h.client().post(`${API}/auth/recover`, { username: 'maya', recoverySecret: '', newPassword: 'brand new passphrase 2' });
    expect(recover.status).toBe(422);
    expect(recover.body.error.fieldErrors).toContainEqual({ path: 'recoverySecret', message: 'Enter your recovery secret.' });

    const wA = await h.loginStaff('wA');
    const verify = await wA.post(`${API}/staff/cases/${ids.case('sam')}/verify`, { assistanceSecret: '' });
    expect(verify.status).toBe(422);
    expect(verify.body.error.fieldErrors).toContainEqual({ path: 'assistanceSecret', message: 'Enter the assistance secret.' });
  });
});
