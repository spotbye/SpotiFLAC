import { useState, useEffect, useCallback, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { X, ArrowUp, CloudDownload } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getSettings, getSettingsWithDefaults, loadSettings, saveSettings, applyThemeMode, applyFont } from "@/lib/settings";
import { applyTheme } from "@/lib/themes";
import { openExternal } from "@/lib/utils";
import { OpenFolder, CheckFFmpegInstalled, DownloadFFmpeg, GetRecentFetches, SaveRecentFetches } from "../wailsjs/go/main/App";
import { EventsOn, EventsOff, Quit } from "../wailsjs/runtime/runtime";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar, type PageType } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { MarkdownLite, extractMarkdownSection } from "@/components/MarkdownLite";
import { SearchBar } from "@/components/SearchBar";
import { TrackInfo } from "@/components/TrackInfo";
import { AlbumInfo } from "@/components/AlbumInfo";
import { PlaylistInfo } from "@/components/PlaylistInfo";
import { ArtistInfo } from "@/components/ArtistInfo";
import { DownloadQueue } from "@/components/DownloadQueue";
import { DownloadProgressToast } from "@/components/DownloadProgressToast";
import { CooldownBanner } from "@/components/CooldownBanner";
import { AudioAnalysisPage } from "@/components/AudioAnalysisPage";
import { AudioConverterPage } from "@/components/AudioConverterPage";
import { AudioResamplerPage } from "@/components/AudioResamplerPage";
import { FileManagerPage } from "@/components/FileManagerPage";
import { LyricsManagerPage } from "@/components/LyricsManagerPage";
import { SettingsPage } from "@/components/SettingsPage";
import { DebugLoggerPage } from "@/components/DebugLoggerPage";
import { OtherProjects } from "@/components/OtherProjects";
import { HistoryPage } from "@/components/HistoryPage";
import { SupportPage } from "@/components/SupportPage";
import type { HistoryItem } from "@/components/FetchHistory";
import { useDownload } from "@/hooks/useDownload";
import { useMetadata } from "@/hooks/useMetadata";
import { useLyrics } from "@/hooks/useLyrics";
import { useCover } from "@/hooks/useCover";
import { useAvailability } from "@/hooks/useAvailability";
import { ensureApiStatusCheckStarted } from "@/lib/api-status";
import { useDownloadQueueDialog } from "@/hooks/useDownloadQueueDialog";
import { useDownloadProgress } from "@/hooks/useDownloadProgress";
import { buildPlaylistFolderName } from "@/lib/playlist";
const HISTORY_KEY = "spotiflac_fetch_history";
const MAX_HISTORY = 5;
function extractSpotifyEntityFromURL(url: string): {
    type: string;
    id: string;
} | null {
    const trimmed = url.trim();
    if (!trimmed) {
        return null;
    }
    const spotifyUriMatch = trimmed.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)$/i);
    if (spotifyUriMatch) {
        return {
            type: spotifyUriMatch[1].toLowerCase(),
            id: spotifyUriMatch[2],
        };
    }
    try {
        const parsed = new URL(trimmed);
        const segments = parsed.pathname.split("/").filter(Boolean);
        const supportedTypes = new Set(["track", "album", "playlist", "artist"]);
        for (let i = 0; i < segments.length - 1; i++) {
            const segment = segments[i].toLowerCase();
            if (!supportedTypes.has(segment)) {
                continue;
            }
            const id = segments[i + 1];
            if (id) {
                return { type: segment, id };
            }
        }
    }
    catch {
    }
    return null;
}
function normalizeHistoryURL(url: string): string {
    const trimmed = url.trim();
    if (!trimmed)
        return trimmed;
    const withoutQuery = trimmed.split("?")[0].replace(/\/+$/, "");
    const spotifyEntity = extractSpotifyEntityFromURL(withoutQuery);
    if (spotifyEntity) {
        return `https://open.spotify.com/${spotifyEntity.type}/${spotifyEntity.id}`;
    }
    return withoutQuery.replace(/(\/artist\/[A-Za-z0-9]+)\/discography\/all$/i, "$1");
}
function getHistoryIdentityKey(type: HistoryItem["type"], url: string): string {
    const normalizedUrl = normalizeHistoryURL(url);
    const spotifyEntity = extractSpotifyEntityFromURL(normalizedUrl);
    if (spotifyEntity) {
        return `${type}:${spotifyEntity.id}`;
    }
    return `${type}:${normalizedUrl}`;
}
function dedupeHistoryItems(items: HistoryItem[]): HistoryItem[] {
    const seen = new Set<string>();
    const deduped: HistoryItem[] = [];
    for (const item of items) {
        const normalizedUrl = normalizeHistoryURL(item.url);
        const key = getHistoryIdentityKey(item.type, normalizedUrl);
        if (seen.has(key))
            continue;
        seen.add(key);
        deduped.push({ ...item, url: normalizedUrl });
    }
    return deduped;
}
function sortHistoryItems(items: HistoryItem[]): HistoryItem[] {
    return [...items].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}
