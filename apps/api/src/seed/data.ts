/**
 * Fixture data for the AURA BEAUTY GH demo workspace.
 *
 * Names, products and price points are drawn from a plausible Accra-based
 * beauty retailer so the seeded analytics look like a real business rather than
 * uniform noise. Prices are in pesewas (GHS minor units).
 */

export const DEMO_BUSINESS = {
  name: 'Aura Beauty GH',
  industry: 'Beauty & Personal Care',
  businessType: 'Retail & salon',
  country: 'GH',
  currency: 'GHS',
  description:
    'Skincare, haircare and beauty essentials for Accra. Retail counter, online orders on WhatsApp and Instagram, plus a small treatment room for facials and braiding.',
  phone: '+233 24 555 0142',
  email: 'hello@aurabeauty.gh',
  website: 'https://aurabeauty.example.gh',
  addressLine1: '14 Oxford Street, Osu',
  city: 'Accra',
  region: 'Greater Accra',
  employeeCount: 4,
  primaryGoal: 'increase_sales',
  goals: ['increase_sales', 'manage_inventory', 'track_finances'],
  socialLinks: { instagram: '@aurabeauty.gh', whatsapp: '+233245550142' },
};

export const DEMO_OWNER = {
  fullName: 'Joel Duker',
  email: 'demo@nexa.app',
  password: 'NexaDemo2026',
};

export const DEMO_STAFF = {
  fullName: 'Ama Serwaa',
  email: 'ama@aurabeauty.gh',
  password: 'NexaDemo2026',
  role: 'manager' as const,
};

export const CUSTOMER_NAMES = [
  'Akosua Mensah', 'Kwame Boateng', 'Efua Darko', 'Yaw Asante', 'Abena Owusu',
  'Kofi Appiah', 'Adwoa Nyarko', 'Kojo Frimpong', 'Esi Baidoo', 'Nana Ama Ofori',
  'Selorm Agbeko', 'Naa Adjeley Quaye', 'Kwabena Sarpong', 'Akua Bediako', 'Yaa Amponsah',
  'Mensah Adjei', 'Comfort Anku', 'Priscilla Tetteh', 'Gifty Ansah', 'Linda Osei',
  'Sandra Kyei', 'Josephine Larbi', 'Rita Amoah', 'Vida Oppong', 'Grace Danso',
  'Emmanuella Aidoo', 'Patience Nkrumah', 'Doris Antwi', 'Belinda Acheampong', 'Sylvia Gyamfi',
  'Freda Aggrey', 'Juliet Yeboah', 'Cynthia Addo', 'Mavis Otoo', 'Hannah Bonsu',
  'Portia Amankwah', 'Rebecca Sowah', 'Deborah Quartey', 'Michelle Adom', 'Barbara Kusi',
];

export const CUSTOMER_SOURCES = ['Instagram', 'Walk-in', 'WhatsApp', 'Referral', 'TikTok', 'Repeat customer'];

export interface SeedProduct {
  name: string;
  sku: string;
  category: string;
  costPrice: number;
  sellingPrice: number;
  openingStock: number;
  minStock: number;
  supplier: string;
  /** Relative popularity used to weight the order generator. */
  weight: number;
  /** 'rising' and 'falling' drive a deliberate trend the AI can explain. */
  trend?: 'rising' | 'falling';
  /** Forces a near-term stock-out so the projection surface has real signal. */
  scarce?: boolean;
}

