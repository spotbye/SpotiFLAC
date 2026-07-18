import { useState, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import { FolderOpen, Save, RotateCcw, Info, ArrowRight, MonitorCog, FolderCog, Router, FolderLock, Plus, Trash2, ExternalLink, PlugZap, Download, Tags, FileSignature } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { getSettings, getSettingsWithDefaults, saveSettings, resetToDefaultSettings, applyThemeMode, applyFont, getFontOptions, parseGoogleFontUrl, loadGoogleFontUrl, loadCustomFonts, saveCustomFonts, TEMPLATE_VARIABLES, DEFAULT_SETTINGS, sanitizeAutoOrder, type Settings as SettingsType, type MetadataTagToggles, type FontFamily, type CustomFontFamily, type ExistingFileCheckMode, } from "@/lib/settings";
import { FormatEditor } from "@/components/FormatEditor";
import { themes, applyTheme } from "@/lib/themes";
import { SelectFolder, OpenConfigFolder, CheckCustomTidalAPI, CheckCustomQobuzAPI } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { openExternal } from "@/lib/utils";
import { ApiStatusTab } from "./ApiStatusTab";
import { AmazonIcon, QobuzIcon, SonglinkIcon, SongstatsIcon, TidalIcon } from "./PlatformIcons";
interface SettingsPageProps {
    onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
    onResetRequest?: (resetFn: () => void) => void;
}
type CustomTidalApiStatus = "idle" | "checking" | "online" | "offline";
const AUTO_CONVERT_BITRATES: SettingsType["autoConvertBitrate"][] = ["320k", "256k", "192k", "128k"];
const METADATA_TAG_OPTIONS: Array<{
    key: keyof MetadataTagToggles;
    label: string;
    example: string;
}> = [
    { key: "title", label: "Title", example: "Golden" },
    { key: "artist", label: "Artist", example: "HUNTR/X / EJAE / AUDREY NUNA / REI AMI" },
    { key: "album", label: "Album", example: "KPop Demon Hunters (Soundtrack from the Netflix Film)" },
    { key: "albumArtist", label: "Album Artist", example: "KPop Demon Hunters Cast / HUNTR/X / Saja Boys" },
    { key: "date", label: "Date / Year", example: "2025-06-20" },
    { key: "trackNumber", label: "Track Number", example: "4/12" },
    { key: "discNumber", label: "Disc Number", example: "1/1" },
    { key: "genre", label: "Genre", example: "K-Pop" },
    { key: "composer", label: "Composer", example: "EJAE / Mark Sonnenblick / Joong Gyu Kwak" },
    { key: "copyright", label: "Copyright", example: "© 2025 Visva Records / Republic Records" },
    { key: "label", label: "Label / Publisher", example: "K-Pop Demon Hunters" },
    { key: "isrc", label: "ISRC", example: "QZ8BZ2513510" },
    { key: "upc", label: "UPC", example: "00602478398346" },
    { key: "comment", label: "Comment", example: "https://open.spotify.com/track/1CPZ5BxNNd0n0nF4Orb9JS" },
];
export function SettingsPage({ onUnsavedChangesChange, onResetRequest, }: SettingsPageProps) {
    const [savedSettings, setSavedSettings] = useState<SettingsType>(getSettings());
    const [tempSettings, setTempSettings] = useState<SettingsType>(savedSettings);
    const [isDark, setIsDark] = useState(document.documentElement.classList.contains("dark"));
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showAddFontDialog, setShowAddFontDialog] = useState(false);
    const [showCustomTidalApiDialog, setShowCustomTidalApiDialog] = useState(false);
    const [showCustomQobuzApiDialog, setShowCustomQobuzApiDialog] = useState(false);
    const [addFontUrl, setAddFontUrl] = useState("");
    const [customTidalApiStatus, setCustomTidalApiStatus] = useState<CustomTidalApiStatus>("idle");
    const [customQobuzApiStatus, setCustomQobuzApiStatus] = useState<CustomTidalApiStatus>("idle");
    const parsedAddFont = parseGoogleFontUrl(addFontUrl);
    const fontOptions = getFontOptions(tempSettings.customFonts);
    const hasUnsavedChanges = JSON.stringify(savedSettings) !== JSON.stringify(tempSettings);
    const effectiveDownloader = tempSettings.downloader;
    const effectiveAutoOrder = sanitizeAutoOrder(tempSettings.autoOrder);
    const autoAtmosAvailable = !effectiveAutoOrder.includes("qobuz") &&
        (effectiveAutoOrder.includes("tidal") || effectiveAutoOrder.includes("amazon"));
    const isAtmosSelected = (effectiveDownloader === "tidal" && tempSettings.tidalQuality === "ATMOS") ||
        (effectiveDownloader === "amazon" && tempSettings.amazonQuality === "atmos") ||
        (effectiveDownloader === "auto" && tempSettings.autoQuality === "atmos");
    const resetToSaved = useCallback(() => {
        const freshSavedSettings = getSettings();
        flushSync(() => {
            setTempSettings(freshSavedSettings);
            setIsDark(document.documentElement.classList.contains("dark"));
        });
    }, []);
    useEffect(() => {
        if (onResetRequest) {
            onResetRequest(resetToSaved);
        }
    }, [onResetRequest, resetToSaved]);
    useEffect(() => {
        onUnsavedChangesChange?.(hasUnsavedChanges);
    }, [hasUnsavedChanges, onUnsavedChangesChange]);
    useEffect(() => {
        applyThemeMode(savedSettings.themeMode);
        applyTheme(savedSettings.theme);
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleChange = () => {
            if (savedSettings.themeMode === "auto") {
                applyThemeMode("auto");
                applyTheme(savedSettings.theme);
            }
        };
        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, [savedSettings.themeMode, savedSettings.theme]);
    useEffect(() => {
        applyThemeMode(tempSettings.themeMode);
        applyTheme(tempSettings.theme);
        applyFont(tempSettings.fontFamily, tempSettings.customFonts);
        setTimeout(() => {
            setIsDark(document.documentElement.classList.contains("dark"));
        }, 0);
    }, [tempSettings.themeMode, tempSettings.theme, tempSettings.fontFamily, tempSettings.customFonts]);
    useEffect(() => {
        if (showAddFontDialog && parsedAddFont) {
            loadGoogleFontUrl(parsedAddFont.url, "spotiflac-add-font-preview");
        }
    }, [showAddFontDialog, parsedAddFont]);
    useEffect(() => {
        const loadDefaults = async () => {
            const currentSettings = getSettings();
            if (!currentSettings.downloadPath) {
                const settingsWithDefaults = await getSettingsWithDefaults();
                setSavedSettings(settingsWithDefaults);
                setTempSettings(settingsWithDefaults);
                await saveSettings(settingsWithDefaults);
            }
        };
        loadDefaults();
    }, []);
    useEffect(() => {
        const syncCustomFonts = async () => {
            const customFonts = await loadCustomFonts();
            setSavedSettings((prev) => ({ ...prev, customFonts }));
            setTempSettings((prev) => ({ ...prev, customFonts }));
        };
        void syncCustomFonts();
    }, []);
    const handleSave = async () => {
        await saveSettings(tempSettings);
        const persistedSettings = getSettings();
        setSavedSettings(persistedSettings);
        setTempSettings(persistedSettings);
        toast.success("Settings saved");
        onUnsavedChangesChange?.(false);
    };
    const handleReset = async () => {
        const defaultSettings = await resetToDefaultSettings();
        setTempSettings(defaultSettings);
        setSavedSettings(defaultSettings);
        applyThemeMode(defaultSettings.themeMode);
        applyTheme(defaultSettings.theme);
        applyFont(defaultSettings.fontFamily, defaultSettings.customFonts);
        setShowResetConfirm(false);
        toast.success("Settings reset to default");
    };
    const handleBrowseFolder = async () => {
        try {
            const selectedPath = await SelectFolder(tempSettings.downloadPath || "");
            if (selectedPath && selectedPath.trim() !== "") {
                setTempSettings((prev) => ({ ...prev, downloadPath: selectedPath }));
            }
        }
        catch (error) {
            console.error("Error selecting folder:", error);
            toast.error(`Error selecting folder: ${error}`);
        }
    };
    const closeAddFontDialog = () => {
        setShowAddFontDialog(false);
        setAddFontUrl("");
    };
    const handleAddFont = async () => {
        if (!parsedAddFont) {
            toast.error("Enter a valid Google Fonts URL");
            return;
        }
        const existingFonts = tempSettings.customFonts || [];
        const existingIndex = existingFonts.findIndex((font) => font.value === parsedAddFont.value || font.url === parsedAddFont.url);
        const customFonts = existingIndex >= 0
            ? existingFonts.map((font, index) => index === existingIndex ? parsedAddFont : font)
            : [...existingFonts, parsedAddFont];
        const savedCustomFonts = await saveCustomFonts(customFonts);
        setSavedSettings((prev) => ({ ...prev, customFonts: savedCustomFonts }));
        setTempSettings((prev) => ({
            ...prev,
            customFonts: savedCustomFonts,
            fontFamily: parsedAddFont.value,
        }));
        closeAddFontDialog();
        toast.success(`${parsedAddFont.label} added`);
    };
    const handleDeleteCustomFont = async (fontValue: CustomFontFamily) => {
        const customFonts = (tempSettings.customFonts || []).filter((font) => font.value !== fontValue);
        const savedCustomFonts = await saveCustomFonts(customFonts);
        const shouldResetSavedFont = savedSettings.fontFamily === fontValue;
        const shouldResetTempFont = tempSettings.fontFamily === fontValue;
        const nextSavedSettings: SettingsType = {
            ...savedSettings,
            customFonts: savedCustomFonts,
            fontFamily: shouldResetSavedFont ? "google-sans" : savedSettings.fontFamily,
        };
        setSavedSettings(nextSavedSettings);
        setTempSettings((prev) => ({
            ...prev,
            customFonts: savedCustomFonts,
            fontFamily: shouldResetTempFont ? "google-sans" : prev.fontFamily,
        }));
        if (shouldResetSavedFont) {
            await saveSettings(nextSavedSettings);
        }
        toast.success("Font deleted");
    };
    const handleTidalQualityChange = async (value: "LOSSLESS" | "HI_RES_LOSSLESS" | "ATMOS") => {
        setTempSettings((prev) => ({ ...prev, tidalQuality: value }));
    };
    const handleQobuzQualityChange = (value: "6" | "7" | "27") => {
        setTempSettings((prev) => ({ ...prev, qobuzQuality: value }));
    };
    const handleAmazonQualityChange = (value: "16" | "24" | "atmos") => {
        setTempSettings((prev) => ({ ...prev, amazonQuality: value }));
    };
    const handleAutoQualityChange = async (value: "16" | "24" | "atmos") => {
        setTempSettings((prev) => ({ ...prev, autoQuality: value }));
    };
    const persistCustomTidalApi = useCallback(async (nextValue: string) => {
        const normalizedValue = nextValue.trim().replace(/\/+$/g, "");
        const persistedSettings = getSettings();
        const nextSavedSettings: SettingsType = {
            ...persistedSettings,
            customTidalApi: normalizedValue,
        };
        await saveSettings(nextSavedSettings);
        const nextSavedState = getSettings();
        setSavedSettings(nextSavedState);
        setTempSettings((prev) => ({
            ...prev,
            customTidalApi: nextSavedState.customTidalApi,
        }));
    }, []);
    const persistCustomQobuzApi = useCallback(async (nextValue: string) => {
        const normalizedValue = nextValue.trim().replace(/\/+$/g, "");
        const persistedSettings = getSettings();
        const nextSavedSettings: SettingsType = {
            ...persistedSettings,
            customQobuzApi: normalizedValue,
        };
        await saveSettings(nextSavedSettings);
        const nextSavedState = getSettings();
        setSavedSettings(nextSavedState);
        setTempSettings((prev) => ({
            ...prev,
            customQobuzApi: nextSavedState.customQobuzApi,
        }));
    }, []);
    const handleCheckCustomTidalApi = async () => {
        const normalizedCustomTidalApi = (tempSettings.customTidalApi || "").trim().replace(/\/+$/g, "");
        if (!normalizedCustomTidalApi.startsWith("https://")) {
            toast.error("Enter a valid HTTPS HiFi API URL");
            return;
        }
        setCustomTidalApiStatus("checking");
        try {
            const isOnline = await CheckCustomTidalAPI(normalizedCustomTidalApi);
            setCustomTidalApiStatus(isOnline ? "online" : "offline");
            if (isOnline) {
                toast.success("HiFi API instance is online");
            }
            else {
                toast.error("HiFi API instance is offline");
            }
        }
        catch (error) {
            console.error("Failed to check custom Tidal API:", error);
            setCustomTidalApiStatus("offline");
            toast.error(`Failed to check HiFi API instance: ${error}`);
        }
    };
    const handleCheckCustomQobuzApi = async () => {
        const normalizedCustomQobuzApi = (tempSettings.customQobuzApi || "").trim().replace(/\/+$/g, "");
        if (!normalizedCustomQobuzApi.startsWith("https://")) {
            toast.error("Enter a valid HTTPS Qobuz-DL instance URL");
            return;
        }
        setCustomQobuzApiStatus("checking");
        try {
            const isOnline = await CheckCustomQobuzAPI(normalizedCustomQobuzApi);
            setCustomQobuzApiStatus(isOnline ? "online" : "offline");
            if (isOnline) {
                toast.success("Qobuz-DL instance is online");
            }
            else {
                toast.error("Qobuz-DL instance is offline");
            }
        }
        catch (error) {
            console.error("Failed to check custom Qobuz API:", error);
            setCustomQobuzApiStatus("offline");
            toast.error(`Failed to check Qobuz-DL instance: ${error}`);
        }
    };
    const [activeTab, setActiveTab] = useState<"general" | "download" | "naming" | "files" | "metadata" | "status">("general");
    return (<div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={async () => {
            try {
                await OpenConfigFolder();
            }
            catch (e) {
                toast.error(`Failed to open config folder: ${e}`);
            }
        }} className="gap-1.5">
            <FolderLock className="h-4 w-4"/>
            Open Config Folder
          </Button>
          <Button variant="outline" onClick={() => setShowResetConfirm(true)} className="gap-1.5">
            <RotateCcw className="h-4 w-4"/>
            Reset to Default
          </Button>
          <Button onClick={handleSave} className="gap-1.5">
            <Save className="h-4 w-4"/>
            Save Changes
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b shrink-0">
        <Button variant={activeTab === "general" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("general")} className="rounded-b-none gap-2">
          <MonitorCog className="h-4 w-4"/>
          General
        </Button>
        <Button variant={activeTab === "download" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("download")} className="rounded-b-none gap-2">
          <Download className="h-4 w-4"/>
          Download
        </Button>
        <Button variant={activeTab === "naming" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("naming")} className="rounded-b-none gap-2">
          <FileSignature className="h-4 w-4"/>
          Naming
        </Button>
        <Button variant={activeTab === "files" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("files")} className="rounded-b-none gap-2">
          <FolderCog className="h-4 w-4"/>
          File Management
        </Button>
        <Button variant={activeTab === "metadata" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("metadata")} className="rounded-b-none gap-2">
          <Tags className="h-4 w-4"/>
          Metadata
        </Button>
        <Button variant={activeTab === "status" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("status")} className="rounded-b-none gap-2">
          <Router className="h-4 w-4"/>
          Status
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto pt-4">
        {activeTab === "general" && (<div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
            <div className="space-y-4 md:pr-8 md:border-r border-border">
              <div className="space-y-2">
                <Label htmlFor="theme-mode">Mode</Label>
                <Select value={tempSettings.themeMode} onValueChange={(value: "auto" | "light" | "dark") => setTempSettings((prev) => ({ ...prev, themeMode: value }))}>
                  <SelectTrigger id="theme-mode">
                    <SelectValue placeholder="Select theme mode"/>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="theme">Accent</Label>
                <Select value={tempSettings.theme} onValueChange={(value) => setTempSettings((prev) => ({ ...prev, theme: value }))}>
                  <SelectTrigger id="theme">
                    <SelectValue placeholder="Select a theme"/>
                  </SelectTrigger>
                  <SelectContent>
                    {themes.map((theme) => (<SelectItem key={theme.name} value={theme.name}>
                        <span className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full border border-border" style={{
                    backgroundColor: isDark
                        ? theme.cssVars.dark.primary
                        : theme.cssVars.light.primary,
                }}/>
                          {theme.label}
                        </span>
                      </SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="font">Font</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={tempSettings.fontFamily} onValueChange={(value: FontFamily) => setTempSettings((prev) => ({ ...prev, fontFamily: value }))}>
                    <SelectTrigger id="font" className="max-w-full min-w-40">
                      <SelectValue placeholder="Select a font"/>
                    </SelectTrigger>
                    <SelectContent>
                      {fontOptions.map((font) => {
                const isCustomFont = font.value.startsWith("custom-");
                return (<SelectItem key={font.value} value={font.value} indicatorPosition="inline" trailingAction={isCustomFont ? (<Button type="button" variant="ghost" size="icon" className="h-8 w-8 cursor-pointer text-muted-foreground hover:bg-transparent hover:text-destructive" aria-label={`Delete ${font.label}`} onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }} onPointerUp={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }} onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleDeleteCustomFont(font.value as CustomFontFamily);
                        }}>
                              <Trash2 className="h-3.5 w-3.5 text-inherit"/>
                            </Button>) : undefined}>
                          <span style={{ fontFamily: font.fontFamily }}>
                            {font.label}
                          </span>
                        </SelectItem>);
            })}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={() => setShowAddFontDialog(true)} className="shrink-0 gap-1.5">
                    <Plus className="h-4 w-4"/>
                    Add Font
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Switch id="sfx-enabled" checked={tempSettings.sfxEnabled} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                sfxEnabled: checked,
            }))}/>
                <Label htmlFor="sfx-enabled" className="cursor-pointer text-sm font-normal">
                  Sound Effects
                </Label>
              </div>
            </div>

            <div className="space-y-4 md:pl-8">
              <div className="space-y-2">
                <Label htmlFor="download-path">Download Path</Label>
                <div className="flex gap-2">
                  <InputWithContext id="download-path" value={tempSettings.downloadPath} onChange={(e) => setTempSettings((prev) => ({
                ...prev,
                downloadPath: e.target.value,
            }))} placeholder="C:\Users\YourUsername\Music"/>
                  <Button type="button" onClick={handleBrowseFolder} className="gap-1.5">
                    <FolderOpen className="h-4 w-4"/>
                    Browse
                  </Button>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-3">
                  <Switch id="embed-lyrics" checked={tempSettings.embedLyrics} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, embedLyrics: checked }))}/>
                  <Label htmlFor="embed-lyrics" className="cursor-pointer text-sm font-normal">Embed Lyrics</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch id="embed-max-quality-cover" checked={tempSettings.embedMaxQualityCover} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, embedMaxQualityCover: checked }))}/>
                  <Label htmlFor="embed-max-quality-cover" className="cursor-pointer text-sm font-normal">Embed Max Quality Cover</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch id="embed-genre" checked={tempSettings.embedGenre} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, embedGenre: checked }))}/>
                  <Label htmlFor="embed-genre" className="cursor-pointer text-sm font-normal">Embed Genre</Label>
                </div>
                {tempSettings.embedGenre && (<div className="flex items-center gap-3">
                  <Switch id="use-single-genre" checked={tempSettings.useSingleGenre} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, useSingleGenre: checked }))}/>
                  <Label htmlFor="use-single-genre" className="cursor-pointer text-sm font-normal">Use Single Genre</Label>
                </div>)}
                <div className="flex items-center gap-3">
                  <Switch id="use-first-artist-only" checked={tempSettings.useFirstArtistOnly} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, useFirstArtistOnly: checked }))}/>
                  <Label htmlFor="use-first-artist-only" className="cursor-pointer text-sm font-normal">Use First Artist Only</Label>
                </div>
                {!tempSettings.useFirstArtistOnly && (<div className="space-y-2">
                  <Label className="text-sm">Artist Separator</Label>
                  <Select value={tempSettings.separator} onValueChange={(value: "comma" | "semicolon") => setTempSettings((prev) => ({ ...prev, separator: value }))}>
                    <SelectTrigger className="h-9 w-fit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comma">Comma (,)</SelectItem>
                      <SelectItem value="semicolon">Semicolon (;)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>)}
              </div>
            </div>
          </div>)}

        {activeTab === "download" && (<div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] lg:gap-8 items-start">
            <div className="space-y-4 lg:pr-8 lg:border-r">
              <div className="space-y-2">
                <Label htmlFor="link-resolver">Link Resolver</Label>
                <div className="flex items-center gap-3 flex-wrap">
                  <Select value={tempSettings.linkResolver} onValueChange={(value: "songstats" | "songlink") => setTempSettings((prev) => ({
                ...prev,
                linkResolver: value,
            }))}>
                    <SelectTrigger id="link-resolver" className="h-9 w-fit min-w-35">
                      <SelectValue placeholder="Select a link resolver"/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="songlink">
                        <span className="flex items-center gap-2">
                          <SonglinkIcon className="h-4 w-4 shrink-0"/>
                          Songlink
                        </span>
                      </SelectItem>
                      <SelectItem value="songstats">
                        <span className="flex items-center gap-2">
                          <SongstatsIcon className="h-4 w-4 shrink-0"/>
                          Songstats
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Switch id="allow-link-resolver-fallback" checked={tempSettings.allowResolverFallback} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                allowResolverFallback: checked,
            }))}/>
                <Label htmlFor="allow-link-resolver-fallback" className="text-sm font-normal cursor-pointer">
                  Allow Resolver Fallback
                </Label>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label className="text-base font-semibold">Community</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help"/>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs whitespace-nowrap">1 track / 30s</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="downloader">Source</Label>
                <div className="flex items-center gap-3 flex-wrap lg:flex-nowrap">
                  <Select value={effectiveDownloader} onValueChange={(value: SettingsType["downloader"]) => setTempSettings((prev) => ({
                ...prev,
                downloader: value,
            }))}>
                    <SelectTrigger id="downloader" className="h-9 w-fit">
                      <SelectValue placeholder="Select a source"/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="tidal">
                        <span className="flex items-center gap-2">
                          <TidalIcon />
                          Tidal
                        </span>
                      </SelectItem>
                      <SelectItem value="qobuz">
                        <span className="flex items-center gap-2">
                          <QobuzIcon />
                          Qobuz
                        </span>
                      </SelectItem>
                      <SelectItem value="amazon">
                        <span className="flex items-center gap-2">
                          <AmazonIcon />
                          Amazon Music
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  {effectiveDownloader === "auto" && (<>
                      <Select value={effectiveAutoOrder} onValueChange={(value: string) => setTempSettings((prev) => ({
                    ...prev,
                    autoOrder: value,
                    autoQuality: value.includes("qobuz") && prev.autoQuality === "atmos" ? "24" : prev.autoQuality,
                }))}>
                        <SelectTrigger className="h-9 w-auto">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="w-fit min-w-max">
                          <SelectItem value="tidal-qobuz-amazon">
                                <span className="flex items-center gap-1.5">
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <QobuzIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <AmazonIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="tidal-amazon-qobuz">
                                <span className="flex items-center gap-1.5">
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <AmazonIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <QobuzIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="qobuz-tidal-amazon">
                                <span className="flex items-center gap-1.5">
                                  <QobuzIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <AmazonIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="qobuz-amazon-tidal">
                                <span className="flex items-center gap-1.5">
                                  <QobuzIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <AmazonIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="amazon-tidal-qobuz">
                                <span className="flex items-center gap-1.5">
                                  <AmazonIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <QobuzIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="amazon-qobuz-tidal">
                                <span className="flex items-center gap-1.5">
                                  <AmazonIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <QobuzIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="tidal-qobuz">
                                <span className="flex items-center gap-1.5">
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <QobuzIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="tidal-amazon">
                                <span className="flex items-center gap-1.5">
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <AmazonIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="qobuz-tidal">
                                <span className="flex items-center gap-1.5">
                                  <QobuzIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="amazon-tidal">
                                <span className="flex items-center gap-1.5">
                                  <AmazonIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                          <SelectItem value="qobuz-amazon">
                            <span className="flex items-center gap-1.5">
                              <QobuzIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <AmazonIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="amazon-qobuz">
                            <span className="flex items-center gap-1.5">
                              <AmazonIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <QobuzIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      <Select value={tempSettings.autoQuality || "16"} onValueChange={handleAutoQualityChange}>
                        <SelectTrigger className="h-9 w-fit shrink-0 whitespace-nowrap">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="16">16-bit/44.1kHz</SelectItem>
                          <SelectItem value="24">24-bit/48kHz - 192kHz</SelectItem>
                          {autoAtmosAvailable && (<SelectItem value="atmos">Dolby Atmos</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </>)}

                  {effectiveDownloader === "tidal" && (<Select value={tempSettings.tidalQuality} onValueChange={handleTidalQualityChange}>
                        <SelectTrigger className="h-9 w-fit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="LOSSLESS">16-bit/44.1kHz</SelectItem>
                          <SelectItem value="HI_RES_LOSSLESS">24-bit/48kHz - 192kHz</SelectItem>
                          <SelectItem value="ATMOS">Dolby Atmos</SelectItem>
                        </SelectContent>
                      </Select>)}

                  {effectiveDownloader === "qobuz" && (<Select value={tempSettings.qobuzQuality} onValueChange={handleQobuzQualityChange}>
                      <SelectTrigger className="h-9 w-fit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="6">16-bit/44.1kHz</SelectItem>
                        <SelectItem value="27">24-bit/48kHz - 192kHz</SelectItem>
                      </SelectContent>
                    </Select>)}

                  {effectiveDownloader === "amazon" && (<Select value={tempSettings.amazonQuality} onValueChange={handleAmazonQualityChange}>
                      <SelectTrigger className="h-9 w-fit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="16">16-bit/44.1kHz</SelectItem>
                        <SelectItem value="24">24-bit/48kHz - 192kHz</SelectItem>
                        <SelectItem value="atmos">Dolby Atmos</SelectItem>
                      </SelectContent>
                    </Select>)}
                </div>

                {isAtmosSelected && (<div className="flex flex-wrap items-center gap-3 pt-2">
                    <Switch id="allow-atmos-fallback" checked={tempSettings.allowAtmosFallback} onCheckedChange={(checked) => setTempSettings((prev) => ({
                    ...prev,
                    allowAtmosFallback: checked,
                }))}/>
                    <Label htmlFor="allow-atmos-fallback" className="text-sm font-normal cursor-pointer">
                      Fallback to FLAC
                    </Label>
                    {tempSettings.allowAtmosFallback && (<Select value={tempSettings.atmosFallbackQuality} onValueChange={(value: "16" | "24") => setTempSettings((prev) => ({
                        ...prev,
                        atmosFallbackQuality: value,
                    }))}>
                        <SelectTrigger className="h-8 w-fit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="16">16-bit/44.1kHz</SelectItem>
                          <SelectItem value="24">24-bit/48kHz - 192kHz</SelectItem>
                        </SelectContent>
                      </Select>)}
                  </div>)}

                {((effectiveDownloader === "tidal" &&
                tempSettings.tidalQuality === "HI_RES_LOSSLESS") ||
                (effectiveDownloader === "qobuz" &&
                    tempSettings.qobuzQuality === "27") ||
                (effectiveDownloader === "amazon" &&
                    tempSettings.amazonQuality === "24") ||
                (effectiveDownloader === "auto" &&
                    tempSettings.autoQuality === "24") ||
                (isAtmosSelected && tempSettings.allowAtmosFallback && tempSettings.atmosFallbackQuality === "24")) && (<div className="flex items-center gap-3 pt-2">
                      <Switch id="allow-fallback" checked={tempSettings.allowFallback} onCheckedChange={(checked) => setTempSettings((prev) => ({
                    ...prev,
                    allowFallback: checked,
                }))}/>
                      <Label htmlFor="allow-fallback" className="text-sm font-normal cursor-pointer">
                        Allow Quality Fallback (16-bit)
                      </Label>
                  </div>)}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-base font-semibold">Custom</Label>
              </div>

              <div className="space-y-2">
                <Label>Tidal</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button type="button" variant="outline" onClick={() => setShowCustomTidalApiDialog(true)} className="gap-2">
                    <TidalIcon />
                    {tempSettings.customTidalApi ? "Change Instance" : "Add Instance"}
                  </Button>
                  {tempSettings.customTidalApi && (<span className="max-w-65 truncate text-xs text-muted-foreground" title={tempSettings.customTidalApi}>
                      {tempSettings.customTidalApi}
                    </span>)}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Qobuz</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button type="button" variant="outline" onClick={() => setShowCustomQobuzApiDialog(true)} className="gap-2">
                    <QobuzIcon />
                    {tempSettings.customQobuzApi ? "Change Instance" : "Add Instance"}
                  </Button>
                  {tempSettings.customQobuzApi && (<span className="max-w-65 truncate text-xs text-muted-foreground" title={tempSettings.customQobuzApi}>
                      {tempSettings.customQobuzApi}
                    </span>)}
                </div>
              </div>
            </div>
          </div>)}

        {activeTab === "naming" && (() => {
            const separateToggle = (<div className="flex items-center gap-2">
              <Label htmlFor="separate-album-filename" className="text-sm cursor-pointer font-normal">Separate Filename</Label>
              <Switch id="separate-album-filename" checked={tempSettings.useSeparateAlbumFilename} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, useSeparateAlbumFilename: checked }))}/>
            </div>);
            const folderSingleTrackToggle = (<div className="flex items-center gap-2">
              <Label htmlFor="apply-folder-single-track" className="text-sm cursor-pointer font-normal">Single Track</Label>
              <Switch id="apply-folder-single-track" checked={tempSettings.applyFolderToSingleTrack} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, applyFolderToSingleTrack: checked }))}/>
            </div>);
            return (<div className="space-y-6">
              <FormatEditor tokens={TEMPLATE_VARIABLES} fields={[
                    ...(tempSettings.useSeparateAlbumFilename ? [
                        { title: "Filename — Single Track", titleAccessory: separateToggle, value: tempSettings.filenameTemplate, defaultValue: DEFAULT_SETTINGS.filenameTemplate, suffix: ".flac", placeholder: "{artist} - {title}", column: "left" as const, onChange: (next: string) => setTempSettings((prev) => ({ ...prev, filenameTemplate: next })) },
                        { title: "Filename — Album / Playlist Track", value: tempSettings.albumFilenameTemplate, defaultValue: DEFAULT_SETTINGS.albumFilenameTemplate, suffix: ".flac", placeholder: "{track}. {title}", column: "left" as const, onChange: (next: string) => setTempSettings((prev) => ({ ...prev, albumFilenameTemplate: next })) },
                    ] : [
                        { title: "Filename", titleAccessory: separateToggle, value: tempSettings.filenameTemplate, defaultValue: DEFAULT_SETTINGS.filenameTemplate, suffix: ".flac", placeholder: "{track}. {artist} - {title}", column: "left" as const, onChange: (next: string) => setTempSettings((prev) => ({ ...prev, filenameTemplate: next })) },
                    ]),
                    { title: "Folder Structure", titleAccessory: folderSingleTrackToggle, value: tempSettings.folderTemplate, defaultValue: DEFAULT_SETTINGS.folderTemplate, suffix: "/", placeholder: "{album_artist}/{album}", column: "right" as const, onChange: (next: string) => setTempSettings((prev) => ({ ...prev, folderTemplate: next })) },
                ]}/>
            </div>);
        })()}

        {activeTab === "files" && (<div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-8 items-start">
            <div className="space-y-4 lg:pr-8 lg:border-r">
              <h3 className="text-sm font-semibold text-muted-foreground">File Output</h3>

              <div className="flex items-center gap-3">
                <Switch id="create-playlist-folder" checked={tempSettings.createPlaylistFolder} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                createPlaylistFolder: checked,
            }))}/>
                <Label htmlFor="create-playlist-folder" className="text-sm cursor-pointer font-normal">
                  Playlist Folder
                </Label>
              </div>

              {tempSettings.createPlaylistFolder && (<div className="flex items-center gap-3 pl-7">
                <Switch id="playlist-owner-folder-name" checked={tempSettings.playlistOwnerFolderName} onCheckedChange={(checked) => setTempSettings((prev) => ({
                    ...prev,
                    playlistOwnerFolderName: checked,
                }))}/>
                <Label htmlFor="playlist-owner-folder-name" className="text-sm cursor-pointer font-normal">
                  Playlist Owner Folder Name
                </Label>
              </div>)}

              <div className="flex items-center gap-3">
                <Switch id="save-cover" checked={tempSettings.saveCover} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                saveCover: checked,
            }))}/>
                <Label htmlFor="save-cover" className="text-sm cursor-pointer font-normal">
                  Auto Download Separate Cover
                </Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="existing-file-check-mode">Existing File Check</Label>
                <Select value={tempSettings.existingFileCheckMode} onValueChange={(value: ExistingFileCheckMode) => setTempSettings((prev) => ({
                ...prev,
                existingFileCheckMode: value,
            }))}>
                  <SelectTrigger id="existing-file-check-mode">
                    <SelectValue placeholder="Select existing file check mode"/>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="filename">Filename</SelectItem>
                    <SelectItem value="isrc">ISRC</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3">
                <Switch id="redownload-with-suffix" checked={tempSettings.redownloadWithSuffix} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                redownloadWithSuffix: checked,
            }))}/>
                <Label htmlFor="redownload-with-suffix" className="text-sm cursor-pointer font-normal">
                  Redownload With Suffix
                </Label>
              </div>

              <div className="flex items-center gap-3">
                <Switch id="export-logs-file" checked={tempSettings.exportLogsFile} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                exportLogsFile: checked,
            }))}/>
                <Label htmlFor="export-logs-file" className="text-sm cursor-pointer font-normal">
                  Generate Failed Logs
                </Label>
              </div>
            </div>

            <div className="space-y-6 lg:pl-0">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground">Conversion</h3>
                <div className="flex items-center gap-3">
                  <Switch id="auto-convert-audio" checked={tempSettings.autoConvertAudio} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, autoConvertAudio: checked }))}/>
                  <Label htmlFor="auto-convert-audio" className="text-sm font-normal cursor-pointer">Auto Convert Audio</Label>
                </div>
                {tempSettings.autoConvertAudio && (<div className="space-y-4 pl-7">
                  <div className="flex gap-3 flex-wrap">
                    <div className="space-y-2"><Label htmlFor="auto-convert-format">Format</Label><Select value={tempSettings.autoConvertFormat} onValueChange={(value: SettingsType["autoConvertFormat"]) => setTempSettings((prev) => ({ ...prev, autoConvertFormat: value }))}>
                      <SelectTrigger id="auto-convert-format" className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="mp3">MP3</SelectItem><SelectItem value="m4a-aac">M4A (AAC)</SelectItem><SelectItem value="m4a-alac">M4A (ALAC)</SelectItem><SelectItem value="wav">WAV</SelectItem><SelectItem value="aiff">AIFF</SelectItem><SelectItem value="opus">Opus</SelectItem></SelectContent>
                    </Select></div>
                    {!(["m4a-alac", "wav", "aiff"] as string[]).includes(tempSettings.autoConvertFormat) && (<div className="space-y-2"><Label htmlFor="auto-convert-bitrate">Bitrate</Label><Select value={tempSettings.autoConvertBitrate} onValueChange={(value: SettingsType["autoConvertBitrate"]) => setTempSettings((prev) => ({ ...prev, autoConvertBitrate: value }))}>
                      <SelectTrigger id="auto-convert-bitrate" className="w-32"><SelectValue /></SelectTrigger><SelectContent>{AUTO_CONVERT_BITRATES.map((bitrate) => <SelectItem key={bitrate} value={bitrate}>{bitrate}</SelectItem>)}</SelectContent>
                    </Select></div>)}
                  </div>
                  <div className="flex items-center gap-3"><Switch id="auto-convert-delete-original" checked={tempSettings.autoConvertDeleteOriginal} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, autoConvertDeleteOriginal: checked }))}/><Label htmlFor="auto-convert-delete-original" className="text-sm font-normal cursor-pointer">Delete Original File After Convert</Label></div>
                </div>)}
                <div className="flex items-center gap-3">
                  <Switch id="auto-resample-audio" checked={tempSettings.autoResampleAudio} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, autoResampleAudio: checked }))}/>
                  <Label htmlFor="auto-resample-audio" className="text-sm font-normal cursor-pointer">Auto Resample Audio</Label>
                </div>
                {tempSettings.autoResampleAudio && (<div className="space-y-4 pl-7">
                  <div className="flex gap-3 flex-wrap">
                    <div className="space-y-2"><Label htmlFor="auto-resample-bit-depth">Bit Depth</Label><Select value={tempSettings.autoResampleBitDepth} onValueChange={(value: SettingsType["autoResampleBitDepth"]) => setTempSettings((prev) => ({ ...prev, autoResampleBitDepth: value }))}>
                      <SelectTrigger id="auto-resample-bit-depth" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="16">16-bit</SelectItem><SelectItem value="24">24-bit</SelectItem></SelectContent>
                    </Select></div>
                    <div className="space-y-2"><Label htmlFor="auto-resample-rate">Sample Rate</Label><Select value={tempSettings.autoResampleSampleRate} onValueChange={(value: SettingsType["autoResampleSampleRate"]) => setTempSettings((prev) => ({ ...prev, autoResampleSampleRate: value }))}>
                      <SelectTrigger id="auto-resample-rate" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="44100">44.1 kHz</SelectItem><SelectItem value="48000">48 kHz</SelectItem><SelectItem value="96000">96 kHz</SelectItem><SelectItem value="192000">192 kHz</SelectItem></SelectContent>
                    </Select></div>
                  </div>
                  <div className="flex items-center gap-3"><Switch id="auto-resample-delete-original" checked={tempSettings.autoResampleDeleteOriginal} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, autoResampleDeleteOriginal: checked }))}/><Label htmlFor="auto-resample-delete-original" className="text-sm font-normal cursor-pointer">Delete Original File After Resample</Label></div>
                </div>)}
              </div>

              <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground">M3U8 Playlist</h3>

              <div className="flex items-center gap-3">
                <Switch id="create-m3u8-file" checked={tempSettings.createM3u8File} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                createM3u8File: checked,
            }))}/>
                <Label htmlFor="create-m3u8-file" className="text-sm cursor-pointer font-normal">
                  Create M3U8 Playlist File
                </Label>
              </div>
              </div>
            </div>
          </div>)}

        {activeTab === "metadata" && (<div className="min-w-0 overflow-hidden space-y-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Embedded Tags</h3>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setTempSettings((prev) => ({ ...prev, metadataTags: Object.fromEntries(METADATA_TAG_OPTIONS.map(({ key }) => [key, true])) as unknown as MetadataTagToggles }))}>Enable All</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setTempSettings((prev) => ({ ...prev, metadataTags: Object.fromEntries(METADATA_TAG_OPTIONS.map(({ key }) => [key, false])) as unknown as MetadataTagToggles }))}>Disable All</Button>
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-1 md:grid-cols-2 md:gap-x-8">
              {[METADATA_TAG_OPTIONS.slice(0, 7), METADATA_TAG_OPTIONS.slice(7)].map((column, columnIndex) => (<div key={columnIndex} className={`min-w-0 ${columnIndex === 1 ? "md:border-l md:pl-8" : ""}`}>
                {column.map((option) => (<div key={option.key} className="flex min-w-0 items-center gap-3 overflow-hidden py-2">
                  <Switch id={`metadata-tag-${option.key}`} checked={tempSettings.metadataTags[option.key]} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, metadataTags: { ...prev.metadataTags, [option.key]: checked } }))}/>
                  <Label htmlFor={`metadata-tag-${option.key}`} className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1 overflow-hidden text-sm font-normal">
                    <span className="shrink-0">{option.label}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">(e.g. {option.example})</span>
                  </Label>
                </div>))}
              </div>))}
            </div>
          </div>

        </div>)}

        {activeTab === "status" && (<ApiStatusTab />)}
      </div>

      <Dialog open={showAddFontDialog} onOpenChange={(open) => open ? setShowAddFontDialog(true) : closeAddFontDialog()}>
        <DialogContent className="sm:max-w-115 [&>button]:hidden">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>Add Font</DialogTitle>
              <button type="button" onClick={() => openExternal("https://fonts.google.com")} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                Open Google Fonts
                <ExternalLink className="h-3 w-3"/>
              </button>
            </div>
            <DialogDescription />
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="google-font-url">Google Font URL</Label>
              <Input id="google-font-url" value={addFontUrl} onChange={(event) => setAddFontUrl(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && parsedAddFont) {
                void handleAddFont();
            }
        }} placeholder="https://fonts.google.com/specimen/Ubuntu" autoFocus/>
              {addFontUrl.trim() && !parsedAddFont && (<p className="text-xs text-destructive">
                  Enter a valid Google Fonts URL.
                </p>)}
            </div>
            <div className="rounded-md border bg-muted/20 p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Preview
              </p>
              <p className="text-2xl font-semibold leading-tight" style={{ fontFamily: parsedAddFont?.fontFamily }}>
                Aa The quick brown fox
              </p>
              <p className="mt-2 text-sm text-muted-foreground" style={{ fontFamily: parsedAddFont?.fontFamily }}>
                Kendrick Lamar - All The Stars
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAddFontDialog}>
              Cancel
            </Button>
            <Button onClick={() => void handleAddFont()} disabled={!parsedAddFont}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCustomTidalApiDialog} onOpenChange={setShowCustomTidalApiDialog}>
        <DialogContent className="sm:max-w-md [&>button]:hidden">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>Tidal Source</DialogTitle>
              <button type="button" onClick={() => openExternal("https://github.com/binimum/hifi-api")} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                How do I create one?
                <ExternalLink className="h-3 w-3"/>
              </button>
            </div>
            <DialogDescription />
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="custom-tidal-api">Instance URL</Label>
              <div className="flex gap-2">
                <Input id="custom-tidal-api" type="url" value={tempSettings.customTidalApi || ""} onChange={(e) => {
            const nextValue = e.target.value.replace(/\/+$/g, "");
            setCustomTidalApiStatus("idle");
            void persistCustomTidalApi(nextValue);
        }} placeholder="https://your-hifi-api.example"/>
                <Button type="button" variant="outline" className="gap-2" onClick={() => void handleCheckCustomTidalApi()} disabled={!((tempSettings.customTidalApi || "").trim().startsWith("https://")) || customTidalApiStatus === "checking"}>
                  {customTidalApiStatus === "checking" ? "Checking..." : <><PlugZap className="h-4 w-4"/>Check</>}
                </Button>
                {tempSettings.customTidalApi && (<Button type="button" variant="outline" size="icon" onClick={() => {
                setCustomTidalApiStatus("idle");
                void persistCustomTidalApi("");
            }}>
                    <Trash2 className="h-4 w-4 text-destructive"/>
                  </Button>)}
              </div>
            </div>
            {customTidalApiStatus !== "idle" && (<p className={`text-xs ${customTidalApiStatus === "online"
                ? "text-green-600 dark:text-green-400"
                : customTidalApiStatus === "offline"
                    ? "text-destructive"
                    : "text-muted-foreground"}`}>
                {customTidalApiStatus === "online"
                ? "Custom HiFi API instance is online."
                : customTidalApiStatus === "offline"
                    ? "Custom HiFi API instance is offline or returned preview-only data."
                    : "Checking custom HiFi API instance..."}
              </p>)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCustomTidalApiDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCustomQobuzApiDialog} onOpenChange={setShowCustomQobuzApiDialog}>
        <DialogContent className="sm:max-w-md [&>button]:hidden">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>Qobuz Source</DialogTitle>
              <button type="button" onClick={() => openExternal("https://github.com/QobuzDL/Qobuz-DL")} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                How do I create one?
                <ExternalLink className="h-3 w-3"/>
              </button>
            </div>
            <DialogDescription />
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="custom-qobuz-api">Instance URL</Label>
              <div className="flex gap-2">
                <Input id="custom-qobuz-api" type="url" value={tempSettings.customQobuzApi || ""} onChange={(e) => {
            const nextValue = e.target.value.replace(/\/+$/g, "");
            setCustomQobuzApiStatus("idle");
            void persistCustomQobuzApi(nextValue);
        }} placeholder="https://your-qobuz-dl.example"/>
                <Button type="button" variant="outline" className="gap-2" onClick={() => void handleCheckCustomQobuzApi()} disabled={!((tempSettings.customQobuzApi || "").trim().startsWith("https://")) || customQobuzApiStatus === "checking"}>
                  {customQobuzApiStatus === "checking" ? "Checking..." : <><PlugZap className="h-4 w-4"/>Check</>}
                </Button>
                {tempSettings.customQobuzApi && (<Button type="button" variant="outline" size="icon" onClick={() => {
                setCustomQobuzApiStatus("idle");
                void persistCustomQobuzApi("");
            }}>
                    <Trash2 className="h-4 w-4 text-destructive"/>
                  </Button>)}
              </div>
            </div>
            {customQobuzApiStatus !== "idle" && (<p className={`text-xs ${customQobuzApiStatus === "online"
                ? "text-green-600 dark:text-green-400"
                : customQobuzApiStatus === "offline"
                    ? "text-destructive"
                    : "text-muted-foreground"}`}>
                {customQobuzApiStatus === "online"
                ? "Custom Qobuz-DL instance is online."
                : customQobuzApiStatus === "offline"
                    ? "Custom Qobuz-DL instance is offline or returned no download URL."
                    : "Checking custom Qobuz-DL instance..."}
              </p>)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCustomQobuzApiDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Reset to Default?</DialogTitle>
            <DialogDescription>
              This will reset all settings to their default values. Your custom
              font list will be kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleReset}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>);
}
