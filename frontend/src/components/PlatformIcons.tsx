import amazonMusicIcon from "../assets/icons/amzn.png";
import deezerIcon from "../assets/icons/dzr.png";
import lrclibIcon from "../assets/icons/lrclib.png";
import musicBrainzDarkIcon from "../assets/icons/musicbrainz_d.png";
import musicBrainzLightIcon from "../assets/icons/musicbrainz_l.png";
import qobuzIcon from "../assets/icons/qbz.png";
import songlinkDarkIcon from "../assets/icons/songlink_d.png";
import songlinkLightIcon from "../assets/icons/songlink_l.png";
import songstatsIcon from "../assets/icons/songstats.png";
import tidalDarkIcon from "../assets/icons/tidal_d.png";
import tidalLightIcon from "../assets/icons/tidal_l.png";
type PlatformIconProps = {
    className?: string;
};
function sanitizeClassName(className: string): string {
    return className
        .split(/\s+/)
        .filter(Boolean)
        .filter((part) => part !== "fill-current" && part !== "fill-muted-foreground" && !part.startsWith("text-"))
        .join(" ");
}
function hasRoundedClass(className: string): boolean {
    return className
        .split(/\s+/)
        .some((part) => part.startsWith("rounded"));
}
function getStatusClasses(className: string): string {
    if (className.includes("text-green-500")) {
        return "ring-2 ring-green-500 rounded-sm";
    }
    if (className.includes("text-red-500")) {
        return "ring-2 ring-red-500 rounded-sm opacity-70";
    }
    return "";
}
function PlatformIcon({ src, alt, className = "w-4 h-4", defaultClassName = "" }: {
    src: string;
    alt: string;
    className?: string;
    defaultClassName?: string;
}) {
    const cleanedClassName = sanitizeClassName(className);
    const statusClasses = getStatusClasses(className);
    const imageClassName = [
        cleanedClassName || "w-4 h-4",
        "inline-block shrink-0 object-contain",
        !hasRoundedClass(cleanedClassName) ? defaultClassName : "",
        statusClasses,
    ]
        .filter(Boolean)
        .join(" ");
    return <img src={src} alt={alt} className={imageClassName} loading="lazy" referrerPolicy="no-referrer"/>;
}
function ThemedPlatformIcon({ lightSrc, darkSrc, alt, className = "w-4 h-4", defaultClassName = "" }: {
    lightSrc: string;
    darkSrc: string;
    alt: string;
    className?: string;
    defaultClassName?: string;
}) {
    const cleanedClassName = sanitizeClassName(className);
    const statusClasses = getStatusClasses(className);
    const wrapperClassName = [
        cleanedClassName || "w-4 h-4",
        "relative inline-flex shrink-0",
        !hasRoundedClass(cleanedClassName) ? defaultClassName : "",
        statusClasses,
    ]
        .filter(Boolean)
        .join(" ");
    return <span role="img" aria-label={alt} className={wrapperClassName}>
      <img src={lightSrc} alt="" aria-hidden="true" className="h-full w-full object-contain dark:hidden" loading="lazy" referrerPolicy="no-referrer"/>
      <img src={darkSrc} alt="" aria-hidden="true" className="hidden h-full w-full object-contain dark:block" loading="lazy" referrerPolicy="no-referrer"/>
    </span>;
}
export function TidalIcon({ className = "w-4 h-4" }: PlatformIconProps) {
    return <ThemedPlatformIcon lightSrc={tidalLightIcon} darkSrc={tidalDarkIcon} alt="Tidal" className={className} defaultClassName="rounded-[4px]"/>;
}
export function QobuzIcon({ className = "w-4 h-4" }: PlatformIconProps) {
    return <PlatformIcon src={qobuzIcon} alt="Qobuz" className={className}/>;
}
export function AmazonIcon({ className = "w-4 h-4" }: PlatformIconProps) {
    return <PlatformIcon src={amazonMusicIcon} alt="Amazon Music" className={className} defaultClassName="rounded-[4px]"/>;
}
export function DeezerIcon({ className = "w-4 h-4" }: PlatformIconProps) {
    return <PlatformIcon src={deezerIcon} alt="Deezer" className={className} defaultClassName="rounded-[4px]"/>;
}
export function LrclibIcon({ className = "w-4 h-4" }: PlatformIconProps) {
    return <PlatformIcon src={lrclibIcon} alt="LRCLIB" className={className}/>;
}
export function MusicBrainzIcon({ className = "w-4 h-4" }: PlatformIconProps) {
    return <ThemedPlatformIcon lightSrc={musicBrainzLightIcon} darkSrc={musicBrainzDarkIcon} alt="MusicBrainz" className={className}/>;
}
export function SonglinkIcon({ className = "w-4 h-4" }: PlatformIconProps) {
    return <ThemedPlatformIcon lightSrc={songlinkLightIcon} darkSrc={songlinkDarkIcon} alt="Songlink" className={className} defaultClassName="rounded-[3px]"/>;
}
export function SongstatsIcon({ className = "w-4 h-4" }: PlatformIconProps) {
    return <PlatformIcon src={songstatsIcon} alt="Songstats" className={className} defaultClassName="rounded-[3px]"/>;
}
export function TidalAvailabilityIcon({ className = "w-4 h-4" }: PlatformIconProps) {
    return <svg viewBox="0 0 24 24" className={`${className} fill-current`}>
        <path d="M4.022 4.5 0 8.516l3.997 3.99 3.997-3.984L4.022 4.5Zm7.956 0L7.994 8.522l4.003 3.984L16 8.484 11.978 4.5Zm8.007 0L24 8.528l-4.003 3.978L16 8.484 19.985 4.5Z"></path>
        <path d="m8.012 16.534 3.991 3.966L16 16.49l-4.003-3.984-3.985 4.028Z"></path>
    </svg>;
}
export function QobuzAvailabilityIcon({ className = "w-4 h-4" }: PlatformIconProps) {
    return <svg viewBox="0 0 24 24" className={`${className} fill-current`}>
        <path d="M21.744 9.815C19.836 1.261 8.393-1 3.55 6.64-.618 13.214 4 22 11.988 22c2.387 0 4.63-.83 6.394-2.304l2.252 2.252 1.224-1.224-2.252-2.253c1.983-2.407 2.823-5.586 2.138-8.656Zm-3.508 7.297L16.4 15.275c-.786-.787-2.017.432-1.224 1.225L17 18.326C10.29 23.656.5 16 5.16 7.667c3.502-6.264 13.172-4.348 14.707 2.574.529 2.385-.06 4.987-1.63 6.87Z"></path>
        <path d="M13.4 8.684a3.59 3.59 0 0 0-4.712 1.9 3.59 3.59 0 0 0 1.9 4.712 3.594 3.594 0 0 0 4.711-1.89 3.598 3.598 0 0 0-1.9-4.722Zm-.737 3.591a.727.727 0 0 1-.965.384.727.727 0 0 1-.384-.965.727.727 0 0 1 .965-.384.73.73 0 0 1 .384.965Z"></path>
    </svg>;
}
export function AmazonAvailabilityIcon({ className = "w-4 h-4" }: PlatformIconProps) {
    return <svg viewBox="0 0 24 24" className={`${className} fill-current`}>
        <path fillRule="evenodd" d="M15.62 11.13c-.15.1-.37.18-.64.18-.42 0-.82-.05-1.21-.18l-.22-.04c-.08 0-.1.04-.1.14v.25c0 .08.02.12.05.17.02.03.07.08.15.1.4.18.84.25 1.33.25.52 0 .91-.12 1.24-.37.32-.25.47-.57.47-.99 0-.3-.08-.52-.23-.72-.15-.17-.4-.34-.74-.47l-.7-.27c-.26-.1-.46-.2-.53-.3a.47.47 0 0 1-.15-.36c0-.38.27-.57.84-.57.32 0 .64.05.94.15l.2.04c.07 0 .12-.04.12-.14v-.25c0-.08-.03-.12-.05-.17-.03-.05-.08-.08-.15-.1-.37-.13-.74-.2-1.11-.2-.47 0-.87.12-1.16.35-.3.22-.45.54-.45.91 0 .57.32.99.97 1.24l.74.27c.24.1.4.17.5.27.09.1.12.2.12.35 0 .2-.08.37-.23.46Zm-3.88-3.55v3.28c-.42.28-.84.42-1.26.42-.27 0-.47-.07-.6-.22-.11-.15-.16-.37-.16-.7V7.59c0-.13-.05-.18-.18-.18h-.52c-.12 0-.17.05-.17.18v3.06c0 .42.1.77.32.99.22.22.55.35.97.35.56 0 1.13-.2 1.68-.6l.05.3c0 .07.02.1.07.12.02.03.07.03.15.03h.37c.12 0 .17-.05.17-.18V7.58c0-.13-.05-.18-.17-.18h-.52c-.15 0-.2.08-.2.18Zm-4.69 4.27h.52c.12 0 .17-.05.17-.17v-3.1c0-.41-.1-.73-.32-.95a1.25 1.25 0 0 0-.94-.35c-.57 0-1.16.2-1.73.62-.2-.42-.57-.62-1.11-.62-.55 0-1.1.2-1.64.57l-.04-.27c0-.08-.03-.1-.08-.13-.02-.02-.07-.02-.12-.02h-.4c-.12 0-.17.05-.17.17v4.1c0 .13.05.18.17.18h.52c.12 0 .17-.05.17-.18V8.37c.42-.25.84-.4 1.29-.4.25 0 .42.08.52.22.1.15.17.35.17.65v2.84c0 .12.05.17.17.17h.52c.13 0 .18-.05.18-.17V8.37c.44-.27.86-.4 1.28-.4.25 0 .42.08.52.22.1.15.17.35.17.65v2.84c0 .12.05.17.18.17Zm13.47 3.29a21.8 21.8 0 0 1-8.3 1.7c-3.96 0-7.8-1.08-10.88-2.89a.35.35 0 0 0-.15-.05c-.17 0-.27.2-.1.37a16.11 16.11 0 0 0 10.87 4.16c3.02 0 6.5-.94 8.9-2.72.42-.3.08-.74-.34-.57Zm-.08-6.74c.22-.26.57-.38 1.06-.38.25 0 .5.03.72.1l.15.02c.07 0 .12-.04.12-.17v-.25c0-.07-.02-.14-.05-.17a.54.54 0 0 0-.12-.1c-.32-.07-.64-.15-.94-.15-.7 0-1.21.2-1.6.62-.38.4-.57 1-.57 1.73 0 .74.17 1.31.54 1.7.37.4.89.6 1.58.6.37 0 .72-.05.99-.17.07-.03.12-.05.15-.1.02-.03.02-.1.02-.17v-.25c0-.13-.05-.17-.12-.17-.03 0-.07 0-.12.02-.28.07-.55.12-.8.12-.46 0-.81-.12-1.03-.37-.23-.24-.32-.64-.32-1.16v-.12c.02-.55.12-.94.34-1.19Z" clipRule="evenodd"></path>
        <path fillRule="evenodd" d="M21.55 17.46c1.29-1.09 1.64-3.33 1.36-3.68-.12-.15-.71-.3-1.45-.3-.8 0-1.73.18-2.45.67-.22.15-.17.35.05.32.76-.1 2.5-.3 2.82.1.3.4-.35 2.03-.65 2.74-.07.23.1.3.32.15ZM18.12 7.4h-.52c-.12 0-.17.05-.17.18v4.1c0 .12.05.17.17.17h.52c.12 0 .17-.05.17-.17v-4.1c0-.1-.05-.18-.17-.18Zm.15-1.68a.58.58 0 0 0-.42-.15c-.18 0-.3.05-.4.15a.5.5 0 0 0-.15.37c0 .15.05.3.15.37.1.1.22.15.4.15.17 0 .3-.05.4-.15a.5.5 0 0 0 .14-.37c0-.15-.02-.3-.12-.37Z" clipRule="evenodd"></path>
    </svg>;
}
