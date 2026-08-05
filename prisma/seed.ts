import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

async function main() {
  console.log("Seeding database...");

  // Clean slate (order matters for FK constraints)
  await db.impersonationSession.deleteMany();
  await db.auditLog.deleteMany();
  await db.aiUsageLog.deleteMany();
  await db.aiBudget.deleteMany();
  await db.supportTicket.deleteMany();
  await db.refund.deleteMany();
  await db.payment.deleteMany();
  await db.invoice.deleteMany();
  await db.subscription.deleteMany();
  await db.featureFlag.deleteMany();
  await db.notification.deleteMany();
  await db.integration.deleteMany();
  await db.user.deleteMany();
  await db.tenant.deleteMany();
  await db.plan.deleteMany();
  await db.permission.deleteMany();
  await db.role.deleteMany();
  await db.product.deleteMany();

  // -------------------------------------------------------------------
  // Roles & permissions
  // -------------------------------------------------------------------
  const roleDefs: Record<string, { resource: string; action: string }[]> = {
    Owner: [{ resource: "*", action: "manage" }],
    Developer: [
      { resource: "products", action: "manage" },
      { resource: "feature-flags", action: "manage" },
      { resource: "integrations", action: "manage" },
      { resource: "monitoring", action: "manage" },
      { resource: "ai", action: "manage" },
    ],
    Support: [
      { resource: "tenants", action: "edit" },
      { resource: "support", action: "manage" },
      { resource: "users", action: "edit" },
    ],
    Finance: [
      { resource: "billing", action: "manage" },
      { resource: "subscriptions", action: "manage" },
      { resource: "analytics", action: "view" },
    ],
    Sales: [
      { resource: "tenants", action: "edit" },
      { resource: "subscriptions", action: "edit" },
      { resource: "analytics", action: "view" },
    ],
    Marketing: [
      { resource: "notifications", action: "manage" },
      { resource: "analytics", action: "view" },
    ],
  };

  const roles: Record<string, { id: string }> = {};
  for (const [name, perms] of Object.entries(roleDefs)) {
    const role = await db.role.create({
      data: {
        name,
        description: `${name} — internal platform role`,
        isSystem: true,
        permissions: { create: perms },
      },
    });
    roles[name] = role;
  }

  // -------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------
  const marketing = await db.product.create({
    data: {
      slug: "marketing",
      name: "Marketing Platform",
      description: "Campaign management, email automation, and analytics for SMB marketers.",
      status: "ACTIVE",
      version: "2.4.1",
      maintenanceMode: false,
      config: JSON.stringify({ primaryColor: "#7c5cff", icon: "megaphone", supportEmail: "support@marketing.example.com" }),
    },
  });

  const gym = await db.product.create({
    data: {
      slug: "gym",
      name: "Gym Platform",
      description: "Class scheduling, membership management, and check-ins for fitness studios. Built by a partner team; integration pending.",
      status: "FUTURE",
      version: "0.1.0",
      maintenanceMode: false,
      config: JSON.stringify({ primaryColor: "#22c55e", icon: "dumbbell", supportEmail: "support@gym.example.com" }),
    },
  });

  // -------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------
  const basic = await db.plan.create({
    data: {
      name: "Basic",
      slug: "basic",
      maxUsers: 5,
      storageLimitMb: 2048,
      aiCredits: 500,
      monthlyPrice: 2900,
      yearlyPrice: 29000,
      features: JSON.stringify(["5 team members", "2GB storage", "500 AI credits/mo", "Email support"]),
      isActive: true,
    },
  });
  const pro = await db.plan.create({
    data: {
      name: "Pro",
      slug: "pro",
      maxUsers: 25,
      storageLimitMb: 20480,
      aiCredits: 5000,
      monthlyPrice: 9900,
      yearlyPrice: 99000,
      features: JSON.stringify([
        "25 team members",
        "20GB storage",
        "5,000 AI credits/mo",
        "Priority support",
        "Advanced analytics",
      ]),
      isActive: true,
    },
  });
  const enterprise = await db.plan.create({
    data: {
      name: "Enterprise",
      slug: "enterprise",
      maxUsers: 250,
      storageLimitMb: 204800,
      aiCredits: 50000,
      monthlyPrice: 49900,
      yearlyPrice: 499000,
      features: JSON.stringify([
        "Unlimited team members",
        "200GB storage",
        "50,000 AI credits/mo",
        "Dedicated support",
        "SSO & audit exports",
        "Custom AI budgets",
      ]),
      isActive: true,
    },
  });
  const plans = [basic, pro, enterprise];

  // -------------------------------------------------------------------
  // Platform (internal admin) users
  // -------------------------------------------------------------------
  const platformUsersData = [
    { email: "ava.owner@platform.example.com", name: "Ava Whitfield", role: "Owner" },
    { email: "leo.dev@platform.example.com", name: "Leo Marchetti", role: "Developer" },
    { email: "nina.support@platform.example.com", name: "Nina Osei", role: "Support" },
    { email: "marcus.finance@platform.example.com", name: "Marcus Chen", role: "Finance" },
    { email: "priya.sales@platform.example.com", name: "Priya Nair", role: "Sales" },
    { email: "diego.marketing@platform.example.com", name: "Diego Fuentes", role: "Marketing" },
  ];
  const platformUsers: Record<string, { id: string }> = {};
  for (const u of platformUsersData) {
    const user = await db.user.create({
      data: {
        email: u.email,
        name: u.name,
        scope: "PLATFORM",
        status: "ACTIVE",
        roleId: roles[u.role].id,
        lastLoginAt: daysAgo(randInt(0, 5)),
      },
    });
    platformUsers[u.role] = user;
  }

  // -------------------------------------------------------------------
  // Tenants (spread across products) + tenant users
  // -------------------------------------------------------------------
  const tenantDefs = [
    { company: "Northwind Retail Co.", sub: "northwind", product: marketing, status: "ACTIVE", plan: pro },
    { company: "Blue Harbor Agency", sub: "blueharbor", product: marketing, status: "ACTIVE", plan: enterprise },
    { company: "Crestline Media", sub: "crestline", product: marketing, status: "TRIAL", plan: basic },
    { company: "Summit Growth Labs", sub: "summitgrowth", product: marketing, status: "PAST_DUE", plan: pro },
    { company: "Verdant Studio", sub: "verdant", product: marketing, status: "ACTIVE", plan: basic },
    { company: "Ironclad Fitness Group", sub: "ironclad", product: gym, status: "TRIAL", plan: basic },
    { company: "Peak Form Studios", sub: "peakform", product: gym, status: "ACTIVE", plan: pro },
    { company: "Riverside Wellness", sub: "riverside", product: marketing, status: "SUSPENDED", plan: basic },
  ];

  const tenants: { id: string; companyName: string; productId: string }[] = [];

  for (const t of tenantDefs) {
    const ownerUser = await db.user.create({
      data: {
        email: `owner@${t.sub}.example.com`,
        name: `${t.company.split(" ")[0]} Owner`,
        scope: "TENANT",
        status: "ACTIVE",
        lastLoginAt: daysAgo(randInt(0, 14)),
      },
    });

    const tenant = await db.tenant.create({
      data: {
        productId: t.product.id,
        companyName: t.company,
        subdomain: t.sub,
        status: t.status,
        ownerId: ownerUser.id,
        storageUsedMb: randInt(50, 15000),
        aiCreditsUsed: randInt(10, 4000),
        createdAt: daysAgo(randInt(30, 400)),
      },
    });

    await db.user.update({ where: { id: ownerUser.id }, data: { tenantId: tenant.id } });

    // a couple of extra team members per tenant
    for (let i = 0; i < randInt(1, 3); i++) {
      await db.user.create({
        data: {
          email: `member${i + 1}@${t.sub}.example.com`,
          name: `Team Member ${i + 1}`,
          scope: "TENANT",
          status: pick(["ACTIVE", "ACTIVE", "INVITED"]),
          tenantId: tenant.id,
          lastLoginAt: daysAgo(randInt(0, 30)),
        },
      });
    }

    tenants.push({ id: tenant.id, companyName: tenant.companyName, productId: tenant.productId });

    // Subscription
    const subStatus =
      t.status === "TRIAL"
        ? "TRIALING"
        : t.status === "PAST_DUE"
        ? "PAST_DUE"
        : t.status === "SUSPENDED"
        ? "CANCELED"
        : "ACTIVE";

    await db.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: t.plan.id,
        status: subStatus,
        trialEndsAt: t.status === "TRIAL" ? daysAgo(-14) : null,
        gracePeriodEndsAt: t.status === "PAST_DUE" ? daysAgo(-7) : null,
        billingCycle: pick(["monthly", "yearly"]),
        currentPeriodStart: daysAgo(randInt(1, 30)),
        currentPeriodEnd: daysAgo(-randInt(1, 30)),
      },
    });

    // Invoices + payments + occasional refund
    const invoiceCount = randInt(2, 5);
    for (let i = 0; i < invoiceCount; i++) {
      const amount = t.plan.monthlyPrice;
      const issued = daysAgo(30 * (invoiceCount - i));
      const invStatus = i === invoiceCount - 1 && t.status === "PAST_DUE" ? "OPEN" : "PAID";
      const invoice = await db.invoice.create({
        data: {
          tenantId: tenant.id,
          number: `INV-${tenant.subdomain.toUpperCase()}-${1000 + i}`,
          status: invStatus,
          amountCents: amount,
          dueDate: daysAgo(30 * (invoiceCount - i) - 14),
          issuedAt: issued,
          paidAt: invStatus === "PAID" ? daysAgo(30 * (invoiceCount - i) - 2) : null,
          lineItems: JSON.stringify([
            { description: `${t.plan.name} plan — monthly`, amountCents: amount },
          ]),
        },
      });

      if (invStatus === "PAID") {
        const payment = await db.payment.create({
          data: {
            tenantId: tenant.id,
            invoiceId: invoice.id,
            amountCents: amount,
            status: "SUCCEEDED",
            method: pick(["card", "card", "bank_transfer"]),
            processedAt: invoice.paidAt ?? issued,
          },
        });

        if (Math.random() < 0.12) {
          await db.refund.create({
            data: {
              tenantId: tenant.id,
              paymentId: payment.id,
              amountCents: Math.floor(amount * 0.5),
              reason: pick(["Duplicate charge", "Service downgrade", "Customer request"]),
              status: pick(["COMPLETED", "APPROVED", "PENDING"]),
              requestedAt: daysAgo(randInt(1, 20)),
              processedAt: daysAgo(randInt(0, 10)),
            },
          });
        }
      }
    }

    // AI usage logs — last 30 days
    const aiModels = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-5", "claude-opus-4-6", "gemini-2.5-flash"];
    const dailyLogCount = randInt(1, 6);
    for (let day = 0; day < 30; day++) {
      for (let i = 0; i < randInt(0, dailyLogCount); i++) {
        const tokens = randInt(200, 8000);
        const success = Math.random() > 0.05;
        await db.aiUsageLog.create({
          data: {
            tenantId: tenant.id,
            productId: t.product.id,
            model: pick(aiModels),
            tokens,
            costCents: Math.max(1, Math.round(tokens * 0.0012)),
            responseTimeMs: randInt(180, 4200),
            success,
            errorMessage: success ? null : pick(["Rate limit exceeded", "Timeout", "Upstream 500"]),
            createdAt: daysAgo(day),
          },
        });
      }
    }

    // AI budget scoped to this tenant
    await db.aiBudget.create({
      data: {
        scope: "TENANT",
        scopeId: tenant.id,
        dailyBudgetCents: randInt(500, 5000),
        monthlyBudgetCents: randInt(10000, 100000),
        rateLimitPerMin: pick([30, 60, 120]),
        defaultModel: pick(aiModels),
        cachingEnabled: Math.random() > 0.2,
        killSwitchEnabled: false,
      },
    });

    // Support tickets
    const ticketCount = randInt(0, 3);
    for (let i = 0; i < ticketCount; i++) {
      await db.supportTicket.create({
        data: {
          tenantId: tenant.id,
          subject: pick([
            "Unable to export analytics report",
            "Billing discrepancy on last invoice",
            "Feature request: bulk tenant tagging",
            "AI responses slower than usual",
            "Cannot invite new team member",
            "SSO login failing intermittently",
          ]),
          description: "Reported via support widget.",
          type: pick(["BUG", "FEATURE_REQUEST", "FEEDBACK", "QUESTION", "BILLING"]),
          priority: pick(["LOW", "MEDIUM", "HIGH", "URGENT"]),
          status: pick(["OPEN", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "RESOLVED", "CLOSED"]),
          assigneeId: Math.random() > 0.3 ? platformUsers.Support.id : null,
          createdAt: daysAgo(randInt(0, 25)),
        },
      });
    }

    // Audit logs
    const auditActions = [
      "tenant.updated",
      "subscription.changed",
      "invoice.generated",
      "user.invited",
      "feature_flag.toggled",
      "impersonation.started",
    ];
    for (let i = 0; i < randInt(2, 6); i++) {
      await db.auditLog.create({
        data: {
          actorId: pick(Object.values(platformUsers)).id,
          action: pick(auditActions),
          resource: "tenant",
          tenantId: tenant.id,
          ip: `${randInt(10, 250)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`,
          device: pick(["Desktop", "Laptop", "Mobile"]),
          browser: pick(["Chrome 128", "Safari 17", "Firefox 129", "Edge 127"]),
          oldValue: JSON.stringify({ status: "ACTIVE" }),
          newValue: JSON.stringify({ status: t.status }),
          createdAt: daysAgo(randInt(0, 60)),
        },
      });
    }
  }

  // -------------------------------------------------------------------
  // Global / product-level AI budgets
  // -------------------------------------------------------------------
  await db.aiBudget.create({
    data: {
      scope: "GLOBAL",
      scopeId: null,
      dailyBudgetCents: 500000,
      monthlyBudgetCents: 12000000,
      rateLimitPerMin: 600,
      defaultModel: "gpt-4o-mini",
      cachingEnabled: true,
      killSwitchEnabled: false,
    },
  });
  await db.aiBudget.create({
    data: {
      scope: "PRODUCT",
      scopeId: marketing.id,
      dailyBudgetCents: 200000,
      monthlyBudgetCents: 5000000,
      rateLimitPerMin: 300,
      defaultModel: "claude-sonnet-5",
      cachingEnabled: true,
      killSwitchEnabled: false,
    },
  });
  await db.aiBudget.create({
    data: {
      scope: "PRODUCT",
      scopeId: gym.id,
      dailyBudgetCents: 20000,
      monthlyBudgetCents: 400000,
      rateLimitPerMin: 60,
      defaultModel: "gpt-4o-mini",
      cachingEnabled: true,
      killSwitchEnabled: true,
    },
  });

  // -------------------------------------------------------------------
  // Feature flags at different scopes
  // -------------------------------------------------------------------
  await db.featureFlag.createMany({
    data: [
      { key: "new_dashboard_ui", name: "New Dashboard UI", scope: "GLOBAL", scopeId: null, enabled: true, description: "Rolls out the redesigned admin dashboard shell." },
      { key: "ai_auto_replies", name: "AI Auto Replies", scope: "GLOBAL", scopeId: null, enabled: false, description: "Enables AI-drafted support replies globally." },
      { key: "beta_analytics_v2", name: "Analytics v2 (Beta)", scope: "PRODUCT", scopeId: marketing.id, enabled: true, description: "New cohort & LTV analytics for Marketing." },
      { key: "gym_checkin_kiosk", name: "Check-in Kiosk Mode", scope: "PRODUCT", scopeId: gym.id, enabled: false, description: "Front-desk kiosk check-in flow." },
      { key: "priority_support", name: "Priority Support Badge", scope: "SUBSCRIPTION", scopeId: enterprise.id, enabled: true, description: "Shows a priority queue badge for Enterprise tickets." },
      { key: "early_access_ai_models", name: "Early Access AI Models", scope: "TENANT", scopeId: tenants[1].id, enabled: true, description: "Grants access to preview AI models." },
      { key: "custom_branding", name: "Custom Branding", scope: "SUBSCRIPTION", scopeId: pro.id, enabled: true, description: "Allows white-label branding on tenant-facing pages." },
    ],
  });

  // -------------------------------------------------------------------
  // Notifications / broadcasts
  // -------------------------------------------------------------------
  await db.notification.createMany({
    data: [
      {
        title: "Scheduled maintenance — Aug 10, 2:00 AM UTC",
        body: "The platform will be briefly unavailable for scheduled maintenance.",
        audience: "ALL_TENANTS",
        status: "SENT",
        sentAt: daysAgo(3),
      },
      {
        title: "New AI models now available",
        body: "Claude Sonnet 5 and Gemini 2.5 Flash are now selectable in AI settings.",
        audience: "ALL_TENANTS",
        status: "SENT",
        sentAt: daysAgo(10),
      },
      {
        title: "Gym platform preview — coming soon",
        body: "We're excited to share an early look at the Gym platform for select partners.",
        audience: "PRODUCT_TENANTS",
        audienceRef: gym.id,
        status: "SCHEDULED",
        scheduledAt: daysAgo(-5),
      },
      {
        title: "Internal: Q3 roadmap review",
        body: "Roadmap review deck posted for all platform staff.",
        audience: "ALL_PLATFORM_USERS",
        status: "DRAFT",
      },
    ],
  });

  // -------------------------------------------------------------------
  // Integrations
  // -------------------------------------------------------------------
  await db.integration.createMany({
    data: [
      { provider: "OPENAI", name: "OpenAI", enabled: true, config: JSON.stringify({ apiKeyMasked: "sk-••••1a2b", org: "org-platform" }), lastSyncAt: daysAgo(0) },
      { provider: "CLAUDE", name: "Anthropic Claude", enabled: true, config: JSON.stringify({ apiKeyMasked: "sk-ant-••••9f3e" }), lastSyncAt: daysAgo(0) },
      { provider: "GEMINI", name: "Google Gemini", enabled: false, config: JSON.stringify({}), lastSyncAt: null },
      { provider: "SMTP", name: "Transactional Email (SMTP)", enabled: true, config: JSON.stringify({ host: "smtp.postmarkapp.com", port: 587 }), lastSyncAt: daysAgo(1) },
      { provider: "SUPABASE", name: "Supabase", enabled: false, config: JSON.stringify({}), lastSyncAt: null },
      { provider: "CLOUDFLARE", name: "Cloudflare", enabled: true, config: JSON.stringify({ zone: "example.com" }), lastSyncAt: daysAgo(2) },
      { provider: "STORAGE", name: "Object Storage (S3-compatible)", enabled: true, config: JSON.stringify({ bucket: "admin-platform-prod" }), lastSyncAt: daysAgo(0) },
      { provider: "META", name: "Meta Business", enabled: false, config: JSON.stringify({}), lastSyncAt: null },
      { provider: "WHATSAPP", name: "WhatsApp Business API", enabled: false, config: JSON.stringify({}), lastSyncAt: null },
      { provider: "RESEND", name: "Resend", enabled: true, config: JSON.stringify({ domain: "mail.example.com" }), lastSyncAt: daysAgo(1) },
      { provider: "WEBHOOK", name: "Outbound Webhooks", enabled: true, config: JSON.stringify({ endpoints: 3 }), lastSyncAt: daysAgo(0) },
    ],
  });

  console.log(`Seeded: 2 products, ${tenants.length} tenants, ${plans.length} plans, 6 roles.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
