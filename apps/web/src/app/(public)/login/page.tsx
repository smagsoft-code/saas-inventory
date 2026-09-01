import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · SaaS Inventory' };

export default function LoginPage(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
        <p className="text-sm text-slate-500">Enter your email and password.</p>
      </div>
      {/* useSearchParams (returnTo) requires a Suspense boundary during prerender. */}
      <Suspense fallback={<p className="text-sm text-slate-400">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
