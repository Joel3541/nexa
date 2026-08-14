import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiRequestError, api } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui/primitives';
import { AuthLayout } from './layout';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="If that address has a NEXA account, a reset link is on its way. The link expires in one hour."
        footer={
          <Link to="/sign-in" className="font-medium text-brand-600 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-[13.5px] muted">
          In development, no email provider is configured — the reset link is printed in the API server log instead of
          being delivered.
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link."
      footer={
        <Link to="/sign-in" className="font-medium text-brand-600 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-700">
            {error}
          </div>
        )}
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@business.com"
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={loading}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