export const PRODUCTS: SeedProduct[] = [
  { name: 'Glow Serum 30ml', sku: 'AB-SER-030', category: 'Skincare', costPrice: 4200, sellingPrice: 9500, openingStock: 120, minStock: 12, supplier: 'Lagos Beauty Imports', weight: 14, scarce: true },
  { name: 'Shea Radiance Body Butter 250g', sku: 'AB-SHB-250', category: 'Body Care', costPrice: 2800, sellingPrice: 6500, openingStock: 160, minStock: 15, supplier: 'Tamale Shea Co-op', weight: 12 },
  { name: 'Hydrating Face Mist 100ml', sku: 'AB-MST-100', category: 'Skincare', costPrice: 2100, sellingPrice: 5500, openingStock: 140, minStock: 12, supplier: 'Lagos Beauty Imports', weight: 9, trend: 'rising' },
  { name: 'Charcoal Clay Mask 120g', sku: 'AB-MSK-120', category: 'Skincare', costPrice: 3100, sellingPrice: 7200, openingStock: 90, minStock: 10, supplier: 'Accra Cosmetics Ltd', weight: 7 },
  { name: 'Coconut Hair Food 200g', sku: 'AB-HRF-200', category: 'Haircare', costPrice: 1900, sellingPrice: 4800, openingStock: 180, minStock: 20, supplier: 'Tamale Shea Co-op', weight: 11, trend: 'falling' },
  { name: 'Braid Sheen Spray 300ml', sku: 'AB-BSS-300', category: 'Haircare', costPrice: 1600, sellingPrice: 4200, openingStock: 150, minStock: 18, supplier: 'Accra Cosmetics Ltd', weight: 8, trend: 'falling' },
  { name: 'Edge Control Gel 100g', sku: 'AB-EDG-100', category: 'Haircare', costPrice: 1200, sellingPrice: 3500, openingStock: 200, minStock: 25, supplier: 'Accra Cosmetics Ltd', weight: 10 },
  { name: 'Vitamin C Brightening Cream', sku: 'AB-VCB-050', category: 'Skincare', costPrice: 5400, sellingPrice: 12500, openingStock: 70, minStock: 8, supplier: 'Lagos Beauty Imports', weight: 6, trend: 'rising' },
  { name: 'African Black Soap Bar', sku: 'AB-ABS-150', category: 'Body Care', costPrice: 900, sellingPrice: 2500, openingStock: 260, minStock: 30, supplier: 'Tamale Shea Co-op', weight: 13 },
  { name: 'Rosewater Toner 200ml', sku: 'AB-TNR-200', category: 'Skincare', costPrice: 2400, sellingPrice: 5800, openingStock: 110, minStock: 12, supplier: 'Lagos Beauty Imports', weight: 7 },
  { name: 'Matte Lip Set (3 shades)', sku: 'AB-LIP-003', category: 'Makeup', costPrice: 4800, sellingPrice: 11000, openingStock: 60, minStock: 8, supplier: 'Dubai Beauty Direct', weight: 5 },
  { name: 'Lash Growth Serum', sku: 'AB-LGS-010', category: 'Makeup', costPrice: 3600, sellingPrice: 8900, openingStock: 55, minStock: 8, supplier: 'Dubai Beauty Direct', weight: 5, scarce: true },
  { name: 'Sunscreen SPF50 60ml', sku: 'AB-SPF-060', category: 'Skincare', costPrice: 3900, sellingPrice: 8800, openingStock: 85, minStock: 10, supplier: 'Lagos Beauty Imports', weight: 6, trend: 'rising' },
  { name: 'Cocoa Butter Lotion 400ml', sku: 'AB-CBL-400', category: 'Body Care', costPrice: 2200, sellingPrice: 5200, openingStock: 170, minStock: 20, supplier: 'Tamale Shea Co-op', weight: 9 },
  { name: 'Detox Hair Shampoo 350ml', sku: 'AB-SHP-350', category: 'Haircare', costPrice: 2600, sellingPrice: 6200, openingStock: 130, minStock: 15, supplier: 'Accra Cosmetics Ltd', weight: 7 },
  { name: 'Silk Hair Bonnet', sku: 'AB-BNT-001', category: 'Accessories', costPrice: 1100, sellingPrice: 3200, openingStock: 190, minStock: 20, supplier: 'Dubai Beauty Direct', weight: 8 },
  { name: 'Gift Box — Glow Essentials', sku: 'AB-GFT-001', category: 'Bundles', costPrice: 9800, sellingPrice: 21500, openingStock: 35, minStock: 5, supplier: 'In-house', weight: 3 },
];

export interface SeedService {
  name: string;
  category: string;
  price: number;
  durationMinutes: number;
  description: string;
  weight: number;
}

export const SERVICES: SeedService[] = [
  { name: 'Signature Facial (60 min)', category: 'Treatments', price: 18000, durationMinutes: 60, description: 'Deep cleanse, exfoliation, mask and massage.', weight: 4 },
  { name: 'Express Glow Facial (30 min)', category: 'Treatments', price: 9500, durationMinutes: 30, description: 'Quick cleanse and hydration boost.', weight: 5 },
  { name: 'Knotless Braids (Medium)', category: 'Hair', price: 32000, durationMinutes: 240, description: 'Full head, medium size, hair not included.', weight: 3 },
];

/**
 * Operating expenses only.
 *
 * Stock purchases are deliberately absent. NEXA already accounts for the cost
 * of goods through each product's unit cost on the order line, so recording a
 * restock as an expense as well would double-count it and understate profit.
 * Restocks appear in the inventory ledger instead, which is where they belong.
 */
export const EXPENSE_TEMPLATES = [
  { category: 'Rent', vendor: 'Osu Property Ltd', description: 'Shop rent', min: 250000, max: 250000, cadenceDays: 30 },
  { category: 'Utilities', vendor: 'ECG', description: 'Electricity', min: 32000, max: 68000, cadenceDays: 30 },
  { category: 'Utilities', vendor: 'Ghana Water', description: 'Water bill', min: 9000, max: 16000, cadenceDays: 30 },
  { category: 'Salaries', vendor: 'Staff payroll', description: 'Monthly salaries (2 staff)', min: 300000, max: 300000, cadenceDays: 30 },
  { category: 'Marketing', vendor: 'Meta Ads', description: 'Instagram promotion', min: 15000, max: 55000, cadenceDays: 14 },
  { category: 'Transport', vendor: 'Bolt / delivery riders', description: 'Customer deliveries', min: 4000, max: 18000, cadenceDays: 6 },
  { category: 'Fees & Charges', vendor: 'MTN MoMo', description: 'Mobile money transaction fees', min: 2500, max: 9000, cadenceDays: 10 },
  { category: 'Equipment', vendor: 'Melcom', description: 'Shop fittings and display', min: 25000, max: 90000, cadenceDays: 60 },
];

export const TASK_TEMPLATES = [
  { title: 'Restock Glow Serum before the weekend', priority: 'high' as const, dueInDays: 2 },
  { title: 'Post new arrivals on Instagram', priority: 'medium' as const, dueInDays: 1 },
  { title: 'Call supplier about delayed shipment', priority: 'urgent' as const, dueInDays: -1 },
  { title: 'Reconcile last month’s mobile money statement', priority: 'medium' as const, dueInDays: 4 },
  { title: 'Prepare month-end stock count', priority: 'low' as const, dueInDays: 9 },
  { title: 'Follow up on treatment room bookings', priority: 'medium' as const, dueInDays: 3 },
];

export const CHANNELS = ['walk-in', 'whatsapp', 'instagram', 'referral'];
export const PAYMENT_METHODS = ['mobile_money', 'cash', 'card', 'bank_transfer'] as const;
