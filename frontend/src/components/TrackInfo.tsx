import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, CheckCircle, XCircle, FileText, FileCheck, Globe, ImageDown, Play, Pause } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import type { TrackMetadata, TrackAvailability } from "@/types/api";
import { usePreview } from "@/hooks/usePreview";
import { AvailabilityLinks, hasAvailabilityLinks } from "./AvailabilityLinks";
import { buildClickableArtists, getClickableArtistKey } from "@/lib/artist-links";
interface TrackInfoProps {
    track: TrackMetadata & {
        album_name: string;
        release_date: string;
    };
    isDownloading: boolean;
    downloadingTrack: string | null;
    isDownloaded: boolean;
    isFailed: boolean;
    isSkipped: boolean;
    downloadingLyricsTrack?: string | null;
    downloadedLyrics?: boolean;
    failedLyrics?: boolean;
    skippedLyrics?: boolean;
    checkingAvailability?: boolean;
    availability?: TrackAvailability;
    downloadingCover?: boolean;
    downloadedCover?: boolean;
    failedCover?: boolean;
    skippedCover?: boolean;
    onDownload: (id: string, name: string, artists: string, albumName?: string, spotifyId?: string, playlistName?: string, durationMs?: number, position?: number, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string) => void;
    onDownloadLyrics?: (spotifyId: string, name: string, artists: string, albumName?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onCheckAvailability?: (spotifyId: string) => void;
    onDownloadCover?: (coverUrl: string, trackName: string, artistName: string, albumName?: string, playlistName?: string, position?: number, trackId?: string, albumArtist?: string, releaseDate?: string, discNumber?: number) => void;
    onOpenFolder: () => void;
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
    onPublisherClick?: (publisher: string) => void;
    onBack?: () => void;
}
export function TrackInfo({ track, isDownloading, downloadingTrack, isDownloaded, isFailed, isSkipped, downloadingLyricsTrack, downloadedLyrics, failedLyrics, skippedLyrics, checkingAvailability, availability, downloadingCover, downloadedCover, failedCover, skippedCover, onDownload, onDownloadLyrics, onCheckAvailability, onDownloadCover, onOpenFolder, onAlbumClick, onArtistClick, onPublisherClick, onBack, }: TrackInfoProps) {
    const { playPreview, loadingPreview, playingTrack } = usePreview();
    const hasAlbumClick = !!(onAlbumClick && track.album_id && track.album_url);
    const clickableArtists = buildClickableArtists(track.artists, track.artists_data, track.artist_id, track.artist_url);
    const formatDuration = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };
    const formatPlays = (plays: string) => {
        const num = parseInt(plays, 10);
        if (isNaN(num))
            return plays;
        return num.toLocaleString();
    };
    return (<Card className="relative">
    {onBack && (<div className="absolute top-4 right-4 z-10">
        <Button variant="ghost" size="icon" onClick={onBack}>
            <XCircle className="h-5 w-5"/>
        </Button>
    </div>)}
    <CardContent className="px-6">
      <div className="flex gap-6 items-start">
        <div className="shrink-0">
          {track.images && (<div className="relative w-48 h-48 rounded-md shadow-lg overflow-hidden">
            <img src={track.images} alt={track.name} className="w-full h-full object-cover"/>
            <div className="absolute bottom-1 right-1 bg-black/80 text-white px-1.5 py-0.5 text-xs font-medium rounded">
              {formatDuration(track.duration_ms)}
            </div>
          </div>)}
        </div>
        <div className="flex-1 space-y-4 min-w-0">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold wrap-break-word">{track.name}</h1>
              {track.is_explicit && (<span className="inline-flex items-center justify-center bg-red-600 text-white text-[10px] h-4 w-4 rounded shrink-0" title="Explicit">E</span>)}
              {isSkipped ? (<FileCheck className="h-6 w-6 text-yellow-500 shrink-0"/>) : isDownloaded ? (<CheckCircle className="h-6 w-6 text-green-500 shrink-0"/>) : isFailed ? (<XCircle className="h-6 w-6 text-red-500 shrink-0"/>) : null}
            </div>
            <p className="text-lg text-muted-foreground">
              {clickableArtists.length > 0 ? clickableArtists.map((artist, index) => (<span key={getClickableArtistKey(artist)}>
                    {onArtistClick ? (<button type="button" className="cursor-pointer rounded-sm bg-transparent p-0 text-inherit hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" onClick={() => onArtistClick({
                    id: artist.id,
                    name: artist.name,
                    external_urls: artist.external_urls,
                })}>
                        {artist.name}
                      </button>) : (artist.name)}
                    {index < clickableArtists.length - 1 && ", "}
                  </span>)) : track.artists}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <div>
                <p className="text-xs text-muted-foreground">Album</p>
                <p className="min-w-0 truncate font-medium">{hasAlbumClick ? (<button type="button" className="block max-w-full cursor-pointer truncate rounded-sm bg-transparent p-0 text-left text-inherit hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" title={track.album_name} onClick={() => onAlbumClick?.({
                id: track.album_id!,
                name: track.album_name,
                external_urls: track.album_url!,
            })}>
                    {track.album_name}
                  </button>) : (track.album_name)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Release Date</p>
                <p className="font-medium">{track.release_date}</p>
              </div>
              {track.plays && (<div>
                <p className="text-xs text-muted-foreground">Total Plays</p>
                <p className="font-medium">{formatPlays(track.plays)}</p>
              </div>)}
            </div>
            <div className="space-y-1">
              {track.copyright && (<div>
                <p className="text-xs text-muted-foreground">Copyright</p>
                <p className="font-medium truncate" title={track.copyright}>
                  {track.copyright}
                </p>
              </div>)}
              {track.publisher && (<div>
                <p className="text-xs text-muted-foreground">Record Label</p>
                <button type="button" className="max-w-full cursor-pointer truncate rounded-sm bg-transparent p-0 text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" title={`Search Spotify for label: ${track.publisher}`} onClick={() => onPublisherClick?.(track.publisher!)}>
                  {track.publisher}
                </button>
              </div>)}
            </div>
          </div>
          {track.spotify_id && (<div className="flex gap-2 flex-wrap">
            <Button onClick={() => onDownload(track.spotify_id || "", track.name, track.artists, track.album_name, track.spotify_id, undefined, track.duration_ms, track.track_number, track.album_artist, track.release_date, track.images, track.track_number, track.disc_number, track.total_tracks, track.total_discs, track.copyright, track.publisher)} disabled={isDownloading || downloadingTrack === track.spotify_id}>
              {downloadingTrack === track.spotify_id ? (<Spinner />) : (<>
                <Download className="h-4 w-4"/>
                Download
              </>)}
            </Button>
            {track.spotify_id && (<Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => playPreview(track.spotify_id!, track.name)} variant="outline" size="icon" disabled={loadingPreview === track.spotify_id}>
                  {loadingPreview === track.spotify_id ? (<Spinner />) : playingTrack === track.spotify_id ? (<Pause className="h-4 w-4"/>) : (<Play className="h-4 w-4"/>)}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{playingTrack === track.spotify_id ? "Stop Preview" : "Play Preview"}</p>
              </TooltipContent>
            </Tooltip>)}
            {track.spotify_id && onDownloadLyrics && (<Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => onDownloadLyrics(track.spotify_id!, track.name, track.artists, track.album_name, track.album_artist, track.release_date, track.disc_number)} variant="outline" size="icon" disabled={downloadingLyricsTrack === track.spotify_id}>
                  {downloadingLyricsTrack === track.spotify_id ? (<Spinner />) : skippedLyrics ? (<FileCheck className="h-4 w-4 text-yellow-500"/>) : downloadedLyrics ? (<CheckCircle className="h-4 w-4 text-green-500"/>) : failedLyrics ? (<XCircle className="h-4 w-4 text-red-500"/>) : (<FileText className="h-4 w-4"/>)}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Download Separate Lyric</p>
              </TooltipContent>
            </Tooltip>)}
            {track.images && onDownloadCover && (<Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => onDownloadCover(track.images, track.name, track.artists, track.album_name, undefined, undefined, track.spotify_id, track.album_artist, track.release_date, track.disc_number)} variant="outline" size="icon" disabled={downloadingCover}>
                  {downloadingCover ? (<Spinner />) : skippedCover ? (<FileCheck className="h-4 w-4 text-yellow-500"/>) : downloadedCover ? (<CheckCircle className="h-4 w-4 text-green-500"/>) : failedCover ? (<XCircle className="h-4 w-4 text-red-500"/>) : (<ImageDown className="h-4 w-4"/>)}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Download Separate Cover</p>
              </TooltipContent>
            </Tooltip>)}
            {track.spotify_id && onCheckAvailability && (<Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => onCheckAvailability(track.spotify_id!)} variant="outline" size="icon" disabled={checkingAvailability}>
                  {checkingAvailability ? (<Spinner />) : availability ? (hasAvailabilityLinks(availability) ? (<CheckCircle className="h-4 w-4 text-green-500"/>) : (<XCircle className="h-4 w-4 text-red-500"/>)) : (<Globe className="h-4 w-4"/>)}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="pointer-events-auto">
                <AvailabilityLinks availability={availability}/>
              </TooltipContent>
            </Tooltip>)}
            {isDownloaded && (<Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={onOpenFolder} variant="outline" size="icon">
                  <FolderOpen className="h-4 w-4"/>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Open Folder</p>
              </TooltipContent>
            </Tooltip>)}
          </div>)}
        </div>
      </div>
    </CardContent>
  </Card>);
}
