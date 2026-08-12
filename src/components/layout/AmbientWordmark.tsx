export function AmbientWordmark({ word = "ADMIN" }: { word?: string }) {
  return (
    <div className="ambient-wordmark-wrap">
      <div className="flex flex-col items-center gap-6">
        <div className="ambient-wordmark text-[14vw] leading-none md:text-[9vw]">{word}</div>
        <div className="flex items-center gap-3 opacity-[0.11]">
          <span className="flourish-rule w-16 md:w-28" />
          <span className="h-1 w-1 rounded-full bg-[var(--text-4)]" />
          <span className="flourish-rule w-16 md:w-28" />
        </div>
      </div>
    </div>
  );
}
