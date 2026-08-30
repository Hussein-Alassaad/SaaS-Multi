/**
 * Fixed brand mark -- shows "N" for every user, every product (Admin,
 * Agency, Outreach). Previously each sidebar/topbar showed the CURRENT
 * user's own first initial here instead (e.g. "Z" for a Zimmar user), which
 * meant the "logo" changed depending on who was logged in rather than being
 * a consistent mark. `size` matches the two contexts this renders in:
 * sidebars use the larger 8/16 size, mobile top bars use the smaller 7/14.
 */
export function NexarisLogo({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <div
      className={
        size === "md"
          ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-gradient text-sm font-bold text-white"
          : "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-gradient text-xs font-bold text-white"
      }
    >
      N
    </div>
  );
}
