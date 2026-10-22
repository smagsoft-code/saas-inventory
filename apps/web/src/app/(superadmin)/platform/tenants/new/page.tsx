import { redirect } from 'next/navigation';
import { PageContainer } from '../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../../components/ui/card';
import { getPlatformSession } from '../../../../../lib/auth/platform-session';
import { CreateTenantForm } from './create-tenant-form';

export const metadata = { title: 'Crear empresa · Plataforma' };

/** `S-SA-TENANT-NEW` (ADR-0036) — closes `GAP-SA-CREATE-TENANT`. `POST /api/v1/platform/tenants`.
 * No password field — the admin sets their own via the invitation link this form surfaces once. */
export default async function NewPlatformTenantPage(): Promise<React.JSX.Element> {
  const admin = await getPlatformSession();
  if (!admin) {
    redirect('/platform/login');
  }

  return (
    <PageContainer>
      <PageHeader
        title="Crear empresa"
        help="Provisiona una nueva empresa y su administrador inicial. El administrador establece su propia contraseña mediante un enlace de invitación — nunca la defines tú."
      />
      <Card>
        <CardBody>
          <CreateTenantForm />
        </CardBody>
      </Card>
    </PageContainer>
  );
}
