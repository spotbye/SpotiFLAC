import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { BrowserOpenURL } from "../../wailsjs/runtime/runtime";
import type { Settings } from "./settings";
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
export function sanitizePath(input: string, _os: string): string {
    const sanitized = input.trim();
    return sanitized.replace(/[<>:"/\\|?*]/g, "_");
}
export function joinPath(os: string, ...parts: string[]): string {
    const sep = os === "Windows" ? "\\" : "/";
    const filtered = parts.filter(Boolean);
    if (filtered.length === 0)
        return "";
    const joined = filtered
        .map((p, i) => {
        if (i === 0) {
            return p.replace(/[/\\]+$/g, "");
        }
        return p.replace(/^[/\\]+|[/\\]+$/g, "");
    })
        .filter(Boolean)
        .join(sep);
    return joined;
}
export function buildOutputPath(settings: Settings, folder?: string) {
    const os = settings.operatingSystem;
    const base = settings.downloadPath || "";
    const sanitized = folder ? sanitizePath(folder, os) : undefined;
    return sanitized ? joinPath(os, base, sanitized) : base;
}
export function openExternal(url: string) {
    if (!url)
        return;
    try {
        BrowserOpenURL(url);
    }
    catch (error) {
        if (typeof window !== "undefined") {
            window.open(url, "_blank", "noopener,noreferrer");
        }
    }
}
export function getFirstArtist(artistString: string): string {
    if (!artistString)
        return artistString;
    const delimiters = /\s*;\s*|\s+\/\s+|\s+(?:feat\.?|ft\.?|featuring)\s+/i;
    const parts = artistString.split(delimiters);
    return parts[0].trim();
}
