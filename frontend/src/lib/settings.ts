import { GetDefaults, LoadFonts as LoadFontsFromBackend, LoadSettings, SaveFonts as SaveFontsToBackend, SaveSettings as SaveToBackend, } from "../../wailsjs/go/main/App";
export type BuiltInFontFamily = "google-sans" | "inter" | "poppins" | "roboto" | "dm-sans" | "plus-jakarta-sans" | "manrope" | "space-grotesk" | "noto-sans" | "nunito-sans" | "figtree" | "raleway" | "public-sans" | "outfit" | "jetbrains-mono" | "geist-sans" | "bricolage-grotesque";
export type CustomFontFamily = `custom-${string}`;
export type FontFamily = BuiltInFontFamily | CustomFontFamily;
export interface CustomFontOption {
    value: CustomFontFamily;
    label: string;
    fontFamily: string;
    url: string;
}
export type FontOption = {
    value: FontFamily;
    label: string;
    fontFamily: string;
    url?: string;
};
export type FolderPreset = "none" | "artist" | "album" | "year-album" | "year-artist-album" | "artist-album" | "artist-year-album" | "artist-year-nested-album" | "album-artist" | "album-artist-album" | "album-artist-year-album" | "album-artist-year-nested-album" | "year" | "year-artist" | "custom";
export type FilenamePreset = "title" | "title-artist" | "artist-title" | "track-title" | "track-title-artist" | "track-artist-title" | "title-album-artist" | "track-title-album-artist" | "artist-album-title" | "track-dash-title" | "disc-track-title" | "disc-track-title-artist" | "custom";
export type ExistingFileCheckMode = "none" | "filename" | "isrc";
export interface Settings {
    downloadPath: string;
    downloader: "auto" | "tidal" | "qobuz" | "amazon";
    customTidalApi: string;
    linkResolver: "songstats" | "songlink";
    allowResolverFallback: boolean;
    theme: string;
    themeMode: "auto" | "light" | "dark";
    fontFamily: FontFamily;
    customFonts: CustomFontOption[];
    folderPreset: FolderPreset;
    folderTemplate: string;
    filenamePreset: FilenamePreset;
    filenameTemplate: string;
    filenameFormat?: "title-artist" | "artist-title" | "title";
    artistSubfolder?: boolean;
    albumSubfolder?: boolean;
    trackNumber: boolean;
    sfxEnabled: boolean;
    embedLyrics: boolean;
    embedMaxQualityCover: boolean;
    operatingSystem: "Windows" | "linux/MacOS";
    tidalQuality: "LOSSLESS" | "HI_RES_LOSSLESS";
    qobuzQuality: "6" | "7" | "27";
    amazonQuality: "original";
    autoOrder: "tidal-qobuz-amazon" | "tidal-amazon-qobuz" | "qobuz-tidal-amazon" | "qobuz-amazon-tidal" | "amazon-tidal-qobuz" | "amazon-qobuz-tidal" | string;
    autoQuality: "16" | "24";
    allowFallback: boolean;
    createPlaylistFolder: boolean;
    playlistOwnerFolderName: boolean;
    createM3u8File: boolean;
    previewVolume: number;
    existingFileCheckMode: ExistingFileCheckMode;
    useFirstArtistOnly: boolean;
    useSingleGenre: boolean;
    embedGenre: boolean;
    redownloadWithSuffix: boolean;
    separator: "comma" | "semicolon";
}
export const FOLDER_PRESETS: Record<FolderPreset, {
    label: string;
    template: string;
}> = {
    none: { label: "No Subfolder", template: "" },
    artist: { label: "Artist", template: "{artist}" },
    album: { label: "Album", template: "{album}" },
    "year-album": { label: "[Year] Album", template: "[{year}] {album}" },
    "year-artist-album": {
        label: "[Year] Artist - Album",
        template: "[{year}] {artist} - {album}",
    },
    "artist-album": { label: "Artist / Album", template: "{artist}/{album}" },
    "artist-year-album": {
        label: "Artist / [Year] Album",
        template: "{artist}/[{year}] {album}",
    },
    "artist-year-nested-album": {
        label: "Artist / Year / Album",
        template: "{artist}/{year}/{album}",
    },
    "album-artist": { label: "Album Artist", template: "{album_artist}" },
    "album-artist-album": {
        label: "Album Artist / Album",
        template: "{album_artist}/{album}",
    },
    "album-artist-year-album": {
        label: "Album Artist / [Year] Album",
        template: "{album_artist}/[{year}] {album}",
    },
    "album-artist-year-nested-album": {
        label: "Album Artist / Year / Album",
        template: "{album_artist}/{year}/{album}",
    },
    year: { label: "Year", template: "{year}" },
    "year-artist": { label: "Year / Artist", template: "{year}/{artist}" },
    custom: { label: "Custom...", template: "{artist}/{album}" },
};
export const FILENAME_PRESETS: Record<FilenamePreset, {
    label: string;
    template: string;
}> = {
    title: { label: "Title", template: "{title}" },
    "title-artist": { label: "Title - Artist", template: "{title} - {artist}" },
    "artist-title": { label: "Artist - Title", template: "{artist} - {title}" },
    "track-title": { label: "Track. Title", template: "{track}. {title}" },
    "track-title-artist": {
        label: "Track. Title - Artist",
        template: "{track}. {title} - {artist}",
    },
    "track-artist-title": {
        label: "Track. Artist - Title",
        template: "{track}. {artist} - {title}",
    },
    "title-album-artist": {
        label: "Title - Album Artist",
        template: "{title} - {album_artist}",
    },
    "track-title-album-artist": {
        label: "Track. Title - Album Artist",
        template: "{track}. {title} - {album_artist}",
    },
    "artist-album-title": {
        label: "Artist - Album - Title",
        template: "{artist} - {album} - {title}",
    },
    "track-dash-title": { label: "Track - Title", template: "{track} - {title}" },
    "disc-track-title": {
        label: "Disc-Track. Title",
        template: "{disc}-{track}. {title}",
    },
    "disc-track-title-artist": {
        label: "Disc-Track. Title - Artist",
        template: "{disc}-{track}. {title} - {artist}",
    },
    custom: { label: "Custom...", template: "{title} - {artist}" },
};
export const TEMPLATE_VARIABLES = [
    { key: "{title}", description: "Track title", example: "Shake It Off" },
    { key: "{artist}", description: "Track artist", example: "Taylor Swift" },
    { key: "{album}", description: "Album name", example: "1989" },
    {
        key: "{album_artist}",
        description: "Album artist",
        example: "Taylor Swift",
    },
    { key: "{track}", description: "Track number", example: "01" },
    { key: "{disc}", description: "Disc number", example: "1" },
    { key: "{year}", description: "Release year", example: "2014" },
    {
        key: "{date}",
        description: "Release date (YYYY-MM-DD)",
        example: "2014-10-27",
    },
    {
        key: "{isrc}",
        description: "Track ISRC",
        example: "USUM71412345",
    },
];
function detectOS(): "Windows" | "linux/MacOS" {
    const platform = window.navigator.platform.toLowerCase();
    if (platform.includes("win")) {
        return "Windows";
    }
    return "linux/MacOS";
}
export const DEFAULT_SETTINGS: Settings = {
    downloadPath: "",
    downloader: "auto",
    customTidalApi: "",
    linkResolver: "songlink",
    allowResolverFallback: true,
    theme: "yellow",
    themeMode: "auto",
    fontFamily: "google-sans",
    customFonts: [],
    folderPreset: "none",
    folderTemplate: "",
    filenamePreset: "title-artist",
    filenameTemplate: "{title} - {artist}",
    trackNumber: false,
    sfxEnabled: true,
    embedLyrics: false,
    embedMaxQualityCover: false,
    operatingSystem: detectOS(),
    tidalQuality: "LOSSLESS",
    qobuzQuality: "6",
    amazonQuality: "original",
    autoOrder: "qobuz-amazon",
    autoQuality: "16",
    allowFallback: true,
    createPlaylistFolder: true,
    playlistOwnerFolderName: false,
    createM3u8File: false,
    previewVolume: 100,
    existingFileCheckMode: "filename",
    useFirstArtistOnly: false,
    useSingleGenre: false,
    embedGenre: false,
    redownloadWithSuffix: false,
    separator: "semicolon",
};
export const FONT_OPTIONS: FontOption[] = [
    {
        value: "bricolage-grotesque",
        label: "Bricolage Grotesque",
        fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
    },
    {
        value: "dm-sans",
        label: "DM Sans",
        fontFamily: '"DM Sans", system-ui, sans-serif',
    },
    {
        value: "figtree",
        label: "Figtree",
        fontFamily: '"Figtree", system-ui, sans-serif',
    },
    {
        value: "geist-sans",
        label: "Geist Sans",
        fontFamily: '"Geist", system-ui, sans-serif',
    },
    {
        value: "google-sans",
        label: "Google Sans",
        fontFamily: '"Google Sans", system-ui, sans-serif',
    },
    {
        value: "inter",
        label: "Inter",
        fontFamily: '"Inter", system-ui, sans-serif',
    },
    {
        value: "jetbrains-mono",
        label: "JetBrains Mono",
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    },
    {
        value: "manrope",
        label: "Manrope",
        fontFamily: '"Manrope", system-ui, sans-serif',
    },
    {
        value: "noto-sans",
        label: "Noto Sans",
        fontFamily: '"Noto Sans", system-ui, sans-serif',
    },
    {
        value: "nunito-sans",
        label: "Nunito Sans",
        fontFamily: '"Nunito Sans", system-ui, sans-serif',
    },
    {
        value: "outfit",
        label: "Outfit",
        fontFamily: '"Outfit", system-ui, sans-serif',
    },
    {
        value: "plus-jakarta-sans",
        label: "Plus Jakarta Sans",
        fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
    },
    {
        value: "poppins",
        label: "Poppins",
        fontFamily: '"Poppins", system-ui, sans-serif',
    },
    {
        value: "public-sans",
        label: "Public Sans",
        fontFamily: '"Public Sans", system-ui, sans-serif',
    },
    {
        value: "raleway",
        label: "Raleway",
        fontFamily: '"Raleway", system-ui, sans-serif',
    },
    {
        value: "roboto",
        label: "Roboto",
        fontFamily: '"Roboto", system-ui, sans-serif',
    },
    {
        value: "space-grotesk",
        label: "Space Grotesk",
        fontFamily: '"Space Grotesk", system-ui, sans-serif',
    },
];
const BUILT_IN_FONT_VALUES = new Set(FONT_OPTIONS.map((font) => font.value));
const GOOGLE_FONT_LINK_ID_PREFIX = "spotiflac-custom-font-";
const GOOGLE_FONTS_CSS_HOST = "fonts.googleapis.com";
const GOOGLE_FONTS_SPECIMEN_HOST = "fonts.google.com";
const SETTINGS_KEY = "spotiflac-settings";
let cachedSettings: Settings | null = null;
type SettingsPayload = Partial<Settings> & {
    darkMode?: boolean;
    [key: string]: unknown;
};
const KNOWN_SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>;
function extractGoogleFontInputUrl(input: string): string {
    const trimmed = input.trim();
    const hrefMatch = trimmed.match(/\bhref=["']([^"']+)["']/i);
    if (hrefMatch?.[1]) {
        return hrefMatch[1];
    }
    const importMatch = trimmed.match(/@import\s+url\(["']?([^"')]+)["']?\)/i);
    if (importMatch?.[1]) {
        return importMatch[1];
    }
    return trimmed;
}
function coerceGoogleFontUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }
    if (/^(fonts\.googleapis\.com|fonts\.google\.com)\//i.test(trimmed)) {
        return `https://${trimmed}`;
    }
    return trimmed;
}
function normalizeFontLabel(label: string): string {
    return label.replace(/\+/g, " ").replace(/\s+/g, " ").trim();
}
function slugifyFontLabel(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "font";
}
function toFontFamilyCss(label: string): string {
    const escapedLabel = label.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escapedLabel}", system-ui, sans-serif`;
}
function buildGoogleFontsCssUrl(label: string): string {
    const url = new URL("https://fonts.googleapis.com/css2");
    url.searchParams.set("family", label);
    url.searchParams.set("display", "swap");
    return url.toString();
}
function extractSpecimenFontLabel(parsed: URL): string {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const specimenIndex = segments.findIndex((segment) => segment.toLowerCase() === "specimen");
    const specimenName = specimenIndex >= 0 ? segments[specimenIndex + 1] : "";
    return normalizeFontLabel(decodeURIComponent(specimenName || ""));
}
function normalizeGoogleFontCssUrl(rawUrl: string): string | null {
    try {
        const parsed = new URL(coerceGoogleFontUrl(extractGoogleFontInputUrl(rawUrl)));
        if (parsed.protocol !== "https:") {
            return null;
        }
        if (parsed.hostname === GOOGLE_FONTS_SPECIMEN_HOST) {
            const label = extractSpecimenFontLabel(parsed);
            return label ? buildGoogleFontsCssUrl(label) : null;
        }
        if (parsed.hostname !== GOOGLE_FONTS_CSS_HOST ||
            (parsed.pathname !== "/css" && parsed.pathname !== "/css2")) {
            return null;
        }
        if (parsed.searchParams.getAll("family").length === 0) {
            return null;
        }
        if (!parsed.searchParams.has("display")) {
            parsed.searchParams.set("display", "swap");
        }
        return parsed.toString();
    }
    catch {
        return null;
    }
}
export function parseGoogleFontUrl(rawUrl: string): CustomFontOption | null {
    const normalizedUrl = normalizeGoogleFontCssUrl(rawUrl);
    if (!normalizedUrl) {
        return null;
    }
    const parsed = new URL(normalizedUrl);
    const family = parsed.searchParams.getAll("family")[0];
    const label = normalizeFontLabel((family || "").split(":")[0] || "");
    if (!label) {
        return null;
    }
    return {
        value: `custom-${slugifyFontLabel(label)}` as CustomFontFamily,
        label,
        fontFamily: toFontFamilyCss(label),
        url: normalizedUrl,
    };
}
function normalizeCustomFonts(customFonts: unknown): CustomFontOption[] {
    if (!Array.isArray(customFonts)) {
        return [];
    }
    const normalizedFonts: CustomFontOption[] = [];
    const seenValues = new Set<string>();
    const seenUrls = new Set<string>();
    for (const item of customFonts) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const rawUrl = (item as {
            url?: unknown;
        }).url;
        if (typeof rawUrl !== "string") {
            continue;
        }
        const parsed = parseGoogleFontUrl(rawUrl);
        if (!parsed || seenValues.has(parsed.value) || seenUrls.has(parsed.url)) {
            continue;
        }
        seenValues.add(parsed.value);
        seenUrls.add(parsed.url);
        normalizedFonts.push(parsed);
    }
    return normalizedFonts;
}
function normalizeFontFamily(fontFamily: unknown, customFonts: CustomFontOption[]): FontFamily {
    if (typeof fontFamily !== "string") {
        return DEFAULT_SETTINGS.fontFamily;
    }
    if (BUILT_IN_FONT_VALUES.has(fontFamily as BuiltInFontFamily)) {
        return fontFamily as BuiltInFontFamily;
    }
    const customFont = customFonts.find((font) => font.value === fontFamily);
    return customFont ? customFont.value : DEFAULT_SETTINGS.fontFamily;
}
export function getFontOptions(customFonts: CustomFontOption[] = []): FontOption[] {
    return [...FONT_OPTIONS, ...normalizeCustomFonts(customFonts)];
}
export function loadGoogleFontUrl(url: string, id = `${GOOGLE_FONT_LINK_ID_PREFIX}preview`): void {
    const normalizedUrl = normalizeGoogleFontCssUrl(url);
    if (!normalizedUrl) {
        return;
    }
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
        link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        document.head.appendChild(link);
    }
    if (link.href !== normalizedUrl) {
        link.href = normalizedUrl;
    }
}
function loadCustomFontStylesheets(customFonts: CustomFontOption[]): void {
    for (const font of normalizeCustomFonts(customFonts)) {
        loadGoogleFontUrl(font.url, `${GOOGLE_FONT_LINK_ID_PREFIX}${font.value}`);
    }
}
export function applyFont(fontFamily: FontFamily, customFonts: CustomFontOption[] = []): void {
    const fontOptions = getFontOptions(customFonts);
    loadCustomFontStylesheets(customFonts);
    const font = fontOptions.find((option) => option.value === fontFamily) ||
        FONT_OPTIONS.find((option) => option.value === DEFAULT_SETTINGS.fontFamily);
    if (font) {
        document.documentElement.style.setProperty("--font-sans", font.fontFamily);
        document.body.style.fontFamily = font.fontFamily;
    }
}
async function persistCustomFontsInternal(customFonts: CustomFontOption[]): Promise<CustomFontOption[]> {
    const normalizedFonts = normalizeCustomFonts(customFonts);
    await SaveFontsToBackend(normalizedFonts as unknown as Array<Record<string, unknown>>);
    if (cachedSettings) {
        cachedSettings = toNormalizedSettings({
            ...cachedSettings,
            customFonts: normalizedFonts,
        });
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(cachedSettings));
        window.dispatchEvent(new CustomEvent("settingsUpdated", { detail: cachedSettings }));
    }
    return normalizedFonts;
}
async function loadStoredCustomFonts(fallbackFonts?: unknown): Promise<CustomFontOption[]> {
    try {
        const storedFonts = await LoadFontsFromBackend();
        if (storedFonts !== null) {
            return normalizeCustomFonts(storedFonts);
        }
    }
    catch (error) {
        console.error("Failed to load custom fonts:", error);
    }
    const migratedFonts = normalizeCustomFonts(fallbackFonts);
    if (migratedFonts.length > 0) {
        try {
            return await persistCustomFontsInternal(migratedFonts);
        }
        catch (error) {
            console.error("Failed to migrate custom fonts:", error);
        }
    }
    return migratedFonts;
}
export async function loadCustomFonts(): Promise<CustomFontOption[]> {
    return loadStoredCustomFonts(getSettings().customFonts);
}
export async function saveCustomFonts(customFonts: CustomFontOption[]): Promise<CustomFontOption[]> {
    return persistCustomFontsInternal(customFonts);
}
function keepKnownSettings(settings: SettingsPayload): SettingsPayload {
    const normalized: Record<string, unknown> = {};
    for (const key of KNOWN_SETTINGS_KEYS) {
        if (key in settings) {
            normalized[key] = settings[key];
        }
    }
    return normalized as SettingsPayload;
}
function normalizePreviewVolume(volume: unknown): number {
    const parsed = typeof volume === "number"
        ? volume
        : typeof volume === "string"
            ? Number.parseFloat(volume)
            : Number.NaN;
    if (!Number.isFinite(parsed)) {
        return DEFAULT_SETTINGS.previewVolume;
    }
    return Math.min(100, Math.max(0, Math.round(parsed)));
}
function normalizeCustomTidalApi(value: unknown): string {
    return typeof value === "string"
        ? value.trim().replace(/\/+$/g, "")
        : "";
}
export function hasConfiguredCustomTidalApi(value: unknown): boolean {
    return normalizeCustomTidalApi(value).startsWith("https://");
}
export function sanitizeAutoOrder(order: unknown, allowTidal: boolean): string {
    const allowedServices = allowTidal
        ? new Set(["tidal", "qobuz", "amazon"])
        : new Set(["qobuz", "amazon"]);
    const fallbackOrder = allowTidal ? "tidal-qobuz-amazon" : "qobuz-amazon";
    if (typeof order !== "string") {
        return fallbackOrder;
    }
    const normalized = order
        .split("-")
        .map((part) => part.trim().toLowerCase())
        .filter((part, index, parts) => part !== "" && allowedServices.has(part) && parts.indexOf(part) === index);
    return normalized.length >= 2 ? normalized.join("-") : fallbackOrder;
}
function normalizeDownloader(value: unknown, allowTidal: boolean): Settings["downloader"] {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "tidal") {
        return allowTidal ? "tidal" : "auto";
    }
    if (normalized === "qobuz" || normalized === "amazon" || normalized === "auto") {
        return normalized;
    }
    return DEFAULT_SETTINGS.downloader;
}
function normalizeExistingFileCheckMode(mode: unknown): ExistingFileCheckMode {
    switch (typeof mode === "string" ? mode.trim().toLowerCase() : "") {
        case "none":
            return "none";
        case "isrc":
        case "upc":
            return "isrc";
        default:
            return "filename";
    }
}
function normalizeSettingsPayload(settings: SettingsPayload): SettingsPayload {
    const normalized: SettingsPayload = { ...settings };
    if ("darkMode" in normalized && !("themeMode" in normalized)) {
        normalized.themeMode = normalized.darkMode ? "dark" : "light";
        delete normalized.darkMode;
    }
    if (!("folderPreset" in normalized) &&
        ("artistSubfolder" in normalized || "albumSubfolder" in normalized)) {
        const hasArtist = Boolean(normalized.artistSubfolder);
        const hasAlbum = Boolean(normalized.albumSubfolder);
        if (hasArtist && hasAlbum) {
            normalized.folderPreset = "artist-album";
            normalized.folderTemplate = "{artist}/{album}";
        }
        else if (hasArtist) {
            normalized.folderPreset = "artist";
            normalized.folderTemplate = "{artist}";
        }
        else if (hasAlbum) {
            normalized.folderPreset = "album";
            normalized.folderTemplate = "{album}";
        }
        else {
            normalized.folderPreset = "none";
            normalized.folderTemplate = "";
        }
    }
    if (!("filenamePreset" in normalized) && "filenameFormat" in normalized) {
        const format = normalized.filenameFormat;
        if (format === "title-artist") {
            normalized.filenamePreset = "artist-title";
            normalized.filenameTemplate = "{artist} - {title}";
        }
        else if (format === "artist-title") {
            normalized.filenamePreset = "artist-title";
            normalized.filenameTemplate = "{artist} - {title}";
        }
        else {
            normalized.filenamePreset = "title";
            normalized.filenameTemplate = "{title}";
        }
    }
    delete normalized.tidalVariant;
    if (!("tidalQuality" in normalized)) {
        normalized.tidalQuality = "LOSSLESS";
    }
    if (!("qobuzQuality" in normalized)) {
        normalized.qobuzQuality = "6";
    }
    if (!("amazonQuality" in normalized)) {
        normalized.amazonQuality = "original";
    }
    if (!("autoOrder" in normalized)) {
        normalized.autoOrder = DEFAULT_SETTINGS.autoOrder;
    }
    if (!("autoQuality" in normalized)) {
        normalized.autoQuality = "16";
    }
    normalized.customTidalApi = normalizeCustomTidalApi(normalized.customTidalApi);
    const allowTidal = hasConfiguredCustomTidalApi(normalized.customTidalApi);
    normalized.downloader = normalizeDownloader(normalized.downloader, allowTidal);
    normalized.autoOrder = sanitizeAutoOrder(normalized.autoOrder, allowTidal);
    if (!("allowFallback" in normalized)) {
        normalized.allowFallback = true;
    }
    if (!("linkResolver" in normalized)) {
        normalized.linkResolver = "songlink";
    }
    if (!("allowResolverFallback" in normalized)) {
        normalized.allowResolverFallback = true;
    }
    if (!("createPlaylistFolder" in normalized)) {
        normalized.createPlaylistFolder = true;
    }
    if (!("playlistOwnerFolderName" in normalized)) {
        normalized.playlistOwnerFolderName = false;
    }
    if (!("createM3u8File" in normalized)) {
        normalized.createM3u8File = false;
    }
    normalized.previewVolume = normalizePreviewVolume(normalized.previewVolume);
    normalized.existingFileCheckMode = normalizeExistingFileCheckMode(normalized.existingFileCheckMode);
    if (!("useFirstArtistOnly" in normalized)) {
        normalized.useFirstArtistOnly = false;
    }
    if (!("useSingleGenre" in normalized)) {
        normalized.useSingleGenre = false;
    }
    if (!("embedGenre" in normalized)) {
        normalized.embedGenre = false;
    }
    if (!("separator" in normalized)) {
        normalized.separator = "semicolon";
    }
    if (!("redownloadWithSuffix" in normalized)) {
        normalized.redownloadWithSuffix = false;
    }
    normalized.operatingSystem = detectOS();
    const normalizedCustomFonts = normalizeCustomFonts(normalized.customFonts);
    normalized.customFonts = normalizedCustomFonts;
    normalized.fontFamily = normalizeFontFamily(normalized.fontFamily, normalizedCustomFonts);
    return normalized;
}
function toNormalizedSettings(settings: SettingsPayload): Settings {
    return {
        ...DEFAULT_SETTINGS,
        ...keepKnownSettings(normalizeSettingsPayload(settings)),
    } as Settings;
}
async function persistSettingsInternal(settings: Settings, notify = true): Promise<void> {
    cachedSettings = settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    const settingsForBackend = { ...settings } as Record<string, unknown>;
    delete settingsForBackend.customFonts;
    await SaveToBackend(settingsForBackend);
    if (notify) {
        window.dispatchEvent(new CustomEvent("settingsUpdated", { detail: settings }));
    }
}
async function fetchDefaultPath(): Promise<string> {
    try {
        const data = await GetDefaults();
        return data.downloadPath || "";
    }
    catch (error) {
        console.error("Failed to fetch default path:", error);
        return "";
    }
}
function getSettingsFromLocalStorage(): Settings {
    try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (stored) {
            return toNormalizedSettings(JSON.parse(stored) as SettingsPayload);
        }
    }
    catch (error) {
        console.error("Failed to load settings from local storage:", error);
    }
    return DEFAULT_SETTINGS;
}
export function getSettings(): Settings {
    if (cachedSettings) {
        return cachedSettings;
    }
    return getSettingsFromLocalStorage();
}
export async function loadSettings(): Promise<Settings> {
    try {
        const backendSettings = await LoadSettings();
        if (backendSettings) {
            const parsed = backendSettings as SettingsPayload;
            const customFonts = await loadStoredCustomFonts(parsed.customFonts);
            cachedSettings = toNormalizedSettings({
                ...parsed,
                customFonts,
            });
            if ("customFonts" in parsed) {
                await persistSettingsInternal(cachedSettings, false);
            }
            return cachedSettings;
        }
    }
    catch (error) {
        console.error("Failed to load settings from backend:", error);
    }
    const local = getSettingsFromLocalStorage();
    try {
        const customFonts = await loadStoredCustomFonts(local.customFonts);
        const localWithFonts = toNormalizedSettings({
            ...local,
            customFonts,
        });
        await persistSettingsInternal(localWithFonts, false);
        cachedSettings = localWithFonts;
        return localWithFonts;
    }
    catch (error) {
        console.error("Failed to migrate settings to backend:", error);
    }
    cachedSettings = local;
    return local;
}
export interface TemplateData {
    artist?: string;
    album?: string;
    album_artist?: string;
    title?: string;
    isrc?: string;
    track?: number;
    disc?: number;
    year?: string;
    date?: string;
    playlist?: string;
}
export function parseTemplate(template: string, data: TemplateData): string {
    if (!template) {
        return "";
    }
    let result = template;
    result = result.replace(/\{title\}/g, data.title || "Unknown Title");
    result = result.replace(/\{artist\}/g, data.artist || "Unknown Artist");
    result = result.replace(/\{album\}/g, data.album || "Unknown Album");
    result = result.replace(/\{album_artist\}/g, data.album_artist || data.artist || "Unknown Artist");
    result = result.replace(/\{isrc\}/g, data.isrc || "");
    result = result.replace(/\{track\}/g, data.track ? String(data.track).padStart(2, "0") : "00");
    result = result.replace(/\{disc\}/g, data.disc ? String(data.disc) : "1");
    result = result.replace(/\{year\}/g, data.year || "0000");
    result = result.replace(/\{date\}/g, data.date || "0000-00-00");
    result = result.replace(/\{playlist\}/g, data.playlist || "");
    return result;
}
export async function getSettingsWithDefaults(): Promise<Settings> {
    const settings = await loadSettings();
    if (!settings.downloadPath) {
        settings.downloadPath = await fetchDefaultPath();
        await saveSettings(settings);
    }
    return settings;
}
export async function saveSettings(settings: Settings): Promise<void> {
    try {
        const normalizedSettings = toNormalizedSettings(settings as SettingsPayload);
        await persistSettingsInternal(normalizedSettings);
    }
    catch (error) {
        console.error("Failed to save settings:", error);
    }
}
export async function updateSettings(partial: Partial<Settings>): Promise<Settings> {
    const current = getSettings();
    const updated = { ...current, ...partial };
    await saveSettings(updated);
    return updated;
}
export async function resetToDefaultSettings(): Promise<Settings> {
    const defaultPath = await fetchDefaultPath();
    const customFonts = await loadCustomFonts();
    const defaultSettings = {
        ...DEFAULT_SETTINGS,
        downloadPath: defaultPath,
        customFonts,
    };
    await saveSettings(defaultSettings);
    return defaultSettings;
}
export function applyThemeMode(mode: "auto" | "light" | "dark"): void {
    if (mode === "auto") {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (prefersDark) {
            document.documentElement.classList.add("dark");
        }
        else {
            document.documentElement.classList.remove("dark");
        }
    }
    else if (mode === "dark") {
        document.documentElement.classList.add("dark");
    }
    else {
        document.documentElement.classList.remove("dark");
    }
}
