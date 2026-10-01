import nocpix from "@/assets/brands/nocpix.png";
import pard from "@/assets/brands/pard.png";
import spuhr from "@/assets/brands/spuhr.png";
import recknagel from "@/assets/brands/recknagel.svg";
import era from "@/assets/brands/era.svg";
import nitecore from "@/assets/brands/nitecore.svg";
import keeppower from "@/assets/brands/keeppower.png";

type Brand = { name: string; logo?: string };

const BRANDS: Brand[] = [
  { name: "NOCPIX", logo: nocpix },
  { name: "PARD", logo: pard },
  { name: "SPUHR", logo: spuhr },
  { name: "RECKNAGEL", logo: recknagel },
  { name: "ERA", logo: era },
  { name: "RUSAN" },
  { name: "NITECORE", logo: nitecore },
  { name: "KEEPPOWER", logo: keeppower },
];

/** Laufband mit Markenlogos – nur am PC, stoppt beim Überfahren mit der Maus. */
export function BrandMarquee({ onSelect }: { onSelect: (brand: string) => void }) {
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-16 pr-16" aria-hidden={hidden || undefined}>
      {BRANDS.map((b) => (
        <li key={b.name}>
          <button type="button" tabIndex={hidden ? -1 : 0} onClick={() => onSelect(b.name)} title={`Alle Produkte von ${b.name}`} className="flex h-5 items-center transition-transform hover:scale-110">
          {b.logo ? (
            <img
              src={b.logo}
              alt={hidden ? "" : b.name}
              className="h-full w-auto max-w-[150px] object-contain brightness-0 invert"
              loading="lazy"
            />
          ) : (
            <span className="text-base font-black tracking-[0.2em] text-primary-foreground">
              {b.name}
            </span>
          )}
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <section
      aria-label="Unsere Marken"
      className="group hidden overflow-hidden bg-primary py-2 opacity-60 transition-opacity hover:opacity-90 md:block"
    >
      <div className="flex w-max animate-brand-marquee group-hover:[animation-play-state:paused]">
        {row(false)}
        {row(true)}
      </div>
    </section>
  );
}

/** Herstellerlogo (weiß) – fällt auf den Namen als Text zurück, wenn kein Logo vorhanden ist. */
export function BrandLogo({ name, className = "h-8" }: { name: string; className?: string }) {
  const logo = BRANDS.find((b) => b.name.toUpperCase() === (name ?? "").trim().toUpperCase())?.logo;
  if (!logo) return <p className="text-lg font-bold">{name}</p>;
  return <img src={logo} alt={name} className={`${className} w-auto max-w-[220px] object-contain object-left brightness-0 invert`} />;
}
