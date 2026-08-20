import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

/**
 * Generic instant-paint shell shown the moment a navigation starts, before
 * the destination page's real data has come back from the server. Every
 * click used to show nothing at all until the full server round-trip
 * finished (title, KPIs, table -- all at once, or nothing) -- that blank
 * pause is most of what reads as "lag," independent of how fast the
 * underlying query actually is. This never needs to match any specific
 * page's real layout exactly; it just needs to appear instantly so a click
 * has visible feedback right away.
 */
export function PageLoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="glass space-y-3 p-5">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-1">
            <Skeleton className="h-4 flex-[2]" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
