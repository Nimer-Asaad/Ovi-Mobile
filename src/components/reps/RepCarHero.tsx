import { cn } from "@/lib/utils";
import { RepVanIllustration } from "./RepVanIllustration";

export interface RepCarHeroProps {
  subtitle: string;
  title?: string;
  className?: string;
}

/** Dark navy "car warehouse" hero — same self-contained dark-accent-block
 * pattern as the homepage HeroBanner (bg-chrome inside an otherwise light
 * page). The only motion is the van's idle float (from RepVanIllustration)
 * and a looping dashed "road line" underneath it — both pure CSS. */
export function RepCarHero({ subtitle, title = "مخزن السيارة", className }: RepCarHeroProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-card bg-chrome px-6 py-8 shadow-card md:px-10 md:py-10",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-gold-champagne/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-16 -start-16 h-56 w-56 rounded-full bg-gold-light/10 blur-3xl"
      />

      <div className="relative flex flex-col items-center gap-6 text-center md:flex-row md:justify-between md:text-start">
        <div>
          <p className="text-sm font-semibold tracking-wide text-gold-champagne">Ovi Mobile</p>
          <h2 className="mt-1 text-2xl font-bold text-white md:text-3xl">{title}</h2>
          <p className="mt-2 max-w-md text-sm text-white/60">{subtitle}</p>
        </div>

        <div className="relative w-full max-w-[220px]">
          <RepVanIllustration className="relative z-10 w-full drop-shadow-xl" />
          <div
            aria-hidden="true"
            className="absolute inset-x-6 bottom-1 h-1 animate-road-line rounded-full opacity-60"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 10px, transparent 10px, transparent 22px)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
