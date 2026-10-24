/**
 * Colour tokens of the phone version of Productos. The screen was designed dark first; the app only
 * has a light theme today, so `light` is what renders. The `dark` set is kept intact so switching
 * the screen to a dark theme later is a one-prop change (`theme="dark"` on the mobile components),
 * with no markup or logic to rewrite. Every class is a literal string so Tailwind keeps it.
 */
export interface ProductsMobileTheme {
  /** KPI tiles at the top. */
  kpi: string;
  kpiLabel: string;
  kpiValue: string;
  kpiUnit: string;
  kpiGood: string;
  kpiWarn: string;
  /** Result list. */
  count: string;
  hint: string;
  card: string;
  cardOut: string;
  code: string;
  codeOut: string;
  dot: string;
  stockLine: string;
  stockLineOut: string;
  title: string;
  meta: string;
  price: string;
  priceOut: string;
  currency: string;
  divider: string;
  chevron: string;
  badgeStock: string;
  badgeStatus: string;
  badgeOut: string;
  badgeUrgent: string;
  badgeWarn: string;
  badgeNeutral: string;
  /** Product photo and its empty placeholder. */
  thumb: string;
  thumbEmpty: string;
  /** Expanded detail. */
  detail: string;
  tile: string;
  tileLabel: string;
  tileValue: string;
  tileValueMono: string;
  tileValueGood: string;
  secondaryButton: string;
  primaryButton: string;
  /** Active-filter chips. */
  chipsLabel: string;
  chip: string;
  chipAccent: string;
  chipAlt: string;
  /** The bar above the bottom navigation. */
  footer: string;
  footerText: string;
  footerButton: string;
}

