import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, CheckCircle, XCircle, FileCheck, FileText, Globe, ImageDown, Play, Pause } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious, } from "@/components/ui/pagination";
import type { TrackMetadata, TrackAvailability } from "@/types/api";
import { usePreview } from "@/hooks/usePreview";
import { AvailabilityLinks, hasAvailabilityLinks } from "./AvailabilityLinks";
import { buildClickableArtists } from "@/lib/artist-links";
interface TrackListProps {
    tracks: TrackMetadata[];
    searchQuery: string;
    sortBy: string;
    selectedTracks: string[];
    downloadedTracks: Set<string>;
    failedTracks: Set<string>;
    skippedTracks: Set<string>;
    downloadingTrack: string | null;
    isDownloading: boolean;
    currentPage: number;
    itemsPerPage: number;
    showCheckboxes?: boolean;
    hideAlbumColumn?: boolean;
    folderName?: string;
    isArtistDiscography?: boolean;
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
    onToggleTrack: (id: string) => void;
    onToggleSelectAll: (tracks: TrackMetadata[]) => void;
    onDownloadTrack: (id: string, name: string, artists: string, albumName: string, spotifyId?: string, folderName?: string, durationMs?: number, position?: number, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string, isExplicit?: boolean) => void;
    onDownloadLyrics?: (spotifyId: string, name: string, artists: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onCheckAvailability?: (spotifyId: string) => void;
    onDownloadCover?: (coverUrl: string, trackName: string, artistName: string, albumName: string, folderName?: string, isArtistDiscography?: boolean, position?: number, trackId?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onPageChange: (page: number) => void;
    onAlbumClick?: (album: {
        id: string;
        name: string;
        external_urls: string;
    }) => void;
    onArtistClick?: (artist: {
        id: string;
        name: string;
        external_urls: string;
    }) => void;
    onTrackClick?: (track: TrackMetadata) => void;
}
export function TrackList({ tracks, searchQuery, sortBy, selectedTracks, downloadedTracks, failedTracks, skippedTracks, downloadingTrack, isDownloading, currentPage, itemsPerPage, showCheckboxes = false, hideAlbumColumn = false, folderName, isArtistDiscography = false, downloadedLyrics, failedLyrics, skippedLyrics, downloadingLyricsTrack, checkingAvailabilityTrack, availabilityMap, downloadedCovers, failedCovers, skippedCovers, downloadingCoverTrack, onToggleTrack, onToggleSelectAll, onDownloadTrack, onDownloadLyrics, onCheckAvailability, onDownloadCover, onPageChange, onAlbumClick, onArtistClick, onTrackClick, }: TrackListProps) {
    const { playPreview, loadingPreview, playingTrack } = usePreview();
    let filteredTracks = tracks.filter((track) => {
        if (!searchQuery)
            return true;
        const query = searchQuery.toLowerCase();
        return (track.name.toLowerCase().includes(query) ||
            track.artists.toLowerCase().includes(query) ||
            track.album_name.toLowerCase().includes(query));
    });
    if (sortBy === "title-asc") {
        filteredTracks = [...filteredTracks].sort((a, b) => a.name.localeCompare(b.name));
    }
    else if (sortBy === "title-desc") {
        filteredTracks = [...filteredTracks].sort((a, b) => b.name.localeCompare(a.name));
    }
    else if (sortBy === "artist-asc") {
        filteredTracks = [...filteredTracks].sort((a, b) => a.artists.localeCompare(b.artists));
    }
    else if (sortBy === "artist-desc") {
        filteredTracks = [...filteredTracks].sort((a, b) => b.artists.localeCompare(a.artists));
    }
    else if (sortBy === "duration-asc") {
        filteredTracks = [...filteredTracks].sort((a, b) => a.duration_ms - b.duration_ms);
    }
    else if (sortBy === "duration-desc") {
        filteredTracks = [...filteredTracks].sort((a, b) => b.duration_ms - a.duration_ms);
    }
    else if (sortBy === "plays-asc") {
        filteredTracks = [...filteredTracks].sort((a, b) => {
            const aPlays = a.plays ? parseInt(a.plays, 10) : 0;
            const bPlays = b.plays ? parseInt(b.plays, 10) : 0;
            if (isNaN(aPlays))
                return 1;
            if (isNaN(bPlays))
                return -1;
            return aPlays - bPlays;
        });
    }
    else if (sortBy === "plays-desc") {
        filteredTracks = [...filteredTracks].sort((a, b) => {
            const aPlays = a.plays ? parseInt(a.plays, 10) : 0;
            const bPlays = b.plays ? parseInt(b.plays, 10) : 0;
            if (isNaN(aPlays))
                return 1;
            if (isNaN(bPlays))
                return -1;
            return bPlays - aPlays;
        });
    }
    else if (sortBy === "downloaded") {
        filteredTracks = [...filteredTracks].sort((a, b) => {
            const aDownloaded = a.spotify_id ? downloadedTracks.has(a.spotify_id) : false;
            const bDownloaded = b.spotify_id ? downloadedTracks.has(b.spotify_id) : false;
            return (bDownloaded ? 1 : 0) - (aDownloaded ? 1 : 0);
        });
    }
    else if (sortBy === "not-downloaded") {
        filteredTracks = [...filteredTracks].sort((a, b) => {
            const aDownloaded = a.spotify_id ? downloadedTracks.has(a.spotify_id) : false;
            const bDownloaded = b.spotify_id ? downloadedTracks.has(b.spotify_id) : false;
            return (aDownloaded ? 1 : 0) - (bDownloaded ? 1 : 0);
        });
    }
    else if (sortBy === "failed") {
        filteredTracks = [...filteredTracks].sort((a, b) => {
            const aFailed = a.spotify_id ? failedTracks.has(a.spotify_id) : false;
            const bFailed = b.spotify_id ? failedTracks.has(b.spotify_id) : false;
            return (bFailed ? 1 : 0) - (aFailed ? 1 : 0);
        });
    }
    const totalPages = Math.ceil(filteredTracks.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedTracks = filteredTracks.slice(startIndex, endIndex);
    const getPaginationPages = (current: number, total: number): (number | 'ellipsis')[] => {
        if (total <= 10) {
            return Array.from({ length: total }, (_, i) => i + 1);
        }
        const pages: (number | 'ellipsis')[] = [];
        pages.push(1);
        if (current <= 7) {
            for (let i = 2; i <= 10; i++) {
                pages.push(i);
            }
            pages.push('ellipsis');
            pages.push(total);
        }
        else if (current >= total - 7) {
            pages.push('ellipsis');
            for (let i = total - 9; i <= total; i++) {
                pages.push(i);
            }
        }
        else {
            pages.push('ellipsis');
            pages.push(current - 1);
            pages.push(current);
            pages.push(current + 1);
            pages.push('ellipsis');
            pages.push(total);
        }
        return pages;
    };
    const tracksWithId = filteredTracks.filter((track) => track.spotify_id);
    const allSelected = tracksWithId.length > 0 &&
        tracksWithId.every((track) => selectedTracks.includes(track.spotify_id!));
    const formatDuration = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };
    const formatPlays = (plays: string | undefined) => {
        if (!plays)
            return "";
        const num = parseInt(plays, 10);
        if (isNaN(num))
            return plays;
        return num.toLocaleString();
    };
    const getAvailabilityButtonIcon = (spotifyId?: string) => {
        if (!spotifyId) {
            return <Globe className="h-4 w-4"/>;
        }
        if (checkingAvailabilityTrack === spotifyId) {
            return <Spinner />;
        }
        const availability = availabilityMap?.get(spotifyId);
        if (!availability) {
            return <Globe className="h-4 w-4"/>;
        }
        if (hasAvailabilityLinks(availability)) {
            return <CheckCircle className="h-4 w-4 text-green-500"/>;
        }
        return <XCircle className="h-4 w-4 text-red-500"/>;
    };
    return (<div className="space-y-4">
    <div className="rounded-md border">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              {showCheckboxes && (<th className="h-12 px-4 text-left align-middle w-12">
                <Checkbox checked={allSelected} onCheckedChange={() => onToggleSelectAll(filteredTracks)}/>
              </th>)}
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-12">
                #
              </th>
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                Title
              </th>
              {!hideAlbumColumn && (<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell">
                Album
              </th>)}
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden lg:table-cell w-24">
                Duration
              </th>
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden xl:table-cell w-32">
                Plays
              </th>
              <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground w-32">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedTracks.map((track, index) => (<tr key={index} className="border-b transition-colors hover:bg-muted/50">
              {showCheckboxes && (<td className="p-4 align-middle">
                {track.spotify_id && (<Checkbox checked={selectedTracks.includes(track.spotify_id)} onCheckedChange={() => onToggleTrack(track.spotify_id!)}/>)}
              </td>)}
              <td className="p-4 align-middle text-sm text-muted-foreground">
                <div className="flex flex-col items-center gap-0.5">
                  <span>{startIndex + index + 1}</span>
                  {track.status && (track.status === "UP" || track.status === "DOWN" || track.status === "NEW") && (<span className={`text-xs ${track.status === "UP"
                    ? "text-green-500"
                    : track.status === "DOWN"
                        ? "text-red-500"
                        : track.status === "NEW"
                            ? "text-blue-500"
                            : ""}`}>
                    {track.status === "NEW" ? "●" : track.status === "UP" ? "▲" : "▼"}
                  </span>)}
                </div>
              </td>
              <td className="p-4 align-middle">
                <div className="flex items-center gap-3">
                  {track.images && (<img src={track.images} alt={track.name} className="w-10 h-10 rounded object-cover"/>)}
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      {onTrackClick ? (<span className="font-medium cursor-pointer hover:underline" onClick={() => onTrackClick(track)}>
                        {track.name}
                      </span>) : (<span className="font-medium">{track.name}</span>)}
                      {track.is_explicit && (<span className="inline-flex items-center justify-center bg-red-600 text-white text-[10px] h-4 w-4 rounded shrink-0" title="Explicit">E</span>)}

                      {track.spotify_id && skippedTracks.has(track.spotify_id) ? (<FileCheck className="h-4 w-4 text-yellow-500 shrink-0"/>) : track.spotify_id && downloadedTracks.has(track.spotify_id) ? (<CheckCircle className="h-4 w-4 text-green-500 shrink-0"/>) : track.spotify_id && failedTracks.has(track.spotify_id) ? (<XCircle className="h-4 w-4 text-red-500 shrink-0"/>) : null}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {(() => {
                const clickableArtists = buildClickableArtists(track.artists, track.artists_data, track.artist_id, track.artist_url);
                if (clickableArtists.length === 0) {
                    return track.artists;
                }
                return clickableArtists.map((artist, i) => (<span key={`${artist.id || artist.name}-${i}`}>
                            {onArtistClick ? (<span className="cursor-pointer hover:underline" onClick={() => onArtistClick({
                            id: artist.id,
                            name: artist.name,
                            external_urls: artist.external_urls,
                        })}>
                                {artist.name}
                              </span>) : (artist.name)}
                            {i < clickableArtists.length - 1 && ", "}
                          </span>));
            })()}
                    </span>
                  </div>
                </div>
              </td>
              {!hideAlbumColumn && (<td className="p-4 align-middle text-sm text-muted-foreground hidden md:table-cell">
                {onAlbumClick && track.album_id && track.album_url ? (<span className="cursor-pointer hover:underline" onClick={() => onAlbumClick({
                        id: track.album_id!,
                        name: track.album_name,
                        external_urls: track.album_url!,
                    })}>
                  {track.album_name}
                </span>) : (track.album_name)}
              </td>)}
              <td className="p-4 align-middle text-sm text-muted-foreground hidden lg:table-cell">
                {formatDuration(track.duration_ms)}
              </td>
              <td className="p-4 align-middle text-sm text-muted-foreground hidden xl:table-cell">
                {track.plays ? formatPlays(track.plays) : ""}
              </td>
              <td className="p-4 align-middle text-center">
                <div className="flex items-center justify-center gap-1">
                  {track.spotify_id && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={() => onDownloadTrack(track.spotify_id!, track.name, track.artists, track.album_name, track.spotify_id, folderName, track.duration_ms, startIndex + index + 1, track.album_artist, track.release_date, track.images, track.track_number, track.disc_number, track.total_tracks, track.total_discs, track.copyright, track.publisher, track.is_explicit)} size="icon" disabled={isDownloading || downloadingTrack === track.spotify_id}>
                        {downloadingTrack === track.spotify_id ? (<Spinner />) : skippedTracks.has(track.spotify_id) ? (<FileCheck className="h-4 w-4"/>) : downloadedTracks.has(track.spotify_id) ? (<CheckCircle className="h-4 w-4"/>) : failedTracks.has(track.spotify_id) ? (<XCircle className="h-4 w-4"/>) : (<Download className="h-4 w-4"/>)}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {downloadingTrack === track.spotify_id ? (<p>Downloading...</p>) : skippedTracks.has(track.spotify_id) ? (<p>Already exists</p>) : downloadedTracks.has(track.spotify_id) ? (<p>Downloaded</p>) : failedTracks.has(track.spotify_id) ? (<p>Failed</p>) : (<p>Download Track</p>)}
                    </TooltipContent>
                  </Tooltip>)}
                  {track.spotify_id && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={() => playPreview(track.spotify_id!, track.name)} size="icon" variant="outline" disabled={loadingPreview === track.spotify_id}>
                        {loadingPreview === track.spotify_id ? (<Spinner />) : playingTrack === track.spotify_id ? (<Pause className="h-4 w-4"/>) : (<Play className="h-4 w-4"/>)}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{playingTrack === track.spotify_id ? "Stop Preview" : "Play Preview"}</p>
                    </TooltipContent>
                  </Tooltip>)}
                  {track.spotify_id && onDownloadLyrics && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={() => onDownloadLyrics(track.spotify_id!, track.name, track.artists, track.album_name, folderName, isArtistDiscography, startIndex + index + 1, track.album_artist, track.release_date, track.disc_number)} size="icon" variant="outline" disabled={downloadingLyricsTrack === track.spotify_id}>
                        {downloadingLyricsTrack === track.spotify_id ? (<Spinner />) : skippedLyrics?.has(track.spotify_id) ? (<FileCheck className="h-4 w-4 text-yellow-500"/>) : downloadedLyrics?.has(track.spotify_id) ? (<CheckCircle className="h-4 w-4 text-green-500"/>) : failedLyrics?.has(track.spotify_id) ? (<XCircle className="h-4 w-4 text-red-500"/>) : (<FileText className="h-4 w-4"/>)}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download Separate Lyric</p>
                    </TooltipContent>
                  </Tooltip>)}
                  {track.images && onDownloadCover && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={() => {
                    const trackId = track.spotify_id || `${track.name}-${track.artists}`;
                    onDownloadCover(track.images, track.name, track.artists, track.album_name, folderName, isArtistDiscography, startIndex + index + 1, trackId, track.album_artist, track.release_date, track.disc_number);
                }} size="icon" variant="outline" disabled={downloadingCoverTrack === (track.spotify_id || `${track.name}-${track.artists}`)}>
                        {downloadingCoverTrack === (track.spotify_id || `${track.name}-${track.artists}`) ? (<Spinner />) : skippedCovers?.has(track.spotify_id || `${track.name}-${track.artists}`) ? (<FileCheck className="h-4 w-4 text-yellow-500"/>) : downloadedCovers?.has(track.spotify_id || `${track.name}-${track.artists}`) ? (<CheckCircle className="h-4 w-4 text-green-500"/>) : failedCovers?.has(track.spotify_id || `${track.name}-${track.artists}`) ? (<XCircle className="h-4 w-4 text-red-500"/>) : (<ImageDown className="h-4 w-4"/>)}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download Separate Cover</p>
                    </TooltipContent>
                  </Tooltip>)}
                  {track.spotify_id && onCheckAvailability && (<Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={() => onCheckAvailability(track.spotify_id!)} size="icon" variant="outline" disabled={checkingAvailabilityTrack === track.spotify_id}>
                        {getAvailabilityButtonIcon(track.spotify_id)}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="pointer-events-auto">
                      <AvailabilityLinks availability={track.spotify_id ? availabilityMap?.get(track.spotify_id) : undefined}/>
                    </TooltipContent>
                  </Tooltip>)}
                </div>
              </td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </div>

    {totalPages > 1 && (<Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" onClick={(e) => {
                e.preventDefault();
                if (currentPage > 1)
                    onPageChange(currentPage - 1);
            }} className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}/>
        </PaginationItem>

        {getPaginationPages(currentPage, totalPages).map((page, index) => (page === 'ellipsis' ? (<PaginationItem key={`ellipsis-${index}`}>
              <PaginationEllipsis />
            </PaginationItem>) : (<PaginationItem key={page}>
              <PaginationLink href="#" onClick={(e) => {
                    e.preventDefault();
                    onPageChange(page);
                }} isActive={currentPage === page} className="cursor-pointer">
                {page}
              </PaginationLink>
            </PaginationItem>)))}

        <PaginationItem>
          <PaginationNext href="#" onClick={(e) => {
                e.preventDefault();
                if (currentPage < totalPages)
                    onPageChange(currentPage + 1);
            }} className={currentPage === totalPages
                ? "pointer-events-none opacity-50"
                : "cursor-pointer"}/>
        </PaginationItem>
      </PaginationContent>
    </Pagination>)}
  </div>);
}