function normalizeHistoryItems(items: HistoryItem[]): HistoryItem[] {
    return dedupeHistoryItems(sortHistoryItems(items)).slice(0, MAX_HISTORY);
}
function parseStoredHistory(value: string | null): HistoryItem[] {
    if (!value) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (err) {
        console.error("Failed to parse stored history:", err);
        return [];
    }
}
function App() {
    const [currentPage, setCurrentPage] = useState<PageType>("main");
    const contentScrollRef = useRef<HTMLDivElement | null>(null);
    const [spotifyUrl, setSpotifyUrl] = useState("");
    const [smartSearchInput, setSmartSearchInput] = useState("");
    const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState<string>("default");
    const [currentListPage, setCurrentListPage] = useState(1);
    const [hasUpdate, setHasUpdate] = useState(false);
    const [releaseDate, setReleaseDate] = useState<string | null>(null);
    const [updateInfo, setUpdateInfo] = useState<{
        version: string;
        changelog: string;
        url: string;
    } | null>(null);
    const [showUpdateDialog, setShowUpdateDialog] = useState(false);
    const [fetchHistory, setFetchHistory] = useState<HistoryItem[]>([]);
    const [isSearchMode, setIsSearchMode] = useState(false);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [hasUnsavedSettings, setHasUnsavedSettings] = useState(false);
    const [pendingPageChange, setPendingPageChange] = useState<PageType | null>(null);
    const [showUnsavedChangesDialog, setShowUnsavedChangesDialog] = useState(false);
    const [resetSettingsFn, setResetSettingsFn] = useState<(() => void) | null>(null);
    const ITEMS_PER_PAGE = 50;
    const CURRENT_VERSION = __APP_VERSION__;
    const download = useDownload();
    const metadata = useMetadata();
    const lyrics = useLyrics();
    const cover = useCover();
    const availability = useAvailability();
    const downloadQueue = useDownloadQueueDialog();
    const downloadProgress = useDownloadProgress();
    const [isFFmpegInstalled, setIsFFmpegInstalled] = useState<boolean | null>(null);
    const [isInstallingFFmpeg, setIsInstallingFFmpeg] = useState(false);
    const [ffmpegInstallProgress, setFfmpegInstallProgress] = useState(0);
    const [ffmpegInstallStatus, setFfmpegInstallStatus] = useState("");
    useLayoutEffect(() => {
        const savedSettings = getSettings();
        if (savedSettings) {
            applyThemeMode(savedSettings.themeMode);
            applyTheme(savedSettings.theme);
            applyFont(savedSettings.fontFamily, savedSettings.customFonts);
        }
    }, []);
    useEffect(() => {
        const initSettings = async () => {
            const settings = await loadSettings();
            applyThemeMode(settings.themeMode);
            applyTheme(settings.theme);
            applyFont(settings.fontFamily, settings.customFonts);
            if (!settings.downloadPath) {
                const settingsWithDefaults = await getSettingsWithDefaults();
                await saveSettings(settingsWithDefaults);
            }
        };
        initSettings();
        const checkFFmpeg = async () => {
            try {
                const installed = await CheckFFmpegInstalled();
                setIsFFmpegInstalled(installed);
            }
            catch (err) {
                console.error("Failed to check FFmpeg:", err);
                setIsFFmpegInstalled(false);
            }
        };
        checkFFmpeg();
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleChange = () => {
            const currentSettings = getSettings();
            if (currentSettings.themeMode === "auto") {
                applyThemeMode("auto");
                applyTheme(currentSettings.theme);
            }
        };
        mediaQuery.addEventListener("change", handleChange);
        checkForUpdates();
        ensureApiStatusCheckStarted();
        void loadHistory();
        return () => {
            mediaQuery.removeEventListener("change", handleChange);
        };
    }, []);
    useEffect(() => {
        const contentElement = contentScrollRef.current;
        if (!contentElement) {
            return;
        }
        const handleScroll = () => {
            setShowScrollTop(contentElement.scrollTop > 300);
        };
        handleScroll();
        contentElement.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            contentElement.removeEventListener("scroll", handleScroll);
        };
    }, []);
    const scrollToTop = useCallback(() => {
        contentScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, []);
    useEffect(() => {
        contentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
        setShowScrollTop(false);
    }, [currentPage]);
    useEffect(() => {
        setSelectedTracks([]);
        setSearchQuery("");
        download.resetDownloadedTracks();
        lyrics.resetLyricsState();
        cover.resetCoverState();
        availability.clearAvailability();
        setSortBy("default");
        setCurrentListPage(1);
    }, [metadata.metadata]);
    const checkForUpdates = async () => {
        try {
            const response = await fetch("https://api.github.com/repos/spotbye/SpotiFLAC/releases/latest");
            const data = await response.json();
            const rawTag = data.tag_name || "";
            const latestVersion = rawTag.replace(/^v/, "") || "";
            if (data.published_at) {
                setReleaseDate(data.published_at);
            }
            if (latestVersion && latestVersion > CURRENT_VERSION) {
                setHasUpdate(true);
                setUpdateInfo({
                    version: latestVersion,
                    changelog: extractMarkdownSection(data.body || "", "Changelog"),
                    url: `https://github.com/spotbye/SpotiFLAC/releases/tag/${rawTag}`,
                });
                const dismissedVersion = localStorage.getItem("spotiflac_update_dismissed_version");
                if (dismissedVersion !== latestVersion) {
                    setShowUpdateDialog(true);
                }
            }
        }
        catch (err) {
            console.error("Failed to check for updates:", err);
        }
    };
    const persistRecentHistory = useCallback(async (history: HistoryItem[]) => {
        try {
            await SaveRecentFetches(JSON.stringify(history));
        }
        catch (err) {
            console.error("Failed to save recent fetches:", err);
        }
    }, []);
    const loadHistory = useCallback(async () => {
        try {
            const saved = parseStoredHistory(localStorage.getItem(HISTORY_KEY));
            const persisted = parseStoredHistory(await GetRecentFetches());
            const normalized = normalizeHistoryItems([...persisted, ...saved]);
            setFetchHistory(normalized);
            await persistRecentHistory(normalized);
        }
        catch (err) {
            console.error("Failed to load history:", err);
        }
        finally {
            localStorage.removeItem(HISTORY_KEY);
        }
    }, [persistRecentHistory]);
    const handleInstallFFmpeg = async () => {
        setIsInstallingFFmpeg(true);
        setFfmpegInstallProgress(0);
        setFfmpegInstallStatus("starting");
        try {
            EventsOn("ffmpeg:progress", (progress: number) => {
                setFfmpegInstallProgress(progress);
                if (progress >= 100) {
                    setFfmpegInstallStatus("extracting");
                }
                else {
                    setFfmpegInstallStatus("downloading");
                }
            });
            EventsOn("ffmpeg:status", (status: string) => {
                setFfmpegInstallStatus(status);
            });
            const response = await DownloadFFmpeg();
            EventsOff("ffmpeg:progress");
            EventsOff("ffmpeg:status");
            if (response.success) {
                toast.success("FFmpeg installed successfully!");
                setIsFFmpegInstalled(true);
            }
            else {
                toast.error(`Failed to install FFmpeg: ${response.error}`);
            }
        }
        catch (error) {
            console.error("Error installing FFmpeg:", error);
            toast.error(`Error during FFmpeg installation: ${error}`);
        }
        finally {
            setIsInstallingFFmpeg(false);
            setFfmpegInstallProgress(0);
            setFfmpegInstallStatus("");
        }
    };
    const addToHistory = (item: Omit<HistoryItem, "id" | "timestamp">) => {
        setFetchHistory((prev) => {
            const normalizedUrl = normalizeHistoryURL(item.url);
            const identityKey = getHistoryIdentityKey(item.type, normalizedUrl);
            const filtered = prev.filter((h) => getHistoryIdentityKey(h.type, h.url) !== identityKey);
            const newItem: HistoryItem = {
                ...item,
                url: normalizedUrl,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
            };
            const updated = normalizeHistoryItems([newItem, ...filtered]);
            void persistRecentHistory(updated);
            return updated;
        });
    };
    const removeFromHistory = (id: string) => {
        setFetchHistory((prev) => {
            if (!prev.some((h) => h.id === id))
                return prev;
            const updated = prev.filter((h) => h.id !== id);
            void persistRecentHistory(updated);
            return updated;
        });
    };
    const handleHistorySelect = async (item: HistoryItem) => {
        setSmartSearchInput(item.url);
        setSpotifyUrl(item.url);
        const updatedUrl = await metadata.handleFetchMetadata(item.url);
        if (updatedUrl) {
            setSpotifyUrl(updatedUrl);
        }
    };
    const handleFetchMetadata = async () => {
        const requestedUrl = smartSearchInput.trim();
        setSpotifyUrl(requestedUrl);
        const updatedUrl = await metadata.handleFetchMetadata(requestedUrl);
        if (updatedUrl) {
            setSpotifyUrl(updatedUrl);
            setSmartSearchInput(updatedUrl);
        }
    };
    useEffect(() => {
        if (!metadata.metadata || !spotifyUrl)
            return;
        let historyItem: Omit<HistoryItem, "id" | "timestamp"> | null = null;
        if ("track" in metadata.metadata) {
            const { track } = metadata.metadata;
            historyItem = {
                url: spotifyUrl,
                type: "track",
                name: track.name,
                artist: track.artists,
                image: track.images,
                is_explicit: track.is_explicit,
            };
        }
        else if ("album_info" in metadata.metadata) {
            const { album_info } = metadata.metadata;
            historyItem = {
                url: spotifyUrl,
                type: "album",
                name: album_info.name,
                artist: `${album_info.total_tracks.toLocaleString()} tracks`,
                image: album_info.images,
                is_explicit: album_info.is_explicit,
            };
        }
        else if ("playlist_info" in metadata.metadata) {
            const { playlist_info } = metadata.metadata;
            historyItem = {
                url: spotifyUrl,
                type: "playlist",
                name: playlist_info.owner.name,
                artist: `${playlist_info.tracks.total.toLocaleString()} tracks`,
                image: playlist_info.cover || playlist_info.owner.images || "",
            };
        }
        else if ("artist_info" in metadata.metadata) {
            const { artist_info } = metadata.metadata;
            historyItem = {
                url: spotifyUrl,
                type: "artist",
                name: artist_info.name,
                artist: `${artist_info.total_albums.toLocaleString()} albums`,
                image: artist_info.images,
            };
        }
        if (historyItem) {
            addToHistory(historyItem);
        }
    }, [metadata.metadata]);
    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
        setCurrentListPage(1);
    };
    const toggleTrackSelection = (id: string) => {
        setSelectedTracks((prev) => prev.includes(id) ? prev.filter((prevId) => prevId !== id) : [...prev, id]);
    };
    const toggleSelectAll = (tracks: any[]) => {
        const tracksWithId = tracks.filter((track) => track.spotify_id).map((track) => track.spotify_id || "");
        if (tracksWithId.length === 0)
            return;
        const allSelected = tracksWithId.every(id => selectedTracks.includes(id));
        if (allSelected) {
            setSelectedTracks(prev => prev.filter(id => !tracksWithId.includes(id)));
        }
        else {
            setSelectedTracks(prev => Array.from(new Set([...prev, ...tracksWithId])));
        }
    };
    const selectTrackRange = (ids: string[], select: boolean) => {
        const validIds = ids.filter(Boolean);
        if (validIds.length === 0)
            return;
        if (select) {
            setSelectedTracks((prev) => Array.from(new Set([...prev, ...validIds])));
        }
        else {
            const removeSet = new Set(validIds);
            setSelectedTracks((prev) => prev.filter((id) => !removeSet.has(id)));
        }
    };
    const handleOpenFolder = async () => {
        const settings = getSettings();
        if (!settings.downloadPath) {
            toast.error("Download path not set");
            return;
        }
        try {
            await OpenFolder(settings.downloadPath);
        }
        catch (error) {
            console.error("Error opening folder:", error);
            toast.error(`Error opening folder: ${error}`);
        }
    };
    const renderMetadata = () => {
        if (!metadata.metadata)
            return null;
        if ("track" in metadata.metadata) {
            const { track } = metadata.metadata;
            const trackId = track.spotify_id || "";
            return (<TrackInfo track={track} isDownloading={download.isDownloading} downloadingTrack={download.downloadingTrack} isDownloaded={download.downloadedTracks.has(trackId)} isFailed={download.failedTracks.has(trackId)} isSkipped={download.skippedTracks.has(trackId)} downloadingLyricsTrack={lyrics.downloadingLyricsTrack} downloadedLyrics={lyrics.downloadedLyrics.has(track.spotify_id || "")} failedLyrics={lyrics.failedLyrics.has(track.spotify_id || "")} skippedLyrics={lyrics.skippedLyrics.has(track.spotify_id || "")} checkingAvailability={availability.checkingTrackId === track.spotify_id} availability={availability.availabilityMap.get(track.spotify_id || "")} downloadingCover={cover.downloadingCoverTrack === (track.spotify_id || `${track.name}-${track.artists}`)} downloadedCover={cover.downloadedCovers.has(track.spotify_id || `${track.name}-${track.artists}`)} failedCover={cover.failedCovers.has(track.spotify_id || `${track.name}-${track.artists}`)} skippedCover={cover.skippedCovers.has(track.spotify_id || `${track.name}-${track.artists}`)} onDownload={download.handleDownloadTrack} onDownloadLyrics={(spotifyId, name, artists, albumName, albumArtist, releaseDate, discNumber) => lyrics.handleDownloadLyrics(spotifyId, name, artists, albumName, undefined, undefined, albumArtist, releaseDate, discNumber)} onDownloadCover={(coverUrl, trackName, artistName, albumName, _playlistName, _position, trackId, albumArtist, releaseDate, discNumber) => cover.handleDownloadCover(coverUrl, trackName, artistName, albumName, undefined, undefined, trackId, albumArtist, releaseDate, discNumber)} onCheckAvailability={availability.checkAvailability} onOpenFolder={handleOpenFolder} onAlbumClick={metadata.handleAlbumClick} onArtistClick={async (artist) => {
                    const artistUrl = await metadata.handleArtistClick(artist);
                    if (artistUrl) {
                        setSpotifyUrl(artistUrl);
                    }
                }} onPublisherClick={(publisher) => {
                    metadata.resetMetadata();
                    setSmartSearchInput(`label:"${publisher.replace(/"/g, '\\"')}"`);
                }} onBack={metadata.resetMetadata}/>);
        }
        if ("album_info" in metadata.metadata) {
            const { album_info, track_list } = metadata.metadata;
            return (<AlbumInfo albumInfo={album_info} trackList={track_list} searchQuery={searchQuery} sortBy={sortBy} selectedTracks={selectedTracks} downloadedTracks={download.downloadedTracks} failedTracks={download.failedTracks} skippedTracks={download.skippedTracks} downloadingTrack={download.downloadingTrack} isDownloading={download.isDownloading} bulkDownloadType={download.bulkDownloadType} downloadProgress={download.downloadProgress} downloadRemainingCount={download.downloadRemainingCount} currentDownloadInfo={download.currentDownloadInfo} currentPage={currentListPage} itemsPerPage={ITEMS_PER_PAGE} downloadedLyrics={lyrics.downloadedLyrics} failedLyrics={lyrics.failedLyrics} skippedLyrics={lyrics.skippedLyrics} downloadingLyricsTrack={lyrics.downloadingLyricsTrack} checkingAvailabilityTrack={availability.checkingTrackId} availabilityMap={availability.availabilityMap} downloadedCovers={cover.downloadedCovers} failedCovers={cover.failedCovers} skippedCovers={cover.skippedCovers} downloadingCoverTrack={cover.downloadingCoverTrack} isBulkDownloadingCovers={cover.isBulkDownloadingCovers} isBulkDownloadingLyrics={lyrics.isBulkDownloadingLyrics} isMetadataLoading={metadata.loading} onSearchChange={handleSearchChange} onSortChange={setSortBy} onToggleTrack={toggleTrackSelection} onToggleSelectAll={toggleSelectAll} onSelectTrackRange={selectTrackRange} onDownloadTrack={download.handleDownloadTrack} onDownloadLyrics={(spotifyId, name, artists, albumName, _folderName, _isArtistDiscography, position, albumArtist, releaseDate, discNumber) => lyrics.handleDownloadLyrics(spotifyId, name, artists, albumName, album_info.name, position, albumArtist, releaseDate, discNumber, true)} onDownloadCover={(coverUrl, trackName, artistName, albumName, _folderName, _isArtistDiscography, position, trackId, albumArtist, releaseDate, discNumber) => cover.handleDownloadCover(coverUrl, trackName, artistName, albumName, album_info.name, position, trackId, albumArtist, releaseDate, discNumber, true)} onCheckAvailability={availability.checkAvailability} onDownloadAllLyrics={() => lyrics.handleDownloadAllLyrics(track_list, album_info.name, undefined, true)} onDownloadAllCovers={() => cover.handleDownloadAllCovers(track_list, album_info.name, true)} onDownloadAll={() => download.handleDownloadAll(track_list, album_info.name, true)} onDownloadSelected={() => download.handleDownloadSelected(selectedTracks, track_list, album_info.name, true)} onStopDownload={download.handleStopDownload} onOpenFolder={handleOpenFolder} onPageChange={setCurrentListPage} onBack={metadata.resetMetadata} onArtistClick={async (artist) => {
                    const pendingArtistUrl = artist.external_urls.replace(/\/$/, "") + "/discography/all";
                    setSpotifyUrl(pendingArtistUrl);
                    const artistUrl = await metadata.handleArtistClick(artist);
                    if (artistUrl) {
                        setSpotifyUrl(artistUrl);
                    }
                }} onTrackClick={async (track) => {
                    if (track.external_urls) {
                        setSpotifyUrl(track.external_urls);
                        await metadata.handleFetchMetadata(track.external_urls);
                    }
                }}/>);
        }
        if ("playlist_info" in metadata.metadata) {
            const { playlist_info, track_list } = metadata.metadata;
            const settings = getSettings();
            const playlistFolderName = buildPlaylistFolderName(playlist_info.owner.name, playlist_info.owner.display_name, settings.playlistOwnerFolderName);
            return (<PlaylistInfo playlistInfo={playlist_info} trackList={track_list} searchQuery={searchQuery} sortBy={sortBy} selectedTracks={selectedTracks} downloadedTracks={download.downloadedTracks} failedTracks={download.failedTracks} skippedTracks={download.skippedTracks} downloadingTrack={download.downloadingTrack} isDownloading={download.isDownloading} bulkDownloadType={download.bulkDownloadType} downloadProgress={download.downloadProgress} downloadRemainingCount={download.downloadRemainingCount} currentDownloadInfo={download.currentDownloadInfo} currentPage={currentListPage} itemsPerPage={ITEMS_PER_PAGE} downloadedLyrics={lyrics.downloadedLyrics} failedLyrics={lyrics.failedLyrics} skippedLyrics={lyrics.skippedLyrics} downloadingLyricsTrack={lyrics.downloadingLyricsTrack} checkingAvailabilityTrack={availability.checkingTrackId} availabilityMap={availability.availabilityMap} downloadedCovers={cover.downloadedCovers} failedCovers={cover.failedCovers} skippedCovers={cover.skippedCovers} downloadingCoverTrack={cover.downloadingCoverTrack} isBulkDownloadingCovers={cover.isBulkDownloadingCovers} isBulkDownloadingLyrics={lyrics.isBulkDownloadingLyrics} isMetadataLoading={metadata.loading} onSearchChange={handleSearchChange} onSortChange={setSortBy} onToggleTrack={toggleTrackSelection} onToggleSelectAll={toggleSelectAll} onSelectTrackRange={selectTrackRange} onDownloadTrack={download.handleDownloadTrack} onDownloadLyrics={(spotifyId, name, artists, albumName, _folderName, _isArtistDiscography, position, albumArtist, releaseDate, discNumber) => lyrics.handleDownloadLyrics(spotifyId, name, artists, albumName, playlistFolderName, position, albumArtist, releaseDate, discNumber)} onDownloadCover={(coverUrl, trackName, artistName, albumName, _folderName, _isArtistDiscography, position, trackId, albumArtist, releaseDate, discNumber) => cover.handleDownloadCover(coverUrl, trackName, artistName, albumName, playlistFolderName, position, trackId, albumArtist, releaseDate, discNumber)} onCheckAvailability={availability.checkAvailability} onDownloadAllLyrics={() => lyrics.handleDownloadAllLyrics(track_list, playlistFolderName)} onDownloadAllCovers={() => cover.handleDownloadAllCovers(track_list, playlistFolderName)} onDownloadAll={() => download.handleDownloadAll(track_list, playlistFolderName)} onDownloadSelected={() => download.handleDownloadSelected(selectedTracks, track_list, playlistFolderName)} onStopDownload={download.handleStopDownload} onOpenFolder={handleOpenFolder} onPageChange={setCurrentListPage} onBack={metadata.resetMetadata} onAlbumClick={metadata.handleAlbumClick} onArtistClick={async (artist) => {
                    const pendingArtistUrl = artist.external_urls.replace(/\/$/, "") + "/discography/all";
                    setSpotifyUrl(pendingArtistUrl);
                    const artistUrl = await metadata.handleArtistClick(artist);
                    if (artistUrl) {
                        setSpotifyUrl(artistUrl);
                    }
                }} onTrackClick={async (track) => {
                    if (track.external_urls) {
                        setSpotifyUrl(track.external_urls);
                        await metadata.handleFetchMetadata(track.external_urls);
                    }
                }}/>);
        }
        if ("artist_info" in metadata.metadata) {
            const { artist_info, album_list, track_list } = metadata.metadata;
            return (<ArtistInfo artistInfo={artist_info} albumList={album_list} trackList={track_list} searchQuery={searchQuery} sortBy={sortBy} selectedTracks={selectedTracks} downloadedTracks={download.downloadedTracks} failedTracks={download.failedTracks} skippedTracks={download.skippedTracks} downloadingTrack={download.downloadingTrack} isDownloading={download.isDownloading} bulkDownloadType={download.bulkDownloadType} downloadProgress={download.downloadProgress} downloadRemainingCount={download.downloadRemainingCount} currentDownloadInfo={download.currentDownloadInfo} currentPage={currentListPage} itemsPerPage={ITEMS_PER_PAGE} downloadedLyrics={lyrics.downloadedLyrics} failedLyrics={lyrics.failedLyrics} skippedLyrics={lyrics.skippedLyrics} downloadingLyricsTrack={lyrics.downloadingLyricsTrack} checkingAvailabilityTrack={availability.checkingTrackId} availabilityMap={availability.availabilityMap} downloadedCovers={cover.downloadedCovers} failedCovers={cover.failedCovers} skippedCovers={cover.skippedCovers} downloadingCoverTrack={cover.downloadingCoverTrack} isBulkDownloadingCovers={cover.isBulkDownloadingCovers} isBulkDownloadingLyrics={lyrics.isBulkDownloadingLyrics} isMetadataLoading={metadata.loading} onSearchChange={handleSearchChange} onSortChange={setSortBy} onToggleTrack={toggleTrackSelection} onToggleSelectAll={toggleSelectAll} onSelectTrackRange={selectTrackRange} onDownloadTrack={download.handleDownloadTrack} onDownloadLyrics={(spotifyId, name, artists, albumName, _folderName, _isArtistDiscography, position, albumArtist, releaseDate, discNumber) => lyrics.handleDownloadLyrics(spotifyId, name, artists, albumName, artist_info.name, position, albumArtist, releaseDate, discNumber)} onDownloadCover={(coverUrl, trackName, artistName, albumName, _folderName, _isArtistDiscography, position, trackId, albumArtist, releaseDate, discNumber) => cover.handleDownloadCover(coverUrl, trackName, artistName, albumName, artist_info.name, position, trackId, albumArtist, releaseDate, discNumber)} onCheckAvailability={availability.checkAvailability} onDownloadAllLyrics={() => lyrics.handleDownloadAllLyrics(track_list, artist_info.name)} onDownloadAllCovers={() => cover.handleDownloadAllCovers(track_list, artist_info.name)} onDownloadAll={() => download.handleDownloadAll(track_list, artist_info.name)} onDownloadSelected={() => download.handleDownloadSelected(selectedTracks, track_list, artist_info.name)} onStopDownload={download.handleStopDownload} onOpenFolder={handleOpenFolder} onAlbumClick={metadata.handleAlbumClick} onBack={metadata.resetMetadata} onArtistClick={async (artist) => {
                    const pendingArtistUrl = artist.external_urls.replace(/\/$/, "") + "/discography/all";
                    setSpotifyUrl(pendingArtistUrl);
                    const artistUrl = await metadata.handleArtistClick(artist);
                    if (artistUrl) {
                        setSpotifyUrl(artistUrl);
                    }
                }} onPageChange={setCurrentListPage} onTrackClick={async (track) => {
                    if (track.external_urls) {
                        setSpotifyUrl(track.external_urls);
                        await metadata.handleFetchMetadata(track.external_urls);
                    }
                }}/>);
        }
        return null;
    };
    const handlePageChange = (page: PageType) => {
        if (currentPage === "settings" && hasUnsavedSettings && page !== "settings") {
            setPendingPageChange(page);
            setShowUnsavedChangesDialog(true);
            return;
        }
        setCurrentPage(page);
    };
    const handleDiscardChanges = () => {
        setShowUnsavedChangesDialog(false);
        if (resetSettingsFn) {
            resetSettingsFn();
        }
        const savedSettings = getSettings();
        applyThemeMode(savedSettings.themeMode);
        applyTheme(savedSettings.theme);
        applyFont(savedSettings.fontFamily, savedSettings.customFonts);
        if (pendingPageChange) {
            setCurrentPage(pendingPageChange);
            setPendingPageChange(null);
        }
    };
    const handleCancelNavigation = () => {
        setShowUnsavedChangesDialog(false);
        setPendingPageChange(null);
    };
    const renderPage = () => {
        switch (currentPage) {
            case "settings":
                return <SettingsPage onUnsavedChangesChange={setHasUnsavedSettings} onResetRequest={setResetSettingsFn}/>;
            case "debug":
                return <DebugLoggerPage />;
            case "projects":
                return <OtherProjects />;
            case "support":
                return <SupportPage />;
            case "history":
                return <HistoryPage onHistorySelect={(cachedData) => {
                        metadata.loadFromCache(cachedData);
                        setCurrentPage("main");
                    }}/>;
            case "audio-analysis":
                return <AudioAnalysisPage />;
            case "audio-converter":
                return <AudioConverterPage />;
            case "audio-resampler":
                return <AudioResamplerPage />;
            case "file-manager":
                return <FileManagerPage />;
            case "lyrics-manager":
                return <LyricsManagerPage />;
            default:
                return (<>
                    <Header version={CURRENT_VERSION} hasUpdate={hasUpdate} releaseDate={releaseDate}/>




                    <Dialog open={metadata.showAlbumDialog} onOpenChange={metadata.setShowAlbumDialog}>
                        <DialogContent className="sm:max-w-106.25 p-6 [&>button]:hidden">
                            <div className="absolute right-4 top-4">
                                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-70 hover:opacity-100" onClick={() => metadata.setShowAlbumDialog(false)}>
                                    <X className="h-4 w-4"/>
                                </Button>
                            </div>
                            <DialogTitle className="text-sm font-medium">Fetch Album</DialogTitle>
                            <DialogDescription>
                                Do you want to fetch metadata for this album?
                            </DialogDescription>
                            {metadata.selectedAlbum && (<div className="py-2">
                                <p className="font-medium bg-muted/50 rounded-md px-3 py-2">{metadata.selectedAlbum.name}</p>
                            </div>)}
                            <DialogFooter>
                                <Button variant="outline" onClick={() => metadata.setShowAlbumDialog(false)}>
                                    Cancel
                                </Button>
                                <Button onClick={async () => {
                        const pendingAlbumUrl = metadata.selectedAlbum?.external_urls;
                        if (pendingAlbumUrl) {
                            setSpotifyUrl(pendingAlbumUrl);
                        }
                        const albumUrl = await metadata.handleConfirmAlbumFetch();
                        if (albumUrl) {
                            setSpotifyUrl(albumUrl);
                        }
                    }}>
                                    <CloudDownload className="h-4 w-4"/>
                                    Fetch Album
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <SearchBar url={smartSearchInput} loading={metadata.loading} onUrlChange={setSmartSearchInput} onFetch={handleFetchMetadata} onFetchUrl={async (url) => {
                        setSmartSearchInput(url);
                        setSpotifyUrl(url);
                        const updatedUrl = await metadata.handleFetchMetadata(url);
                        if (updatedUrl) {
                            setSpotifyUrl(updatedUrl);
                            setSmartSearchInput(updatedUrl);
                        }
                    }} history={fetchHistory} onHistorySelect={handleHistorySelect} onHistoryRemove={removeFromHistory} hasResult={!!metadata.metadata} onSearchModeChange={setIsSearchMode}/>

                    {!isSearchMode && metadata.metadata && renderMetadata()}
                </>);
        }
    };
    const usesWideContent = currentPage === "main"
        ? isSearchMode || !!metadata.metadata
        : !["settings", "projects", "support"].includes(currentPage);
    return (<TooltipProvider>
        <div className="h-screen overflow-hidden bg-background">
            <TitleBar />
            <Sidebar currentPage={currentPage} onPageChange={handlePageChange}/>


            <div ref={contentScrollRef} className="fixed top-10 right-0 bottom-0 left-14 overflow-y-auto overflow-x-hidden">
                <div className="p-4 md:p-8">
                    <div className={`${usesWideContent ? "w-full" : "max-w-4xl mx-auto"} space-y-6`}>
                        {renderPage()}
                    </div>
                </div>
            </div>


            <DownloadProgressToast onClick={downloadQueue.openQueue}/>

            <CooldownBanner />


            <DownloadQueue isOpen={downloadQueue.isOpen} onClose={downloadQueue.closeQueue}/>


            {showScrollTop && (<Button onClick={scrollToTop} className="fixed bottom-6 right-6 z-50 h-10 w-10 rounded-full shadow-lg" size="icon">
                <ArrowUp className="h-5 w-5"/>
            </Button>)}


            <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
              <DialogContent className="sm:max-w-125 [&>button]:hidden">
                <DialogHeader>
                  <DialogTitle>Update Available</DialogTitle>
                  <DialogDescription>
                    A new version{updateInfo ? ` (v${updateInfo.version})` : ""} is available. You're on v{CURRENT_VERSION}.
                  </DialogDescription>
                </DialogHeader>
                {updateInfo?.changelog ? (<div className="max-h-72 overflow-y-auto rounded-md border bg-muted/40 p-3 custom-scrollbar">
                    <MarkdownLite content={updateInfo.changelog}/>
                  </div>) : (<p className="text-sm text-muted-foreground">No changelog provided for this release.</p>)}
                <DialogFooter className="gap-2 sm:justify-between">
                  <Button variant="ghost" onClick={() => {
            if (updateInfo) {
                localStorage.setItem("spotiflac_update_dismissed_version", updateInfo.version);
            }
            setShowUpdateDialog(false);
        }}>
                    Don't Show
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowUpdateDialog(false)}>
                      Download Later
                    </Button>
                    <Button onClick={() => {
            if (updateInfo) {
                openExternal(updateInfo.url);
            }
            setShowUpdateDialog(false);
        }}>
                      Download Now
                    </Button>
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={showUnsavedChangesDialog} onOpenChange={setShowUnsavedChangesDialog}>
                <DialogContent className="sm:max-w-106.25 [&>button]:hidden">
                    <DialogHeader>
                        <DialogTitle>Unsaved Changes</DialogTitle>
                        <DialogDescription>
                            You have unsaved changes in Settings. Are you sure you want to leave? Your changes will be lost.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={handleCancelNavigation}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDiscardChanges}>
                            Discard Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={metadata.showVpnAdviceDialog} onOpenChange={metadata.setShowVpnAdviceDialog}>
                <DialogContent className="max-w-md [&>button]:hidden">
                    <DialogHeader>
                        <DialogTitle>Fetch Failed</DialogTitle>
                        <DialogDescription className="space-y-3">
                            <span className="block">
                                Metadata fetch failed. Try using a high-quality VPN such as
                                Surfshark, ExpressVPN, Proton VPN, or a similar service.
                            </span>
                            <span className="block">
                                Choose a location that is not blocked by Spotify or the
                                related service, such as the USA, UK, Germany, Netherlands,
                                or Singapore.
                            </span>
                            <span className="block">
                                If you are already using a VPN, try switching to another
                                server and fetch again.
                            </span>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={() => metadata.setShowVpnAdviceDialog(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isFFmpegInstalled === false} onOpenChange={() => { }}>
                <DialogContent className="max-w-112.5 [&>button]:hidden p-6 gap-5">
                    <DialogHeader className="space-y-2">
                        <DialogTitle className="text-lg font-bold tracking-tight">
                            FFmpeg Required
                        </DialogTitle>
                        <DialogDescription className="text-sm text-foreground/70 leading-relaxed font-normal">
                            SpotiFLAC checks your system for FFmpeg and FFprobe first.
                            If they are not available, the required binaries will be downloaded from GitHub.
                            This setup downloads about <span className="text-foreground font-semibold">30-40MB</span> of data.
                        </DialogDescription>
                    </DialogHeader>

                    {isInstallingFFmpeg && (<div className="space-y-4">
                            {ffmpegInstallStatus === "extracting" ? (<div className="flex flex-col items-center justify-center py-2 animate-in fade-in duration-500">
                                    <div className="flex items-center gap-3">
                                        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
                                        <span className="text-sm font-bold tracking-tight">Extracting...</span>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] font-bold mt-2">Finalizing setup</span>
                                </div>) : (<div className="space-y-3">
                                    <div className="flex justify-between text-[11px] font-bold">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-muted-foreground uppercase tracking-wider">Downloading...</span>
                                            {downloadProgress.is_downloading && downloadProgress.mb_downloaded > 0 && (<span className="text-primary font-mono tabular-nums">
                                                    {downloadProgress.mb_downloaded.toFixed(1)}MB
                                                    {downloadProgress.speed_mbps > 0 && ` @ ${downloadProgress.speed_mbps.toFixed(1)}MB/s`}
                                                </span>)}
                                        </div>
                                        <span className="text-xl font-bold tracking-tighter text-primary">{ffmpegInstallProgress}%</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-secondary/30 rounded-full overflow-hidden">
                                        <div className="h-full bg-primary transition-all duration-300 shadow-[0_0_10px_rgba(var(--primary),0.3)]" style={{ width: `${ffmpegInstallProgress}%` }}/>
                                    </div>
                                </div>)}
                        </div>)}

                    <DialogFooter className="flex-row gap-3 pt-2">
                        {!isInstallingFFmpeg && (<Button variant="outline" className="flex-1 h-11 text-sm font-bold transition-colors" onClick={() => Quit()}>
                                Exit
                            </Button>)}
                        <Button className={`${isInstallingFFmpeg ? 'w-full' : 'flex-1'} h-11 text-sm font-bold shadow-lg shadow-primary/10`} onClick={handleInstallFFmpeg} disabled={isInstallingFFmpeg}>
                                {isInstallingFFmpeg ? "Installing..." : "Install now"}
                            </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    </TooltipProvider>);
}
export default App;
