/**
 * Picks which knowledge-base entries go into the AI's prompt for one reply.
 *
 * Before: the first 10 rows, unranked -- entry 11 onward was never seen, and
 * the 10 that were chosen had nothing to do with the question. Now entries are
 * ranked by how many of the customer's words they share (title counts triple),
 * the best few are kept, and the total size is capped so the prompt stays small.
 * No embeddings: keyword overlap is enough for a business's FAQ-sized
 * knowledge base and needs no extra service.
 */

export interface KnowledgeLike {
  title: string;
  body: string;
  category?: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "is", "are", "to", "of", "in", "for", "on", "do", "you", "i", "me", "my", "we", "it", "how", "what",
  "في", "من", "على", "الى", "إلى", "هل", "ما", "عن", "مع", "هو", "هي", "انا", "أنا", "شو", "كيف", "بدي", "لو",
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((t) => !STOP_WORDS.has(t));
}

export function selectKnowledge<T extends KnowledgeLike>(entries: T[], query: string, maxEntries = 8, maxChars = 6000): T[] {
  if (entries.length === 0) return [];
  const words = new Set(tokenize(query));

  const scored = entries.map((entry, index) => {
    const title = new Set(tokenize(entry.title));
    const body = new Set(tokenize(entry.body));
    let score = 0;
    for (const w of words) {
      if (title.has(w)) score += 3;
      if (body.has(w)) score += 1;
    }
    return { entry, index, score };
  });

  // Ranked best-first; entries that match nothing keep their original order after the matches,
  // so a first message like "hello" still gets some of the business's basics.
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const picked: T[] = [];
  let used = 0;
  for (const { entry } of scored) {
    if (picked.length >= maxEntries) break;
    const size = entry.title.length + entry.body.length;
    if (picked.length > 0 && used + size > maxChars) continue;
    picked.push(entry);
    used += size;
  }
  return picked;
}
