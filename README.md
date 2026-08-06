# Admin Platform

Phase 1 of a multi-tenant SaaS Admin Platform — the internal control center that
will eventually manage multiple independent products (a Marketing platform,
a Gym platform, and future products), each plugging into the same
product-agnostic core.

This phase implements only the **Admin Platform**: dashboard, tenant CRM,
product registry, billing, AI control center, users, support, notifications,
analytics, feature flags, integrations, audit logs, monitoring, roles &
permissions, security, settings, and tenant impersonation. It does **not**
implement any Marketing or Gym feature logic — those are separate products
that register into this platform later without touching its core.

## Stack

- **Next.js 15** (App Router) + TypeScript
- **Prisma ORM** — SQLite by default (zero-config local dev), Postgres-ready
- Path-based routing (`/admin/...`) — structured so subdomain routing
  (`admin.domain.com`) is a future config swap, not a rewrite
- **Tailwind CSS v4** (CSS-first `@theme`) + **Framer Motion** for the full
  glass design system (ambient glows, shared-layout nav pill, spring-based
  sheets, shimmer-only loading states)
- **Radix UI** primitives (dialog, dropdown, tabs, select, switch, tooltip,
  etc.) restyled to match the design system
- **Recharts** for all charts
- **next-themes** for dark/light (dark-first default)
- **Zustand** for lightweight client UI state (sidebar, impersonation banner)
- **zod** for validation schemas backing the domain types

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the database

The project ships configured for **SQLite** so it runs with zero external
setup — no Postgres instance required.

```bash
cp .env.example .env
npx prisma db push      # creates prisma/dev.db from the schema
npm run db:seed         # seeds 2 products, 8 tenants, plans, invoices,
                         # AI usage logs, tickets, audit logs, flags, roles
```

(`npm run db:push` / `npm run db:seed` are also available as shortcuts —
see `package.json` scripts.)

**To use Postgres instead:**

1. In `prisma/schema.prisma`, change `provider = "sqlite"` to
   `provider = "postgresql"` under `datasource db`.
   - Note: SQLite has no native enum type, so this schema models
     enum-like fields (statuses, scopes, etc.) as validated `String`
     columns rather than Prisma `enum`s — see the comment block at the
     top of `schema.prisma` for the full list of allowed values per
     field. This keeps the same schema portable across both providers;
     you are not required to convert them to native enums when
     switching to Postgres, though you may choose to.
2. Set `DATABASE_URL` in `.env` to your Postgres connection string.
3. Run `npx prisma migrate dev` and `npm run db:seed`.

### 3. Log in

The `/admin/*` tree requires authentication. Visiting it while logged out
redirects to `/login`. Platform (internal admin) users can sign in with the
demo credentials seeded above — **tenant-user login is intentionally out of
scope for this pass** (only `scope: "PLATFORM"` users can log in here).

| Role | Email | Password |
|---|---|---|
| Owner | `ava.owner@platform.example.com` | `owner123!` |
| Developer | `leo.dev@platform.example.com` | `dev123!` |
| Support | `nina.support@platform.example.com` | `support123!` |
| Finance | `marcus.finance@platform.example.com` | `finance123!` |
| Sales | `priya.sales@platform.example.com` | `sales123!` |
| Marketing | `diego.marketing@platform.example.com` | `marketing123!` |

**Session mechanism:** email + password auth, backed by a signed, HTTP-only
JWT cookie (`admin_session`) — passwords are hashed with `bcryptjs`, and the
session token is signed/verified with `jose` (`src/lib/auth.ts`). This keeps
verification edge-compatible so `src/middleware.ts` can gate every
`/admin/*` request without touching Prisma. Sessions last 7 days. Set
`AUTH_SECRET` in `.env` to a strong random value for any real deployment
(see `.env.example`) — a fixed fallback secret is used for local dev only
and is **not safe for production**.

Server-side mutations (e.g. starting/ending tenant impersonation) call
`getSession()` to identify the acting admin and `guard()` from
`src/lib/permissions.ts` to enforce the role → permission matrix before
performing the mutation.

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — it redirects to
`/admin`.

### Other scripts

