# ADR-0038: Order PDF Export — Browser Print Now, Server-Side Generation Deferred

## Status

Accepted

## Context

The owner asked for a way to download the order detail page (`/sales/:id`) as a PDF. Two shapes were
considered, trading effort now against fidelity later:

1. A "Descargar PDF" button that triggers the browser's own print dialog (`window.print()`), with a
   print stylesheet that hides navigation chrome (`ShellLayout`'s sidebar/header) so only the order
   content prints — the viewer picks "Guardar como PDF" as the destination. Zero new dependencies, no
   server round trip, ships immediately.
2. A server-side PDF-generation endpoint (e.g. `pdf-lib`/Puppeteer) that renders a purpose-built
   document — a real layout (logo, table, totals) independent of the page's own HTML/CSS.

The owner explicitly wants option 2 eventually, once the platform needs a properly designed document
(most likely as the first step toward a real external-invoicing integration — ADR-0023 already
established the platform never generates the fiscal document itself, but a plain internal PDF copy of
an order is a different, smaller thing than that). This ADR records the owner's explicit choice to
start with option 1.

## Decision

Ship the browser-print path now (`PrintButton`, `apps/web/src/components/ui/print-button.tsx`) on the
order detail page, and defer server-side PDF generation to a later phase. `ShellLayout`'s fixed sidebar
and sticky header carry `print:hidden` so the printed/saved output is just the page's own content, not
the app shell around it.

## Alternatives considered

- **Server-side generation now.** Rejected for this pass — real effort (a new dependency, a new
  endpoint, a from-scratch layout matching whatever a "designed" document should look like) that the
  owner deferred on purpose; building it ahead of that design would likely be thrown away or
  substantially reworked once the real requirements (logo, fiscal fields, pagination) are known.
- **No PDF capability at all until the server-side version ships.** Rejected — the owner asked for
  something usable today; the browser-print path is free (no dependency, no endpoint) and gives a
  working "save as PDF" immediately.

## Consequences

- The printed/saved output is exactly the page's own HTML styled for print — it looks like a printed
  web page, not a designed document (no logo, no custom pagination/headers). That's an accepted
  limitation of this phase, not a defect.
- Any other page that wants the same capability reuses `PrintButton` and only needs to add `print:`
  variants to whatever chrome (nav, action buttons, forms) shouldn't appear in the output — the
  mechanism isn't order-specific.
- When server-side generation is eventually built, it replaces/supplements this button (same UI
  affordance, different implementation) — this ADR doesn't need to be revisited for that, only
  superseded by a new one describing the chosen library/endpoint/layout once that design exists.
