import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, ImageDown, FileText, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchAndSort } from "./SearchAndSort";
import { TrackList } from "./TrackList";
import { DownloadProgress } from "./DownloadProgress";
import { getSettings } from "@/lib/settings";
import { downloadCover } from "@/lib/api";
import { useState } from "react";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { joinPath, sanitizePath } from "@/lib/utils";
import { parseTemplate, type TemplateData } from "@/lib/settings";
import { buildPlaylistFolderName } from "@/lib/playlist";
import type { TrackMetadata, TrackAvailability } from "@/types/api";
interface PlaylistInfoProps {
    playlistInfo: {
        owner: {
            name: string;
            display_name: string;
            images: string;
        };
        tracks: {
            total: number;
        };
        followers: {
            total: number;
        };
        cover?: string;
        description?: string;
    };
    trackList: TrackMetadata[];
    searchQuery: string;
    sortBy: string;
    selectedTracks: string[];
    downloadedTracks: Set<string>;
    failedTracks: Set<string>;
    skippedTracks: Set<string>;
    downloadingTrack: string | null;
    isDownloading: boolean;
    bulkDownloadType: "all" | "selected" | null;
    downloadProgress: number;
    downloadRemainingCount: number;
    currentDownloadInfo: {
        name: string;
        artists: string;
    } | null;
    currentPage: number;
    itemsPerPage: number;
    downloadedLyrics?: Set<string>;
    failedLyrics?: Set<string>;
    skippedLyrics?: Set<string>;
    downloadingLyricsTrack?: string | null;
    checkingAvailabilityTrack?: string | null;
    availabilityMap?: Map<string, TrackAvailability>;
    downloadedCovers?: Set<string>;
    failedCovers?: Set<string>;
    skippedCovers?: Set<string>;
    downloadingCoverTrack?: string | null;
    isBulkDownloadingCovers?: boolean;
    isBulkDownloadingLyrics?: boolean;
    isMetadataLoading?: boolean;
    onSearchChange: (value: string) => void;
    onSortChange: (value: string) => void;
    onToggleTrack: (id: string) => void;
    onToggleSelectAll: (tracks: TrackMetadata[]) => void;
    onDownloadTrack: (id: string, name: string, artists: string, albumName: string, spotifyId?: string, folderName?: string, durationMs?: number, position?: number, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string, isExplicit?: boolean) => void;
    onDownloadLyrics?: (spotifyId: string, name: string, artists: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onDownloadCover?: (coverUrl: string, trackName: string, artistName: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, trackId?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onCheckAvailability?: (spotifyId: string) => void;
    onDownloadAllLyrics?: () => void;
    onDownloadAllCovers?: () => void;
    onDownloadAll: () => void;
    onDownloadSelected: () => void;
    onStopDownload: () => void;
    onOpenFolder: () => void;
    onPageChange: (page: number) => void;
    onAlbumClick: (album: {
        id: string;
        name: string;
        external_urls: string;
    }) => void;
    onArtistClick: (artist: {
        id: string;
        name: string;
        external_urls: string;
    }) => void;
    onTrackClick: (track: TrackMetadata) => void;
    onBack?: () => void;
}
export function PlaylistInfo({ playlistInfo, trackList, searchQuery, sortBy, selectedTracks, downloadedTracks, failedTracks, skippedTracks, downloadingTrack, isDownloading, bulkDownloadType, downloadProgress, downloadRemainingCount, currentDownloadInfo, currentPage, itemsPerPage, downloadedLyrics, failedLyrics, skippedLyrics, downloadingLyricsTrack, checkingAvailabilityTrack, availabilityMap, downloadedCovers, failedCovers, skippedCovers, downloadingCoverTrack, isBulkDownloadingCovers, isBulkDownloadingLyrics, isMetadataLoading = false, onSearchChange, onSortChange, onToggleTrack, onToggleSelectAll, onDownloadTrack, onDownloadLyrics, onDownloadCover, onCheckAvailability, onDownloadAllLyrics, onDownloadAllCovers, onDownloadAll, onDownloadSelected, onStopDownload, onOpenFolder, onPageChange, onAlbumClick, onArtistClick, onTrackClick, onBack, }: PlaylistInfoProps) {
    const settings = getSettings();
    const playlistName = playlistInfo.owner.name;
    const playlistFolderName = buildPlaylistFolderName(playlistName, playlistInfo.owner.display_name, settings.playlistOwnerFolderName);
    const [downloadingPlaylistCover, setDownloadingPlaylistCover] = useState(false);
    const fetchedTrackCount = trackList.length;
    const totalTrackCount = playlistInfo.tracks.total;
    const showStreamingProgress = isMetadataLoading && totalTrackCount > 0 && fetchedTrackCount < totalTrackCount;
    const handleDownloadPlaylistCover = async () => {
        if (!playlistInfo.cover)
            return;
        setDownloadingPlaylistCover(true);
        try {
            const os = settings.operatingSystem;
            let outputDir = settings.downloadPath;
            const placeholder = "__SLASH_PLACEHOLDER__";
            const templateData: TemplateData = {
                artist: "",
                album: "",
                album_artist: "",
                title: playlistName.replace(/\//g, placeholder),
                playlist: playlistFolderName.replace(/\//g, placeholder),
            };
            if (settings.createPlaylistFolder && playlistFolderName) {
                outputDir = joinPath(os, outputDir, sanitizePath(playlistFolderName.replace(/\//g, " "), os));
            }
            if (settings.folderTemplate) {
                const folderPath = parseTemplate(settings.folderTemplate, templateData);
                if (folderPath) {
                    const parts = folderPath.split("/").filter((p: string) => p.trim());
                    for (const part of parts) {
                        outputDir = joinPath(os, outputDir, sanitizePath(part.replace(new RegExp(placeholder, "g"), " "), os));
                    }
                }
            }
            const response = await downloadCover({
                cover_url: playlistInfo.cover,
                track_name: playlistName,
                artist_name: "",
                album_name: "",
                album_artist: "",
                release_date: "",
                output_dir: outputDir,
                filename_format: "title",
                track_number: false,
                position: 0,
                disc_number: 0,
            });
            if (response.success) {
                if (response.already_exists)
                    toast.info("Cover already exists");
                else
                    toast.success("Separate playlist cover downloaded");
            }
            else {
                toast.error(response.error || "Failed to download cover");
            }
        }
        catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to download cover");
        }
        finally {
            setDownloadingPlaylistCover(false);
        }
    };
    return (<div className="space-y-6">
      <Card className="relative">
      {onBack && (<div className="absolute top-4 right-4 z-10">
          <Button variant="ghost" size="icon" onClick={onBack}>
              <XCircle className="h-5 w-5"/>
          </Button>
      </div>)}
        <CardContent className="px-6">
          <div className="flex gap-6 items-start">
            {playlistInfo.cover && (<div className="relative group shrink-0 w-48 h-48">
                <img src={playlistInfo.cover} alt={playlistName} className="w-48 h-48 rounded-md shadow-lg object-cover"/>
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-md">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="secondary" size="icon" className="h-9 w-9 shadow-lg" onClick={handleDownloadPlaylistCover} disabled={downloadingPlaylistCover}>
                        {downloadingPlaylistCover ? <Spinner /> : <ImageDown className="h-4 w-4"/>}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Download Separate Playlist Cover</p></TooltipContent>
                  </Tooltip>
                </div>
              </div>)}
            <div className="flex-1 space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Playlist</p>
                <h2 className="text-4xl font-bold">{playlistName}</h2>
                {playlistInfo.description && (<p className="text-sm text-muted-foreground">{playlistInfo.description}</p>)}
                <div className="flex items-center gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    {playlistInfo.owner.images && (<img src={playlistInfo.owner.images} alt={playlistInfo.owner.display_name} className="w-5 h-5 rounded-full object-cover"/>)}
                    <span className="font-medium">{playlistInfo.owner.display_name}</span>
                  </div>
                  <span>•</span>
                  <span>
                    {showStreamingProgress
            ? `${fetchedTrackCount.toLocaleString()} / ${totalTrackCount.toLocaleString()} tracks`
            : `${Math.max(totalTrackCount, fetchedTrackCount).toLocaleString()} ${Math.max(totalTrackCount, fetchedTrackCount) === 1 ? "track" : "tracks"}`}
                  </span>
                  <span>•</span>
                  <span>{playlistInfo.followers.total.toLocaleString()} {playlistInfo.followers.total === 1 ? "follower" : "followers"}</span>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={onDownloadAll} disabled={isDownloading}>
                  {isDownloading && bulkDownloadType === "all" ? (<Spinner />) : (<Download className="h-4 w-4"/>)}
                  Download All
                </Button>
                {selectedTracks.length > 0 && (<Button onClick={onDownloadSelected} variant="secondary" disabled={isDownloading}>
                    {isDownloading && bulkDownloadType === "selected" ? (<Spinner />) : (<Download className="h-4 w-4"/>)}
                    Download Selected ({selectedTracks.length.toLocaleString()})
                  </Button>)}
                {onDownloadAllLyrics && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={onDownloadAllLyrics} variant="outline" disabled={isBulkDownloadingLyrics}>
                        {isBulkDownloadingLyrics ? <Spinner /> : <FileText className="h-4 w-4"/>}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download All Lyrics</p>
                    </TooltipContent>
                  </Tooltip>)}
                {onDownloadAllCovers && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={onDownloadAllCovers} variant="outline" disabled={isBulkDownloadingCovers}>
                        {isBulkDownloadingCovers ? <Spinner /> : <ImageDown className="h-4 w-4"/>}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download All Separate Covers</p>
                    </TooltipContent>
                  </Tooltip>)}
                {downloadedTracks.size > 0 && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={onOpenFolder} variant="outline" size="icon">
                        <FolderOpen className="h-4 w-4"/>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Open Folder</p>
                    </TooltipContent>
                  </Tooltip>)}
              </div>
              {isDownloading && (<DownloadProgress progress={downloadProgress} remainingCount={downloadRemainingCount} currentTrack={currentDownloadInfo} onStop={onStopDownload}/>)}
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <SearchAndSort searchQuery={searchQuery} sortBy={sortBy} onSearchChange={onSearchChange} onSortChange={onSortChange}/>
        <TrackList tracks={trackList} searchQuery={searchQuery} sortBy={sortBy} selectedTracks={selectedTracks} downloadedTracks={downloadedTracks} failedTracks={failedTracks} skippedTracks={skippedTracks} downloadingTrack={downloadingTrack} isDownloading={isDownloading} currentPage={currentPage} itemsPerPage={itemsPerPage} showCheckboxes={true} hideAlbumColumn={false} folderName={playlistFolderName} downloadedLyrics={downloadedLyrics} failedLyrics={failedLyrics} skippedLyrics={skippedLyrics} downloadingLyricsTrack={downloadingLyricsTrack} checkingAvailabilityTrack={checkingAvailabilityTrack} availabilityMap={availabilityMap} downloadedCovers={downloadedCovers} failedCovers={failedCovers} skippedCovers={skippedCovers} downloadingCoverTrack={downloadingCoverTrack} onToggleTrack={onToggleTrack} onToggleSelectAll={onToggleSelectAll} onDownloadTrack={onDownloadTrack} onDownloadLyrics={onDownloadLyrics} onDownloadCover={onDownloadCover} onCheckAvailability={onCheckAvailability} onPageChange={onPageChange} onAlbumClick={onAlbumClick} onArtistClick={onArtistClick} onTrackClick={onTrackClick}/>
      </div>
    </div>);
}
