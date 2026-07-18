import { useState, useRef } from "react";
import { downloadCover } from "@/lib/api";
import { getSettings, parseTemplate, templateUsesAlbumTrackNumber, getAlbumCategoryLabel, type TemplateData } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath, getFirstArtist } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { TrackMetadata } from "@/types/api";
export function useCover() {
    const [downloadingCover, setDownloadingCover] = useState(false);
    const [downloadingCoverTrack, setDownloadingCoverTrack] = useState<string | null>(null);
    const [downloadedCovers, setDownloadedCovers] = useState<Set<string>>(new Set());
    const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set());
    const [skippedCovers, setSkippedCovers] = useState<Set<string>>(new Set());
    const [isBulkDownloadingCovers, setIsBulkDownloadingCovers] = useState(false);
    const [coverDownloadProgress, setCoverDownloadProgress] = useState(0);
    const stopBulkDownloadRef = useRef(false);
    const handleDownloadCover = async (coverUrl: string, trackName: string, artistName: string, albumName?: string, playlistName?: string, position?: number, trackId?: string, albumArtist?: string, releaseDate?: string, discNumber?: number, isAlbum?: boolean) => {
        if (!coverUrl) {
            toast.error("No cover URL found for this track");
            return;
        }
        const id = trackId || `${trackName}-${artistName}`;
        logger.info(`downloading cover: ${trackName} - ${artistName}`);
        const settings = getSettings();
        setDownloadingCover(true);
        setDownloadingCoverTrack(id);
        try {
            const os = settings.operatingSystem;
            let outputDir = settings.downloadPath;
            const placeholder = "__SLASH_PLACEHOLDER__";
            const yearValue = releaseDate?.substring(0, 4);
            const displayArtist = artistName ? getFirstArtist(artistName) : artistName;
            const displayAlbumArtist = albumArtist ? getFirstArtist(albumArtist) : albumArtist;
            const templateData: TemplateData = {
                artist: displayArtist?.replace(/\//g, placeholder),
                artists: artistName?.replace(/\//g, placeholder),
                album: albumName?.replace(/\//g, placeholder),
                album_artist: displayAlbumArtist?.replace(/\//g, placeholder) || displayArtist?.replace(/\//g, placeholder),
                title: trackName?.replace(/\//g, placeholder),
                track: position,
                year: yearValue,
                date: releaseDate,
                playlist: playlistName?.replace(/\//g, placeholder),
            };
            const folderTemplate = settings.folderTemplate || "";
            const useAlbumSubfolder = folderTemplate.includes("{album}") || folderTemplate.includes("{album_artist}") || folderTemplate.includes("{playlist}");
            if (settings.createPlaylistFolder && playlistName && (!isAlbum || !useAlbumSubfolder)) {
                outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
            }
            if (settings.folderTemplate && (isAlbum || settings.applyFolderToSingleTrack)) {
                const folderPath = parseTemplate(settings.folderTemplate, templateData);
                if (folderPath) {
                    const parts = folderPath.split("/").filter((p: string) => p.trim());
                    for (const part of parts) {
                        const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
                        outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
                    }
                }
            }
            const response = await downloadCover({
                cover_url: coverUrl,
                track_name: trackName,
                artist_name: displayArtist,
                artists: artistName || "",
                album_name: albumName || "",
                album_artist: displayAlbumArtist || "",
                release_date: releaseDate || "",
                output_dir: outputDir,
                filename_format: settings.filenameTemplate || "{title}",
                playlist_name: playlistName || "",
                track_number: settings.trackNumber,
                position: position || 0,
                disc_number: discNumber || 0,
            });
            if (response.success) {
                if (response.already_exists) {
                    toast.info("Cover file already exists");
                    setSkippedCovers((prev) => new Set(prev).add(id));
                }
                else {
                    toast.success("Cover downloaded successfully");
                    setDownloadedCovers((prev) => new Set(prev).add(id));
                }
                setFailedCovers((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(id);
                    return newSet;
                });
            }
            else {
                toast.error(response.error || "Failed to download cover");
                setFailedCovers((prev) => new Set(prev).add(id));
            }
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to download cover");
            setFailedCovers((prev) => new Set(prev).add(id));
        }
        finally {
            setDownloadingCover(false);
            setDownloadingCoverTrack(null);
        }
    };
    const handleDownloadAllCovers = async (tracks: TrackMetadata[], playlistName?: string, isAlbum?: boolean) => {
        if (tracks.length === 0) {
            toast.error("No tracks to download covers");
            return;
        }
        const settings = getSettings();
        setIsBulkDownloadingCovers(true);
        setCoverDownloadProgress(0);
        stopBulkDownloadRef.current = false;
        let completed = 0;
        let success = 0;
        let skipped = 0;
        let failed = 0;
        for (let i = 0; i < tracks.length; i++) {
            if (stopBulkDownloadRef.current) {
                toast.info("Cover download stopped");
                break;
            }
            const track = tracks[i];
            if (!track.images) {
                completed++;
                setCoverDownloadProgress(Math.round((completed / tracks.length) * 100));
                continue;
            }
            const id = track.spotify_id || `${track.name}-${track.artists}`;
            setDownloadingCoverTrack(id);
            try {
                const os = settings.operatingSystem;
                let outputDir = settings.downloadPath;
                const placeholder = "__SLASH_PLACEHOLDER__";
                const useAlbumTrackNumber = templateUsesAlbumTrackNumber(settings);
                const trackPosition = useAlbumTrackNumber ? (track.track_number || i + 1) : (i + 1);
                const yearValue = track.release_date?.substring(0, 4);
                const displayArtist = track.artists ? getFirstArtist(track.artists) : track.artists;
                const displayAlbumArtist = track.album_artist ? getFirstArtist(track.album_artist) : track.album_artist;
                const templateData: TemplateData = {
                    artist: displayArtist?.replace(/\//g, placeholder),
                    artists: track.artists?.replace(/\//g, placeholder),
                    album: track.album_name?.replace(/\//g, placeholder),
                    album_artist: displayAlbumArtist?.replace(/\//g, placeholder) || displayArtist?.replace(/\//g, placeholder),
                    title: track.name?.replace(/\//g, placeholder),
                    track: trackPosition,
                    year: yearValue,
                    date: track.release_date,
                    playlist: playlistName?.replace(/\//g, placeholder),
                };
                const folderTemplate = settings.folderTemplate || "";
                const useAlbumSubfolder = folderTemplate.includes("{album}") || folderTemplate.includes("{album_artist}") || folderTemplate.includes("{playlist}");
                if (settings.createPlaylistFolder && playlistName && (!isAlbum || !useAlbumSubfolder)) {
                    outputDir = joinPath(os, outputDir, sanitizePath(playlistName.replace(/\//g, " "), os));
                }
                if (settings.folderTemplate && (isAlbum || settings.applyFolderToSingleTrack)) {
                    const folderPath = parseTemplate(settings.folderTemplate, templateData);
                    if (folderPath) {
                        const parts = folderPath.split("/").filter((p: string) => p.trim());
                        for (const part of parts) {
                            const sanitizedPart = part.replace(new RegExp(placeholder, "g"), " ");
                            outputDir = joinPath(os, outputDir, sanitizePath(sanitizedPart, os));
                        }
                    }
                }
                const response = await downloadCover({
                    cover_url: track.images,
                    track_name: track.name,
                    artist_name: displayArtist,
                    artists: track.artists,
                    album_name: track.album_name,
                    album_artist: displayAlbumArtist,
                    release_date: track.release_date,
                    output_dir: outputDir,
                    filename_format: settings.filenameTemplate || "{title}",
                    playlist_name: playlistName || "",
                    category: getAlbumCategoryLabel(track.album_type),
                    upc: track.upc || "",
                    track_number: settings.trackNumber,
                    position: trackPosition,
                    disc_number: track.disc_number,
                    total_tracks: track.total_tracks,
                    total_discs: track.total_discs,
                    use_album_track_number: useAlbumTrackNumber,
                });
                if (response.success) {
                    if (response.already_exists) {
                        skipped++;
                        setSkippedCovers((prev) => new Set(prev).add(id));
                    }
                    else {
                        success++;
                        setDownloadedCovers((prev) => new Set(prev).add(id));
                    }
                }
                else {
                    failed++;
                    setFailedCovers((prev) => new Set(prev).add(id));
                }
            }
            catch {
                failed++;
                setFailedCovers((prev) => new Set(prev).add(id));
            }
            completed++;
            setCoverDownloadProgress(Math.round((completed / tracks.length) * 100));
        }
        setDownloadingCoverTrack(null);
        setIsBulkDownloadingCovers(false);
        setCoverDownloadProgress(0);
        if (!stopBulkDownloadRef.current) {
            toast.success(`Covers: ${success} downloaded, ${skipped} skipped, ${failed} failed`);
        }
    };
    const handleStopCoverDownload = () => {
        stopBulkDownloadRef.current = true;
    };
    const resetCoverState = () => {
        setDownloadedCovers(new Set());
        setFailedCovers(new Set());
        setSkippedCovers(new Set());
    };
    return {
        downloadingCover,
        downloadingCoverTrack,
        downloadedCovers,
        failedCovers,
        skippedCovers,
        isBulkDownloadingCovers,
        coverDownloadProgress,
        handleDownloadCover,
        handleDownloadAllCovers,
        handleStopCoverDownload,
        resetCoverState,
    };
}
