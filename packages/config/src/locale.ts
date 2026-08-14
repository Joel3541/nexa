/**
 * Localization registry.
 *
 * Nothing in NEXA hard-codes a country, currency or tax rule. A business picks
 * a country at onboarding; everything downstream (currency formatting, tax
 * labels, phone prefixes, available payment rails) is derived from this table.
 * Adding a market is a data change, not a code change.
 */

export interface CurrencyDefinition {
  code: string;
  name: string;
  symbol: string;
  /** Minor units. 2 for most currencies, 0 for e.g. JPY. */
  decimals: number;
}

export interface TaxDefinition {
  /** Label shown on invoices and receipts, e.g. "VAT", "Sales Tax", "GST". */
  label: string;
  /** Default percentage applied when a business enables tax. */
  defaultRate: number;
  /** Whether prices are conventionally displayed tax-inclusive in this market. */
  inclusiveByDefault: boolean;
}

export interface CountryDefinition {
  code: string;
  name: string;
  currency: string;
  phonePrefix: string;
  locale: string;
  timezone: string;
  tax: TaxDefinition;
  /** Payment rails commonly available. Drives provider suggestions later. */
  paymentRails: string[];
  region: 'africa' | 'europe' | 'north-america' | 'asia' | 'oceania' | 'south-america';
}

