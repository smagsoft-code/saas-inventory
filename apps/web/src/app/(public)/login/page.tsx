import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata = { title: 'Iniciar sesión · SaaS Inventory' };

export default function LoginPage(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Iniciar sesión</h1>
        <p className="text-sm text-slate-500">Ingresa tu correo y contraseña.</p>
      </div>
      {/* useSearchParams (returnTo) requires a Suspense boundary during prerender. */}
      <Suspense fallback={<p className="text-sm text-slate-400">Cargando…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
