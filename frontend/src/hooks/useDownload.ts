import { useState, useRef } from "react";
import { downloadTrack, fetchSpotifyMetadata } from "@/lib/api";
import { getSettings, parseTemplate, sanitizeAutoOrder, getEffectiveAlbumFilenameTemplate, templateUsesAlbumTrackNumber, getAlbumCategoryLabel, type TemplateData } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath, getFirstArtist } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { TrackMetadata } from "@/types/api";
function isCooldownMessage(message?: string): boolean {
    if (!message)
        return false;
    const lower = message.toLowerCase();
    return lower.includes("short break") || lower.includes("scheduled") || lower.includes("cooldown");
}
function getCooldownFailure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return isCooldownMessage(message) ? { success: false, error: message } : null;
}
function formatSourceSuffix(response: {
    source_url?: string;
    source_label?: string;
}): string {
    const url = response.source_url?.trim();
    const label = response.source_label?.trim();
    if (label && url)
        return ` [source: ${label} → ${url}]`;
    if (url)
        return ` [source: ${url}]`;
    if (label)
        return ` [source: ${label}]`;
    return "";
}
interface CheckFileExistenceRequest {
    spotify_id: string;
    track_name: string;
    artist_name: string;
    album_name?: string;
    album_artist?: string;
    release_date?: string;
    isrc?: string;
    track_number?: number;
    disc_number?: number;
    position?: number;
    use_album_track_number?: boolean;
    filename_format?: string;
    include_track_number?: boolean;
    audio_format?: string;
    relative_path?: string;
}
interface FileExistenceResult {
    spotify_id: string;
    exists: boolean;
    file_path?: string;
    track_name?: string;
    artist_name?: string;
}
const CheckFilesExistence = (outputDir: string, rootDir: string, tracks: CheckFileExistenceRequest[]): Promise<FileExistenceResult[]> => (window as any)["go"]["main"]["App"]["CheckFilesExistence"](outputDir, rootDir, tracks);
const SkipDownloadItem = (itemID: string, filePath: string): Promise<void> => (window as any)["go"]["main"]["App"]["SkipDownloadItem"](itemID, filePath);
const CreateM3U8File = (playlistName: string, outputDir: string, filePaths: string[]): Promise<void> => (window as any)["go"]["main"]["App"]["CreateM3U8File"](playlistName, outputDir, filePaths);
const CreateLogFile = (fileName: string, outputDir: string, logs: string[]): Promise<void> => (window as any)["go"]["main"]["App"]["CreateLogFile"](fileName, outputDir, logs);
const GetTrackISRC = (spotifyId: string): Promise<string> => (window as any)["go"]["main"]["App"]["GetTrackISRC"](spotifyId);
async function resolveTemplateISRC(settings: {
    folderTemplate?: string;
    filenameTemplate?: string;
    existingFileCheckMode?: string;
}, spotifyId?: string): Promise<string> {
    if (!spotifyId) {
        return "";
    }
    const folderTemplate = settings.folderTemplate || "";
    const filenameTemplate = settings.filenameTemplate || "";
    const shouldResolveISRC = settings.existingFileCheckMode === "isrc" ||
        folderTemplate.includes("{isrc}") ||
        filenameTemplate.includes("{isrc}");
    if (!shouldResolveISRC) {
        return "";
    }
    try {
        return await GetTrackISRC(spotifyId);
    }
    catch {
        return "";
    }
}
function getTidalAudioFormat(settings: any, mode: "single" | "auto"): "LOSSLESS" | "HI_RES_LOSSLESS" | "ATMOS" {
    if (mode === "auto") {
        if (settings.autoQuality === "atmos")
            return "ATMOS";
        return (settings.autoQuality || "24") === "24" ? "HI_RES_LOSSLESS" : "LOSSLESS";
    }
    return settings.tidalQuality || "LOSSLESS";
}
function shouldFetchStreamingURLs(order: string[]): boolean {
    return order.includes("amazon") || order.includes("tidal");
}
function getCustomInstanceFields(tidalApi?: string, qobuzApi?: string) {
    return {
        ...(tidalApi ? { tidal_api_url: tidalApi } : {}),
        ...(qobuzApi ? { qobuz_api_url: qobuzApi } : {}),
    };
}
export function useDownload() {
    const [downloadProgress, setDownloadProgress] = useState<number>(0);
    const [downloadRemainingCount, setDownloadRemainingCount] = useState<number>(0);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadingTrack, setDownloadingTrack] = useState<string | null>(null);
    const [bulkDownloadType, setBulkDownloadType] = useState<"all" | "selected" | null>(null);
    const [downloadedTracks, setDownloadedTracks] = useState<Set<string>>(new Set());
    const [failedTracks, setFailedTracks] = useState<Set<string>>(new Set());
    const [skippedTracks, setSkippedTracks] = useState<Set<string>>(new Set());
    const [currentDownloadInfo, setCurrentDownloadInfo] = useState<{
        name: string;
        artists: string;
    } | null>(null);
    const shouldStopDownloadRef = useRef(false);
    const updateBatchProgress = (completedCount: number, totalCount: number) => {
        const safeTotalCount = Math.max(0, totalCount);
        const safeCompletedCount = Math.min(Math.max(0, completedCount), safeTotalCount);
        setDownloadProgress(safeTotalCount > 0 ? Math.min(100, Math.round((safeCompletedCount / safeTotalCount) * 100)) : 0);
        setDownloadRemainingCount(Math.max(0, safeTotalCount - safeCompletedCount));
    };
    const downloadWithAutoFallback = async (id: string, settings: any, trackName?: string, artistName?: string, albumName?: string, playlistName?: string, position?: number, spotifyId?: string, durationMs?: number, releaseYear?: string, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string) => {
        const service = settings.downloader;
        const query = trackName && artistName ? `${trackName} ${artistName} ` : undefined;
        const os = settings.operatingSystem;
        const customTidalApi = typeof settings.customTidalApi === "string" && settings.customTidalApi.trim().startsWith("https://")
            ? settings.customTidalApi.trim().replace(/\/+$/g, "")
            : undefined;
        const customQobuzApi = typeof settings.customQobuzApi === "string" && settings.customQobuzApi.trim().startsWith("https://")
            ? settings.customQobuzApi.trim().replace(/\/+$/g, "")
            : undefined;
        let outputDir = settings.downloadPath;
        let useAlbumTrackNumber = false;
        const placeholder = "__SLASH_PLACEHOLDER__";
        let finalReleaseDate = releaseDate;
        let finalTrackNumber = spotifyTrackNumber || 0;
        let finalAlbumType = "";
        let finalUPC = "";
        if (spotifyId) {
            try {
                const trackURL = `https://open.spotify.com/track/${spotifyId}`;
                const trackMetadata = await fetchSpotifyMetadata(trackURL, false, 0, 10);
                if ("track" in trackMetadata && trackMetadata.track) {
                    if (trackMetadata.track.release_date) {
                        finalReleaseDate = trackMetadata.track.release_date;
                    }
                    if (trackMetadata.track.track_number > 0) {
                        finalTrackNumber = trackMetadata.track.track_number;
                    }
                    if (trackMetadata.track.album_type) {
                        finalAlbumType = trackMetadata.track.album_type;
                    }
                    if (trackMetadata.track.upc) {
                        finalUPC = trackMetadata.track.upc;
                    }
                }
            }
            catch (err) {
            }
        }
        const yearValue = releaseYear || finalReleaseDate?.substring(0, 4);
        const hasSubfolder = settings.folderTemplate && settings.folderTemplate.trim() !== "" && settings.applyFolderToSingleTrack;
        const trackNumberForTemplate = (hasSubfolder && finalTrackNumber > 0) ? finalTrackNumber : (position || 0);
        if (hasSubfolder) {
            useAlbumTrackNumber = true;
        }
        const displayArtist = settings.useFirstArtistOnly && artistName
            ? getFirstArtist(artistName)
            : artistName;
        const displayAlbumArtist = settings.useFirstArtistOnly && albumArtist
            ? getFirstArtist(albumArtist)
            : albumArtist;
        const namingArtist = artistName ? getFirstArtist(artistName) : artistName;
        const namingAlbumArtist = albumArtist ? getFirstArtist(albumArtist) : albumArtist;
        const resolvedTemplateISRC = await resolveTemplateISRC(settings, spotifyId || id);
        const templateData: TemplateData = {
            artist: namingArtist?.replace(/\//g, placeholder),
            artists: artistName?.replace(/\//g, placeholder),
            album: albumName?.replace(/\//g, placeholder),
            album_artist: namingAlbumArtist?.replace(/\//g, placeholder) || namingArtist?.replace(/\//g, placeholder),
            title: trackName?.replace(/\//g, placeholder),
            isrc: resolvedTemplateISRC?.replace(/\//g, placeholder),
            track: trackNumberForTemplate,
            total_tracks: spotifyTotalTracks,
            total_discs: spotifyTotalDiscs,
            year: yearValue,
            date: releaseDate,
            playlist: playlistName?.replace(/\//g, placeholder),
        };
        const folderTemplate = settings.folderTemplate || "";
        const useAlbumSubfolder = folderTemplate.includes("{album}") || folderTemplate.includes("{album_artist}") || folderTemplate.includes("{playlist}");
        if (settings.createPlaylistFolder && playlistName && !useAlbumSubfolder) {
            outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
        }
        if (settings.folderTemplate && settings.applyFolderToSingleTrack) {
            const folderPath = parseTemplate(settings.folderTemplate, templateData);
            if (folderPath) {
                const parts = folderPath.split("/").filter((p: string) => p.trim());
                for (const part of parts) {
                    const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
                    outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
                }
            }
        }
        const serviceForCheck = service === "auto" ? "flac" : (service === "tidal" ? "flac" : (service === "qobuz" ? "flac" : "flac"));
        let fileExists = false;
        if (trackName && artistName) {
            try {
                const checkRequest: CheckFileExistenceRequest = {
                    spotify_id: spotifyId || id,
                    track_name: trackName,
                    artist_name: displayArtist || "",
                    album_name: albumName,
                    album_artist: displayAlbumArtist,
                    release_date: finalReleaseDate || releaseDate,
                    isrc: resolvedTemplateISRC || undefined,
                    track_number: finalTrackNumber || spotifyTrackNumber || 0,
                    disc_number: spotifyDiscNumber || 0,
                    position: trackNumberForTemplate,
                    use_album_track_number: useAlbumTrackNumber,
                    filename_format: settings.filenameTemplate || "",
                    include_track_number: settings.trackNumber || false,
                    audio_format: serviceForCheck,
                };
                const existenceResults = await CheckFilesExistence(outputDir, settings.downloadPath, [checkRequest]);
                if (existenceResults.length > 0 && existenceResults[0].exists) {
                    fileExists = true;
                    return {
                        success: true,
                        message: "File already exists",
                        file: existenceResults[0].file_path || "",
                        already_exists: true,
                    };
                }
            }
            catch (err) {
                console.warn("File existence check failed:", err);
            }
        }
        const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
        let itemID: string | undefined;
        if (!fileExists) {
            itemID = await AddToDownloadQueue(id, trackName || "", displayArtist || "", albumName || "");
        }
        if (service === "auto") {
            const order = sanitizeAutoOrder(settings.autoOrder).split("-");
            let streamingURLs: any = null;
            if (spotifyId && shouldFetchStreamingURLs(order)) {
                try {
                    const { GetStreamingURLs } = await import("../../wailsjs/go/main/App");
                    const urlsJson = await GetStreamingURLs(spotifyId, "");
                    streamingURLs = JSON.parse(urlsJson);
                }
                catch (err) {
                    console.error("Failed to get streaming URLs:", err);
                }
            }
            const durationSeconds = durationMs ? Math.round(durationMs / 1000) : undefined;
            let lastResponse: any = { success: false, error: "No matching services found" };
            const fallbackErrors: string[] = [];
            const tidalQuality = getTidalAudioFormat(settings, "auto");
            const isAtmos = settings.autoQuality === "atmos";
            const is24Bit = (settings.autoQuality || "24") === "24";
            const qobuzQuality = is24Bit ? "27" : "6";
            for (const s of order) {
                if (s === "tidal" && streamingURLs?.tidal_url) {
                    try {
                        logger.debug(`trying Tidal for: ${trackName} - ${artistName}`);
                        const response = await downloadTrack({
                            service: "tidal",
                            query,
                            track_name: trackName,
                            artist_name: displayArtist,
                            album_name: albumName,
                            album_artist: displayAlbumArtist,
                            release_date: finalReleaseDate || releaseDate,
                            cover_url: coverUrl,
                            output_dir: outputDir,
                            filename_format: settings.filenameTemplate,
                            artists: artistName,
                            category: getAlbumCategoryLabel(finalAlbumType),
                            upc: finalUPC,
                            track_number: settings.trackNumber,
                            position,
                            use_album_track_number: useAlbumTrackNumber,
                            spotify_id: spotifyId,
                            embed_lyrics: settings.embedLyrics,
                            embed_max_quality_cover: settings.embedMaxQualityCover,
                            service_url: streamingURLs?.tidal_url,
                            duration: durationSeconds,
                            item_id: itemID,
                            audio_format: tidalQuality,
                            ...getCustomInstanceFields(customTidalApi),
                            spotify_track_number: spotifyTrackNumber,
                            spotify_disc_number: spotifyDiscNumber,
                            spotify_total_tracks: spotifyTotalTracks,
                            spotify_total_discs: spotifyTotalDiscs,
                            isrc: resolvedTemplateISRC || undefined,
                            copyright: copyright,
                            publisher: publisher,
                            use_first_artist_only: settings.useFirstArtistOnly,
                            use_single_genre: settings.useSingleGenre,
                            embed_genre: settings.embedGenre,
                            save_cover: settings.saveCover,
                        });
                        if (response.success) {
                            logger.success(`Tidal: ${trackName} - ${artistName}${formatSourceSuffix(response)}`);
                            return response;
                        }
                        const errMsg = response.error || response.message || "Failed";
                        if (isCooldownMessage(errMsg))
                            return response;
                        fallbackErrors.push(`[Tidal] ${errMsg}`);
                        lastResponse = response;
                        logger.warning(`Tidal failed, trying next...`);
                    }
                    catch (err) {
                        logger.error(`Tidal error: ${err}`);
                        const cooldownFailure = getCooldownFailure(err);
                        if (cooldownFailure)
                            return cooldownFailure;
                        fallbackErrors.push(`[Tidal] ${String(err)}`);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
                else if (s === "amazon" && streamingURLs?.amazon_url) {
                    try {
                        logger.debug(`trying amazon for: ${trackName} - ${artistName}`);
                        const response = await downloadTrack({
                            service: "amazon",
                            query,
                            track_name: trackName,
                            artist_name: displayArtist,
                            album_name: albumName,
                            album_artist: displayAlbumArtist,
                            release_date: finalReleaseDate || releaseDate,
                            cover_url: coverUrl,
                            output_dir: outputDir,
                            filename_format: settings.filenameTemplate,
                            artists: artistName,
                            category: getAlbumCategoryLabel(finalAlbumType),
                            upc: finalUPC,
                            track_number: settings.trackNumber,
                            position,
                            use_album_track_number: useAlbumTrackNumber,
                            spotify_id: spotifyId,
                            embed_lyrics: settings.embedLyrics,
                            embed_max_quality_cover: settings.embedMaxQualityCover,
                            service_url: streamingURLs.amazon_url,
                            item_id: itemID,
                            audio_format: isAtmos ? "atmos" : (is24Bit ? "24" : "16"),
                            spotify_track_number: spotifyTrackNumber,
                            spotify_disc_number: spotifyDiscNumber,
                            spotify_total_tracks: spotifyTotalTracks,
                            spotify_total_discs: spotifyTotalDiscs,
                            isrc: resolvedTemplateISRC || undefined,
                            copyright: copyright,
                            publisher: publisher,
                            use_single_genre: settings.useSingleGenre,
                            embed_genre: settings.embedGenre,
                            save_cover: settings.saveCover,
                        });
                        if (response.success) {
                            logger.success(`amazon: ${trackName} - ${artistName}${formatSourceSuffix(response)}`);
                            return response;
                        }
                        const errMsg = response.error || response.message || "Failed";
                        if (isCooldownMessage(errMsg))
                            return response;
                        fallbackErrors.push(`[Amazon] ${errMsg}`);
                        lastResponse = response;
                        logger.warning(`amazon failed, trying next...`);
                    }
                    catch (err) {
                        logger.error(`amazon error: ${err}`);
                        const cooldownFailure = getCooldownFailure(err);
                        if (cooldownFailure)
                            return cooldownFailure;
                        fallbackErrors.push(`[Amazon] ${String(err)}`);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
                else if (s === "qobuz") {
                    try {
                        logger.debug(`trying qobuz for: ${trackName} - ${artistName}`);
                        const response = await downloadTrack({
                            service: "qobuz",
                            query,
                            track_name: trackName,
                            artist_name: displayArtist,
                            album_name: albumName,
                            album_artist: displayAlbumArtist,
                            release_date: finalReleaseDate || releaseDate,
                            cover_url: coverUrl,
                            output_dir: outputDir,
                            filename_format: settings.filenameTemplate,
                            artists: artistName,
                            category: getAlbumCategoryLabel(finalAlbumType),
                            upc: finalUPC,
                            track_number: settings.trackNumber,
                            position: trackNumberForTemplate,
                            use_album_track_number: useAlbumTrackNumber,
                            spotify_id: spotifyId,
                            embed_lyrics: settings.embedLyrics,
                            embed_max_quality_cover: settings.embedMaxQualityCover,
                            item_id: itemID,
                            audio_format: qobuzQuality,
                            ...getCustomInstanceFields(undefined, customQobuzApi),
                            spotify_track_number: spotifyTrackNumber,
                            spotify_disc_number: spotifyDiscNumber,
                            spotify_total_tracks: spotifyTotalTracks,
                            spotify_total_discs: spotifyTotalDiscs,
                            isrc: resolvedTemplateISRC || undefined,
                            copyright: copyright,
                            publisher: publisher,
                            use_single_genre: settings.useSingleGenre,
                            embed_genre: settings.embedGenre,
                            save_cover: settings.saveCover,
                        });
                        if (response.success) {
                            logger.success(`qobuz: ${trackName} - ${artistName}${formatSourceSuffix(response)}`);
                            return response;
                        }
                        const errMsg = response.error || response.message || "Failed";
                        if (isCooldownMessage(errMsg))
                            return response;
                        fallbackErrors.push(`[Qobuz] ${errMsg}`);
                        lastResponse = response;
                        logger.warning(`qobuz failed, trying next...`);
                    }
                    catch (err) {
                        logger.error(`qobuz error: ${err}`);
                        const cooldownFailure = getCooldownFailure(err);
                        if (cooldownFailure)
                            return cooldownFailure;
                        fallbackErrors.push(`[Qobuz] ${String(err)}`);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
            }
            if (itemID) {
                const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
                const finalError = fallbackErrors.length > 0 ? fallbackErrors.join(" | ") : (lastResponse.error || "All services failed");
                await MarkDownloadItemFailed(itemID, finalError);
            }
            return lastResponse;
        }
        const durationSecondsForFallback = durationMs ? Math.round(durationMs / 1000) : undefined;
        let audioFormat: string | undefined;
        if (service === "tidal") {
            audioFormat = getTidalAudioFormat(settings, "single");
        }
        else if (service === "qobuz") {
            audioFormat = settings.qobuzQuality || "6";
        }
        else if (service === "amazon") {
            audioFormat = settings.amazonQuality || "16";
        }
        else if (service === "deezer") {
            audioFormat = "flac";
        }
        logger.debug(`trying ${service} for: ${trackName} - ${artistName}`);
        const singleServiceResponse = await downloadTrack({
            service: service as "tidal" | "qobuz" | "amazon",
            query,
            track_name: trackName,
            artist_name: displayArtist,
            album_name: albumName,
            album_artist: displayAlbumArtist,
            release_date: finalReleaseDate || releaseDate,
            cover_url: coverUrl,
            output_dir: outputDir,
            filename_format: settings.filenameTemplate,
            artists: artistName,
            category: getAlbumCategoryLabel(finalAlbumType),
            upc: finalUPC,
            track_number: settings.trackNumber,
            position: trackNumberForTemplate,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            embed_lyrics: settings.embedLyrics,
            embed_max_quality_cover: settings.embedMaxQualityCover,
            duration: durationSecondsForFallback,
            item_id: itemID,
            audio_format: audioFormat,
            ...getCustomInstanceFields(service === "tidal" ? customTidalApi : undefined, service === "qobuz" ? customQobuzApi : undefined),
            spotify_track_number: spotifyTrackNumber,
            spotify_disc_number: spotifyDiscNumber,
            spotify_total_tracks: spotifyTotalTracks,
            spotify_total_discs: spotifyTotalDiscs,
            isrc: resolvedTemplateISRC || undefined,
            copyright: copyright,
            publisher: publisher,
            use_first_artist_only: settings.useFirstArtistOnly,
            use_single_genre: settings.useSingleGenre,
            embed_genre: settings.embedGenre,
        });
        if (!singleServiceResponse.success && itemID) {
            const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
            await MarkDownloadItemFailed(itemID, singleServiceResponse.error || "Download failed");
        }
        return singleServiceResponse;
    };
    const downloadWithItemID = async (settings: any, itemID: string, trackName?: string, artistName?: string, albumName?: string, folderName?: string, position?: number, spotifyId?: string, durationMs?: number, isAlbum?: boolean, releaseYear?: string, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string) => {
        settings = { ...settings, filenameTemplate: getEffectiveAlbumFilenameTemplate(settings) };
        const service = settings.downloader;
        const query = trackName && artistName ? `${trackName} ${artistName}` : undefined;
        const os = settings.operatingSystem;
        const customTidalApi = typeof settings.customTidalApi === "string" && settings.customTidalApi.trim().startsWith("https://")
            ? settings.customTidalApi.trim().replace(/\/+$/g, "")
            : undefined;
        const customQobuzApi = typeof settings.customQobuzApi === "string" && settings.customQobuzApi.trim().startsWith("https://")
            ? settings.customQobuzApi.trim().replace(/\/+$/g, "")
            : undefined;
        let outputDir = settings.downloadPath;
        let useAlbumTrackNumber = false;
        const placeholder = "__SLASH_PLACEHOLDER__";
        let finalReleaseDate = releaseDate;
        let finalTrackNumber = spotifyTrackNumber || 0;
        let finalAlbumType = "";
        let finalUPC = "";
        if (spotifyId) {
            try {
                const trackURL = `https://open.spotify.com/track/${spotifyId}`;
                const trackMetadata = await fetchSpotifyMetadata(trackURL, false, 0, 10);
                if ("track" in trackMetadata && trackMetadata.track) {
                    if (trackMetadata.track.release_date) {
                        finalReleaseDate = trackMetadata.track.release_date;
                    }
                    if (trackMetadata.track.track_number > 0) {
                        finalTrackNumber = trackMetadata.track.track_number;
                    }
                    if (trackMetadata.track.album_type) {
                        finalAlbumType = trackMetadata.track.album_type;
                    }
                    if (trackMetadata.track.upc) {
                        finalUPC = trackMetadata.track.upc;
                    }
                }
            }
            catch (err) {
            }
        }
        const yearValue = releaseYear || finalReleaseDate?.substring(0, 4);
        const hasSubfolder = settings.folderTemplate && settings.folderTemplate.trim() !== "";
        const trackNumberForTemplate = (hasSubfolder && finalTrackNumber > 0) ? finalTrackNumber : (position || 0);
        const displayArtist = settings.useFirstArtistOnly && artistName
            ? getFirstArtist(artistName)
            : artistName;
        const displayAlbumArtist = settings.useFirstArtistOnly && albumArtist
            ? getFirstArtist(albumArtist)
            : albumArtist;
        const namingArtist = artistName ? getFirstArtist(artistName) : artistName;
        const namingAlbumArtist = albumArtist ? getFirstArtist(albumArtist) : albumArtist;
        const resolvedTemplateISRC = await resolveTemplateISRC(settings, spotifyId);
        const templateData: TemplateData = {
            artist: namingArtist?.replace(/\//g, placeholder),
            artists: artistName?.replace(/\//g, placeholder),
            album: albumName?.replace(/\//g, placeholder),
            album_artist: namingAlbumArtist?.replace(/\//g, placeholder) || namingArtist?.replace(/\//g, placeholder),
            title: trackName?.replace(/\//g, placeholder),
            isrc: resolvedTemplateISRC?.replace(/\//g, placeholder),
            track: trackNumberForTemplate,
            total_tracks: spotifyTotalTracks,
            total_discs: spotifyTotalDiscs,
            year: yearValue,
            date: releaseDate,
            playlist: folderName?.replace(/\//g, placeholder),
        };
        const folderTemplate = settings.folderTemplate || "";
        const useAlbumSubfolder = folderTemplate.includes("{album}") || folderTemplate.includes("{album_artist}") || folderTemplate.includes("{playlist}");
        if (settings.createPlaylistFolder && folderName && (!isAlbum || !useAlbumSubfolder)) {
            outputDir = joinPath(os, outputDir, sanitizePath(folderName.replace(/\//g, " "), os));
        }
        if (settings.folderTemplate) {
            const folderPath = parseTemplate(settings.folderTemplate, templateData);
            if (folderPath) {
                const parts = folderPath.split("/").filter(p => p.trim());
                for (const part of parts) {
                    const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
                    outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
                }
            }
        }
        if (service === "auto") {
            const order = sanitizeAutoOrder(settings.autoOrder).split("-");
            let streamingURLs: any = null;
            if (spotifyId && shouldFetchStreamingURLs(order)) {
                try {
                    const { GetStreamingURLs } = await import("../../wailsjs/go/main/App");
                    const urlsJson = await GetStreamingURLs(spotifyId, "");
                    streamingURLs = JSON.parse(urlsJson);
                }
                catch (err) {
                    console.error("Failed to get streaming URLs:", err);
                }
            }
            const durationSeconds = durationMs ? Math.round(durationMs / 1000) : undefined;
            let lastResponse: any = { success: false, error: "No matching services found" };
            const fallbackErrors: string[] = [];
            const tidalQuality = getTidalAudioFormat(settings, "auto");
            const isAtmos = settings.autoQuality === "atmos";
            const is24Bit = (settings.autoQuality || "24") === "24";
            const qobuzQuality = is24Bit ? "27" : "6";
            for (const s of order) {
                if (s === "tidal" && streamingURLs?.tidal_url) {
                    try {
                        logger.debug(`trying Tidal for: ${trackName} - ${artistName}`);
                        const response = await downloadTrack({
                            service: "tidal",
                            query,
                            track_name: trackName,
                            artist_name: displayArtist,
                            album_name: albumName,
                            album_artist: displayAlbumArtist,
                            release_date: finalReleaseDate || releaseDate,
                            cover_url: coverUrl,
                            output_dir: outputDir,
                            filename_format: settings.filenameTemplate,
                            artists: artistName,
                            category: getAlbumCategoryLabel(finalAlbumType),
                            upc: finalUPC,
                            track_number: settings.trackNumber,
                            position,
                            use_album_track_number: useAlbumTrackNumber,
                            spotify_id: spotifyId,
                            embed_lyrics: settings.embedLyrics,
                            embed_max_quality_cover: settings.embedMaxQualityCover,
                            service_url: streamingURLs?.tidal_url,
                            duration: durationSeconds,
                            item_id: itemID,
                            audio_format: tidalQuality,
                            ...getCustomInstanceFields(customTidalApi),
                            spotify_track_number: spotifyTrackNumber,
                            spotify_disc_number: spotifyDiscNumber,
                            spotify_total_tracks: spotifyTotalTracks,
                            spotify_total_discs: spotifyTotalDiscs,
                            isrc: resolvedTemplateISRC || undefined,
                            copyright: copyright,
                            publisher: publisher,
                            use_first_artist_only: settings.useFirstArtistOnly,
                            use_single_genre: settings.useSingleGenre,
                            embed_genre: settings.embedGenre,
                            save_cover: settings.saveCover,
                        });
                        if (response.success) {
                            logger.success(`Tidal: ${trackName} - ${artistName}${formatSourceSuffix(response)}`);
                            return response;
                        }
                        const errMsg = response.error || response.message || "Failed";
                        if (isCooldownMessage(errMsg))
                            return response;
                        fallbackErrors.push(`[Tidal] ${errMsg}`);
                        lastResponse = response;
                        logger.warning(`Tidal failed, trying next...`);
                    }
                    catch (err) {
                        logger.error(`Tidal error: ${err}`);
                        const cooldownFailure = getCooldownFailure(err);
                        if (cooldownFailure)
                            return cooldownFailure;
                        fallbackErrors.push(`[Tidal] ${String(err)}`);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
                else if (s === "amazon" && streamingURLs?.amazon_url) {
                    try {
                        logger.debug(`trying amazon for: ${trackName} - ${artistName}`);
                        const response = await downloadTrack({
                            service: "amazon",
                            query,
                            track_name: trackName,
                            artist_name: displayArtist,
                            album_name: albumName,
                            album_artist: displayAlbumArtist,
                            release_date: finalReleaseDate || releaseDate,
                            cover_url: coverUrl,
                            output_dir: outputDir,
                            filename_format: settings.filenameTemplate,
                            artists: artistName,
                            category: getAlbumCategoryLabel(finalAlbumType),
                            upc: finalUPC,
                            track_number: settings.trackNumber,
                            position,
                            use_album_track_number: useAlbumTrackNumber,
                            spotify_id: spotifyId,
                            embed_lyrics: settings.embedLyrics,
                            embed_max_quality_cover: settings.embedMaxQualityCover,
                            service_url: streamingURLs.amazon_url,
                            item_id: itemID,
                            audio_format: isAtmos ? "atmos" : (is24Bit ? "24" : "16"),
                            spotify_track_number: spotifyTrackNumber,
                            spotify_disc_number: spotifyDiscNumber,
                            spotify_total_tracks: spotifyTotalTracks,
                            spotify_total_discs: spotifyTotalDiscs,
                            isrc: resolvedTemplateISRC || undefined,
                            copyright: copyright,
                            publisher: publisher,
                            use_first_artist_only: settings.useFirstArtistOnly,
                            use_single_genre: settings.useSingleGenre,
                            embed_genre: settings.embedGenre,
                            save_cover: settings.saveCover,
                        });
                        if (response.success) {
                            logger.success(`amazon: ${trackName} - ${artistName}${formatSourceSuffix(response)}`);
                            return response;
                        }
                        const errMsg = response.error || response.message || "Failed";
                        if (isCooldownMessage(errMsg))
                            return response;
                        fallbackErrors.push(`[Amazon] ${errMsg}`);
                        lastResponse = response;
                        logger.warning(`amazon failed, trying next...`);
                    }
                    catch (err) {
                        logger.error(`amazon error: ${err}`);
                        const cooldownFailure = getCooldownFailure(err);
                        if (cooldownFailure)
                            return cooldownFailure;
                        fallbackErrors.push(`[Amazon] ${String(err)}`);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
                else if (s === "qobuz") {
                    try {
                        logger.debug(`trying qobuz for: ${trackName} - ${artistName}`);
                        const response = await downloadTrack({
                            service: "qobuz",
                            query,
                            track_name: trackName,
                            artist_name: displayArtist,
                            album_name: albumName,
                            album_artist: displayAlbumArtist,
                            release_date: finalReleaseDate || releaseDate,
                            cover_url: coverUrl,
                            output_dir: outputDir,
                            filename_format: settings.filenameTemplate,
                            artists: artistName,
                            category: getAlbumCategoryLabel(finalAlbumType),
                            upc: finalUPC,
                            track_number: settings.trackNumber,
                            position: trackNumberForTemplate,
                            use_album_track_number: useAlbumTrackNumber,
                            spotify_id: spotifyId,
                            embed_lyrics: settings.embedLyrics,
                            embed_max_quality_cover: settings.embedMaxQualityCover,
                            duration: durationSeconds,
                            item_id: itemID,
                            audio_format: qobuzQuality,
                            ...getCustomInstanceFields(undefined, customQobuzApi),
                            spotify_track_number: spotifyTrackNumber,
                            spotify_disc_number: spotifyDiscNumber,
                            spotify_total_tracks: spotifyTotalTracks,
                            spotify_total_discs: spotifyTotalDiscs,
                            isrc: resolvedTemplateISRC || undefined,
                            copyright: copyright,
                            publisher: publisher,
                            use_first_artist_only: settings.useFirstArtistOnly,
                            use_single_genre: settings.useSingleGenre,
                            embed_genre: settings.embedGenre,
                            save_cover: settings.saveCover,
                        });
                        if (response.success) {
                            logger.success(`qobuz: ${trackName} - ${artistName}${formatSourceSuffix(response)}`);
                            return response;
                        }
                        const errMsg = response.error || response.message || "Failed";
                        if (isCooldownMessage(errMsg))
                            return response;
                        fallbackErrors.push(`[Qobuz] ${errMsg}`);
                        lastResponse = response;
                        logger.warning(`qobuz failed, trying next...`);
                    }
                    catch (err) {
                        logger.error(`qobuz error: ${err}`);
                        const cooldownFailure = getCooldownFailure(err);
                        if (cooldownFailure)
                            return cooldownFailure;
                        fallbackErrors.push(`[Qobuz] ${String(err)}`);
                        lastResponse = { success: false, error: String(err) };
                    }
                }
            }
            if (!lastResponse.success && itemID) {
                const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
                const finalError = fallbackErrors.length > 0 ? fallbackErrors.join(" | ") : (lastResponse.error || "All services failed");
                await MarkDownloadItemFailed(itemID, finalError);
            }
            return lastResponse;
        }
        const durationSecondsForFallback = durationMs ? Math.round(durationMs / 1000) : undefined;
        let audioFormat: string | undefined;
        if (service === "tidal") {
            audioFormat = getTidalAudioFormat(settings, "single");
        }
        else if (service === "qobuz") {
            audioFormat = settings.qobuzQuality || "6";
        }
        else if (service === "amazon") {
            audioFormat = settings.amazonQuality || "16";
        }
        const singleServiceResponse = await downloadTrack({
            service: service as "tidal" | "qobuz" | "amazon",
            query,
            track_name: trackName,
            artist_name: displayArtist,
            album_name: albumName,
            album_artist: displayAlbumArtist,
            release_date: finalReleaseDate || releaseDate,
            cover_url: coverUrl,
            output_dir: outputDir,
            filename_format: settings.filenameTemplate,
            artists: artistName,
            category: getAlbumCategoryLabel(finalAlbumType),
            upc: finalUPC,
            track_number: settings.trackNumber,
            position: trackNumberForTemplate,
            use_album_track_number: useAlbumTrackNumber,
            spotify_id: spotifyId,
            embed_lyrics: settings.embedLyrics,
            embed_max_quality_cover: settings.embedMaxQualityCover,
            duration: durationSecondsForFallback,
            item_id: itemID,
            audio_format: audioFormat,
            ...getCustomInstanceFields(service === "tidal" ? customTidalApi : undefined, service === "qobuz" ? customQobuzApi : undefined),
            spotify_track_number: spotifyTrackNumber,
            spotify_disc_number: spotifyDiscNumber,
            spotify_total_tracks: spotifyTotalTracks,
            spotify_total_discs: spotifyTotalDiscs,
            isrc: resolvedTemplateISRC || undefined,
            copyright: copyright,
            publisher: publisher,
            use_first_artist_only: settings.useFirstArtistOnly,
            use_single_genre: settings.useSingleGenre,
            embed_genre: settings.embedGenre,
        });
        if (!singleServiceResponse.success && itemID) {
            const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
            await MarkDownloadItemFailed(itemID, singleServiceResponse.error || "Download failed");
        }
        return singleServiceResponse;
    };
    const handleDownloadTrack = async (id: string, trackName?: string, artistName?: string, albumName?: string, spotifyId?: string, playlistName?: string, durationMs?: number, position?: number, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string) => {
        if (!id) {
            toast.error("No ID found for this track");
            return;
        }
        const settings = getSettings();
        const displayArtist = artistName;
        logger.info(`starting download: ${trackName} - ${displayArtist}`);
        setDownloadingTrack(id);
        try {
            const releaseYear = releaseDate?.substring(0, 4);
            const response = await downloadWithAutoFallback(id, settings, trackName, artistName, albumName, playlistName, position, spotifyId, durationMs, releaseYear, albumArtist || "", releaseDate, coverUrl, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyTotalDiscs, copyright, publisher);
            if (response.success) {
                if (response.already_exists) {
                    toast.info(response.message);
                    setSkippedTracks((prev) => new Set(prev).add(id));
                }
                else {
                    toast.success(response.message);
                }
                setDownloadedTracks((prev) => new Set(prev).add(id));
                setFailedTracks((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(id);
                    return newSet;
                });
            }
            else {
                if (isCooldownMessage(response.error)) {
                    toast.info(response.error || "Servers on a scheduled break, try again shortly");
                }
                else {
                    toast.error(response.error || "Download failed");
                }
                setFailedTracks((prev) => new Set(prev).add(id));
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Download failed";
            if (isCooldownMessage(message)) {
                toast.info(message);
            }
            else {
                toast.error(message);
            }
            setFailedTracks((prev) => new Set(prev).add(id));
        }
        finally {
            setDownloadingTrack(null);
        }
    };
    const handleDownloadSelected = async (selectedTracks: string[], allTracks: TrackMetadata[], folderName?: string, isAlbum?: boolean) => {
        if (selectedTracks.length === 0) {
            toast.error("No tracks selected");
            return;
        }
        logger.info(`starting batch download: ${selectedTracks.length} selected tracks`);
        const settings = getSettings();
        setIsDownloading(true);
        setBulkDownloadType("selected");
        setDownloadProgress(0);
        setDownloadRemainingCount(selectedTracks.length);
        setCurrentDownloadInfo(null);
        let outputDir = settings.downloadPath;
        const os = settings.operatingSystem;
        const useAlbumTag = settings.folderTemplate?.includes("{album}");
        if (settings.createPlaylistFolder && folderName && (!isAlbum || !useAlbumTag)) {
            outputDir = joinPath(os, outputDir, sanitizePath(folderName.replace(/\//g, " "), os));
        }
        const selectedTrackObjects = selectedTracks
            .map((id) => allTracks.find((t) => t.spotify_id === id))
            .filter((t): t is TrackMetadata => t !== undefined);
        logger.info(`checking existing files in parallel...`);
        const useAlbumTrackNumber = templateUsesAlbumTrackNumber(settings);
        const albumFilenameTemplate = getEffectiveAlbumFilenameTemplate(settings);
        const audioFormat = "flac";
        const existenceChecks = selectedTrackObjects.map((track, index) => {
            const displayArtist = track.artists ? getFirstArtist(track.artists) : track.artists;
            const displayAlbumArtist = track.album_artist ? getFirstArtist(track.album_artist) : track.album_artist;
            return {
                spotify_id: track.spotify_id || "",
                track_name: track.name || "",
                artist_name: displayArtist || "",
                artists: track.artists || "",
                album_name: track.album_name || "",
                album_artist: displayAlbumArtist || "",
                category: getAlbumCategoryLabel(track.album_type),
                upc: track.upc || "",
                release_date: track.release_date || "",
                track_number: track.track_number || 0,
                disc_number: track.disc_number || 0,
                total_tracks: track.total_tracks || 0,
                total_discs: track.total_discs || 0,
                position: index + 1,
                use_album_track_number: useAlbumTrackNumber,
                filename_format: albumFilenameTemplate || "",
                include_track_number: settings.trackNumber || false,
                audio_format: audioFormat,
            };
        });
        const existenceResults = await CheckFilesExistence(outputDir, settings.downloadPath, existenceChecks);
        const existingSpotifyIDs = new Set<string>();
        const existingFilePaths = new Map<string, string>();
        const finalFilePaths = new Map<string, string>();
        for (const result of existenceResults) {
            if (result.exists) {
                existingSpotifyIDs.add(result.spotify_id);
                existingFilePaths.set(result.spotify_id, result.file_path || "");
                finalFilePaths.set(result.spotify_id, result.file_path || "");
            }
        }
        logger.info(`found ${existingSpotifyIDs.size} existing files`);
        const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
        const itemIDs: string[] = [];
        for (const id of selectedTracks) {
            const track = allTracks.find((t) => t.spotify_id === id);
            if (!track)
                continue;
            const trackID = track.spotify_id || id;
            const displayArtist = track.artists;
            const itemID = await AddToDownloadQueue(trackID, track.name || "", displayArtist || "", track.album_name || "");
            itemIDs.push(itemID);
            if (existingSpotifyIDs.has(trackID)) {
                const filePath = existingFilePaths.get(trackID) || "";
                setTimeout(() => SkipDownloadItem(itemID, filePath), 10);
                setSkippedTracks((prev) => new Set(prev).add(id));
                setDownloadedTracks((prev) => new Set(prev).add(id));
            }
        }
        const tracksToDownload = selectedTrackObjects.filter((track) => {
            const trackID = track.spotify_id || "";
            return !existingSpotifyIDs.has(trackID);
        });
        let successCount = 0;
        let errorCount = 0;
        let skippedCount = existingSpotifyIDs.size;
        const total = selectedTracks.length;
        const failedErrorMessages = new Map<string, string>();
        updateBatchProgress(skippedCount, total);
        for (let i = 0; i < tracksToDownload.length; i++) {
            if (shouldStopDownloadRef.current) {
                toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`);
                break;
            }
            const track = tracksToDownload[i];
            const id = track.spotify_id || "";
            const originalIndex = selectedTracks.indexOf(id);
            const itemID = itemIDs[originalIndex];
            setDownloadingTrack(id);
            const displayArtist = track.artists;
            setCurrentDownloadInfo({ name: track.name, artists: displayArtist || "" });
            try {
                const releaseYear = track.release_date?.substring(0, 4);
                const response = await downloadWithItemID(settings, itemID, track.name, track.artists, track.album_name, folderName, originalIndex + 1, track.spotify_id, track.duration_ms, isAlbum, releaseYear, track.album_artist || "", track.release_date, track.images, track.track_number, track.disc_number, track.total_tracks, track.total_discs, track.copyright, track.publisher);
                if (response.cancelled || shouldStopDownloadRef.current) {
                    toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`);
                    break;
                }
                if (response.success) {
                    if (response.already_exists) {
                        skippedCount++;
                        logger.info(`skipped: ${track.name} - ${displayArtist} (already exists)`);
                        setSkippedTracks((prev) => new Set(prev).add(id));
                    }
                    else {
                        successCount++;
                        logger.success(`downloaded: ${track.name} - ${displayArtist}${formatSourceSuffix(response)}`);
                    }
                    if (response.file) {
                        finalFilePaths.set(id, response.file);
                        finalFilePaths.set(track.spotify_id || id, response.file);
                    }
                    setDownloadedTracks((prev) => new Set(prev).add(id));
                    setFailedTracks((prev) => {
                        const newSet = new Set(prev);
                        newSet.delete(id);
                        return newSet;
                    });
                }
                else {
                    errorCount++;
                    logger.error(`failed: ${track.name} - ${displayArtist}`);
                    failedErrorMessages.set(id, response.error || "Download failed");
                    setFailedTracks((prev) => new Set(prev).add(id));
                    if (isCooldownMessage(response.error)) {
                        const remaining = tracksToDownload.length - i - 1;
                        toast.info(response.error || "Servers on a scheduled break. Pausing downloads.");
                        logger.info(`cooldown detected, pausing queue with ${remaining} track(s) remaining`);
                        updateBatchProgress(skippedCount + successCount + errorCount, total);
                        break;
                    }
                }
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                errorCount++;
                logger.error(`error: ${track.name} - ${err}`);
                failedErrorMessages.set(id, message);
                setFailedTracks((prev) => new Set(prev).add(id));
                if (itemID) {
                    const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
                    await MarkDownloadItemFailed(itemID, message);
                }
                if (isCooldownMessage(message)) {
                    const remaining = tracksToDownload.length - i - 1;
                    toast.info("Servers on a scheduled break. Pausing downloads.");
                    logger.info(`cooldown detected, pausing queue with ${remaining} track(s) remaining`);
                    updateBatchProgress(skippedCount + successCount + errorCount, total);
                    break;
                }
            }
            const completedCount = skippedCount + successCount + errorCount;
            updateBatchProgress(completedCount, total);
        }
        setDownloadingTrack(null);
        setCurrentDownloadInfo(null);
        setIsDownloading(false);
        setBulkDownloadType(null);
        updateBatchProgress(0, 0);
        shouldStopDownloadRef.current = false;
        const { CancelAllQueuedItems } = await import("../../wailsjs/go/main/App");
        await CancelAllQueuedItems();
        if (settings.createM3u8File && folderName) {
            const paths = selectedTrackObjects.map((t) => finalFilePaths.get(t.spotify_id || "") || "").filter((p) => p !== "");
            if (paths.length > 0) {
                try {
                    logger.info(`creating m3u8 playlist: ${folderName}`);
                    await CreateM3U8File(folderName, outputDir, paths);
                    toast.success("M3U8 playlist created");
                }
                catch (err) {
                    logger.error(`failed to create m3u8 playlist: ${err}`);
                    toast.error(`Failed to create M3U8 playlist: ${err}`);
                }
            }
        }
        if (settings.exportLogsFile && folderName) {
            const logsToExport: string[] = [];
            logsToExport.push(`Download Report - ${new Date().toLocaleString()}`);
            logsToExport.push("-".repeat(50));
            logsToExport.push("");
            let failedCount = 0;
            selectedTrackObjects.forEach((t) => {
                const spotifyID = t.spotify_id || "";
                const errorMessage = failedErrorMessages.get(spotifyID);
                const isFailed = !!errorMessage;
                const isSkipped = existingSpotifyIDs.has(spotifyID);
                const isSuccess = !!finalFilePaths.get(spotifyID);
                const displayArtist = t.artists;
                if (isFailed) {
                    failedCount++;
                    logsToExport.push(`${failedCount}. ${t.name} - ${displayArtist}${t.album_name ? ` (${t.album_name})` : ""}`);
                    logsToExport.push(`   Error: ${errorMessage}`);
                    if (spotifyID) {
                        logsToExport.push(`   ID: ${spotifyID}`);
                        logsToExport.push(`   URL: https://open.spotify.com/track/${spotifyID}`);
                    }
                    logsToExport.push("");
                }
                else if (!settings.exportLogsOnlyFailed) {
                    if (isSkipped) {
                        logsToExport.push(`[SKIPPED] ${t.name} - ${displayArtist}`);
                    }
                    else if (isSuccess) {
                        logsToExport.push(`[SUCCESS] ${t.name} - ${displayArtist}`);
                    }
                }
            });
            if (failedCount > 0) {
                try {
                    logger.info(`creating log file: ${folderName}`);
                    await CreateLogFile(folderName, outputDir, logsToExport);
                    toast.success("Download log created");
                }
                catch (err) {
                    logger.error(`failed to create log file: ${err}`);
                }
            }
        }
        logger.info(`batch complete: ${successCount} downloaded, ${skippedCount} skipped, ${errorCount} failed`);
        if (errorCount === 0 && skippedCount === 0) {
            toast.success(`Downloaded ${successCount} tracks successfully`);
        }
        else if (errorCount === 0 && successCount === 0) {
            toast.info(`${skippedCount} tracks already exist`);
        }
        else if (errorCount === 0) {
            toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
        }
        else {
            const parts = [];
            if (successCount > 0)
                parts.push(`${successCount} downloaded`);
            if (skippedCount > 0)
                parts.push(`${skippedCount} skipped`);
            parts.push(`${errorCount} failed`);
            toast.warning(parts.join(", "));
        }
    };
    const handleDownloadAll = async (tracks: TrackMetadata[], folderName?: string, isAlbum?: boolean) => {
        const tracksWithId = tracks.filter((track) => track.spotify_id);
        if (tracksWithId.length === 0) {
            toast.error("No tracks available for download");
            return;
        }
        logger.info(`starting batch download: ${tracksWithId.length} tracks`);
        const settings = getSettings();
        setIsDownloading(true);
        setBulkDownloadType("all");
        setDownloadProgress(0);
        setDownloadRemainingCount(tracksWithId.length);
        setCurrentDownloadInfo(null);
        let outputDir = settings.downloadPath;
        const os = settings.operatingSystem;
        const useAlbumTag = settings.folderTemplate?.includes("{album}");
        if (settings.createPlaylistFolder && folderName && (!isAlbum || !useAlbumTag)) {
            outputDir = joinPath(os, outputDir, sanitizePath(folderName.replace(/\//g, " "), os));
        }
        logger.info(`checking existing files in parallel...`);
        const useAlbumTrackNumber = templateUsesAlbumTrackNumber(settings);
        const albumFilenameTemplate = getEffectiveAlbumFilenameTemplate(settings);
        const audioFormat = "flac";
        const existenceChecks = tracksWithId.map((track, index) => {
            const displayArtist = track.artists ? getFirstArtist(track.artists) : track.artists;
            const displayAlbumArtist = track.album_artist ? getFirstArtist(track.album_artist) : track.album_artist;
            return {
                spotify_id: track.spotify_id || "",
                track_name: track.name || "",
                artist_name: displayArtist || "",
                artists: track.artists || "",
                album_name: track.album_name || "",
                album_artist: displayAlbumArtist || "",
                category: getAlbumCategoryLabel(track.album_type),
                upc: track.upc || "",
                release_date: track.release_date || "",
                track_number: track.track_number || 0,
                disc_number: track.disc_number || 0,
                total_tracks: track.total_tracks || 0,
                total_discs: track.total_discs || 0,
                position: index + 1,
                use_album_track_number: useAlbumTrackNumber,
                filename_format: albumFilenameTemplate || "",
                include_track_number: settings.trackNumber || false,
                audio_format: audioFormat,
            };
        });
        const existenceResults = await CheckFilesExistence(outputDir, settings.downloadPath, existenceChecks);
        const finalFilePaths: string[] = new Array(tracksWithId.length).fill("");
        const existingSpotifyIDs = new Set<string>();
        const existingFilePaths = new Map<string, string>();
        for (let i = 0; i < existenceResults.length; i++) {
            const result = existenceResults[i];
            if (result.exists) {
                existingSpotifyIDs.add(result.spotify_id);
                existingFilePaths.set(result.spotify_id, result.file_path || "");
                finalFilePaths[i] = result.file_path || "";
            }
        }
        logger.info(`found ${existingSpotifyIDs.size} existing files`);
        const { AddToDownloadQueue } = await import("../../wailsjs/go/main/App");
        const itemIDs: string[] = [];
        for (const track of tracksWithId) {
            const displayArtist = track.artists;
            const itemID = await AddToDownloadQueue(track.spotify_id || "", track.name || "", displayArtist || "", track.album_name || "");
            itemIDs.push(itemID);
            const trackID = track.spotify_id || "";
            if (existingSpotifyIDs.has(trackID)) {
                const filePath = existingFilePaths.get(trackID) || "";
                setTimeout(() => SkipDownloadItem(itemID, filePath), 10);
                setSkippedTracks((prev: Set<string>) => new Set(prev).add(trackID));
                setDownloadedTracks((prev: Set<string>) => new Set(prev).add(trackID));
            }
        }
        const tracksToDownload = tracksWithId.filter((track) => {
            const trackID = track.spotify_id || "";
            return !existingSpotifyIDs.has(trackID);
        });
        let successCount = 0;
        let errorCount = 0;
        let skippedCount = existingSpotifyIDs.size;
        const total = tracksWithId.length;
        const failedErrorMessages = new Map<string, string>();
        updateBatchProgress(skippedCount, total);
        for (let i = 0; i < tracksToDownload.length; i++) {
            if (shouldStopDownloadRef.current) {
                toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`);
                break;
            }
            const track = tracksToDownload[i];
            const originalIndex = tracksWithId.findIndex((t) => t.spotify_id === track.spotify_id);
            const itemID = itemIDs[originalIndex];
            const trackId = track.spotify_id || "";
            setDownloadingTrack(trackId);
            const displayArtist = track.artists;
            setCurrentDownloadInfo({ name: track.name || "", artists: displayArtist || "" });
            try {
                const releaseYear = track.release_date?.substring(0, 4);
                const response = await downloadWithItemID(settings, itemID, track.name, track.artists, track.album_name, folderName, originalIndex + 1, track.spotify_id, track.duration_ms, isAlbum, releaseYear, track.album_artist || "", track.release_date, track.images, track.track_number, track.disc_number, track.total_tracks, track.total_discs, track.copyright, track.publisher);
                if (response.cancelled || shouldStopDownloadRef.current) {
                    toast.info(`Download stopped. ${successCount} tracks downloaded, ${tracksToDownload.length - i} remaining.`);
                    break;
                }
                if (response.success) {
                    if (response.already_exists) {
                        skippedCount++;
                        logger.info(`skipped: ${track.name} - ${displayArtist} (already exists)`);
                        setSkippedTracks((prev) => new Set(prev).add(trackId));
                    }
                    else {
                        successCount++;
                        logger.success(`downloaded: ${track.name} - ${displayArtist}${formatSourceSuffix(response)}`);
                    }
                    setDownloadedTracks((prev) => new Set(prev).add(trackId));
                    setFailedTracks((prev) => {
                        const newSet = new Set(prev);
                        newSet.delete(trackId);
                        return newSet;
                    });
                    if (response.file) {
                        finalFilePaths[originalIndex] = response.file;
                    }
                }
                else {
                    errorCount++;
                    logger.error(`failed: ${track.name} - ${displayArtist}`);
                    failedErrorMessages.set(trackId, response.error || "Download failed");
                    setFailedTracks((prev) => new Set(prev).add(trackId));
                    if (isCooldownMessage(response.error)) {
                        const remaining = tracksToDownload.length - i - 1;
                        toast.info(response.error || "Servers on a scheduled break. Pausing downloads.");
                        logger.info(`cooldown detected, pausing queue with ${remaining} track(s) remaining`);
                        updateBatchProgress(skippedCount + successCount + errorCount, total);
                        break;
                    }
                }
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                errorCount++;
                logger.error(`error: ${track.name} - ${err}`);
                failedErrorMessages.set(trackId, message);
                setFailedTracks((prev) => new Set(prev).add(trackId));
                const { MarkDownloadItemFailed } = await import("../../wailsjs/go/main/App");
                await MarkDownloadItemFailed(itemID, message);
                if (isCooldownMessage(message)) {
                    const remaining = tracksToDownload.length - i - 1;
                    toast.info("Servers on a scheduled break. Pausing downloads.");
                    logger.info(`cooldown detected, pausing queue with ${remaining} track(s) remaining`);
                    updateBatchProgress(skippedCount + successCount + errorCount, total);
                    break;
                }
            }
            const completedCount = skippedCount + successCount + errorCount;
            updateBatchProgress(completedCount, total);
        }
        setDownloadingTrack(null);
        setCurrentDownloadInfo(null);
        setIsDownloading(false);
        setBulkDownloadType(null);
        updateBatchProgress(0, 0);
        shouldStopDownloadRef.current = false;
        const { CancelAllQueuedItems: CancelQueued } = await import("../../wailsjs/go/main/App");
        await CancelQueued();
        if (settings.createM3u8File && folderName) {
            try {
                logger.info(`creating m3u8 playlist: ${folderName}`);
                await CreateM3U8File(folderName, outputDir, finalFilePaths.filter(p => p !== ""));
                toast.success("M3U8 playlist created");
            }
            catch (err) {
                logger.error(`failed to create m3u8 playlist: ${err}`);
                toast.error(`Failed to create M3U8 playlist: ${err}`);
            }
        }
        if (settings.exportLogsFile && folderName) {
            const logsToExport: string[] = [];
            logsToExport.push(`Download Report - ${new Date().toLocaleString()}`);
            logsToExport.push("-".repeat(50));
            logsToExport.push("");
            let failedCount = 0;
            tracksWithId.forEach((t, idx) => {
                const spotifyID = t.spotify_id || "";
                const errorMessage = failedErrorMessages.get(spotifyID);
                const isFailed = !!errorMessage;
                const isSkipped = existingSpotifyIDs.has(spotifyID);
                const isSuccess = !!finalFilePaths[idx];
                const displayArtist = t.artists;
                if (isFailed) {
                    failedCount++;
                    logsToExport.push(`${failedCount}. ${t.name} - ${displayArtist}${t.album_name ? ` (${t.album_name})` : ""}`);
                    logsToExport.push(`   Error: ${errorMessage}`);
                    if (spotifyID) {
                        logsToExport.push(`   ID: ${spotifyID}`);
                        logsToExport.push(`   URL: https://open.spotify.com/track/${spotifyID}`);
                    }
                    logsToExport.push("");
                }
                else if (!settings.exportLogsOnlyFailed) {
                    if (isSkipped) {
                        logsToExport.push(`[SKIPPED] ${t.name} - ${displayArtist}`);
                    }
                    else if (isSuccess) {
                        logsToExport.push(`[SUCCESS] ${t.name} - ${displayArtist}`);
                    }
                }
            });
            if (failedCount > 0) {
                try {
                    logger.info(`creating log file: ${folderName}`);
                    await CreateLogFile(folderName, outputDir, logsToExport);
                    toast.success("Download log created");
                }
                catch (err) {
                    logger.error(`failed to create log file: ${err}`);
                }
            }
        }
        logger.info(`batch complete: ${successCount} downloaded, ${skippedCount} skipped, ${errorCount} failed`);
        if (errorCount === 0 && skippedCount === 0) {
            toast.success(`Downloaded ${successCount} tracks successfully`);
        }
        else if (errorCount === 0 && successCount === 0) {
            toast.info(`${skippedCount} tracks already exist`);
        }
        else if (errorCount === 0) {
            toast.info(`${successCount} downloaded, ${skippedCount} skipped`);
        }
        else {
            const parts = [];
            if (successCount > 0)
                parts.push(`${successCount} downloaded`);
            if (skippedCount > 0)
                parts.push(`${skippedCount} skipped`);
            parts.push(`${errorCount} failed`);
            toast.warning(parts.join(", "));
        }
    };
    const handleStopDownload = () => {
        logger.info("download stopped by user");
        shouldStopDownloadRef.current = true;
        void (async () => {
            try {
                const { ForceStopDownloads } = await import("../../wailsjs/go/main/App");
                await ForceStopDownloads();
            }
            catch (err) {
                console.error("Failed to force stop downloads:", err);
            }
        })();
        toast.info("Stopping download...");
    };
    const resetDownloadedTracks = () => {
        setDownloadedTracks(new Set());
        setFailedTracks(new Set());
        setSkippedTracks(new Set());
    };
    return {
        downloadProgress,
        downloadRemainingCount,
        isDownloading,
        downloadingTrack,
        bulkDownloadType,
        downloadedTracks,
        failedTracks,
        skippedTracks,
        currentDownloadInfo,
        handleDownloadTrack,
        handleDownloadSelected,
        handleDownloadAll,
        handleStopDownload,
        resetDownloadedTracks,
    };
}
