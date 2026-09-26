import type { ReactNode } from "react";

export const HOSTED_ORGANIZATION_BACKGROUND = "/images/hosted/hosted-organizations-background.png";

export default function HostedOrganizationHero({
  eyebrow,
  title,
  description,
  siteCoverUrl,
  compact = false,
  centered = false,
  rightAligned = false,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  siteCoverUrl?: string | null;
  compact?: boolean;
  centered?: boolean;
  rightAligned?: boolean;
}) {
  return <section
    className={`relative isolate overflow-hidden bg-zinc-950 px-5 text-white ${compact ? "py-12 sm:px-7 sm:py-16" : "py-20 sm:px-7 sm:py-28"}`}
    style={{
      backgroundImage: `url("${siteCoverUrl ?? HOSTED_ORGANIZATION_BACKGROUND}")`,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "cover",
    }}
  >
    <div aria-hidden="true" className={`absolute inset-0 -z-10 ${rightAligned ? "bg-gradient-to-l from-black/90 via-black/65 to-black/35" : "bg-gradient-to-r from-black/90 via-black/75 to-black/60"}`} />
    <div className="mx-auto max-w-6xl">
      <div className={centered ? "text-center" : rightAligned ? "md:ml-auto md:w-1/2 md:text-right" : ""}>
        {eyebrow ? <p className="text-xs font-black uppercase tracking-[.24em] text-orange-400 sm:text-sm">{eyebrow}</p> : null}
        <h1 className={`font-black tracking-tight text-white drop-shadow-lg ${eyebrow ? "mt-3" : ""} ${compact ? "text-4xl sm:text-5xl" : "max-w-4xl text-4xl sm:text-6xl"}`}>{title}</h1>
        {description ? <p className={`mt-5 text-base leading-7 text-zinc-100 drop-shadow-md sm:text-lg sm:leading-8 ${centered ? "mx-auto max-w-3xl" : "max-w-2xl"}`}>{description}</p> : null}
      </div>
    </div>
  </section>;
}
