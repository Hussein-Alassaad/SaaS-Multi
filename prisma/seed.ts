import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PERMISSION_MATRIX, type SystemRole } from "../src/lib/permissions";
import { AGENCY_PERMISSION_MATRIX, agencyRoleDbName, type AgencyRole } from "../src/lib/agency-permissions";
import { OUTREACH_PERMISSION_MATRIX, outreachRoleDbName, type OutreachRole } from "../src/lib/outreach-permissions";

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
  await db.meetingRequest.deleteMany();
  await db.meetingSlot.deleteMany();
  await db.message.deleteMany();
  await db.conversation.deleteMany();
  await db.channel.deleteMany();
  await db.nexarisClient.deleteMany();
  await db.knowledgeEntry.deleteMany();
  await db.tenantFeatureRequest.deleteMany();
  await db.aiSettings.deleteMany();
  await db.teamInvite.deleteMany();
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
  await db.user.deleteMany();
  await db.tenant.deleteMany();
  await db.plan.deleteMany();
  await db.permission.deleteMany();
  await db.role.deleteMany();
  await db.product.deleteMany();

  // -------------------------------------------------------------------
  // Roles & permissions
  // -------------------------------------------------------------------
  // Permission rows are generated directly from PERMISSION_MATRIX
  // (src/lib/permissions.ts) — the canonical source of truth used by the
  // app's `can()`/`guard()` enforcement — so the DB rows shown on the
  // Roles page always mirror what's actually enforced in code.
  const roleDefs: Record<SystemRole, { resource: string; action: string }[]> = Object.fromEntries(
    Object.entries(PERMISSION_MATRIX).map(([roleName, resourceMap]) => {
      const perms: { resource: string; action: string }[] = [];
      for (const [resource, actions] of Object.entries(resourceMap)) {
        for (const action of actions ?? []) {
          perms.push({ resource, action });
        }
      }
      return [roleName, perms];
    })
  ) as Record<SystemRole, { resource: string; action: string }[]>;

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

  // Agency OS roles — same generation pattern, stored under a distinguishing
  // DB name (agencyRoleDbName) since Role.name is globally unique and
  // collides with platform role names like "Owner"/"Sales"/"Marketing".
  const agencyRoleDefs: Record<AgencyRole, { resource: string; action: string }[]> = Object.fromEntries(
    Object.entries(AGENCY_PERMISSION_MATRIX).map(([roleName, resourceMap]) => {
      const perms: { resource: string; action: string }[] = [];
      for (const [resource, actions] of Object.entries(resourceMap)) {
        for (const action of actions ?? []) {
          perms.push({ resource, action });
        }
      }
      return [roleName, perms];
    })
  ) as Record<AgencyRole, { resource: string; action: string }[]>;

  const agencyRoles: Record<AgencyRole, { id: string }> = {} as Record<AgencyRole, { id: string }>;
  for (const [name, perms] of Object.entries(agencyRoleDefs) as [AgencyRole, { resource: string; action: string }[]][]) {
    const role = await db.role.create({
      data: {
        name: agencyRoleDbName(name),
        description: `${name} — Agency OS tenant role`,
        isSystem: true,
        permissions: { create: perms },
      },
    });
    agencyRoles[name] = role;
  }

  // Outreach roles — same generation pattern, stored under a distinguishing
  // DB name (outreachRoleDbName) since Role.name is globally unique and
  // "Owner"/"Manager" collide with both platform and Agency role names.
  const outreachRoleDefs: Record<OutreachRole, { resource: string; action: string }[]> = Object.fromEntries(
    Object.entries(OUTREACH_PERMISSION_MATRIX).map(([roleName, resourceMap]) => {
      const perms: { resource: string; action: string }[] = [];
      for (const [resource, actions] of Object.entries(resourceMap)) {
        for (const action of actions ?? []) {
          perms.push({ resource, action });
        }
      }
      return [roleName, perms];
    })
  ) as Record<OutreachRole, { resource: string; action: string }[]>;

  const outreachRoles: Record<OutreachRole, { id: string }> = {} as Record<OutreachRole, { id: string }>;
  for (const [name, perms] of Object.entries(outreachRoleDefs) as [OutreachRole, { resource: string; action: string }[]][]) {
    const role = await db.role.create({
      data: {
        name: outreachRoleDbName(name),
        description: `${name} — Outreach tenant role`,
        isSystem: true,
        permissions: { create: perms },
      },
    });
    outreachRoles[name] = role;
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

  const outreach = await db.product.create({
    data: {
      slug: "outreach",
      name: "Outreach",
      description: "AI lead discovery and outreach agent across LinkedIn and Instagram, with human-in-the-loop approval.",
      status: "ACTIVE",
      version: "1.0.0",
      maintenanceMode: false,
      config: JSON.stringify({ primaryColor: "#7c5cff", icon: "radar", supportEmail: "support@outreach.example.com" }),
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
    { email: "ava.owner@platform.example.com", name: "Ava Whitfield", role: "Owner", password: "owner123!" },
    { email: "leo.dev@platform.example.com", name: "Leo Marchetti", role: "Developer", password: "dev123!" },
    { email: "nina.support@platform.example.com", name: "Nina Osei", role: "Support", password: "support123!" },
    { email: "marcus.finance@platform.example.com", name: "Marcus Chen", role: "Finance", password: "finance123!" },
    { email: "priya.sales@platform.example.com", name: "Priya Nair", role: "Sales", password: "sales123!" },
    { email: "diego.marketing@platform.example.com", name: "Diego Fuentes", role: "Marketing", password: "marketing123!" },
  ];
  const platformUsers: Record<string, { id: string }> = {};
  for (const u of platformUsersData) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const user = await db.user.create({
      data: {
        email: u.email,
        name: u.name,
        scope: "PLATFORM",
        status: "ACTIVE",
        roleId: roles[u.role].id,
        passwordHash,
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
    { company: "Vantage Outreach Co.", sub: "vantage", product: outreach, status: "ACTIVE", plan: pro },
  ];

  const tenants: {
    id: string;
    companyName: string;
    productId: string;
    sub: string;
    isAgency: boolean;
    isOutreach: boolean;
  }[] = [];

  for (const t of tenantDefs) {
    const isAgency = t.product.id === marketing.id;
    const isOutreach = t.product.id === outreach.id;
    const ownerPassword = isOutreach ? "outreach123!" : "agency123!";
    const ownerPasswordHash = isAgency || isOutreach ? await bcrypt.hash(ownerPassword, 10) : undefined;

    const ownerUser = await db.user.create({
      data: {
        email: `owner@${t.sub}.example.com`,
        name: `${t.company.split(" ")[0]} Owner`,
        scope: "TENANT",
        status: "ACTIVE",
        uiLanguage: t.sub === "northwind" ? "AR" : "EN",
        roleId: isAgency ? agencyRoles.Owner.id : isOutreach ? outreachRoles.Owner.id : undefined,
        passwordHash: ownerPasswordHash,
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

    tenants.push({
      id: tenant.id,
      companyName: tenant.companyName,
      productId: tenant.productId,
      sub: t.sub,
      isAgency,
      isOutreach,
    });

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
  // Nexaris tenant platform -- Channels, Conversations, Messages,
  // NexarisClients, MeetingSlots/Requests, KnowledgeEntries, AiSettings.
  // Seeded for marketing-product tenants (the AI Sales & Support use case).
  // Arabic-first demo data, matching the confirmed primary language.
  // -------------------------------------------------------------------
  const arabicCustomerNames = [
    "أحمد الفهد", "سارة المطيري", "خالد العتيبي", "منى الشمري", "يوسف الدوسري",
    "ليلى القحطاني", "عمر الزهراني", "نورة الحربي", "فيصل السبيعي", "ريم العنزي",
  ];
  const arabicFirstMessages = [
    "السلام عليكم، أريد معلومات عن خدماتكم من فضلكم",
    "مرحبا، هل يمكنني معرفة الأسعار؟",
    "أهلا، أبحث عن شركة لبناء متجر إلكتروني",
    "السلام عليكم، عندي استفسار عن الباقات المتوفرة",
    "مرحبا، شفت إعلانكم وحابب أعرف أكثر عن الخدمة",
  ];
  const englishFirstMessages = [
    "Hi, I'd like to know more about your services.",
    "Hello, can you send me your pricing?",
    "Hi there, I'm looking for help launching an online store.",
  ];
  const knowledgeEntryDefs = [
    {
      title: "الخدمات المقدمة",
      category: "SERVICES",
      body: "نقدم خدمات تصميم وبناء المتاجر الإلكترونية الكاملة، بما في ذلك: تصميم واجهة المتجر، ربط بوابات الدفع، إدارة المخزون، والتسويق الرقمي للمتجر بعد الإطلاق.",
    },
    {
      title: "الأسعار والباقات",
      category: "PRICING",
      body: "الباقة الأساسية: 3000 ريال (متجر بسيط، حتى 20 منتج). الباقة الاحترافية: 7000 ريال (متجر متكامل، منتجات غير محدودة، ربط شحن). الباقة المتقدمة: حسب الطلب (تخصيص كامل + تكامل مع أنظمة ERP).",
    },
    {
      title: "الأسئلة الشائعة",
      category: "FAQ",
      body: "س: كم تستغرق مدة التنفيذ؟ ج: من 2 إلى 4 أسابيع حسب الباقة.\nس: هل تقدمون دعم بعد الإطلاق؟ ج: نعم، شهر دعم مجاني ثم باقات دعم شهرية اختيارية.\nس: هل يمكن الدفع بالتقسيط؟ ج: نعم، دفعتين على الأقل حسب الاتفاق.",
    },
    {
      title: "سياسة المواعيد",
      category: "POLICY",
      body: "المواعيد متاحة من الأحد إلى الخميس، من الساعة 10 صباحًا حتى 6 مساءً بتوقيت الرياض. يفضل حجز الموعد قبل 24 ساعة على الأقل.",
    },
  ];

  for (const tenant of tenants.filter((t) => t.isAgency)) {
    // AI settings -- Arabic-first, professional tone, approval required by default.
    await db.aiSettings.create({
      data: {
        tenantId: tenant.id,
        tone: "PROFESSIONAL",
        primaryLanguage: "AR",
        allowEnglish: true,
        approvalRequired: true,
        model: "claude-sonnet-4-5",
        qualificationRules:
          "اسأل عن نوع النشاط التجاري، الميزانية التقريبية، والجدول الزمني المطلوب قبل حجز اجتماع. لا تعطِ أسعارًا نهائية دون تأكيد من فريق المبيعات.",
      },
    });

    // Knowledge base entries
    for (const k of knowledgeEntryDefs) {
      await db.knowledgeEntry.create({
        data: {
          tenantId: tenant.id,
          title: k.title,
          category: k.category,
          body: k.body,
          addedById: null,
          createdAt: daysAgo(randInt(10, 60)),
        },
      });
    }

    // Channels -- WhatsApp connected, Instagram connected, Facebook disconnected (realistic partial setup)
    const whatsapp = await db.channel.create({
      data: { tenantId: tenant.id, provider: "WHATSAPP", status: "CONNECTED", displayName: `${tenant.companyName} WhatsApp`, connectedAt: daysAgo(45) },
    });
    const instagram = await db.channel.create({
      data: { tenantId: tenant.id, provider: "INSTAGRAM", status: "CONNECTED", displayName: `@${tenant.sub}`, connectedAt: daysAgo(30) },
    });
    await db.channel.create({
      data: { tenantId: tenant.id, provider: "FACEBOOK", status: "DISCONNECTED" },
    });
    const channels = [whatsapp, instagram];

    // Meeting slots -- a mix of available (future) and booked (linked below)
    const availableSlots: { id: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const startsAt = daysAgo(-randInt(1, 14));
      startsAt.setHours(pick([10, 11, 13, 14, 16]), 0, 0, 0);
      const slot = await db.meetingSlot.create({
        data: { tenantId: tenant.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60000), status: "AVAILABLE" },
      });
      availableSlots.push(slot);
    }

    // Conversations across the funnel
    const stagePlan: { stage: string; count: number }[] = [
      { stage: "NEW", count: 3 },
      { stage: "CONTACTED", count: 3 },
      { stage: "INTERESTED", count: 2 },
      { stage: "MEETING_PENDING", count: 1 },
      { stage: "MEETING_BOOKED", count: 2 },
      { stage: "WON", count: 2 },
      { stage: "LOST", count: 1 },
    ];

    let slotCursor = 0;
    for (const { stage, count } of stagePlan) {
      for (let i = 0; i < count; i++) {
        const useArabic = Math.random() > 0.25;
        const customerName = pick(arabicCustomerNames);
        const client = await db.nexarisClient.create({
          data: {
            tenantId: tenant.id,
            name: customerName,
            phone: `+9665${randInt(10000000, 99999999)}`,
            email: Math.random() > 0.5 ? `${customerName.split(" ")[0]}@example.com` : null,
            company: Math.random() > 0.6 ? pick(["متجر الأناقة", "بوتيك لمسة", "معرض الديار", "Style Hub"]) : null,
            needs: stage === "NEW" ? null : "بناء متجر إلكتروني متكامل مع ربط الشحن والدفع",
            tag:
              stage === "WON" ? "CONVERTED" : stage === "LOST" ? "LOST" : stage === "NEW" ? "REPLIED" : "INTERESTED",
            createdAt: daysAgo(randInt(1, 60)),
          },
        });

        const channel = pick(channels);
        const conversation = await db.conversation.create({
          data: {
            tenantId: tenant.id,
            channelId: channel.id,
            nexarisClientId: client.id,
            stage,
            status: stage === "LOST" ? "CLOSED" : "OPEN",
            language: useArabic ? "AR" : "EN",
            lastMessageAt: daysAgo(randInt(0, 20)),
            createdAt: daysAgo(randInt(1, 60)),
          },
        });

        const firstMsg = useArabic ? pick(arabicFirstMessages) : pick(englishFirstMessages);
        await db.message.create({
          data: {
            conversationId: conversation.id,
            sender: "CUSTOMER",
            body: firstMsg,
            language: useArabic ? "AR" : "EN",
            status: "SENT",
            createdAt: daysAgo(randInt(10, 60)),
          },
        });

        if (stage !== "NEW") {
          await db.message.create({
            data: {
              conversationId: conversation.id,
              sender: "AI",
              body: useArabic
                ? `أهلاً ${customerName.split(" ")[0]}، شكراً لتواصلك معنا. يسعدنا مساعدتك في بناء متجرك الإلكتروني. هل يمكنني معرفة نوع المنتجات التي تنوي بيعها؟`
                : `Hello ${customerName.split(" ")[0]}, thanks for reaching out! We'd love to help you launch your online store. What kind of products are you looking to sell?`,
              language: useArabic ? "AR" : "EN",
              status: "SENT",
              createdAt: daysAgo(randInt(9, 59)),
            },
          });
        }

        // Meeting booked / pending stages get a linked MeetingRequest
        if ((stage === "MEETING_BOOKED" || stage === "MEETING_PENDING") && slotCursor < availableSlots.length) {
          const slot = availableSlots[slotCursor++];
          await db.meetingRequest.create({
            data: {
              tenantId: tenant.id,
              conversationId: conversation.id,
              nexarisClientId: client.id,
              slotId: slot.id,
              status: stage === "MEETING_BOOKED" ? "APPROVED" : "PENDING_APPROVAL",
              decidedAt: stage === "MEETING_BOOKED" ? daysAgo(randInt(0, 5)) : null,
              createdAt: daysAgo(randInt(0, 5)),
            },
          });
          if (stage === "MEETING_BOOKED") {
            await db.meetingSlot.update({ where: { id: slot.id }, data: { status: "BOOKED" } });
          }
        }

        // A couple of pending-approval messages for the Approval Queue demo
        if (stage === "CONTACTED" && Math.random() < 0.5) {
          await db.message.create({
            data: {
              conversationId: conversation.id,
              sender: "AI",
              body: useArabic
                ? "بالنسبة للسعر، الباقة الاحترافية تبدأ من 7000 ريال وتشمل متجر متكامل مع ربط الشحن. هل ترغب بحجز موعد لمناقشة التفاصيل؟"
                : "Our professional package starts at 7,000 SAR and includes a full store with shipping integration. Would you like to book a call to go over the details?",
              language: useArabic ? "AR" : "EN",
              status: "PENDING_APPROVAL",
              createdAt: daysAgo(randInt(0, 3)),
            },
          });
          await db.conversation.update({ where: { id: conversation.id }, data: { status: "PENDING_APPROVAL" } });
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // Pending team invites (agency tenants)
  // -------------------------------------------------------------------
  for (const tenant of tenants.filter((t) => t.isAgency)) {
    const tenantUsers = await db.user.findMany({ where: { tenantId: tenant.id } });
    if (tenantUsers.length === 0) continue;
    if (Math.random() < 0.5) {
      await db.teamInvite.create({
        data: {
          tenantId: tenant.id,
          email: `newhire@${tenant.sub}-prospect.example.com`,
          roleId: pick(Object.values(agencyRoles)).id,
          invitedById: pick(tenantUsers).id,
          createdAt: daysAgo(randInt(0, 14)),
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
  // Outreach tenant platform -- settings + a starter dataset so the
  // rebuilt pages have something real to render against.
  // -------------------------------------------------------------------
  for (const t of tenants.filter((t) => t.isOutreach)) {
    await db.outreachSettings.create({
      data: {
        tenantId: t.id,
        targetNiche: "boutique fitness studios",
        targetIndustry: "health & wellness",
        targetLocation: "United States",
        targetBusinessType: "small business",
      },
    });

    const account1 = await db.outreachAccount.create({
      data: {
        tenantId: t.id,
        label: "Account 1",
        runTime: "09:00",
        status: "active",
        lastActiveAt: daysAgo(0),
      },
    });
    const account2 = await db.outreachAccount.create({
      data: {
        tenantId: t.id,
        label: "Account 2",
        runTime: "11:00",
        status: "active",
        lastActiveAt: daysAgo(1),
      },
    });

    const leadDefs = [
      { name: "Solstice Yoga Studio", platform: "linkedin", stage: "discovered", temp: null, account: account1 },
      { name: "Pulse Fitness Co.", platform: "instagram", stage: "analyzed", temp: "warm", account: account1 },
      { name: "Ironwell CrossFit", platform: "linkedin", stage: "awaiting_approval", temp: "hot", account: account2 },
      { name: "Bloom Pilates Studio", platform: "instagram", stage: "contacted", temp: "warm", account: account2 },
      { name: "Summit Strength Lab", platform: "linkedin", stage: "replied", temp: "hot", account: account1 },
    ];
    for (const l of leadDefs) {
      await db.outreachLead.create({
        data: {
          tenantId: t.id,
          accountId: l.account.id,
          platform: l.platform,
          businessName: l.name,
          status: l.stage,
          temperature: l.temp,
          score: l.temp === "hot" ? randInt(8, 10) : l.temp === "warm" ? randInt(5, 7) : null,
          createdAt: daysAgo(randInt(0, 10)),
        },
      });
    }
  }

  const agencyTenantCount = tenants.filter((t) => t.isAgency).length;
  const outreachTenantCount = tenants.filter((t) => t.isOutreach).length;
  console.log(
    `Seeded: 3 products, ${tenants.length} tenants, ${plans.length} plans, 6 platform roles, 6 agency roles, 3 outreach roles, Nexaris tenant platform data for ${agencyTenantCount} tenants, Outreach starter data for ${outreachTenantCount} tenants.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
