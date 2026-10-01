import Link from 'next/link';
import { getInvitationInfo, type InvitationInvalidReason } from '../../../../lib/auth/invitations';
import { AcceptInvitationForm } from './accept-invitation-form';

export const metadata = { title: 'Activar cuenta · SaaS Inventory' };

const INVALID_MESSAGES: Record<InvitationInvalidReason, string> = {
  expired: 'La invitación ha expirado. Solicita al administrador de la plataforma que la reenvíe.',
  accepted: 'Esta invitación ya fue utilizada. Si ya activaste tu cuenta, inicia sesión normalmente.',
  revoked: 'La invitación ya no es válida.',
  not_found: 'La invitación ya no es válida.',
};

/**
 * ADR-0036 — the public landing for `${APP_URL}/accept-invitation/${token}` (built by the backend's
 * `buildInvitationUrl`). Always renders a normal page, never a raw error boundary: `GET
 * /auth/invitations/:token` is `@Public` and always 200, with validity carried in the body
 * (`lib/auth/invitations.ts`). No session is required or assumed — an already-authenticated visitor
 * who opens this link still goes through the same flow (their existing session is irrelevant to
 * activating a *different* identity's credential).
 */
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  const info = await getInvitationInfo(token);

  if (!info.valid) {
    const message = info.reason ? INVALID_MESSAGES[info.reason] : INVALID_MESSAGES.not_found;
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Enlace no disponible</h1>
        <p className="text-sm text-slate-500">{message}</p>
        <Link href="/login" className="text-sm font-medium text-slate-900 underline">
          Ir a iniciar sesión
        </Link>
      </main>
    );
  }

  return <AcceptInvitationForm token={token} tenantName={info.tenantName ?? ''} email={info.email ?? ''} />;
}
