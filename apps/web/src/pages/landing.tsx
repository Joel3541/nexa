import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HeroVisual } from '@/components/artwork';
import { Wordmark } from '@/components/icons';
import { Reveal } from '@/components/reveal';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge, Button, Card, cx } from '@/components/ui/primitives';

/**
 * Marketing page.
 *
 * Every screenshot on this page is rendered from the same design tokens as the
 * product, not a mock image — what a visitor sees here is what they get.
 */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--surface)]">
      <TopBar />
      <Hero />
      <LogoStrip />
      <Problem />
      <BriefSection />
      <DashboardSection />
      <CustomerSection />
      <AssistantSection />
      <AutomationSection />
      <AnalyticsSection />
      <SecuritySection />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </div>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Wordmark />
        <nav className="hidden items-center gap-7 text-sm muted md:flex">
          <a href="#product" className="hover:text-[var(--text)]">Product</a>
          <a href="#assistant" className="hover:text-[var(--text)]">AI</a>
          <a href="#pricing" className="hover:text-[var(--text)]">Pricing</a>
          <a href="#faq" className="hover:text-[var(--text)]">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          {/* The toggle lived only inside the app shell, so a visitor who never
              signed in had no way to switch themes on the page they actually
              landed on. */}
          <ThemeToggle compact />
          <Link to="/sign-in">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link to="/sign-up">
            <Button variant="primary" size="sm" className="hidden sm:inline-flex">Start free</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  className,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cx('mx-auto max-w-6xl px-5 py-16 sm:py-20', className)}>
      {/*
        Every landing section reveals on scroll from here, so the behaviour is
        consistent by construction rather than remembered at each call site.
        Heading and body are separate reveals with a small offset: the title
        settles first, which is the order the section is read in anyway.
      */}
      <Reveal>
        {eyebrow && <p className="mb-2.5 text-[13px] font-semibold tracking-wide text-accent uppercase">{eyebrow}</p>}
        <h2 className="max-w-3xl text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] sm:text-[34px]">{title}</h2>
        {lead && <p className="mt-3.5 max-w-2xl text-[16px] leading-relaxed muted">{lead}</p>}
      </Reveal>
      {children && (
        <Reveal className="mt-9" delay={90} distance={22}>
          {children}
        </Reveal>
      )}
    </section>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-[var(--border)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[30rem] bg-[radial-gradient(60%_60%_at_50%_50%,var(--color-brand-100),transparent)] opacity-70"
      />
      <div className="relative mx-auto max-w-6xl px-5 pt-16 pb-14 sm:pt-24 sm:pb-20">
        {/*
          Two columns from `lg` up: copy left, artwork right. Below that the
          artwork moves under the copy rather than shrinking beside it — a
          hero illustration squeezed into a phone-width column communicates
          nothing and costs a screenful of scroll.
        */}
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
          <div>
            <Badge tone="brand" className="mb-5">Built for small businesses in emerging markets first</Badge>
            <h1 className="text-[36px] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-[54px]">
              Run your business.
              <br />
              <span className="text-accent">NEXA runs the busywork.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed muted">
              An intelligent operating system that helps you understand your business, manage daily operations and act on
              opportunities, from customers, sales, invoices, stock and money in one place, with an AI that actually knows your numbers.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/sign-up">
                <Button variant="primary" size="lg">Start free</Button>
              </Link>
              <a href="#product">
                <Button size="lg">See how it works</Button>
              </a>
            </div>
            <p className="mt-4 text-[13px] subtle">No card required · Set up in under 3 minutes · Your data stays yours</p>
          </div>

          <HeroVisual className="h-auto w-full max-w-[36rem] justify-self-center lg:max-w-none" />
        </div>

        <Reveal className="mt-14" distance={24}>
          <BriefMock />
        </Reveal>
      </div>
    </section>
  );
}

