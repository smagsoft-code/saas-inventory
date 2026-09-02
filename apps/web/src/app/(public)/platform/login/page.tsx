import { Suspense } from 'react';
import { PlatformLoginForm } from './platform-login-form';

export const metadata = { title: 'Platform sign in · SaaS Inventory' };

/**
 * Platform-admin sign in — a separate surface from the tenant `/login` (F17-01 §3.C / §11).
 * `POST /platform/auth/login` (`@Public`), distinct `platform_*` session cookies. No
 * self-registration: platform admins are provisioned out-of-band.
 */
export default function PlatformLoginPage(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Platform sign in</h1>
        <p className="text-sm text-slate-500">Administrator access to the platform.</p>
      </div>
      {/* useSearchParams (returnTo) requires a Suspense boundary during prerender. */}
      <Suspense fallback={<p className="text-sm text-slate-400">Loading…</p>}>
        <PlatformLoginForm />
      </Suspense>
    </main>
  );
}