| Script | Purpose |
|---|---|
| `npm run build` | Production build |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:push` | Push schema changes to the DB (no migration history) |
| `npm run db:migrate` | Create/apply a migration (Postgres workflow) |
| `npm run db:seed` | Re-run the seed script |
| `npm run db:reset` | Drop, recreate, and reseed the database |

## Folder structure

```
src/
  app/
    (admin)/admin/          # every admin module — layout.tsx is the shell
      tenants/               tenant CRM (table + detail w/ 13 tabs)
      products/               product registry (grid + generic [slug] page)
      subscriptions/          plan builder (Basic/Pro/Enterprise)
      billing/                revenue, invoices, payments, refunds
      ai/                     AI Control Center
      users/ support/ notifications/ analytics/
      feature-flags/ integrations/ audit-logs/ monitoring/
      roles/ security/ settings/
    api/admin/               route handlers (as needed; most reads go
                              through server components + lib/mock/*)
    layout.tsx                root layout: theme provider, fonts, ambient glows
    globals.css                design tokens, glass utilities, shimmer, diagram theme
  components/
    layout/                  Sidebar, MobileTopBar, MobileBottomSheet,
                              AmbientWordmark, PageTransition, ImpersonationBanner
    ui/                       Card, Button, Badge, KpiCard, DataTable, Modal,
                              Drawer, Skeleton, Toggle, Select, Tabs, StatusBadge...
    charts/                   Revenue/TenantGrowth/AiUsage/ApiRequests/ActiveUsers
    diagram/                  SystemFlowDiagram — the monitoring page's
                              interactive technical-schematic data-flow view
  lib/
    db.ts                     Prisma client singleton
    permissions.ts             role -> permission matrix + guard helpers
    mock/                      server-side query functions per domain,
                                reading live from the seeded DB
    actions/                   server actions (e.g. impersonation start/end)
    store/                     Zustand UI store
    utils.ts
  types/
    product.ts, tenant.ts, subscription.ts, ai.ts, billing.ts
                                shared domain types + zod schemas (product-agnostic)
prisma/
  schema.prisma
  seed.ts
```

## Adding a future product

The core admin code never branches on a product's identity — `Product` is a
registry entry (`slug`, `name`, `status`, `version`, `config` JSON), and every
tenant-owned resource is scoped by `tenantId` → `productId`, not by hardcoded
product logic. To add a new product to the ecosystem:

1. Insert a row into the `Product` table (via `/admin/products` UI once
   write actions are added, or directly via Prisma/seed):
   ```ts
   await db.product.create({
     data: {
       slug: "my-new-product",
       name: "My New Product",
       status: "FUTURE", // or "ACTIVE" once launched
       version: "0.1.0",
       config: JSON.stringify({ primaryColor: "#...", icon: "..." }),
     },
   });
   ```
2. It immediately appears in `/admin/products` and gets a working detail
   page at `/admin/products/my-new-product` — the `[slug]` route reads
   generically from the registry, no code changes required.
3. Point tenants at it by setting their `productId` — they'll show up in
   that product's tenant list, AI usage, and revenue rollups automatically.
4. The product's own feature logic (e.g. class scheduling for a Gym
   product, campaign builders for a Marketing product) is built as a
   **separate codebase/module** that plugs into this admin platform's data
   model — it is intentionally out of scope for this repo.

This is proven in the seed data: **Marketing** (`ACTIVE`) and **Gym**
(`FUTURE`) are both registered products rendered from the exact same
`/admin/products/[slug]` code path, with zero `if product === '...'`
branching anywhere in the admin core.

## Known gaps vs. the full spec

- Most write actions (editing a plan, saving settings, creating a feature
  flag, etc.) are wired as functional UI with local component state rather
  than persisted server actions — the two exceptions are tenant
  impersonation (start/end sessions are persisted to `ImpersonationSession`
  + `AuditLog`) which was explicitly required to be real. Wiring the rest to
  server actions is straightforward given the existing `lib/mock/*` query
  layer and Prisma models, but was deprioritized in favor of covering every
  module end-to-end.
- Authentication now covers **platform admins only** (`scope: "PLATFORM"`).
  Tenant-side (`scope: "TENANT"`) login is intentionally out of scope for
  this pass — those users have no `passwordHash` and cannot sign in here.
- Permission enforcement (`guard()` from `lib/permissions.ts`) is wired into
  the impersonation server action, the only state-changing server action
  that currently exists in this codebase (see the gap above about most
  writes still being local component state). As more server actions are
  added for the other modules' write paths, they should call `getSession()`
  + `guard()` the same way.
- `api/admin/*` route handlers were not heavily used since server
  components calling `lib/mock/*` directly (via Prisma) covers all current
  read paths; add route handlers there as needed for client-side fetching
  or external API consumers.
