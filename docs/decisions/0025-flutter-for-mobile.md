# ADR-0025: Flutter for Mobile Applications

## Status

Accepted

## Context

The platform needs native-feeling Android and iOS apps for field/warehouse/sales users (scanning,
selling, transferring, receiving — see [mobile.md](../architecture/mobile.md)). Building and
maintaining two fully separate native codebases (Kotlin/Java for Android, Swift for iOS) doubles
implementation and QA effort for every feature, for a team whose backend/web stack (NestJS, Next.js,
TypeScript) doesn't otherwise touch either native ecosystem.

## Decision

**Flutter + Dart**, one codebase producing both the Android and iOS apps. Full responsibility scope,
web/mobile split, and integration points: [mobile.md](../architecture/mobile.md). Platform-specific
native code is used only where a cross-platform path genuinely doesn't exist (e.g. a hardware-specific
barcode-scanner SDK offered only as native modules), isolated behind Flutter's platform-channel
mechanism — not a routine escape hatch.

## Alternatives considered

- **Separate native apps (Kotlin/Java + Swift).** Rejected: doubles engineering and QA cost for every
  feature indefinitely, for a small team already spread across NestJS/Next.js — the strongest
  counter-argument (best possible platform fidelity) doesn't outweigh that cost for this platform's
  actual needs (a business operations app, not a graphics-intensive or platform-API-heavy consumer app).
- **React Native.** A reasonable alternative given the team's existing TypeScript/React familiarity from
  Next.js, and was seriously weighed. Flutter was chosen instead for: (a) a single rendering engine
  (Skia) drawing its own widgets rather than bridging to native UI components, which tends to produce
  more consistent cross-platform behavior for a data-heavy, form-and-list-heavy operational app; (b) a
  more complete out-of-the-box widget/tooling story for exactly this app shape (lists, forms, camera/
  scanner integration) without assembling as many third-party packages. The team's React familiarity is
  a real cost of this choice (Dart is a new language), acknowledged as a trade-off, not dismissed.
- **Progressive Web App (PWA) instead of a native/cross-platform app.** Rejected: camera-based QR/
  barcode scanning, OS-level secure token storage, and push notifications — all core to the mobile
  responsibility list in [mobile.md](../architecture/mobile.md) — are meaningfully more capable and
  reliable via a real app than a PWA on the platforms this business's field staff actually use.
- **Kotlin Multiplatform Mobile (KMM).** Considered; rejected primarily because it still requires
  building each platform's UI natively (KMM shares business/data logic, not UI) — for a team without
  existing Kotlin or Swift depth, that doesn't reduce the two-UI-codebases problem this ADR exists to
  avoid, unlike Flutter's single-UI-codebase model.

## Consequences

- A new language (Dart) and toolchain (Flutter SDK) enter the stack — a real onboarding cost for a team
  currently working in TypeScript across NestJS and Next.js.
- Mobile has **no independent business logic** — it is a thin client over `/api/v1`, per
  [mobile.md#backend-as-the-sole-authority](../architecture/mobile.md#backend-as-the-sole-authority) —
  so this decision affects UI/client architecture only, not the domain model or API contract, which
  stay exactly as already designed for web.
- Auth transport for mobile (bearer token + OS secure storage) is fixed by
  [mobile.md#auth-on-mobile](../architecture/mobile.md#auth-on-mobile) independent of Flutter's
  specifics — this ADR is the "why Flutter" record; the "how auth/multi-tenancy/QR/offline work on
  mobile" record lives in `mobile.md`, not duplicated here.
