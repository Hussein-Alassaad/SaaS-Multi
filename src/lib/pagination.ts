/**
 * Cursor-based pagination shape shared by every "Load more" list in the
 * agency app. Cursor pagination (not offset/skip) is used deliberately --
 * offset pagination gets slower the deeper you page (the DB has to count
 * and skip N rows every time), while a cursor on an indexed column stays
 * fast regardless of how many pages deep you are. Matches the composite
 * indexes added alongside this (e.g. Conversation@@index([tenantId, lastMessageAt])).
 */
export const DEFAULT_PAGE_SIZE = 25;