export const CURRENCIES: Record<string, CurrencyDefinition> = {
  GHS: { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', decimals: 2 },
  NGN: { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', decimals: 2 },
  KES: { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', decimals: 2 },
  ZAR: { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimals: 2 },
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2 },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  CAD: { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', decimals: 2 },
  XOF: { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA', decimals: 0 },
  EGP: { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', decimals: 2 },
  INR: { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 },
};

export const COUNTRIES: Record<string, CountryDefinition> = {
  GH: {
    code: 'GH',
    name: 'Ghana',
    currency: 'GHS',
    phonePrefix: '+233',
    locale: 'en-GH',
    timezone: 'Africa/Accra',
    tax: { label: 'VAT', defaultRate: 15, inclusiveByDefault: true },
    paymentRails: ['mobile_money', 'bank_transfer', 'cash', 'card'],
    region: 'africa',
  },
  NG: {
    code: 'NG',
    name: 'Nigeria',
    currency: 'NGN',
    phonePrefix: '+234',
    locale: 'en-NG',
    timezone: 'Africa/Lagos',
    tax: { label: 'VAT', defaultRate: 7.5, inclusiveByDefault: true },
    paymentRails: ['bank_transfer', 'card', 'cash', 'ussd'],
    region: 'africa',
  },
  KE: {
    code: 'KE',
    name: 'Kenya',
    currency: 'KES',
    phonePrefix: '+254',
    locale: 'en-KE',
    timezone: 'Africa/Nairobi',
    tax: { label: 'VAT', defaultRate: 16, inclusiveByDefault: true },
    paymentRails: ['mobile_money', 'bank_transfer', 'cash', 'card'],
    region: 'africa',
  },
  ZA: {
    code: 'ZA',
    name: 'South Africa',
    currency: 'ZAR',
    phonePrefix: '+27',
    locale: 'en-ZA',
    timezone: 'Africa/Johannesburg',
    tax: { label: 'VAT', defaultRate: 15, inclusiveByDefault: true },
    paymentRails: ['card', 'bank_transfer', 'cash'],
    region: 'africa',
  },
  CI: {
    code: 'CI',
    name: "Côte d'Ivoire",
    currency: 'XOF',
    phonePrefix: '+225',
    locale: 'fr-CI',
    timezone: 'Africa/Abidjan',
    tax: { label: 'TVA', defaultRate: 18, inclusiveByDefault: true },
    paymentRails: ['mobile_money', 'cash', 'bank_transfer'],
    region: 'africa',
  },
  EG: {
    code: 'EG',
    name: 'Egypt',
    currency: 'EGP',
    phonePrefix: '+20',
    locale: 'ar-EG',
    timezone: 'Africa/Cairo',
    tax: { label: 'VAT', defaultRate: 14, inclusiveByDefault: true },
    paymentRails: ['cash', 'card', 'bank_transfer', 'mobile_money'],
    region: 'africa',
  },
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    currency: 'GBP',
    phonePrefix: '+44',
    locale: 'en-GB',
    timezone: 'Europe/London',
    tax: { label: 'VAT', defaultRate: 20, inclusiveByDefault: true },
    paymentRails: ['card', 'bank_transfer', 'direct_debit'],
    region: 'europe',
  },
  US: {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    phonePrefix: '+1',
    locale: 'en-US',
    timezone: 'America/New_York',
    tax: { label: 'Sales Tax', defaultRate: 0, inclusiveByDefault: false },
    paymentRails: ['card', 'ach', 'cash'],
    region: 'north-america',
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    currency: 'CAD',
    phonePrefix: '+1',
    locale: 'en-CA',
    timezone: 'America/Toronto',
    tax: { label: 'GST/HST', defaultRate: 13, inclusiveByDefault: false },
    paymentRails: ['card', 'bank_transfer', 'cash'],
    region: 'north-america',
  },
  DE: {
    code: 'DE',
    name: 'Germany',
    currency: 'EUR',
    phonePrefix: '+49',
    locale: 'de-DE',
    timezone: 'Europe/Berlin',
    tax: { label: 'MwSt', defaultRate: 19, inclusiveByDefault: true },
    paymentRails: ['card', 'bank_transfer', 'sepa'],
    region: 'europe',
  },
  IN: {
    code: 'IN',
    name: 'India',
    currency: 'INR',
    phonePrefix: '+91',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    tax: { label: 'GST', defaultRate: 18, inclusiveByDefault: true },
    paymentRails: ['upi', 'card', 'bank_transfer', 'cash'],
    region: 'asia',
  },
};

export const DEFAULT_COUNTRY = 'GH';

export function getCountry(code: string | null | undefined): CountryDefinition {
  return COUNTRIES[(code ?? '').toUpperCase()] ?? COUNTRIES[DEFAULT_COUNTRY]!;
}

export function getCurrency(code: string | null | undefined): CurrencyDefinition {
  return CURRENCIES[(code ?? '').toUpperCase()] ?? CURRENCIES.USD!;
}

export const COUNTRY_LIST = Object.values(COUNTRIES).sort((a, b) => a.name.localeCompare(b.name));
export const CURRENCY_LIST = Object.values(CURRENCIES).sort((a, b) => a.code.localeCompare(b.code));

/**
 * Money is stored as an integer number of minor units everywhere in NEXA
 * (see docs/database.md). These helpers are the only sanctioned way to move
 * between minor units and human-facing strings.
 */
export function formatMoney(minorUnits: number, currencyCode: string, options?: { locale?: string; compact?: boolean }): string {
  const currency = getCurrency(currencyCode);
  const amount = minorUnits / 10 ** currency.decimals;
  const locale = options?.locale ?? 'en-US';
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: options?.compact ? 0 : currency.decimals,
    maximumFractionDigits: currency.decimals,
    notation: options?.compact ? 'compact' : 'standard',
  }).format(amount);
  return `${currency.symbol}${formatted}`;
}

export function toMinorUnits(amount: number, currencyCode: string): number {
  const currency = getCurrency(currencyCode);
  return Math.round(amount * 10 ** currency.decimals);
}

export function fromMinorUnits(minorUnits: number, currencyCode: string): number {
  const currency = getCurrency(currencyCode);
  return minorUnits / 10 ** currency.decimals;
}

export const BUSINESS_INDUSTRIES = [
  'Retail & Trading',
  'Beauty & Personal Care',
  'Food & Beverage',
  'Fashion & Apparel',
  'Health & Wellness',
  'Professional Services',
  'Creative & Media',
  'Education & Training',
  'Construction & Trades',
  'Logistics & Transport',
  'Technology',
  'Agriculture',
  'Hospitality',
  'Automotive',
  'Other',
] as const;

export const BUSINESS_GOALS = [
  { id: 'more_customers', label: 'Get more customers', modules: ['customers', 'campaigns', 'analytics'] },
  { id: 'increase_sales', label: 'Increase sales', modules: ['sales', 'products', 'analytics'] },
  { id: 'track_finances', label: 'Track finances', modules: ['expenses', 'invoices', 'analytics'] },
  { id: 'manage_inventory', label: 'Manage inventory', modules: ['products', 'inventory'] },
  { id: 'manage_customers', label: 'Manage customers', modules: ['customers', 'tasks'] },
  { id: 'save_time', label: 'Save time', modules: ['tasks', 'ai', 'automation'] },
  { id: 'automate_work', label: 'Automate repetitive work', modules: ['ai', 'automation', 'tasks'] },
  { id: 'understand_business', label: 'Understand my business', modules: ['analytics', 'ai'] },
] as const;

export type BusinessGoalId = (typeof BUSINESS_GOALS)[number]['id'];
