import { db } from "@/lib/db";

export async function getSupportTickets() {
  const tickets = await db.supportTicket.findMany({
    include: { tenant: true, assignee: true },
    orderBy: { createdAt: "desc" },
  });
  return tickets;
}
