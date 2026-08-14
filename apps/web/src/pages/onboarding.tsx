import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { CountryDefinition } from '@nexa/config/locale';
import type { SessionContext } from '@nexa/types';
import { Wordmark } from '@/components/icons';
import { Button, Card, Field, Input, Select, Textarea, cx } from '@/components/ui/primitives';
import { LoadingState } from '@/components/ui/feedback';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

interface Reference {
  countries: CountryDefinition[];
  currencies: Array<{ code: string; name: string; symbol: string }>;
  industries: string[];
  goals: Array<{ id: string; label: string; modules: string[] }>;
}

/**
 * Business onboarding.
 *
 * Three short steps rather than one long form. The goals chosen in step three
 * decide which modules the workspace surfaces first — a barber lands on
 * appointments, a retailer on stock — without forking the product.
 */
export default function OnboardingPage() {
  const { session, loading, isAuthenticated, applySession } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    name: '',
    industry: '',
    businessType: '',
    country: 'GH',
    currency: '',
    description: '',
    phone: '',
    email: '',
    addressLine1: '',
    city: '',
    website: '',
    employeeCount: '',
    primaryGoal: '',
    goals: [] as string[],
  });

  const { data: reference } = useQuery({
    queryKey: ['reference'],
    queryFn: () => api.get<Reference>('/business/reference'),
    staleTime: Infinity,
  });

  const country = useMemo(
    () => reference?.countries.find((entry) => entry.code === form.country),
    [reference, form.country],
  );

  if (loading) return <LoadingState label="Loading…" />;
  if (!isAuthenticated) return <Navigate to="/sign-in" replace />;
  if (session?.business) return <Navigate to="/app" replace />;

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggleGoal = (id: string) =>
    setForm((current) => ({
      ...current,
      goals: current.goals.includes(id) ? current.goals.filter((g) => g !== id) : [...current.goals, id].slice(0, 4),
      primaryGoal: current.primaryGoal || id,
    }));

  const canContinue = step === 0 ? form.name.trim().length >= 2 && form.industry : step === 1 ? true : form.goals.length > 0;

  async function finish() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const session = await api.post<SessionContext>('/business', {
        name: form.name,
        industry: form.industry,
        businessType: form.businessType || undefined,
        country: form.country,
        currency: form.currency || undefined,
        description: form.description || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        addressLine1: form.addressLine1 || undefined,
        city: form.city || undefined,
        website: form.website || undefined,
        employeeCount: form.employeeCount ? Number(form.employeeCount) : undefined,
        primaryGoal: form.primaryGoal || undefined,
        goals: form.goals,
      });
      applySession(session);
      navigate('/app', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.message);
        setFieldErrors(caught.fields ?? {});
        if (caught.fields?.name || caught.fields?.industry) setStep(0);
      } else {
        setError('We could not save your business. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  const steps = ['Your business', 'Where you operate', 'What you want to improve'];

  return (
    <div className="min-h-screen bg-[var(--surface-muted)] px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-2xl">
        <Wordmark />

        <div className="mt-7 mb-5 flex gap-2" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={3}>
          {steps.map((label, index) => (
            <div key={label} className="flex-1">
              <div className={cx('h-1 rounded-full transition-colors', index <= step ? 'bg-brand-600' : 'bg-[var(--border)]')} />
              <p className={cx('mt-1.5 text-[12px]', index <= step ? 'text-brand-700 dark:text-brand-300' : 'subtle')}>{label}</p>
            </div>
          ))}
        </div>

        <Card>
          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-700">
              {error}
            </div>
          )}

          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-[20px] font-semibold">Tell us about your business</h1>
                <p className="mt-1 text-[14px] muted">This is what your customers will see on invoices and receipts.</p>
              </div>
              <Field label="Business name" htmlFor="name" required error={fieldErrors.name}>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(event) => set('name', event.target.value)}
                  placeholder="Aura Beauty GH"
                  autoFocus
                />
              </Field>
              <Field label="Industry" htmlFor="industry" required error={fieldErrors.industry}>
                <Select id="industry" value={form.industry} onChange={(event) => set('industry', event.target.value)}>
                  <option value="">Choose an industry…</option>
                  {reference?.industries.map((industry) => (
                    <option key={industry} value={industry}>
                      {industry}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="What kind of business is it?" htmlFor="businessType" hint="Optional — e.g. “Retail shop and salon”">
                <Input
                  id="businessType"
                  value={form.businessType}
                  onChange={(event) => set('businessType', event.target.value)}
                />
              </Field>
              <Field label="Describe it in a sentence" htmlFor="description" hint="Optional. Helps NEXA give better recommendations.">
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(event) => set('description', event.target.value)}
                  placeholder="Skincare and haircare retail with a small treatment room."
                />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-[20px] font-semibold">Where do you operate?</h1>
                <p className="mt-1 text-[14px] muted">
                  This sets your currency, tax label and the payment methods NEXA offers.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Country" htmlFor="country" required>
                  <Select id="country" value={form.country} onChange={(event) => set('country', event.target.value)}>
                    {reference?.countries.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Currency" htmlFor="currency" hint={country ? `Default for ${country.name}` : undefined}>
                  <Select id="currency" value={form.currency || country?.currency || ''} onChange={(event) => set('currency', event.target.value)}>
                    {reference?.currencies.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.code} — {entry.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {country && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3.5 text-[13px] muted">
                  We'll use <strong className="text-[var(--text)]">{country.tax.label}</strong> at{' '}
                  <strong className="text-[var(--text)]">{country.tax.defaultRate}%</strong>
                  {country.tax.inclusiveByDefault ? ' included in your prices' : ' added to your prices'}, and offer{' '}
                  {country.paymentRails.slice(0, 3).join(', ').replace(/_/g, ' ')} as payment methods. You can change all
                  of this later in Settings.
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone" htmlFor="phone">
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(event) => set('phone', event.target.value)}
                    placeholder={country?.phonePrefix}
                  />
                </Field>
                <Field label="Business email" htmlFor="email" error={fieldErrors.email}>
                  <Input id="email" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} />
                </Field>
                <Field label="Address" htmlFor="address">
                  <Input id="address" value={form.addressLine1} onChange={(event) => set('addressLine1', event.target.value)} />
                </Field>
                <Field label="City" htmlFor="city">
                  <Input id="city" value={form.city} onChange={(event) => set('city', event.target.value)} />
                </Field>
                <Field label="Website" htmlFor="website">
                  <Input id="website" value={form.website} onChange={(event) => set('website', event.target.value)} />
                </Field>
                <Field label="How many people work here?" htmlFor="employees">
                  <Input
                    id="employees"
                    type="number"
                    min="1"
                    value={form.employeeCount}
                    onChange={(event) => set('employeeCount', event.target.value)}
                  />
                </Field>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-[20px] font-semibold">What are you trying to improve most?</h1>
                <p className="mt-1 text-[14px] muted">
                  Pick up to four. NEXA will put those first — you still get everything else.
                </p>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {reference?.goals.map((goal) => {
                  const selected = form.goals.includes(goal.id);
                  return (
                    <button
                      key={goal.id}
                      type="button"
                      onClick={() => toggleGoal(goal.id)}
                      aria-pressed={selected}
                      className={cx(
                        'rounded-xl border p-3.5 text-left text-[14px] font-medium transition-colors',
                        selected
                          ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-100'
                          : 'border-[var(--border-strong)] hover:bg-[var(--surface-muted)]',
                      )}
                    >
                      {goal.label}
                    </button>
                  );
                })}
              </div>
              {form.goals.length > 1 && (
                <Field label="Which matters most?" htmlFor="primaryGoal">
                  <Select id="primaryGoal" value={form.primaryGoal} onChange={(event) => set('primaryGoal', event.target.value)}>
                    {form.goals.map((goalId) => (
                      <option key={goalId} value={goalId}>
                        {reference?.goals.find((goal) => goal.id === goalId)?.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || saving}>
              Back
            </Button>
            {step < 2 ? (
              <Button variant="primary" onClick={() => setStep((current) => current + 1)} disabled={!canContinue}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" onClick={finish} loading={saving} disabled={!canContinue}>
                Create my workspace
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
