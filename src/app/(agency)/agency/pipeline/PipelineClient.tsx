"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { timeAgo, cn } from "@/lib/utils";
import { updateConversationStageAction } from "@/lib/actions/agency-inbox";
import { getDictionary, isRtl, type UiLanguage } from "@/lib/i18n";

interface PipelineConversation {
  id: string;
  stage: string;
  channel: { provider: string };
  client: { name: string | null; phone: string | null; tag: string };
  lastMessage: string | null;
  lastMessageAt: string;
}

const STAGE_KEYS = ["NEW", "CONTACTED", "INTERESTED", "MEETING_PENDING", "MEETING_BOOKED", "WON", "LOST"] as const;

export function PipelineClient({ conversations: initial, lang }: { conversations: PipelineConversation[]; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const rtl = isRtl(lang);
  const router = useRouter();
  const [conversations, setConversations] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const orderedStageKeys = rtl ? [...STAGE_KEYS].reverse() : STAGE_KEYS;
  const scrollRef = useRef<HTMLDivElement>(null);

  // The scroll container is forced dir="ltr" (see comment below) so columns
  // are reversed in the DOM instead; on first mount for RTL, jump to the
  // far-right scroll extent so "New" (last in DOM, rightmost visually) is
  // in view by default instead of the visually-last "Lost" column.
  useEffect(() => {
    if (rtl && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [rtl]);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const conversationId = active.id as string;
    const newStage = over.id as string;
    const current = conversations.find((c) => c.id === conversationId);
    if (!current || current.stage === newStage) return;

    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, stage: newStage } : c)));
    startTransition(async () => {
      const result = await updateConversationStageAction(conversationId, newStage);
      if (!result.ok) {
        setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, stage: current.stage } : c)));
      }
      router.refresh();
    });
  };

  const activeCard = conversations.find((c) => c.id === activeId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.pipeline.title}</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">{t.pipeline.subtitle}</p>
      </div>

      <DndContext sensors={sensors} onDragStart={(e) => setActiveId(e.active.id as string)} onDragEnd={handleDragEnd}>
        {/* Scroll container stays dir="ltr" regardless of page direction: RTL scroll-anchoring
            (scrollLeft=0 meaning "start" vs "end") is inconsistent across browsers, so instead
            of relying on native flex reversal here, we keep scroll behavior predictable and
            reverse the column order ourselves via orderedStageKeys. */}
        <div className="scroll-x-container" dir="ltr" ref={scrollRef}>
          <div className="flex gap-3 pb-2" style={{ minWidth: `${STAGE_KEYS.length * 260}px` }}>
            {orderedStageKeys.map((stageKey) => (
              <PipelineColumn
                key={stageKey}
                stageKey={stageKey}
                label={t.stage[stageKey]}
                cards={conversations.filter((c) => c.stage === stageKey)}
                lang={lang}
              />
            ))}
          </div>
        </div>

        <DragOverlay>{activeCard && <ConversationCard conversation={activeCard} lang={lang} dragging />}</DragOverlay>
      </DndContext>
    </div>
  );
}

function PipelineColumn({
  stageKey,
  label,
  cards,
  lang,
}: {
  stageKey: string;
  label: string;
  cards: PipelineConversation[];
  lang: UiLanguage;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageKey });

  return (
    <div
      ref={setNodeRef}
      dir={isRtl(lang) ? "rtl" : "ltr"}
      className={cn(
        "flex w-[260px] shrink-0 flex-col rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)]/40 p-2",
        isOver && "ring-1 ring-[var(--accent-from)]"
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-4)]">{label}</span>
        <span className="text-xs text-[var(--text-5)]">{cards.length}</span>
      </div>
      <div className="flex-1 space-y-2">
        {cards.map((c) => (
          <DraggableCard key={c.id} conversation={c} lang={lang} />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({ conversation, lang }: { conversation: PipelineConversation; lang: UiLanguage }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: conversation.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.4 : 1 }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <ConversationCard conversation={conversation} lang={lang} />
    </div>
  );
}

function ConversationCard({ conversation, lang, dragging }: { conversation: PipelineConversation; lang: UiLanguage; dragging?: boolean }) {
  const t = getDictionary(lang);
  return (
    <Card padding="sm" className={cn("cursor-grab active:cursor-grabbing", dragging && "shadow-lg")}>
      <div className="flex items-center gap-2">
        <Avatar name={conversation.client.name ?? conversation.client.phone ?? "?"} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--text-1)]">
            {conversation.client.name ?? conversation.client.phone ?? t.pipeline.unknown}
          </p>
          <p className="truncate text-xs text-[var(--text-4)]">{conversation.lastMessage ?? "—"}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Badge variant="outline">{t.channel[conversation.channel.provider as keyof typeof t.channel] ?? conversation.channel.provider}</Badge>
        <span className="text-[10px] text-[var(--text-5)]">{timeAgo(conversation.lastMessageAt)}</span>
      </div>
    </Card>
  );
}
