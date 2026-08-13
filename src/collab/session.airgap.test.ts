import { describe, expect, it, vi } from 'vitest';

vi.mock('../airgap', () => ({
  AIRGAP: true,
  AIRGAP_MESSAGE: 'AIRGAP_TEST_MSG',
}));

import { buildCollabInvite, createCollabSession } from './session';

describe('collaboration airgap gate', () => {
  it('refuses collaboration invites and sessions in air-gapped builds', () => {
    expect(() => buildCollabInvite('room', 'key')).toThrow('AIRGAP_TEST_MSG');
    expect(() => createCollabSession({ roomId: 'room', sessionKey: 'key' })).toThrow('AIRGAP_TEST_MSG');
  });
});
