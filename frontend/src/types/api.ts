export interface ArtistSimple {
    id: string;
    name: string;
    external_urls: string;
}
export interface TrackMetadata {
    artists: string;
    name: string;
    album_name: string;
    album_artist?: string;
    duration_ms: number;
    images: string;
    release_date: string;
    track_number: number;
    total_tracks?: number;
    total_discs?: number;
    disc_number?: number;
    external_urls: string;
    album_type?: string;
    spotify_id?: string;
    album_id?: string;
    album_url?: string;
    artist_id?: string;
    artist_url?: string;
    artists_data?: ArtistSimple[];
    isrc?: string;
    upc?: string;
    copyright?: string;
    publisher?: string;
    plays?: string;
    status?: string;
    is_explicit?: boolean;
}
export interface TrackResponse {
    track: TrackMetadata;
}
export interface AlbumInfo {
    total_tracks: number;
    name: string;
    release_date: string;
    artists: string;
    images: string;
    upc?: string;
    batch?: string;
}
export interface AlbumResponse {
    album_info: AlbumInfo;
    track_list: TrackMetadata[];
}
export interface PlaylistInfo {
    name: string;
    tracks: {
        total: number;
    };
    followers: {
        total: number;
    };
    owner: {
        display_name: string;
        name: string;
        images: string;
    };
    cover?: string;
    description?: string;
    batch?: string;
}
export interface PlaylistResponse {
    playlist_info: PlaylistInfo;
    track_list: TrackMetadata[];
}
export interface ArtistInfo {
    name: string;
    followers: number;
    genres: string[];
    images: string;
    header?: string;
    gallery?: string[];
    external_urls: string;
    discography_type: string;
    total_albums: number;
    biography?: string;
    verified?: boolean;
    listeners?: number;
    rank?: number;
    batch?: string;
}
export interface DiscographyAlbum {
    id: string;
    name: string;
    album_type: string;
    release_date: string;
    total_tracks: number;
    artists: string;
    images: string;
    external_urls: string;
}
export interface ArtistDiscographyResponse {
    artist_info: ArtistInfo;
    album_list: DiscographyAlbum[];
    track_list: TrackMetadata[];
}
export interface ArtistResponse {
    artist: {
        name: string;
        followers: number;
        genres: string[];
        images: string;
        external_urls: string;
        popularity: number;
    };
}
export type SpotifyMetadataResponse = TrackResponse | AlbumResponse | PlaylistResponse | ArtistDiscographyResponse | ArtistResponse;
export interface DownloadRequest {
    service: "tidal" | "qobuz" | "amazon" | "youtube";
    query?: string;
    track_name?: string;
    artist_name?: string;
    album_name?: string;
    album_artist?: string;
    release_date?: string;
    cover_url?: string;
    tidal_api_url?: string;
    output_dir?: string;
    audio_format?: string;
    folder_name?: string;
    filename_format?: string;
    track_number?: boolean;
    position?: number;
    use_album_track_number?: boolean;
    spotify_id?: string;
    embed_lyrics?: boolean;
    embed_max_quality_cover?: boolean;
    service_url?: string;
    duration?: number;
    item_id?: string;
    spotify_track_number?: number;
    spotify_disc_number?: number;
    spotify_total_tracks?: number;
    spotify_total_discs?: number;
    isrc?: string;
    copyright?: string;
    publisher?: string;
    spotify_url?: string;
    use_first_artist_only?: boolean;
    use_single_genre?: boolean;
    embed_genre?: boolean;
}
export interface DownloadResponse {
    success: boolean;
    message: string;
    file?: string;
    error?: string;
    already_exists?: boolean;
    item_id?: string;
}
export interface HealthResponse {
    status: string;
    time: string;
}
export interface CurrentIPInfo {
    ip: string;
    country: string;
    country_code?: string;
    source?: string;
}
export interface TimeSlice {
    time: number;
    magnitudes: number[] | Float32Array;
}
export interface SpectrumData {
    time_slices: TimeSlice[];
    sample_rate: number;
    freq_bins: number;
    duration: number;
    max_freq: number;
}
export interface AnalysisResult {
    file_path: string;
    file_size: number;
    file_type?: "FLAC" | "MP3" | "M4A" | "AAC";
    sample_rate: number;
    channels: number;
    bits_per_sample: number;
    total_samples: number;
    duration: number;
    bit_depth: string;
    dynamic_range: number;
    peak_amplitude: number;
    rms_level: number;
    codec_mode?: string;
    bitrate_kbps?: number;
    total_frames?: number;
    codec_version?: string;
    spectrum?: SpectrumData;
}
export interface LyricsDownloadRequest {
    spotify_id: string;
    track_name: string;
    artist_name: string;
    album_name?: string;
    album_artist?: string;
    release_date?: string;
    isrc?: string;
    output_dir?: string;
    filename_format?: string;
    track_number?: boolean;
    position?: number;
    use_album_track_number?: boolean;
    disc_number?: number;
}
export interface LyricsDownloadResponse {
    success: boolean;
    message: string;
    file?: string;
    error?: string;
    already_exists?: boolean;
}
export interface TrackAvailability {
    spotify_id: string;
    tidal: boolean;
    amazon: boolean;
    qobuz: boolean;
    tidal_url?: string;
    amazon_url?: string;
    qobuz_url?: string;
}
export interface CoverDownloadRequest {
    cover_url: string;
    track_name: string;
    artist_name: string;
    album_name?: string;
    album_artist?: string;
    release_date?: string;
    output_dir?: string;
    filename_format?: string;
    track_number?: boolean;
    position?: number;
    disc_number?: number;
}
export interface CoverDownloadResponse {
    success: boolean;
    message: string;
    file?: string;
    error?: string;
    already_exists?: boolean;
}
export interface HeaderDownloadRequest {
    header_url: string;
    artist_name: string;
    output_dir?: string;
}
export interface HeaderDownloadResponse {
    success: boolean;
    message: string;
    file?: string;
    error?: string;
    already_exists?: boolean;
}
export interface GalleryImageDownloadRequest {
    image_url: string;
    artist_name: string;
    image_index: number;
    output_dir?: string;
}
export interface GalleryImageDownloadResponse {
    success: boolean;
    message: string;
    file?: string;
    error?: string;
    already_exists?: boolean;
}
export interface AvatarDownloadRequest {
    avatar_url: string;
    artist_name: string;
    output_dir?: string;
}
export interface AvatarDownloadResponse {
    success: boolean;
    message: string;
    file?: string;
    error?: string;
    already_exists?: boolean;
}
export interface AudioMetadata {
    title: string;
    artist: string;
    album: string;
    album_artist: string;
    track_number: number;
    disc_number: number;
    year: string;
    upc?: string;
    isrc?: string;
}
