"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { loadMorePipelineStageAction, moveLeadStageAction } from "@/lib/actions/outreach-leads";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/outreach/pipeline-stages";

interface PipelineLead {
  id: string;
  businessName: string | null;
  platform: string;
  score: number | null;
  temperature: string | null;
  status: string;
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  meeting_booked: "Meeting Booked",
  deal_closed: "Deal Closed",
  lost: "Lost",
};

const STAGE_PAGE_SIZE = 20;

export function PipelineClient({
  leadsByStage: initialLeadsByStage,
  counts: initialCounts,
}: {
  leadsByStage: Record<PipelineStage, PipelineLead[]>;
  counts: Record<PipelineStage, number>;
}) {
  const [leadsByStage, setLeadsByStage] = useState(initialLeadsByStage);
  const [counts, setCounts] = useState(initialCounts);
  const [visibleByStage, setVisibleByStage] = useState<Record<PipelineStage, number>>(
    () => Object.fromEntries(PIPELINE_STAGES.map((s) => [s, STAGE_PAGE_SIZE])) as Record<PipelineStage, number>
  );
  const [loadingMore, setLoadingMore] = useState<Partial<Record<PipelineStage, boolean>>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const findLead = (leadId: string) => {
    for (const stage of PIPELINE_STAGES) {
      const lead = leadsByStage[stage]?.find((l) => l.id === leadId);
      if (lead) return lead;
    }
    return null;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const leadId = active.id as string;
    const toStage = over.id as PipelineStage;
    const current = findLead(leadId);
    if (!current || current.status === toStage) return;

    const fromStage = current.status as PipelineStage;
    setLeadsByStage((prev) => ({
      ...prev,
      [fromStage]: prev[fromStage].filter((l) => l.id !== leadId),
      [toStage]: [{ ...current, status: toStage }, ...prev[toStage]],
    }));
    setCounts((prev) => ({ ...prev, [fromStage]: prev[fromStage] - 1, [toStage]: prev[toStage] + 1 }));

    startTransition(async () => {
      const result = await moveLeadStageAction(leadId, toStage);
      if (!result.ok) {
        setLeadsByStage((prev) => ({
          ...prev,
          [toStage]: prev[toStage].filter((l) => l.id !== leadId),
          [fromStage]: [current, ...prev[fromStage]],
        }));
        setCounts((prev) => ({ ...prev, [toStage]: prev[toStage] - 1, [fromStage]: prev[fromStage] + 1 }));
      }
    });
  };

  const handleShowMore = (stage: PipelineStage) => {
    const nextLimit = visibleByStage[stage] + STAGE_PAGE_SIZE;
    setLoadingMore((prev) => ({ ...prev, [stage]: true }));
    startTransition(async () => {
      const result = await loadMorePipelineStageAction(stage, nextLimit);
      if (result.ok) {
        setLeadsByStage((prev) => ({ ...prev, [stage]: result.leads }));
        setVisibleByStage((prev) => ({ ...prev, [stage]: nextLimit }));
      }
      setLoadingMore((prev) => ({ ...prev, [stage]: false }));
    });
  };

  const activeLead = activeId ? findLead(activeId) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          <span className="text-gradient">Pipeline</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">Drag a card to move it. Every move is logged.</p>
      </motion.header>

      <DndContext sensors={sensors} onDragStart={(e) => setActiveId(e.active.id as string)} onDragEnd={handleDragEnd}>
        <div className="mt-6 space-y-4">
          {PIPELINE_STAGES.map((stage) => (
            <StageSection
              key={stage}
              stage={stage}
              label={STAGE_LABELS[stage]}
              leads={leadsByStage[stage] ?? []}
              totalCount={counts[stage] ?? 0}
              loadingMore={!!loadingMore[stage]}
              onShowMore={() => handleShowMore(stage)}
            />
          ))}
        </div>

        <DragOverlay>{activeLead && <LeadPipelineCard lead={activeLead} dragging />}</DragOverlay>
      </DndContext>
    </div>
  );
}

function StageSection({
  stage,
  label,
  leads,
  totalCount,
  loadingMore,
  onShowMore,
}: {
  stage: PipelineStage;
  label: string;
  leads: PipelineLead[];
  totalCount: number;
  loadingMore: boolean;
  onShowMore: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const hasMore = leads.length < totalCount;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "glass select-none rounded-2xl p-4 transition-all duration-150",
        isOver && "scale-[1.01] ring-2 ring-[var(--accent-from)]/60"
      )}
    >
      <p className="mb-3 cursor-default text-xs font-semibold uppercase tracking-wider text-[var(--text-4)]">
        {label} <span className="text-[var(--text-5)]">({totalCount})</span>
      </p>

      {leads.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border-hairline-strong)] px-3 py-4 text-center text-xs text-[var(--text-5)]">
          Drop a lead here
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <AnimatePresence>
              {leads.map((lead) => (
                <DraggableLeadCard key={lead.id} lead={lead} />
              ))}
            </AnimatePresence>
          </div>
          {hasMore && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={onShowMore}
                disabled={loadingMore}
                className="rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-3 py-1.5 text-xs font-medium text-[var(--text-3)] outline-none transition-colors hover:border-[var(--accent-from)]/50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
              >
                {loadingMore ? "Loading…" : `Show more (${totalCount - leads.length} left)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DraggableLeadCard({ lead }: { lead: PipelineLead }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.4 : 1 }
    : undefined;

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      layoutId={lead.id}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      {...listeners}
      {...attributes}
    >
      <LeadPipelineCard lead={lead} />
    </motion.div>
  );
}

function LeadPipelineCard({ lead, dragging }: { lead: PipelineLead; dragging?: boolean }) {
  return (
    <Link
      href={`/outreach/leads/${lead.id}`}
      draggable={false}
      className={cn(
        "block cursor-grab rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)]/50 p-3 transition-colors hover:border-[var(--accent-from)]/40 active:cursor-grabbing",
        dragging && "shadow-lg"
      )}
    >
      <p className="truncate text-sm font-medium text-[var(--text-1)]">{lead.businessName || "Unnamed business"}</p>
      <p className="mt-1 text-xs text-[var(--text-4)]">
        {lead.platform}
        {lead.score != null ? ` · ${lead.score}/10` : ""}
      </p>
    </Link>
  );
}