export const PRODUCTS_MOBILE_THEMES: Record<'light' | 'dark', ProductsMobileTheme> = {
  light: {
    kpi: 'rounded-2xl border border-slate-200 bg-white p-3 shadow-sm',
    kpiLabel: 'text-[10px] font-semibold uppercase tracking-wider text-slate-500',
    kpiValue: 'text-2xl font-bold tabular-nums text-slate-900',
    kpiUnit: 'text-xs font-medium text-slate-500',
    kpiGood: 'text-[11px] font-medium text-emerald-600',
    kpiWarn: 'text-[11px] font-medium text-amber-600',
    count: 'text-[11px] font-semibold uppercase tracking-wider text-slate-600',
    hint: 'text-[11px] text-slate-400',
    card: 'rounded-2xl border border-slate-200 bg-white shadow-sm',
    cardOut: 'rounded-2xl border border-red-200 bg-red-50/60 shadow-sm',
    code: 'font-mono text-xs font-bold text-cyan-700',
    codeOut: 'font-mono text-xs font-bold text-red-600',
    dot: 'text-slate-300',
    stockLine: 'text-xs text-slate-500',
    stockLineOut: 'text-xs font-semibold text-red-600',
    title: 'text-base font-bold text-slate-900',
    meta: 'text-xs text-slate-500',
    price: 'font-mono text-lg font-bold tabular-nums text-emerald-600',
    priceOut: 'font-mono text-lg font-bold tabular-nums text-slate-700',
    currency: 'text-[10px] font-medium text-slate-500',
    divider: 'border-slate-100',
    chevron: 'text-slate-400',
    badgeStock: 'rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700',
    badgeStatus: 'rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700',
    badgeOut: 'rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700',
    badgeUrgent: 'rounded-md border border-red-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700',
    badgeWarn: 'rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700',
    badgeNeutral: 'rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600',
    thumb: 'h-16 w-16 shrink-0 rounded-xl border border-slate-200 bg-white object-contain',
    thumbEmpty: 'flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-300',
    detail: 'border-t border-slate-100 bg-slate-50/70',
    tile: 'rounded-xl border border-slate-200 bg-white p-3',
    tileLabel: 'text-[10px] font-semibold uppercase tracking-wider text-slate-500',
    tileValue: 'mt-1 text-sm font-semibold text-slate-900',
    tileValueMono: 'mt-1 font-mono text-sm text-slate-600',
    tileValueGood: 'mt-1 font-mono text-sm font-semibold text-emerald-600',
    secondaryButton: 'flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800',
    primaryButton: 'flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-semibold text-white',
    chipsLabel: 'text-[11px] font-semibold uppercase tracking-wider text-slate-500',
    chip: 'inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700',
    chipAccent: 'inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700',
    chipAlt: 'inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700',
    footer: 'rounded-2xl border border-slate-200 bg-white p-3 shadow-sm',
    footerText: 'text-sm font-semibold text-slate-800',
    footerButton: 'flex h-10 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white',
  },
  dark: {
    kpi: 'rounded-2xl border border-slate-700/70 bg-[#101a2b] p-3',
    kpiLabel: 'text-[10px] font-semibold uppercase tracking-wider text-slate-400',
    kpiValue: 'text-2xl font-bold tabular-nums text-white',
    kpiUnit: 'text-xs font-medium text-slate-400',
    kpiGood: 'text-[11px] font-medium text-emerald-400',
    kpiWarn: 'text-[11px] font-medium text-amber-400',
    count: 'text-[11px] font-semibold uppercase tracking-wider text-slate-300',
    hint: 'text-[11px] text-slate-500',
    card: 'rounded-2xl border border-slate-700/70 bg-[#101a2b]',
    cardOut: 'rounded-2xl border border-red-900/70 bg-[#1f1220]',
    code: 'font-mono text-xs font-bold text-cyan-300',
    codeOut: 'font-mono text-xs font-bold text-red-400',
    dot: 'text-slate-600',
    stockLine: 'text-xs text-slate-400',
    stockLineOut: 'text-xs font-semibold text-red-400',
    title: 'text-base font-bold text-white',
    meta: 'text-xs text-slate-400',
    price: 'font-mono text-lg font-bold tabular-nums text-emerald-400',
    priceOut: 'font-mono text-lg font-bold tabular-nums text-slate-200',
    currency: 'text-[10px] font-medium text-slate-400',
    divider: 'border-slate-700/60',
    chevron: 'text-slate-500',
    badgeStock: 'rounded-md border border-emerald-800 bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-300',
    badgeStatus: 'rounded-md border border-sky-800 bg-sky-950/60 px-2 py-0.5 text-[11px] font-semibold text-sky-300',
    badgeOut: 'rounded-md border border-red-800 bg-red-950/60 px-2 py-0.5 text-[11px] font-semibold text-red-300',
    badgeUrgent: 'rounded-md border border-red-700 bg-transparent px-2 py-0.5 text-[11px] font-semibold text-red-300',
    badgeWarn: 'rounded-md border border-amber-800 bg-amber-950/60 px-2 py-0.5 text-[11px] font-semibold text-amber-300',
    badgeNeutral: 'rounded-md border border-slate-600 bg-[#162338] px-2 py-0.5 text-[11px] font-semibold text-slate-300',
    thumb: 'h-16 w-16 shrink-0 rounded-xl border border-slate-700 bg-white object-contain',
    thumbEmpty: 'flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-600 bg-[#0b1423] text-slate-500',
    detail: 'border-t border-slate-700/60 bg-[#0b1423]',
    tile: 'rounded-xl border border-slate-700/70 bg-[#101a2b] p-3',
    tileLabel: 'text-[10px] font-semibold uppercase tracking-wider text-slate-400',
    tileValue: 'mt-1 text-sm font-semibold text-white',
    tileValueMono: 'mt-1 font-mono text-sm text-slate-300',
    tileValueGood: 'mt-1 font-mono text-sm font-semibold text-emerald-400',
    secondaryButton: 'flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-[#162338] text-sm font-semibold text-white',
    primaryButton: 'flex h-11 items-center justify-center gap-2 rounded-xl bg-sky-600 text-sm font-semibold text-white',
    chipsLabel: 'text-[11px] font-semibold uppercase tracking-wider text-slate-400',
    chip: 'inline-flex items-center gap-1 rounded-lg border border-slate-600 bg-[#162338] px-2.5 py-1 text-xs font-medium text-slate-200',
    chipAccent: 'inline-flex items-center gap-1 rounded-lg border border-emerald-800 bg-emerald-950/60 px-2.5 py-1 text-xs font-medium text-emerald-300',
    chipAlt: 'inline-flex items-center gap-1 rounded-lg border border-sky-800 bg-sky-950/60 px-2.5 py-1 text-xs font-medium text-sky-300',
    footer: 'rounded-2xl border border-slate-700/70 bg-[#101a2b] p-3',
    footerText: 'text-sm font-semibold text-slate-100',
    footerButton: 'flex h-10 items-center justify-center rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white',
  },
};

/** The badge class for a status tone (`Badge`'s four tones) in the phone cards. */
export function mobileBadgeClass(t: ProductsMobileTheme, tone: 'neutral' | 'success' | 'warning' | 'danger'): string {
  return { success: t.badgeStock, warning: t.badgeWarn, danger: t.badgeOut, neutral: t.badgeNeutral }[tone];
}
