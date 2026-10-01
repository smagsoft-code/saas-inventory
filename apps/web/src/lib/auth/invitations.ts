import { serverApiFetch } from '../api/server';

/** `GET /api/v1/auth/invitations/:token` (`@Public`) — ADR-0036. Always 200; validity is carried in
 * the body, not the status code, so an invalid/expired/revoked/accepted link renders a normal page,
 * never a raw error boundary. `reason` is only present when `valid` is `false`. */
export type InvitationInvalidReason = 'not_found' | 'accepted' | 'revoked' | 'expired';

export interface InvitationInfo {
  valid: boolean;
  reason?: InvitationInvalidReason;
  tenantName?: string;
  email?: string;
}

export async function getInvitationInfo(token: string): Promise<InvitationInfo> {
  return serverApiFetch<InvitationInfo>(`/api/v1/auth/invitations/${encodeURIComponent(token)}`);
}
