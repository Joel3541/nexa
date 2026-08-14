import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiRequestError, api } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui/primitives';
import { AuthLayout } from './layout';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/sign-in', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        title="That link isn't valid"
        subtitle="Reset links expire after an hour and can only be used once."
        footer={
          <Link to="/forgot-password" className="font-medium text-brand-600 hover:underline">
            Request a new link
          </Link>
        }
      >
        <div />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="You'll be signed out of all devices for safety.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-700">
            {error}
          </div>
        )}
        <Field label="New password" htmlFor="password" hint="At least 10 characters, with a letter and a number.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={mismatch ? "Passwords don't match" : undefined}>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            invalid={mismatch}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={loading} disabled={mismatch}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}
