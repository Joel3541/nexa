import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SessionContext } from '@nexa/types';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';
import { Button, Field, Input } from '@/components/ui/primitives';
import { AuthLayout } from './layout';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const { applySession } = useSession();
  const navigate = useNavigate();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const session = await api.post<SessionContext>('/auth/login', { email, password });
      applySession(session);
      navigate(session.business ? '/app' : '/onboarding', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.message);
        setFields(caught.fields ?? {});
      } else {
        setError('We could not reach NEXA. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  function useDemoAccount() {
    setEmail('demo@nexa.app');
    setPassword('NexaDemo2026');
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to pick up where your business left off."
      footer={
        <>
          New to NEXA?{' '}
          <Link to="/sign-up" className="font-medium text-brand-600 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <Field label="Email" htmlFor="email" error={fields.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@business.com"
            invalid={Boolean(fields.email)}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={fields.password}
          hint={
            <Link to="/forgot-password" className="text-brand-600 hover:underline">
              Forgot your password?
            </Link>
          }
        >
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            invalid={Boolean(fields.password)}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={loading}>
          Sign in
        </Button>

        <button
          type="button"
          onClick={useDemoAccount}
          className="w-full rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-2.5 text-[13px] muted transition-colors hover:bg-[var(--surface-muted)]"
        >
          Explore the demo business — fills in the seeded Aura Beauty GH account
        </button>
      </form>
    </AuthLayout>
  );
}
