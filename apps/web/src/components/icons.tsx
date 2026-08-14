import type { SVGProps } from 'react';

/**
 * Icon set — a single stroke weight and 24px grid throughout, so the UI reads
 * as one system rather than a collection of borrowed glyphs.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-[1.15em]"
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
  </Icon>
);
export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.2A6.5 6.5 0 0 1 21.5 20" />
  </Icon>
);
export const BoxIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 8.5 12 3.5 3 8.5v7L12 20.5l9-5v-7Z" />
    <path d="m3 8.5 9 5 9-5M12 13.5v7" />
  </Icon>
);
export const CartIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9.5" cy="19.5" r="1.3" />
    <circle cx="17.5" cy="19.5" r="1.3" />
    <path d="M2.5 3.5h2.2l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L20.5 7H6" />
  </Icon>
);
export const InvoiceIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 2.5h9L19 6.5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1Z" />
    <path d="M14.5 2.8V7h4.2M8.5 12h7M8.5 16h4.5" />
  </Icon>
);
export const WalletIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7.5A2 2 0 0 1 5 5.5h12.5a1.5 1.5 0 0 1 1.5 1.5v1.5" />
    <path d="M3 7.5v10A2 2 0 0 0 5 19.5h14a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 19 9.5H4.5" />
    <circle cx="16.5" cy="14" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
);
export const CheckSquareIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 12v7.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1H15" />
    <path d="m8 11.5 3 3 9.5-9.5" />
  </Icon>
);
export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="1.6" />
    <path d="M3.5 9.8h17M8 3v4M16 3v4" />
  </Icon>
);
export const ChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 20.5h17" />
    <path d="M7 20.5V12M12 20.5V5.5M17 20.5v-6" />
  </Icon>
);
export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9 12 3.5Z" />
    <path d="M18.5 16.5 19.2 18.8 21.5 19.5 19.2 20.2 18.5 22.5 17.8 20.2 15.5 19.5 17.8 18.8 18.5 16.5Z" />
  </Icon>
);
export const BellIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
    <path d="M10.3 19a2 2 0 0 0 3.4 0" />
  </Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.6-3.6" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1Z" />
  </Icon>
);
export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);
export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </Icon>
);
export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </Icon>
);
export const ActivityIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </Icon>
);
export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.5 4.5 5.8v5.9c0 4.7 3.2 8.2 7.5 9.8 4.3-1.6 7.5-5.1 7.5-9.8V5.8L12 2.5Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);
export const LogoutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 20.5H5.5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1h4" />
    <path d="M16 15.5 19.5 12 16 8.5M19.5 12H9.5" />
  </Icon>
);

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="inline-flex items-center gap-2">
        <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden="true">
          <rect width="32" height="32" rx="8.5" className="fill-brand-600" />
          <path
            d="M9.5 22.5V9.5l13 13v-13"
            stroke="white"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[17px] font-semibold tracking-[-0.02em]">NEXA</span>
      </span>
    </span>
  );
}