function LogoStrip() {
  const stats = [
    { value: 'GH₵ · ₦ · KSh · $ · £ · €', label: 'Multi-currency from day one' },
    { value: 'Mobile money · Card · Cash', label: 'Payment rails that fit your market' },
    { value: 'One workspace', label: 'CRM, sales, stock, invoicing and AI' },
  ];
  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface-muted)]">
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label}>
            <p className="text-[15px] font-semibold">{stat.value}</p>
            <p className="mt-0.5 text-[13px] muted">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Problem() {
  const items = [
    { title: 'Your data is scattered', body: 'Orders in WhatsApp, money in mobile money, stock in a notebook, customers in your head.' },
    { title: 'Reports tell you what happened', body: 'By the time you notice revenue dipped, the month is over and the cause is cold.' },
    { title: 'Software built for someone else', body: 'Enterprise tools assume a finance team, a card processor and a country you don’t operate in.' },
  ];
  return (
    <Section
      eyebrow="The problem"
      title="Most small businesses aren't short of data. They're short of answers."
      lead="You already generate everything needed to run the business well. It just never lands anywhere that can act on it."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {items.map((item) => (
          <Card key={item.title}>
            <h3 className="text-[15px] font-semibold">{item.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed muted">{item.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function BriefMock() {
  return (
    <Card className="mx-auto max-w-3xl shadow-xl" padded={false}>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-red-400" />
        <span className="size-2.5 rounded-full bg-amber-400" />
        <span className="size-2.5 rounded-full bg-emerald-400" />
        <span className="ml-2 text-[12px] subtle">NEXA Morning Brief</span>
      </div>
      <div className="p-5 sm:p-6">
        <p className="text-[13px] font-semibold tracking-wide text-accent uppercase">NEXA Morning Brief</p>
        <p className="mt-2 text-[19px] font-semibold">Good morning, Joel.</p>
        <p className="mt-1 text-[15px] muted">GH₵3,745.00 is overdue, that's today's priority.</p>
        <ul className="mt-5 space-y-2.5 text-[14px]">
          {[
            ['warning', 'Revenue is GH₵16,287.94, 27% down on the previous period.'],
            ['danger', '28 overdue invoices worth GH₵3,745.00. The oldest is 132 days past due.'],
            ['warning', 'Lash Growth Serum is projected to run out in about 8 days.'],
            ['info', "18 customers haven't purchased in more than 60 days."],
          ].map(([tone, text]) => (
            <li key={text} className="flex gap-2.5">
              <span
                className={cx(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  tone === 'danger' && 'bg-red-500',
                  tone === 'warning' && 'bg-amber-500',
                  tone === 'info' && 'bg-sky-500',
                )}
              />
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-800 dark:bg-brand-900/25">
          <p className="text-[13px] font-semibold text-accent">Recommended action</p>
          <p className="mt-1 text-[14px]">
            Follow up on 28 overdue invoices, GH₵3,745.00 is money you have already earned.
          </p>
        </div>
      </div>
    </Card>
  );
}

function BriefSection() {
  return (
    <Section
      id="product"
      eyebrow="AI Daily Brief"
      title="Open NEXA and know exactly what today needs."
      lead="Not a wall of charts. A short, specific read on the business — what moved, what's at risk, and the one thing worth doing first. Every number is retrieved from your records, never estimated."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ['Money in and out', 'Revenue, expenses and profit against the previous period.'],
          ['What needs attention', 'Overdue invoices, stock about to run out, customers going quiet.'],
          ['One clear next action', 'Ranked by financial impact, not by what is easiest to show.'],
        ].map(([title, body]) => (
          <Card key={title}>
            <h3 className="text-[15px] font-semibold">{title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed muted">{body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function DashboardSection() {
  return (
    <div className="border-y border-[var(--border)] bg-[var(--surface-muted)]">
      <Section
        eyebrow="Business dashboard"
        title="A health score you can actually explain."
        lead="NEXA scores revenue trend, customer activity, receivables, stock position, profitability and operating rhythm — and shows you the breakdown, so the number is a diagnosis rather than a verdict."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Revenue', 'GH₵16,287', '↓ 27%', 'negative'],
            ['Expenses', 'GH₵7,850', '↓ 3.7%', 'neutral'],
            ['Profit', 'GH₵2,098', '↑ 12%', 'positive'],
            ['Owed to you', 'GH₵4,594', '28 overdue', 'neutral'],
          ].map(([label, value, delta, tone]) => (
            <Card key={label}>
              <p className="text-[13px] font-medium muted">{label}</p>
              <p
                className={cx(
                  'mt-1.5 text-[26px] leading-none font-semibold tnum',
                  tone === 'positive' && 'text-positive',
                  tone === 'negative' && 'text-negative',
                )}
              >
                {value}
              </p>
              <p className="mt-2 text-[12.5px] subtle">{delta}</p>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}

function CustomerSection() {
  return (
    <Section
      eyebrow="Customers"
      title="A CRM that tells you who to call, not just who exists."
      lead="Every customer carries their lifetime value, what they owe, what they buy and when they last showed up. NEXA derives the segments — VIP, repeat, lapsing, owing — so you never maintain a list by hand."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="text-[15px] font-semibold">A real timeline per customer</h3>
          <p className="mt-2 text-[14px] leading-relaxed muted">
            Purchases, invoices, payments, notes, tasks and appointments in one thread. When someone calls, you have the
            whole relationship in front of you.
          </p>
        </Card>
        <Card>
          <h3 className="text-[15px] font-semibold">Segments that update themselves</h3>
          <p className="mt-2 text-[14px] leading-relaxed muted">
            "18 customers haven't bought in 60 days, worth GH₵22,477 of past spend" is a query you never have to write —
            and a campaign you can act on in two clicks.
          </p>
        </Card>
      </div>
    </Section>
  );
}

function AssistantSection() {
  const exchanges = [
    ['Why did revenue fall?', 'Revenue is GH₵16,287.94, 27% down on the previous 30 days. Order count moved from 156 to 114. Glow Serum sold 0 units versus 24, and it stocked out on the 12th. Braid Sheen Spray is down 87%.'],
    ['Who owes me money?', 'You are owed GH₵4,594.00 across 36 open invoices. GH₵3,745.00 of that is overdue,28 invoices, oldest 132 days past due.'],
    ['Create a follow-up task for every overdue invoice', 'I have prepared 28 follow-up tasks, one per overdue invoice,for your approval. Nothing has been created yet.'],
  ];

  return (
    <div id="assistant" className="border-y border-[var(--border)] bg-[var(--surface-muted)]">
      <Section
        eyebrow="NEXA AI"
        title="An assistant that reads your database, not the internet."
        lead="Ask in plain language. NEXA calls typed, permission-checked tools against your own records and answers with real figures. It cannot invent a number, and it cannot change anything without your approval."
      >
        <div className="space-y-3">
          {exchanges.map(([question, answer]) => (
            <Card key={question}>
              <p className="text-[14px] font-semibold">{question}</p>
              <p className="mt-2 text-[14px] leading-relaxed muted">{answer}</p>
            </Card>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            ['Grounded', 'Every figure comes from a tool call against your data. No tool result, no claim.'],
            ['Permissioned', 'The AI inherits your role. A staff member’s assistant cannot see what they cannot see.'],
            ['Approval-gated', 'Anything consequential is proposed with a preview and waits for a human yes.'],
          ].map(([title, body]) => (
            <Card key={title}>
              <h3 className="text-[14px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed muted">{body}</p>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}

function AutomationSection() {
  const agents = [
    ['Finance', 'Watches receivables and flags what to chase, ranked by value and age.'],
    ['Inventory', 'Projects stock-outs from real sales velocity, with a stated confidence level.'],
    ['Customer', 'Notices relationships going quiet before they are gone for good.'],
    ['Sales', 'Surfaces momentum: what is rising, what is fading, and by how much.'],
  ];
  return (
    <Section
      eyebrow="Agents"
      title="Specialists that watch the business while you work in it."
      lead="Each agent has its own remit and its own tool permissions. They raise what matters to the activity feed. None of them can change a record on their own."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {agents.map(([name, body]) => (
          <Card key={name}>
            <h3 className="text-[15px] font-semibold">{name}</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed muted">{body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function AnalyticsSection() {
  return (
    <div className="border-y border-[var(--border)] bg-[var(--surface-muted)]">
      <Section
        eyebrow="Analytics"
        title="Charts that answer a question."
        lead="Revenue, profit and expenses over any range. Product performance with margin. Payment mix. Customer retention and repeat rate. If a chart doesn't change a decision, it isn't on the page."
      />
    </div>
  );
}

function SecuritySection() {
  const points = [
    ['Tenant isolation', 'Every record is scoped to a business. Cross-tenant access returns "not found", never a hint that the record exists.'],
    ['Role-based permissions', 'Owner, admin, manager, staff and viewer, enforced server-side on every request.'],
    ['Full audit trail', 'Who did what, when, and from where — including every action the AI took after approval.'],
    ['Your data is yours', 'Export it, or take the whole thing elsewhere. No lock-in.'],
  ];
  return (
    <Section
      eyebrow="Security"
      title="Built like the system of record it intends to be."
      lead="This is where your money and your customers live. It is treated that way."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {points.map(([title, body]) => (
          <Card key={title}>
            <h3 className="text-[15px] font-semibold">{title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed muted">{body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function Pricing() {
  const tiers = [
    { name: 'Free', price: '0', blurb: 'Run the essentials', features: ['Customers, sales and invoices', 'Basic dashboard', 'Up to 2 team members', 'Community support'] },
    { name: 'Pro', price: '149', blurb: 'Add intelligence', features: ['Everything in Free', 'NEXA AI assistant', 'Daily brief and agents', 'Advanced analytics', 'Campaigns'], highlight: true },
    { name: 'Business', price: '399', blurb: 'Run a team', features: ['Everything in Pro', 'Unlimited team members', 'Roles and permissions', 'Integrations', 'Priority support'] },
    { name: 'Enterprise', price: 'Talk to us', blurb: 'Scale and control', features: ['Advanced permissions', 'API access', 'Audit exports', 'Dedicated support'] },
  ];

  return (
    <Section
      id="pricing"
      eyebrow="Pricing"
      title="Start free. Pay when NEXA is doing real work."
      lead="Prices in GH₵ per month. Local pricing in every market we support."
    >
      <div className="grid gap-4 lg:grid-cols-4">
        {tiers.map((tier) => (
          <Card key={tier.name} className={cx('flex flex-col', tier.highlight && 'border-brand-400 ring-1 ring-brand-400')}>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">{tier.name}</h3>
              {tier.highlight && <Badge tone="brand">Popular</Badge>}
            </div>
            <p className="mt-1 text-[13px] muted">{tier.blurb}</p>
            <p className="mt-4 text-[28px] leading-none font-semibold tnum">
              {tier.price === 'Talk to us' ? tier.price : `GH₵${tier.price}`}
              {tier.price !== 'Talk to us' && <span className="text-[13px] font-normal muted"> /mo</span>}
            </p>
            <ul className="mt-4 flex-1 space-y-2 text-[13.5px] muted">
              {tier.features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <span className="text-accent">✓</span>
                  {feature}
                </li>
              ))}
            </ul>
            <Link to="/sign-up" className="mt-5">
              <Button variant={tier.highlight ? 'primary' : 'secondary'} className="w-full justify-center">
                {tier.price === 'Talk to us' ? 'Contact sales' : 'Start free'}
              </Button>
            </Link>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function Faq() {
  const faqs = [
    ['Do I need to be technical to use NEXA?', 'No. If you can use WhatsApp you can use NEXA. Setup takes about three minutes and the product explains itself as you go.'],
    ['Can the AI change my records without asking?', 'No. Read operations run automatically. Anything consequential, creating records, sending messages, touching money, etc. is proposed with a preview and waits for your explicit approval. Every approved action is logged.'],
    ['Will it work for my kind of business?', 'NEXA has one flexible core rather than separate apps per industry. A retailer sees orders and stock first; a salon sees appointments and services first. Same product, different emphasis.'],
    ['What about payments?', 'NEXA records payments against orders and invoices today, including mobile money, cash, card and bank transfer. Live payment processing connects through a provider interface — mobile money and card processors plug in without changing how the product works.'],
    ['Which currencies do you support?', 'Ghana, Nigeria, Kenya, South Africa, Côte d’Ivoire, Egypt, the UK, US, Canada, Germany and India today. Currency, tax labels, phone formats and payment rails all follow the country you choose.'],
    ['Can I get my data out?', 'Yes. It is your business. Export is available and there is no lock-in.'],
  ];

  return (
    <div className="border-y border-[var(--border)] bg-[var(--surface-muted)]">
      <Section id="faq" eyebrow="FAQ" title="Questions worth asking.">
        <div className="max-w-3xl divide-y divide-[var(--border)]">
          {faqs.map(([question, answer]) => (
            <FaqItem key={question} question={question!} answer={answer!} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-4">
      <button
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <span className="text-[15px] font-medium">{question}</span>
        <span className={cx('shrink-0 text-lg subtle transition-transform', open && 'rotate-45')}>+</span>
      </button>
      {open && <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed muted">{answer}</p>}
    </div>
  );
}

function FinalCta() {
  return (
    <Section title="" className="py-16 sm:py-20">
      <Card className="bg-brand-600 text-center text-white">
        <h2 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[32px]">
          Your business, on autopilot.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[15px] text-brand-100">
          Set NEXA up in three minutes and see your first brief tomorrow morning.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/sign-up">
            <Button size="lg" className="bg-white text-brand-700 hover:bg-brand-50">Start free</Button>
          </Link>
          <Link to="/sign-in">
            <Button size="lg" variant="ghost" className="text-white hover:bg-brand-500">Sign in</Button>
          </Link>
        </div>
      </Card>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-[13px] muted">
        <Wordmark />
        <p>The intelligent operating system for modern small businesses.</p>
        <p className="subtle">© {new Date().getFullYear()} NEXA</p>
      </div>
    </footer>
  );
}
