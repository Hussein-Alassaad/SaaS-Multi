import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { seedMinimalFixtures, createTenantWithOwner, resetDb } from "./test-helpers";

const mockGetTenantSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getTenantSession: () => mockGetTenantSession(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));
// saveUploadedFile touches the real filesystem (public/uploads); these tests
// only care about the DB row + scope checks, so it's stubbed to a fixed path.
vi.mock("@/lib/storage", () => ({
  saveUploadedFile: async (_tenantId: string, file: File) => ({
    filePath: `/uploads/test/${file.name}`,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  }),
}));

const { uploadFileAction, listFilesAction, deleteFileAction } = await import("@/lib/actions/marketing-files");

let tenantAId: string;
let tenantAOwnerId: string;
let tenantBId: string;
let tenantBOwnerId: string;

function asTenantA() {
  mockGetTenantSession.mockResolvedValue({ id: tenantAOwnerId, tenantId: tenantAId, role: { name: "Agency Owner" } });
}
function asTenantB() {
  mockGetTenantSession.mockResolvedValue({ id: tenantBOwnerId, tenantId: tenantBId, role: { name: "Agency Owner" } });
}

beforeEach(async () => {
  const { product } = await seedMinimalFixtures();
  const a = await createTenantWithOwner({ productId: product.id, subdomain: "tenant-a" });
  const b = await createTenantWithOwner({ productId: product.id, subdomain: "tenant-b" });
  tenantAId = a.tenant.id;
  tenantAOwnerId = a.owner.id;
  tenantBId = b.tenant.id;
  tenantBOwnerId = b.owner.id;
});

afterEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

function makeFile(name: string, type: string, contents = "hello"): File {
  return new File([contents], name, { type });
}

describe("uploadFileAction", () => {
  it("stores a MarketingFile row scoped to the caller's tenant", async () => {
    asTenantA();
    const result = await uploadFileAction({ file: makeFile("logo.png", "image/png") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.tenantId).toBe(tenantAId);
    expect(result.file.type).toBe("image");
  });

  it("classifies a PDF distinctly from a generic document", async () => {
    asTenantA();
    const result = await uploadFileAction({ file: makeFile("brochure.pdf", "application/pdf") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.type).toBe("pdf");
  });

  it("rejects an empty file", async () => {
    asTenantA();
    const result = await uploadFileAction({ file: makeFile("empty.txt", "text/plain", "") });
    expect(result.ok).toBe(false);
  });
});

describe("listFilesAction", () => {
  it("only returns files belonging to the caller's tenant", async () => {
    asTenantA();
    await uploadFileAction({ file: makeFile("a.png", "image/png") });

    asTenantB();
    await uploadFileAction({ file: makeFile("b.png", "image/png") });

    asTenantA();
    const result = await listFilesAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe("a.png");
  });

  it("filters by type", async () => {
    asTenantA();
    await uploadFileAction({ file: makeFile("a.png", "image/png") });
    await uploadFileAction({ file: makeFile("a.pdf", "application/pdf") });

    const result = await listFilesAction("pdf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toHaveLength(1);
    expect(result.files[0].type).toBe("pdf");
  });
});

describe("deleteFileAction", () => {
  it("refuses to delete a file belonging to a different tenant", async () => {
    asTenantA();
    const uploaded = await uploadFileAction({ file: makeFile("a.png", "image/png") });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    asTenantB();
    const result = await deleteFileAction(uploaded.file.id);
    expect(result.ok).toBe(false);

    const stillThere = await db.marketingFile.findUnique({ where: { id: uploaded.file.id } });
    expect(stillThere).not.toBeNull();
  });

  it("deletes a file the caller's tenant owns", async () => {
    asTenantA();
    const uploaded = await uploadFileAction({ file: makeFile("a.png", "image/png") });
    if (!uploaded.ok) throw new Error("upload failed");

    const result = await deleteFileAction(uploaded.file.id);
    expect(result.ok).toBe(true);

    const gone = await db.marketingFile.findUnique({ where: { id: uploaded.file.id } });
    expect(gone).toBeNull();
  });
});
