import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SessionContext } from '@nexa/types';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';
import { Button, Field, Input, cx } from '@/components/ui/primitives';
import { AuthLayout } from './layout';

/** Mirrors the server rule in `passwordSchema` so feedback is immediate. */
function passwordChecks(value: string) {
  return [
    { label: 'At least 10 characters', ok: value.length >= 10 },
    { label: 'A letter and a number', ok: /[a-zA-Z]/.test(value) && /[0-9]/.test(value) },
  ];
}

export default function SignUpPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const { applySession } = useSession();
  const navigate = useNavigate();

  const checks = passwordChecks(password);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const session = await api.post<SessionContext>('/auth/register', { fullName, email, password });
      applySession(session);
      navigate('/onboarding', { replace: true });
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

  return (
    <AuthLayout
      title="Start running your business on NEXA"
      subtitle="Free to start. No card required."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/sign-in" className="font-medium text-accent hover:underline">
            Sign in
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

        <Field label="Your name" htmlFor="fullName" error={fields.fullName}>
          <Input
            id="fullName"
            autoComplete="name"
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Ama Serwaa"
            invalid={Boolean(fields.fullName)}
          />
        </Field>

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

        <Field label="Password" htmlFor="password" error={fields.password}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            invalid={Boolean(fields.password)}
          />
          <ul className="mt-2 space-y-1">
            {checks.map((check) => (
              <li key={check.label} className={cx('flex items-center gap-1.5 text-[12.5px]', check.ok ? 'text-positive' : 'subtle')}>
                <span aria-hidden="true">{check.ok ? '✓' : '○'}</span>
                {check.label}
              </li>
            ))}
          </ul>
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full justify-center"
          loading={loading}
          disabled={!checks.every((check) => check.ok)}
        >
          Create account
        </Button>

        <p className="text-[12px] subtle">
          By creating an account you agree to keep your business data accurate. NEXA never shares it.
        </p>
      </form>
    </AuthLayout>
  );
}
