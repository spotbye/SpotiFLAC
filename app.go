package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"

	"path/filepath"

	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/afkarxyz/SpotiFLAC/backend"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context
}

type CurrentIPInfo struct {
	IP          string `json:"ip"`
	Country     string `json:"country"`
	CountryCode string `json:"country_code,omitempty"`
	Source      string `json:"source,omitempty"`
}

const checkOperationTimeout = 10 * time.Second

func NewApp() *App {
	return &App{}
}

type timedResult[T any] struct {
	value T
	err   error
}

func runWithTimeout[T any](timeout time.Duration, fn func() (T, error)) (T, error) {
	resultCh := make(chan timedResult[T], 1)

	go func() {
		value, err := fn()
		resultCh <- timedResult[T]{value: value, err: err}
	}()

	select {
	case result := <-resultCh:
		return result.value, result.err
	case <-time.After(timeout):
		var zero T
		return zero, fmt.Errorf("operation timed out after %s", timeout)
	}
}

func containsStreamingURL(body []byte) bool {
	trimmedBody := strings.TrimSpace(string(body))
	if trimmedBody == "" {
		return false
	}

	var directResp struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(body, &directResp); err == nil && isStreamingURL(directResp.URL) {
		return true
	}

	var nestedResp struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &nestedResp); err == nil && isStreamingURL(nestedResp.Data.URL) {
		return true
	}

	return isStreamingURL(trimmedBody)
}

func containsLRCLIBResults(body []byte) bool {
	trimmedBody := strings.TrimSpace(string(body))
	if trimmedBody == "" {
		return false
	}

	var searchResults []map[string]interface{}
	if err := json.Unmarshal(body, &searchResults); err == nil {
		return len(searchResults) > 0
	}

	var exactResult map[string]interface{}
	if err := json.Unmarshal(body, &exactResult); err == nil {
		return len(exactResult) > 0
	}

	return false
}

func containsMusicBrainzResults(body []byte) bool {
	trimmedBody := strings.TrimSpace(string(body))
	if trimmedBody == "" {
		return false
	}

	var payload struct {
		Count      int               `json:"count"`
		Recordings []json.RawMessage `json:"recordings"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return false
	}

	return payload.Count > 0 || len(payload.Recordings) > 0
}

func isStreamingURL(raw string) bool {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return false
	}

	parsed, err := url.Parse(candidate)
	if err != nil {
		return false
	}

	return (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

func previewResponseBody(body []byte, maxLen int) string {
	preview := strings.TrimSpace(string(body))
	if maxLen > 0 && len(preview) > maxLen {
		return preview[:maxLen] + "..."
	}
	return preview
}

func fetchCurrentIPInfo() (CurrentIPInfo, error) {
	type ipwhoisResponse struct {
		Success     bool   `json:"success"`
		IP          string `json:"ip"`
		Country     string `json:"country"`
		CountryCode string `json:"country_code"`
		Message     string `json:"message"`
	}
	type ipapiResponse struct {
		IP          string `json:"ip"`
		Country     string `json:"country_name"`
		CountryCode string `json:"country_code"`
		Error       bool   `json:"error"`
		Reason      string `json:"reason"`
	}

	client := &http.Client{Timeout: 8 * time.Second}
	tryFetch := func(source, reqURL string, parse func(body []byte) (CurrentIPInfo, error)) (CurrentIPInfo, error) {
		req, err := http.NewRequest(http.MethodGet, reqURL, nil)
		if err != nil {
			return CurrentIPInfo{}, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			return CurrentIPInfo{}, err
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return CurrentIPInfo{}, err
		}
		if resp.StatusCode != http.StatusOK {
			return CurrentIPInfo{}, fmt.Errorf("%s returned status %d: %s", source, resp.StatusCode, previewResponseBody(body, 200))
		}

		info, err := parse(body)
		if err != nil {
			return CurrentIPInfo{}, err
		}
		info.Source = source
		return info, nil
	}

	info, err := tryFetch("ipwho.is", "https://ipwho.is/", func(body []byte) (CurrentIPInfo, error) {
		var payload ipwhoisResponse
		if err := json.Unmarshal(body, &payload); err != nil {
			return CurrentIPInfo{}, err
		}
		if !payload.Success {
			return CurrentIPInfo{}, fmt.Errorf("ipwho.is lookup failed: %s", strings.TrimSpace(payload.Message))
		}
		if strings.TrimSpace(payload.IP) == "" || strings.TrimSpace(payload.Country) == "" {
			return CurrentIPInfo{}, fmt.Errorf("ipwho.is returned incomplete IP data")
		}
		return CurrentIPInfo{
			IP:          strings.TrimSpace(payload.IP),
			Country:     strings.TrimSpace(payload.Country),
			CountryCode: strings.TrimSpace(payload.CountryCode),
		}, nil
	})
	if err == nil {
		return info, nil
	}
	firstErr := err

	info, err = tryFetch("ipapi.co", "https://ipapi.co/json/", func(body []byte) (CurrentIPInfo, error) {
		var payload ipapiResponse
		if err := json.Unmarshal(body, &payload); err != nil {
			return CurrentIPInfo{}, err
		}
		if payload.Error {
			return CurrentIPInfo{}, fmt.Errorf("ipapi.co lookup failed: %s", strings.TrimSpace(payload.Reason))
		}
		if strings.TrimSpace(payload.IP) == "" || strings.TrimSpace(payload.Country) == "" {
			return CurrentIPInfo{}, fmt.Errorf("ipapi.co returned incomplete IP data")
		}
		return CurrentIPInfo{
			IP:          strings.TrimSpace(payload.IP),
			Country:     strings.TrimSpace(payload.Country),
			CountryCode: strings.TrimSpace(payload.CountryCode),
		}, nil
	})
	if err == nil {
		return info, nil
	}

	return CurrentIPInfo{}, fmt.Errorf("failed to detect public IP: %v; fallback failed: %v", firstErr, err)
}

func (a *App) GetCurrentIPInfo() (string, error) {
	info, err := fetchCurrentIPInfo()
	if err != nil {
		return "", err
	}

	payload, err := json.Marshal(info)
	if err != nil {
		return "", err
	}

	return string(payload), nil
}

func (a *App) getFirstArtist(artistString string) string {
	if artistString == "" {
		return ""
	}
	delimiters := []string{", ", " & ", " feat. ", " ft. ", " featuring "}
	for _, d := range delimiters {
		if idx := strings.Index(strings.ToLower(artistString), d); idx != -1 {
			return strings.TrimSpace(artistString[:idx])
		}
	}
	return artistString
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	if err := backend.InitHistoryDB("SpotiFLAC"); err != nil {
		fmt.Printf("Failed to init history DB: %v\n", err)
	}
	if err := backend.InitISRCCacheDB(); err != nil {
		fmt.Printf("Failed to init ISRC cache DB: %v\n", err)
	}
	if err := backend.InitProviderPriorityDB(); err != nil {
		fmt.Printf("Failed to init provider priority DB: %v\n", err)
	}
	go func() {
		if err := backend.PrimeTidalAPIList(); err != nil {
			fmt.Printf("Failed to prime Tidal API list: %v\n", err)
		}
	}()
}

func (a *App) shutdown(ctx context.Context) {
	backend.CloseHistoryDB()
	backend.CloseISRCCacheDB()
	backend.CloseProviderPriorityDB()
}

type SpotifyMetadataRequest struct {
	URL       string  `json:"url"`
	Batch     bool    `json:"batch"`
	Delay     float64 `json:"delay"`
	Timeout   float64 `json:"timeout"`
	Separator string  `json:"separator,omitempty"`
}

type DownloadRequest struct {
	Service              string `json:"service"`
	Query                string `json:"query,omitempty"`
	TrackName            string `json:"track_name,omitempty"`
	ArtistName           string `json:"artist_name,omitempty"`
	AlbumName            string `json:"album_name,omitempty"`
	AlbumArtist          string `json:"album_artist,omitempty"`
	ReleaseDate          string `json:"release_date,omitempty"`
	CoverURL             string `json:"cover_url,omitempty"`
	TidalAPIURL          string `json:"tidal_api_url,omitempty"`
	OutputDir            string `json:"output_dir,omitempty"`
	AudioFormat          string `json:"audio_format,omitempty"`
	FilenameFormat       string `json:"filename_format,omitempty"`
	TrackNumber          bool   `json:"track_number,omitempty"`
	Position             int    `json:"position,omitempty"`
	UseAlbumTrackNumber  bool   `json:"use_album_track_number,omitempty"`
	SpotifyID            string `json:"spotify_id,omitempty"`
	EmbedLyrics          bool   `json:"embed_lyrics,omitempty"`
	EmbedMaxQualityCover bool   `json:"embed_max_quality_cover,omitempty"`
	ServiceURL           string `json:"service_url,omitempty"`
	Duration             int    `json:"duration,omitempty"`
	ItemID               string `json:"item_id,omitempty"`
	SpotifyTrackNumber   int    `json:"spotify_track_number,omitempty"`
	SpotifyDiscNumber    int    `json:"spotify_disc_number,omitempty"`
	SpotifyTotalTracks   int    `json:"spotify_total_tracks,omitempty"`
	SpotifyTotalDiscs    int    `json:"spotify_total_discs,omitempty"`
	ISRC                 string `json:"isrc,omitempty"`
	Copyright            string `json:"copyright,omitempty"`
	Publisher            string `json:"publisher,omitempty"`
	Composer             string `json:"composer,omitempty"`
	PlaylistName         string `json:"playlist_name,omitempty"`
	PlaylistOwner        string `json:"playlist_owner,omitempty"`
	AllowFallback        bool   `json:"allow_fallback"`
	UseFirstArtistOnly   bool   `json:"use_first_artist_only,omitempty"`
	UseSingleGenre       bool   `json:"use_single_genre,omitempty"`
	EmbedGenre           bool   `json:"embed_genre,omitempty"`
	Separator            string `json:"separator,omitempty"`
	IsExplicit           bool   `json:"is_explicit,omitempty"`
}

type DownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
	ItemID        string `json:"item_id,omitempty"`
}

func cleanupInvalidDownloadArtifacts(paths ...string) {
	seen := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		if path == "" {
			continue
		}
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		if err := os.Remove(path); err == nil {
			fmt.Printf("Removed invalid download artifact: %s\n", path)
		}
	}
}

func (a *App) GetStreamingURLs(spotifyTrackID string, region string) (string, error) {
	if spotifyTrackID == "" {
		return "", fmt.Errorf("spotify track ID is required")
	}

	fmt.Printf("[GetStreamingURLs] Called for track ID: %s, Region: %s\n", spotifyTrackID, region)
	client := backend.NewSongLinkClient()
	urls, err := client.GetAllURLsFromSpotify(spotifyTrackID, region)
	if err != nil {
		return "", err
	}

	jsonData, err := json.Marshal(urls)
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}

func (a *App) GetSpotifyMetadata(req SpotifyMetadataRequest) (string, error) {
	if req.URL == "" {
		return "", fmt.Errorf("URL parameter is required")
	}

	if req.Delay == 0 {
		req.Delay = 1.0
	}
	if req.Timeout == 0 {
		req.Timeout = 300.0
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(req.Timeout*float64(time.Second)))
	defer cancel()

	settings, err := a.LoadSettings()
	separator := req.Separator
	if separator == "" {
		separator = ", "
		if err == nil && settings != nil {
			if sep, ok := settings["separator"].(string); ok {
				if sep == "semicolon" {
					separator = "; "
				} else if sep == "comma" {
					separator = ", "
				}
			}
		}
	}

	data, err := backend.GetFilteredSpotifyData(ctx, req.URL, req.Batch, time.Duration(req.Delay*float64(time.Second)), separator, func(tracks interface{}) {
		runtime.EventsEmit(a.ctx, "metadata-stream", tracks)
	})
	if err != nil {
		return "", fmt.Errorf("failed to fetch metadata: %v", err)
	}

	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}

type SpotifySearchRequest struct {
	Query string `json:"query"`
	Limit int    `json:"limit"`
}

func (a *App) SearchSpotify(req SpotifySearchRequest) (*backend.SearchResponse, error) {
	if req.Query == "" {
		return nil, fmt.Errorf("search query is required")
	}

	if req.Limit <= 0 {
		req.Limit = 10
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return backend.SearchSpotify(ctx, req.Query, req.Limit)
}

type SpotifySearchByTypeRequest struct {
	Query      string `json:"query"`
	SearchType string `json:"search_type"`
	Limit      int    `json:"limit"`
	Offset     int    `json:"offset"`
}

func (a *App) SearchSpotifyByType(req SpotifySearchByTypeRequest) ([]backend.SearchResult, error) {
	if req.Query == "" {
		return nil, fmt.Errorf("search query is required")
	}

	if req.SearchType == "" {
		return nil, fmt.Errorf("search type is required")
	}

	if req.Limit <= 0 {
		req.Limit = 50
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return backend.SearchSpotifyByType(ctx, req.Query, req.SearchType, req.Limit, req.Offset)
}

func (a *App) DownloadTrack(req DownloadRequest) (DownloadResponse, error) {

	if req.Service == "qobuz" && req.SpotifyID == "" {
		return DownloadResponse{
			Success: false,
			Error:   "Spotify ID is required for Qobuz",
		}, fmt.Errorf("spotify ID is required for Qobuz")
	}

	if req.Service == "" {
		req.Service = "tidal"
	}

	if req.OutputDir == "" {
		req.OutputDir = "."
	} else {

		if req.PlaylistName != "" {
			sanitizedPlaylist := backend.SanitizeFilename(req.PlaylistName)
			req.OutputDir = filepath.Join(req.OutputDir, sanitizedPlaylist)
		}

		req.OutputDir = backend.SanitizeFolderPath(req.OutputDir)
	}

	if req.AudioFormat == "" {
		req.AudioFormat = "LOSSLESS"
	}

	req.TrackName = backend.ApplyExplicitTitleSuffix(req.TrackName, req.IsExplicit)

	var err error
	var filename string

	if req.FilenameFormat == "" {
		req.FilenameFormat = "title-artist"
	}
	shouldResolveISRC := strings.Contains(req.FilenameFormat, "{isrc}") || backend.GetExistingFileCheckModeSetting() == "isrc"
	if req.ISRC == "" && shouldResolveISRC && req.SpotifyID != "" {
		req.ISRC = backend.ResolveTrackISRC(req.SpotifyID)
	}

	itemID := req.ItemID
	if itemID == "" {

		if req.SpotifyID != "" {
			itemID = fmt.Sprintf("%s-%d", req.SpotifyID, time.Now().UnixNano())
		} else {
			itemID = fmt.Sprintf("%s-%s-%d", req.TrackName, req.ArtistName, time.Now().UnixNano())
		}

		backend.AddToQueue(itemID, req.TrackName, req.ArtistName, req.AlbumName, req.SpotifyID)
	}

	backend.SetDownloading(true)
	backend.StartDownloadItem(itemID)
	defer backend.SetDownloading(false)

	spotifyURL := ""
	if req.SpotifyID != "" {
		spotifyURL = fmt.Sprintf("https://open.spotify.com/track/%s", req.SpotifyID)
	}

	metadataSeparator := req.Separator
	if metadataSeparator == "" {
		metadataSeparator = ", "
		metadataSettings, _ := a.LoadSettings()
		if metadataSettings != nil {
			if sep, ok := metadataSettings["separator"].(string); ok {
				if sep == "semicolon" {
					metadataSeparator = "; "
				} else if sep == "comma" {
					metadataSeparator = ", "
				}
			}
		}
	}

	if req.SpotifyID != "" && (req.Copyright == "" || req.Publisher == "" || req.Composer == "" || req.SpotifyTotalDiscs == 0 || req.ReleaseDate == "" || req.SpotifyTotalTracks == 0 || req.SpotifyTrackNumber == 0) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		trackURL := fmt.Sprintf("https://open.spotify.com/track/%s", req.SpotifyID)
		trackData, err := backend.GetFilteredSpotifyData(ctx, trackURL, false, 0, metadataSeparator, nil)
		if err == nil {

			var trackResp struct {
				Track struct {
					Copyright   string `json:"copyright"`
					Publisher   string `json:"publisher"`
					Composer    string `json:"composer"`
					TotalDiscs  int    `json:"total_discs"`
					TotalTracks int    `json:"total_tracks"`
					TrackNumber int    `json:"track_number"`
					ReleaseDate string `json:"release_date"`
				} `json:"track"`
			}
			if jsonData, jsonErr := json.Marshal(trackData); jsonErr == nil {
				if json.Unmarshal(jsonData, &trackResp) == nil {

					if req.Copyright == "" && trackResp.Track.Copyright != "" {
						req.Copyright = trackResp.Track.Copyright
					}
					if req.Publisher == "" && trackResp.Track.Publisher != "" {
						req.Publisher = trackResp.Track.Publisher
					}
					if req.Composer == "" && trackResp.Track.Composer != "" {
						req.Composer = trackResp.Track.Composer
					}
					if req.SpotifyTotalDiscs == 0 && trackResp.Track.TotalDiscs > 0 {
						req.SpotifyTotalDiscs = trackResp.Track.TotalDiscs
					}
					if req.SpotifyTotalTracks == 0 && trackResp.Track.TotalTracks > 0 {
						req.SpotifyTotalTracks = trackResp.Track.TotalTracks
					}
					if req.SpotifyTrackNumber == 0 && trackResp.Track.TrackNumber > 0 {
						req.SpotifyTrackNumber = trackResp.Track.TrackNumber
					}
					if req.ReleaseDate == "" && trackResp.Track.ReleaseDate != "" {
						req.ReleaseDate = trackResp.Track.ReleaseDate
					}
				}
			}
		}
	}

	if req.TrackName != "" && req.ArtistName != "" {
		expectedFilename := backend.BuildExpectedFilename(req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.FilenameFormat, req.PlaylistName, req.PlaylistOwner, req.TrackNumber, req.Position, req.SpotifyDiscNumber, req.UseAlbumTrackNumber, req.ISRC)
		expectedPath := filepath.Join(req.OutputDir, expectedFilename)

		if !backend.GetRedownloadWithSuffixSetting() {
			if fileInfo, err := os.Stat(expectedPath); err == nil && fileInfo.Size() > 100*1024 {

				backend.SkipDownloadItem(itemID, expectedPath)
				return DownloadResponse{
					Success:       true,
					Message:       "File already exists",
					File:          expectedPath,
					AlreadyExists: true,
					ItemID:        itemID,
				}, nil
			}
		}
	}

	lyricsChan := make(chan string, 1)
	isrcChan := make(chan string, 1)

	if req.SpotifyID != "" {
		if req.EmbedLyrics {
			go func() {
				client := backend.NewLyricsClient()
				resp, _, err := client.FetchLyricsAllSources(req.SpotifyID, req.TrackName, req.ArtistName, req.AlbumName, req.Duration)
				if err == nil && resp != nil && len(resp.Lines) > 0 {
					lrc := client.ConvertToLRC(resp, req.TrackName, req.ArtistName)
					lyricsChan <- lrc
				} else {
					lyricsChan <- ""
				}
			}()
		} else {
			close(lyricsChan)
		}

		if req.Service == "qobuz" {
			go func() {
				client := backend.NewSongLinkClient()
				isrc, err := client.GetISRCDirect(req.SpotifyID)
				if err != nil {
					fmt.Printf("Warning: failed to resolve ISRC for Qobuz: %v\n", err)
				}
				isrcChan <- isrc
			}()
		} else {
			close(isrcChan)
		}
	} else {
		close(lyricsChan)
		close(isrcChan)
	}

	switch req.Service {
	case "amazon":

		downloader := backend.NewAmazonDownloader()
		if req.ServiceURL != "" {
			filename, err = downloader.DownloadByURL(req.ServiceURL, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.PlaylistName, req.PlaylistOwner, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.CoverURL, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks, req.EmbedMaxQualityCover, req.SpotifyTotalDiscs, req.Copyright, req.Publisher, req.Composer, metadataSeparator, req.ISRC, spotifyURL, req.UseFirstArtistOnly, req.UseSingleGenre, req.EmbedGenre)
		} else {
			filename, err = downloader.DownloadBySpotifyID(req.SpotifyID, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.PlaylistName, req.PlaylistOwner, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.CoverURL, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks, req.EmbedMaxQualityCover, req.SpotifyTotalDiscs, req.Copyright, req.Publisher, req.Composer, metadataSeparator, req.ISRC, spotifyURL, req.UseFirstArtistOnly, req.UseSingleGenre, req.EmbedGenre)
		}

	case "tidal":
		if req.TidalAPIURL == "" || req.TidalAPIURL == "auto" {
			downloader := backend.NewTidalDownloader("")
			if req.ServiceURL != "" {
				filename, err = downloader.DownloadByURLWithFallback(req.ServiceURL, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.UseAlbumTrackNumber, req.CoverURL, req.EmbedMaxQualityCover, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks, req.SpotifyTotalDiscs, req.Copyright, req.Publisher, req.Composer, metadataSeparator, req.ISRC, spotifyURL, req.AllowFallback, req.UseFirstArtistOnly, req.UseSingleGenre, req.EmbedGenre)
			} else {
				filename, err = downloader.Download(req.SpotifyID, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.UseAlbumTrackNumber, req.CoverURL, req.EmbedMaxQualityCover, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks, req.SpotifyTotalDiscs, req.Copyright, req.Publisher, req.Composer, metadataSeparator, req.ISRC, spotifyURL, req.AllowFallback, req.UseFirstArtistOnly, req.UseSingleGenre, req.EmbedGenre)
			}
		} else {
			downloader := backend.NewTidalDownloader(req.TidalAPIURL)
			if req.ServiceURL != "" {
				filename, err = downloader.DownloadByURL(req.ServiceURL, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.UseAlbumTrackNumber, req.CoverURL, req.EmbedMaxQualityCover, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks, req.SpotifyTotalDiscs, req.Copyright, req.Publisher, req.Composer, metadataSeparator, req.ISRC, spotifyURL, req.AllowFallback, req.UseFirstArtistOnly, req.UseSingleGenre, req.EmbedGenre)
			} else {
				filename, err = downloader.Download(req.SpotifyID, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.UseAlbumTrackNumber, req.CoverURL, req.EmbedMaxQualityCover, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks, req.SpotifyTotalDiscs, req.Copyright, req.Publisher, req.Composer, metadataSeparator, req.ISRC, spotifyURL, req.AllowFallback, req.UseFirstArtistOnly, req.UseSingleGenre, req.EmbedGenre)
			}
		}

	case "qobuz":

		isrc := strings.TrimSpace(req.ISRC)
		if isrc == "" {
			fmt.Println("Waiting for ISRC (Qobuz dependency)...")
			isrc = <-isrcChan
		}
		downloader := backend.NewQobuzDownloader()
		quality := req.AudioFormat
		if quality == "" {
			quality = "6"
		}
		filename, err = downloader.DownloadTrackWithISRC(isrc, req.OutputDir, quality, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.UseAlbumTrackNumber, req.CoverURL, req.EmbedMaxQualityCover, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks, req.SpotifyTotalDiscs, req.Copyright, req.Publisher, req.Composer, metadataSeparator, spotifyURL, req.AllowFallback, req.UseFirstArtistOnly, req.UseSingleGenre, req.EmbedGenre)

	default:
		return DownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("Unknown service: %s", req.Service),
		}, fmt.Errorf("unknown service: %s", req.Service)
	}

	if err != nil {
		backend.FailDownloadItem(itemID, fmt.Sprintf("Download failed: %v", err))

		if filename != "" && !strings.HasPrefix(filename, "EXISTS:") {

			if _, statErr := os.Stat(filename); statErr == nil {
				fmt.Printf("Removing corrupted/partial file after failed download: %s\n", filename)
				if removeErr := os.Remove(filename); removeErr != nil {
					fmt.Printf("Warning: Failed to remove corrupted file %s: %v\n", filename, removeErr)
				}
			}
		}

		return DownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("Download failed: %v", err),
			ItemID:  itemID,
		}, err
	}

	alreadyExists := false
	if strings.HasPrefix(filename, "EXISTS:") {
		alreadyExists = true
		filename = strings.TrimPrefix(filename, "EXISTS:")
	}

	if !alreadyExists {
		validated, validationErr := backend.ValidateDownloadedTrackDuration(filename, req.Duration)
		if validationErr != nil {
			cleanupInvalidDownloadArtifacts(filename)
			errorMessage := validationErr.Error()
			backend.FailDownloadItem(itemID, errorMessage)
			return DownloadResponse{
				Success: false,
				Error:   errorMessage,
				ItemID:  itemID,
			}, errors.New(errorMessage)
		}
		if !validated {
			fmt.Printf("[DownloadValidation] Skipped duration validation for %s (expected=%ds)\n", filename, req.Duration)
		}
	}

	if !alreadyExists && req.SpotifyID != "" && req.EmbedLyrics && (strings.HasSuffix(filename, ".flac") || strings.HasSuffix(filename, ".mp3") || strings.HasSuffix(filename, ".m4a")) {
		fmt.Printf("\nWaiting for lyrics fetch to complete...\n")
		lyrics := <-lyricsChan
		if lyrics != "" {
			fmt.Printf("\n--- Full LRC Content ---\n")
			fmt.Println(lyrics)
			fmt.Printf("--- End LRC Content ---\n\n")

			fmt.Printf("Embedding into: %s\n", filename)

			if err := backend.EmbedLyricsOnlyUniversal(filename, lyrics); err != nil {
				fmt.Printf("Failed to embed lyrics: %v\n", err)
			} else {
				fmt.Printf("Lyrics embedded successfully!\n")
			}
		} else {
			fmt.Println("No lyrics found to embed.")
		}
	} else {

		select {
		case <-lyricsChan:
		default:
		}
	}

	message := "Download completed successfully"
	if alreadyExists {
		message = "File already exists"
		backend.SkipDownloadItem(itemID, filename)
	} else {
		if strings.EqualFold(filepath.Ext(filename), ".flac") && req.CoverURL != "" {
			coverClient := backend.NewCoverClient()
			if iconErr := coverClient.ApplyMacOSFLACFileIcon(filename, req.CoverURL, 256, req.EmbedMaxQualityCover); iconErr != nil {
				fmt.Printf("Warning: failed to set macOS FLAC file icon: %v\n", iconErr)
			} else {
				fmt.Printf("macOS FLAC file icon set: %s\n", filename)
			}
		}

		if fileInfo, statErr := os.Stat(filename); statErr == nil {
			finalSize := float64(fileInfo.Size()) / (1024 * 1024)
			backend.CompleteDownloadItem(itemID, filename, finalSize)
		} else {

			backend.CompleteDownloadItem(itemID, filename, 0)
		}

		historySource := req.Service

		go func(fPath, track, artist, album, sID, cover, format, source string) {
			time.Sleep(2 * time.Second)

			quality := "Unknown"
			durationStr := "0:00"

			meta, err := backend.GetTrackMetadata(fPath)
			if err == nil {
				if meta.Bitrate > 0 {
					quality = fmt.Sprintf("%dkbps/%.1fkHz", meta.Bitrate/1000, float64(meta.SampleRate)/1000.0)
				} else if meta.SampleRate > 0 {
					quality = fmt.Sprintf("%.1fkHz", float64(meta.SampleRate)/1000.0)
				}
				d := int(meta.Duration)
				durationStr = fmt.Sprintf("%d:%02d", d/60, d%60)
			} else {
				fmt.Printf("[History] Failed to get metadata for %s: %v\n", fPath, err)
			}

			item := backend.HistoryItem{
				SpotifyID:   sID,
				Title:       track,
				Artists:     artist,
				Album:       album,
				DurationStr: durationStr,
				CoverURL:    cover,
				Quality:     quality,
				Path:        fPath,
				Source:      source,
			}

			item.Format = strings.ToUpper(strings.TrimSpace(format))

			if ext := filepath.Ext(fPath); len(ext) > 1 {
				item.Format = strings.ToUpper(ext[1:])
			}

			switch item.Format {
			case "6", "7", "27", "LOSSLESS", "HI_RES", "HI_RES_LOSSLESS":
				item.Format = "FLAC"
			case "ALAC", "APPLE", "ATMOS", "M4A-AAC", "M4A-ALAC":
				item.Format = "M4A"
			}

			backend.AddHistoryItem(item, "SpotiFLAC")
		}(filename, req.TrackName, req.ArtistName, req.AlbumName, req.SpotifyID, req.CoverURL, req.AudioFormat, historySource)
	}

	return DownloadResponse{
		Success:       true,
		Message:       message,
		File:          filename,
		AlreadyExists: alreadyExists,
		ItemID:        itemID,
	}, nil
}

func (a *App) OpenFolder(path string) error {
	if path == "" {
		return fmt.Errorf("path is required")
	}

	err := backend.OpenFolderInExplorer(path)
	if err != nil {
		return fmt.Errorf("failed to open folder: %v", err)
	}

	return nil
}

func (a *App) OpenConfigFolder() error {
	configDir, err := backend.EnsureAppDir()
	if err != nil {
		return fmt.Errorf("failed to create config directory: %v", err)
	}
	return backend.OpenFolderInExplorer(configDir)
}

func (a *App) SelectFolder(defaultPath string) (string, error) {
	return backend.SelectFolderDialog(a.ctx, defaultPath)
}

func (a *App) SelectFile() (string, error) {
	return backend.SelectFileDialog(a.ctx)
}

func (a *App) GetDefaults() map[string]string {
	return map[string]string{
		"downloadPath": backend.GetDefaultMusicPath(),
	}
}

func (a *App) GetDownloadProgress() backend.ProgressInfo {
	return backend.GetDownloadProgress()
}

func (a *App) GetDownloadQueue() backend.DownloadQueueInfo {
	return backend.GetDownloadQueue()
}

func (a *App) ClearCompletedDownloads() {
	backend.ClearDownloadQueue()
}

func (a *App) ClearAllDownloads() {
	backend.ClearAllDownloads()
}

func (a *App) AddToDownloadQueue(spotifyID, trackName, artistName, albumName string) string {
	itemID := fmt.Sprintf("%s-%d", spotifyID, time.Now().UnixNano())
	backend.AddToQueue(itemID, trackName, artistName, albumName, "")
	return itemID
}

func (a *App) MarkDownloadItemFailed(itemID, errorMsg string) {
	backend.FailDownloadItem(itemID, errorMsg)
}

func (a *App) CancelAllQueuedItems() {
	backend.CancelAllQueuedItems()
}

func (a *App) ExportFailedDownloads() (string, error) {
	queueInfo := backend.GetDownloadQueue()
	var failedItems []string

	hasFailed := false
	for _, item := range queueInfo.Queue {
		if item.Status == backend.StatusFailed {
			hasFailed = true
			break
		}
	}

	if !hasFailed {
		return "No failed downloads to export.", nil
	}

	failedItems = append(failedItems, fmt.Sprintf("Failed Downloads Report - %s", time.Now().Format("2006-01-02 15:04:05")))
	failedItems = append(failedItems, strings.Repeat("-", 50))
	failedItems = append(failedItems, "")

	count := 0
	for _, item := range queueInfo.Queue {
		if item.Status == backend.StatusFailed {
			count++
			line := fmt.Sprintf("%d. %s - %s", count, item.TrackName, item.ArtistName)
			if item.AlbumName != "" {
				line += fmt.Sprintf(" (%s)", item.AlbumName)
			}
			failedItems = append(failedItems, line)
			failedItems = append(failedItems, fmt.Sprintf("   Error: %s", item.ErrorMessage))

			if item.SpotifyID != "" {
				failedItems = append(failedItems, fmt.Sprintf("   ID: %s", item.SpotifyID))
				failedItems = append(failedItems, fmt.Sprintf("   URL: https://open.spotify.com/track/%s", item.SpotifyID))
			}
			failedItems = append(failedItems, "")
		}
	}

	content := strings.Join(failedItems, "\n")
	defaultFilename := fmt.Sprintf("SpotiFLAC_%s_Failed.txt", time.Now().Format("20060102_150405"))

	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultFilename,
		Title:           "Export Failed Downloads",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Text Files (*.txt)",
				Pattern:     "*.txt",
			},
		},
	})

	if err != nil {
		return "", fmt.Errorf("failed to open save dialog: %v", err)
	}

	if path == "" {
		return "Export cancelled", nil
	}

	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return "", fmt.Errorf("failed to write file: %v", err)
	}

	return fmt.Sprintf("Successfully exported %d failed downloads to %s", count, path), nil
}

func (a *App) CheckAPIStatus(apiType string, apiURL string) bool {
	isOnline, err := runWithTimeout(checkOperationTimeout, func() (bool, error) {
		switch apiType {
		case "tidal":
			if checkGroupedAPIStatus("tidal", buildTidalStatusCheckURLs(apiURL)) {
				return true, nil
			}
			if strings.TrimSpace(apiURL) == "" {
				if _, refreshErr := backend.RefreshTidalAPIList(true); refreshErr == nil && checkGroupedAPIStatus("tidal", buildTidalStatusCheckURLs("")) {
					return true, nil
				}
			}
			return false, nil
		case "qobuz", "qbz":
			return checkGroupedAPIStatus("qobuz", buildQobuzStatusCheckURLs(apiURL)), nil
		case "amazon":
			return checkGroupedAPIStatus("amazon", buildAmazonStatusCheckURLs(apiURL)), nil
		case "lrclib":
			return checkGroupedAPIStatus("lrclib", buildLRCLIBStatusCheckURLs(apiURL)), nil
		case "musicbrainz":
			return checkGroupedAPIStatus("musicbrainz", buildMusicBrainzStatusCheckURLs(apiURL)), nil
		default:
			return checkGroupedAPIStatus(apiType, []string{strings.TrimSpace(apiURL)}), nil
		}
	})
	if err != nil {
		if apiType == "musicbrainz" {
			backend.SetMusicBrainzStatusCheckResult(false)
		}
		fmt.Printf("CheckAPIStatus timeout/error for %s (%s): %v\n", apiType, apiURL, err)
		return false
	}

	if apiType == "musicbrainz" {
		backend.SetMusicBrainzStatusCheckResult(isOnline)
	}

	return isOnline
}

func (a *App) CheckCustomTidalAPI(apiURL string) bool {
	type tidalProbeResponse struct {
		Version string `json:"version"`
		Data    struct {
			TrackID           int64  `json:"trackId"`
			AssetPresentation string `json:"assetPresentation"`
			ManifestMimeType  string `json:"manifestMimeType"`
			Manifest          string `json:"manifest"`
		} `json:"data"`
	}
	type tidalLegacyResponse struct {
		OriginalTrackURL string `json:"OriginalTrackUrl"`
	}

	apiURL = strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if apiURL == "" {
		return false
	}

	const probeTrackID int64 = 441821360
	probeURL := fmt.Sprintf("%s/track/?id=%d&quality=LOSSLESS", apiURL, probeTrackID)

	req, err := http.NewRequest(http.MethodGet, probeURL, nil)
	if err != nil {
		fmt.Printf("[CheckCustomTidalAPI] Failed to create request for %s: %v\n", apiURL, err)
		return false
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("[CheckCustomTidalAPI] Probe request failed for %s: %v\n", apiURL, err)
		return false
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		fmt.Printf("[CheckCustomTidalAPI] Failed to read probe response for %s: %v\n", apiURL, err)
		return false
	}
	if resp.StatusCode != http.StatusOK {
		fmt.Printf("[CheckCustomTidalAPI] Probe returned status %d for %s: %s\n", resp.StatusCode, apiURL, previewResponseBody(body, 200))
		return false
	}

	var probe tidalProbeResponse
	if err := json.Unmarshal(body, &probe); err == nil {
		assetPresentation := strings.ToUpper(strings.TrimSpace(probe.Data.AssetPresentation))
		switch assetPresentation {
		case "FULL":
			if strings.TrimSpace(probe.Data.Manifest) != "" {
				fmt.Printf("[CheckCustomTidalAPI] Tidal API is ONLINE for %s (assetPresentation=%s)\n", apiURL, assetPresentation)
				return true
			}
			fmt.Printf("[CheckCustomTidalAPI] Probe returned FULL without manifest for %s\n", apiURL)
			return false
		case "PREVIEW":
			fmt.Printf("[CheckCustomTidalAPI] Probe returned PREVIEW for %s\n", apiURL)
			return false
		case "":

		default:
			fmt.Printf("[CheckCustomTidalAPI] Probe returned unsupported assetPresentation=%s for %s\n", assetPresentation, apiURL)
			return false
		}
	}

	var legacy []tidalLegacyResponse
	if err := json.Unmarshal(body, &legacy); err == nil {
		for _, item := range legacy {
			if strings.TrimSpace(item.OriginalTrackURL) != "" {
				fmt.Printf("[CheckCustomTidalAPI] Tidal API is ONLINE for %s (legacy response)\n", apiURL)
				return true
			}
		}
	}

	fmt.Printf("[CheckCustomTidalAPI] Probe response was unusable for %s: %s\n", apiURL, previewResponseBody(body, 200))
	return false
}

func buildTidalStatusCheckURLs(apiURL string) []string {
	apiURL = strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if apiURL != "" {
		return []string{fmt.Sprintf("%s/track/?id=441821360&quality=HI_RES_LOSSLESS", apiURL)}
	}

	apis, err := backend.GetRotatedTidalAPIList()
	if err != nil {
		fmt.Printf("Warning: failed to load rotated Tidal API list for status check: %v\n", err)
	}

	urls := make([]string, 0, len(apis))
	for _, baseURL := range apis {
		baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
		if baseURL == "" {
			continue
		}
		urls = append(urls, fmt.Sprintf("%s/track/?id=441821360&quality=HI_RES_LOSSLESS", baseURL))
	}

	return urls
}

func buildQobuzStatusCheckURLs(apiURL string) []string {
	if trimmed := strings.TrimSpace(apiURL); trimmed != "" {
		return []string{buildQobuzStatusCheckURL(trimmed)}
	}

	bases := backend.GetQobuzStreamAPIBaseURLs()
	urls := make([]string, 0, len(bases)+1)
	for _, baseURL := range bases {
		urls = append(urls, buildQobuzStatusCheckURL(baseURL))
	}
	if musicDLURL := strings.TrimSpace(backend.GetQobuzMusicDLDownloadAPIURL()); musicDLURL != "" {
		urls = append(urls, musicDLURL)
	}
	return urls
}

func buildQobuzStatusCheckURL(apiBase string) string {
	apiBase = strings.TrimSpace(apiBase)
	return fmt.Sprintf("%s360735657&quality=27", apiBase)
}

func buildAmazonStatusCheckURLs(apiURL string) []string {
	baseURL := strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if baseURL == "" {
		baseURL = backend.GetAmazonMusicAPIBaseURL()
	}
	return []string{fmt.Sprintf("%s/status", baseURL)}
}

func buildLRCLIBStatusCheckURLs(apiURL string) []string {
	baseURL := strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if baseURL == "" {
		baseURL = "https://lrclib.net"
	}
	return []string{fmt.Sprintf("%s/api/search?artist_name=Adele&track_name=Hello", baseURL)}
}

func buildMusicBrainzStatusCheckURLs(apiURL string) []string {
	baseURL := strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if baseURL == "" {
		baseURL = "https://musicbrainz.org"
	}
	return []string{fmt.Sprintf("%s/ws/2/recording?query=%s&fmt=json&limit=1", baseURL, url.QueryEscape(`recording:"Hello" AND artist:"Adele"`))}
}

func checkGroupedAPIStatus(apiType string, checkURLs []string) bool {
	filtered := make([]string, 0, len(checkURLs))
	for _, rawURL := range checkURLs {
		url := strings.TrimSpace(rawURL)
		if url == "" {
			continue
		}
		filtered = append(filtered, url)
	}

	if len(filtered) == 0 {
		return false
	}

	results := make(chan bool, len(filtered))
	var wg sync.WaitGroup

	for _, checkURL := range filtered {
		wg.Add(1)
		go func(target string) {
			defer wg.Done()
			results <- checkSingleAPIStatus(apiType, target)
		}(checkURL)
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	for online := range results {
		if online {
			return true
		}
	}

	return false
}

func checkSingleAPIStatus(apiType string, checkURL string) bool {
	client := &http.Client{Timeout: 4 * time.Second}
	if (apiType == "qobuz" || apiType == "qbz") && strings.EqualFold(strings.TrimSpace(checkURL), strings.TrimSpace(backend.GetQobuzMusicDLDownloadAPIURL())) {
		return backend.CheckQobuzMusicDLStatus(client)
	}

	req, err := backend.NewRequestWithDefaultHeaders(http.MethodGet, checkURL, nil)
	if err != nil {
		return false
	}

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false
	}

	statusCode := resp.StatusCode
	switch apiType {
	case "amazon":
		return statusCode == http.StatusOK && strings.Contains(string(body), `"amazonMusic":"up"`)
	case "qobuz", "qbz":
		return statusCode == http.StatusOK && containsStreamingURL(body)
	case "lrclib":
		return statusCode == http.StatusOK && containsLRCLIBResults(body)
	case "musicbrainz":
		return statusCode == http.StatusOK && containsMusicBrainzResults(body)
	default:
		return statusCode == http.StatusOK
	}
}

func (a *App) Quit() {

	panic("quit")
}

func (a *App) GetDownloadHistory() ([]backend.HistoryItem, error) {
	return backend.GetHistoryItems("SpotiFLAC")
}

func (a *App) ClearDownloadHistory() error {
	return backend.ClearHistory("SpotiFLAC")
}

func (a *App) DeleteDownloadHistoryItem(id string) error {
	return backend.DeleteHistoryItem(id, "SpotiFLAC")
}

func (a *App) GetFetchHistory() ([]backend.FetchHistoryItem, error) {
	return backend.GetFetchHistoryItems("SpotiFLAC")
}

func (a *App) AddFetchHistory(item backend.FetchHistoryItem) error {
	return backend.AddFetchHistoryItem(item, "SpotiFLAC")
}

func (a *App) ClearFetchHistory() error {
	return backend.ClearFetchHistory("SpotiFLAC")
}

func (a *App) DeleteFetchHistoryItem(id string) error {
	return backend.DeleteFetchHistoryItem(id, "SpotiFLAC")
}

func (a *App) ClearFetchHistoryByType(itemType string) error {
	return backend.ClearFetchHistoryByType(itemType, "SpotiFLAC")
}

func (a *App) GetRecentFetches() (string, error) {
	items, err := backend.LoadRecentFetches()
	if err != nil {
		return "", err
	}

	data, err := json.Marshal(items)
	if err != nil {
		return "", err
	}

	return string(data), nil
}

func (a *App) SaveRecentFetches(payload string) error {
	payload = strings.TrimSpace(payload)
	if payload == "" {
		payload = "[]"
	}

	var items []backend.RecentFetchItem
	if err := json.Unmarshal([]byte(payload), &items); err != nil {
		return err
	}

	return backend.SaveRecentFetches(items)
}

func (a *App) SaveSpectrumImage(audioFilePath string, base64Data string) (string, error) {
	if audioFilePath == "" || base64Data == "" {
		return "", fmt.Errorf("file path and image data are required")
	}

	base64Data = strings.TrimPrefix(base64Data, "data:image/png;base64,")

	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64 image: %v", err)
	}

	ext := filepath.Ext(audioFilePath)
	baseName := strings.TrimSuffix(filepath.Base(audioFilePath), ext)
	outPath := filepath.Join(filepath.Dir(audioFilePath), baseName+".png")

	err = os.WriteFile(outPath, data, 0644)
	if err != nil {
		return "", fmt.Errorf("failed to save image to disk: %v", err)
	}

	return outPath, nil
}

type LyricsDownloadRequest struct {
	SpotifyID           string `json:"spotify_id"`
	TrackName           string `json:"track_name"`
	ArtistName          string `json:"artist_name"`
	AlbumName           string `json:"album_name"`
	AlbumArtist         string `json:"album_artist"`
	ReleaseDate         string `json:"release_date"`
	ISRC                string `json:"isrc,omitempty"`
	OutputDir           string `json:"output_dir"`
	FilenameFormat      string `json:"filename_format"`
	TrackNumber         bool   `json:"track_number"`
	Position            int    `json:"position"`
	UseAlbumTrackNumber bool   `json:"use_album_track_number"`
	DiscNumber          int    `json:"disc_number"`
}

func (a *App) DownloadLyrics(req LyricsDownloadRequest) (backend.LyricsDownloadResponse, error) {
	if req.SpotifyID == "" {
		return backend.LyricsDownloadResponse{
			Success: false,
			Error:   "Spotify ID is required",
		}, fmt.Errorf("spotify ID is required")
	}

	client := backend.NewLyricsClient()
	backendReq := backend.LyricsDownloadRequest{
		SpotifyID:           req.SpotifyID,
		TrackName:           req.TrackName,
		ArtistName:          req.ArtistName,
		AlbumName:           req.AlbumName,
		AlbumArtist:         req.AlbumArtist,
		ReleaseDate:         req.ReleaseDate,
		ISRC:                req.ISRC,
		OutputDir:           req.OutputDir,
		FilenameFormat:      req.FilenameFormat,
		TrackNumber:         req.TrackNumber,
		Position:            req.Position,
		UseAlbumTrackNumber: req.UseAlbumTrackNumber,
		DiscNumber:          req.DiscNumber,
	}

	resp, err := client.DownloadLyrics(backendReq)
	if err != nil {
		return backend.LyricsDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	return *resp, nil
}

type CoverDownloadRequest struct {
	CoverURL       string `json:"cover_url"`
	TrackName      string `json:"track_name"`
	ArtistName     string `json:"artist_name"`
	AlbumName      string `json:"album_name"`
	AlbumArtist    string `json:"album_artist"`
	ReleaseDate    string `json:"release_date"`
	OutputDir      string `json:"output_dir"`
	FilenameFormat string `json:"filename_format"`
	TrackNumber    bool   `json:"track_number"`
	Position       int    `json:"position"`
	DiscNumber     int    `json:"disc_number"`
}

func (a *App) DownloadCover(req CoverDownloadRequest) (backend.CoverDownloadResponse, error) {
	if req.CoverURL == "" {
		return backend.CoverDownloadResponse{
			Success: false,
			Error:   "Cover URL is required",
		}, fmt.Errorf("cover URL is required")
	}

	client := backend.NewCoverClient()
	backendReq := backend.CoverDownloadRequest{
		CoverURL:       req.CoverURL,
		TrackName:      req.TrackName,
		ArtistName:     req.ArtistName,
		AlbumName:      req.AlbumName,
		AlbumArtist:    req.AlbumArtist,
		ReleaseDate:    req.ReleaseDate,
		OutputDir:      req.OutputDir,
		FilenameFormat: req.FilenameFormat,
		TrackNumber:    req.TrackNumber,
		Position:       req.Position,
		DiscNumber:     req.DiscNumber,
	}

	resp, err := client.DownloadCover(backendReq)
	if err != nil {
		return backend.CoverDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	return *resp, nil
}

type HeaderDownloadRequest struct {
	HeaderURL  string `json:"header_url"`
	ArtistName string `json:"artist_name"`
	OutputDir  string `json:"output_dir"`
}

func (a *App) DownloadHeader(req HeaderDownloadRequest) (backend.HeaderDownloadResponse, error) {
	if req.HeaderURL == "" {
		return backend.HeaderDownloadResponse{
			Success: false,
			Error:   "Header URL is required",
		}, fmt.Errorf("header URL is required")
	}

	if req.ArtistName == "" {
		return backend.HeaderDownloadResponse{
			Success: false,
			Error:   "Artist name is required",
		}, fmt.Errorf("artist name is required")
	}

	client := backend.NewCoverClient()
	backendReq := backend.HeaderDownloadRequest{
		HeaderURL:  req.HeaderURL,
		ArtistName: req.ArtistName,
		OutputDir:  req.OutputDir,
	}

	resp, err := client.DownloadHeader(backendReq)
	if err != nil {
		return backend.HeaderDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	return *resp, nil
}

type GalleryImageDownloadRequest struct {
	ImageURL   string `json:"image_url"`
	ArtistName string `json:"artist_name"`
	ImageIndex int    `json:"image_index"`
	OutputDir  string `json:"output_dir"`
}

func (a *App) DownloadGalleryImage(req GalleryImageDownloadRequest) (backend.GalleryImageDownloadResponse, error) {
	if req.ImageURL == "" {
		return backend.GalleryImageDownloadResponse{
			Success: false,
			Error:   "Image URL is required",
		}, fmt.Errorf("image URL is required")
	}

	if req.ArtistName == "" {
		return backend.GalleryImageDownloadResponse{
			Success: false,
			Error:   "Artist name is required",
		}, fmt.Errorf("artist name is required")
	}

	client := backend.NewCoverClient()
	backendReq := backend.GalleryImageDownloadRequest{
		ImageURL:   req.ImageURL,
		ArtistName: req.ArtistName,
		ImageIndex: req.ImageIndex,
		OutputDir:  req.OutputDir,
	}

	resp, err := client.DownloadGalleryImage(backendReq)
	if err != nil {
		return backend.GalleryImageDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	return *resp, nil
}

type AvatarDownloadRequest struct {
	AvatarURL  string `json:"avatar_url"`
	ArtistName string `json:"artist_name"`
	OutputDir  string `json:"output_dir"`
}

func (a *App) DownloadAvatar(req AvatarDownloadRequest) (backend.AvatarDownloadResponse, error) {
	if req.AvatarURL == "" {
		return backend.AvatarDownloadResponse{
			Success: false,
			Error:   "Avatar URL is required",
		}, fmt.Errorf("avatar URL is required")
	}

	if req.ArtistName == "" {
		return backend.AvatarDownloadResponse{
			Success: false,
			Error:   "Artist name is required",
		}, fmt.Errorf("artist name is required")
	}

	client := backend.NewCoverClient()
	backendReq := backend.AvatarDownloadRequest{
		AvatarURL:  req.AvatarURL,
		ArtistName: req.ArtistName,
		OutputDir:  req.OutputDir,
	}

	resp, err := client.DownloadAvatar(backendReq)
	if err != nil {
		return backend.AvatarDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	return *resp, nil
}

func (a *App) CheckTrackAvailability(spotifyTrackID string) (string, error) {
	if spotifyTrackID == "" {
		return "", fmt.Errorf("spotify track ID is required")
	}

	return runWithTimeout(checkOperationTimeout, func() (string, error) {
		client := backend.NewSongLinkClient()
		availability, err := client.CheckTrackAvailability(spotifyTrackID)
		if err != nil {
			return "", err
		}

		jsonData, err := json.Marshal(availability)
		if err != nil {
			return "", fmt.Errorf("failed to encode response: %v", err)
		}

		return string(jsonData), nil
	})
}

func (a *App) IsFFmpegInstalled() (bool, error) {
	return backend.IsFFmpegInstalled()
}

func (a *App) IsFFprobeInstalled() (bool, error) {
	return backend.IsFFprobeInstalled()
}

type DownloadFFmpegRequest struct{}

type DownloadFFmpegResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}

func (a *App) DownloadFFmpeg() DownloadFFmpegResponse {
	runtime.EventsEmit(a.ctx, "ffmpeg:status", "starting")
	err := backend.DownloadFFmpeg(func(progress int) {
		runtime.EventsEmit(a.ctx, "ffmpeg:progress", progress)
	})
	if err != nil {
		runtime.EventsEmit(a.ctx, "ffmpeg:status", "failed")
		return DownloadFFmpegResponse{
			Success: false,
			Error:   err.Error(),
		}
	}

	runtime.EventsEmit(a.ctx, "ffmpeg:status", "completed")
	return DownloadFFmpegResponse{
		Success: true,
		Message: "FFmpeg installed successfully",
	}
}

func (a *App) GetBrewPath() string {
	return backend.GetBrewPath()
}

func (a *App) IsBrewFFmpegInstalled() (bool, error) {
	return backend.IsBrewFFmpegInstalled()
}

type InstallFFmpegWithBrewResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}

func (a *App) InstallFFmpegWithBrew() InstallFFmpegWithBrewResponse {
	runtime.EventsEmit(a.ctx, "ffmpeg:status", "Installing FFmpeg via Homebrew...")
	err := backend.InstallFFmpegWithBrew(func(progress int, status string) {
		runtime.EventsEmit(a.ctx, "ffmpeg:progress", progress)
		runtime.EventsEmit(a.ctx, "ffmpeg:status", status)
	})
	if err != nil {
		runtime.EventsEmit(a.ctx, "ffmpeg:status", "failed")
		return InstallFFmpegWithBrewResponse{
			Success: false,
			Error:   err.Error(),
		}
	}

	runtime.EventsEmit(a.ctx, "ffmpeg:status", "completed")
	return InstallFFmpegWithBrewResponse{
		Success: true,
		Message: "FFmpeg installed successfully via Homebrew",
	}
}

type ConvertAudioRequest struct {
	InputFiles   []string `json:"input_files"`
	OutputFormat string   `json:"output_format"`
	Bitrate      string   `json:"bitrate"`
	Codec        string   `json:"codec"`
}

func (a *App) ConvertAudio(req ConvertAudioRequest) ([]backend.ConvertAudioResult, error) {
	backendReq := backend.ConvertAudioRequest{
		InputFiles:   req.InputFiles,
		OutputFormat: req.OutputFormat,
		Bitrate:      req.Bitrate,
		Codec:        req.Codec,
	}
	return backend.ConvertAudio(backendReq)
}

type ResampleAudioRequest struct {
	InputFiles []string `json:"input_files"`
	SampleRate string   `json:"sample_rate"`
	BitDepth   string   `json:"bit_depth"`
}

func (a *App) ResampleAudio(req ResampleAudioRequest) ([]backend.ResampleResult, error) {
	backendReq := backend.ResampleRequest{
		InputFiles: req.InputFiles,
		SampleRate: req.SampleRate,
		BitDepth:   req.BitDepth,
	}
	return backend.ResampleAudio(backendReq)
}

func (a *App) SelectAudioFiles() ([]string, error) {
	files, err := backend.SelectMultipleFiles(a.ctx)
	if err != nil {
		return nil, err
	}
	return files, nil
}

func (a *App) GetFlacInfoBatch(paths []string) []backend.FlacInfo {
	return backend.GetFlacInfoBatch(paths)
}

func (a *App) GetFileSizes(files []string) map[string]int64 {
	return backend.GetFileSizes(files)
}

func (a *App) ListDirectoryFiles(dirPath string) ([]backend.FileInfo, error) {
	if dirPath == "" {
		return nil, fmt.Errorf("directory path is required")
	}
	return backend.ListDirectory(dirPath)
}

func (a *App) ListAudioFilesInDir(dirPath string) ([]backend.FileInfo, error) {
	if dirPath == "" {
		return nil, fmt.Errorf("directory path is required")
	}
	return backend.ListAudioFiles(dirPath)
}

func (a *App) ReadFileMetadata(filePath string) (*backend.AudioMetadata, error) {
	if filePath == "" {
		return nil, fmt.Errorf("file path is required")
	}
	return backend.ReadAudioMetadata(filePath)
}

func (a *App) PreviewRenameFiles(files []string, format string) []backend.RenamePreview {
	return backend.PreviewRename(files, format)
}

func (a *App) RenameFilesByMetadata(files []string, format string) []backend.RenameResult {
	return backend.RenameFiles(files, format)
}

func (a *App) ReadTextFile(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

func (a *App) ReadFileAsBase64(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(content), nil
}

func (a *App) DecodeAudioForAnalysis(filePath string) (*backend.AnalysisDecodeResponse, error) {
	if filePath == "" {
		return nil, fmt.Errorf("file path is required")
	}

	return backend.DecodeAudioForAnalysis(filePath)
}

func (a *App) RenameFileTo(oldPath, newName string) error {
	dir := filepath.Dir(oldPath)
	ext := filepath.Ext(oldPath)
	newPath := filepath.Join(dir, newName+ext)
	return os.Rename(oldPath, newPath)
}

func (a *App) SelectImageVideo() ([]string, error) {
	return backend.SelectImageVideoDialog(a.ctx)
}

func (a *App) ReadImageAsBase64(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	var mimeType string
	switch ext {
	case ".jpg", ".jpeg":
		mimeType = "image/jpeg"
	case ".png":
		mimeType = "image/png"
	case ".gif":
		mimeType = "image/gif"
	case ".webp":
		mimeType = "image/webp"
	default:
		mimeType = "image/jpeg"
	}

	encoded := base64.StdEncoding.EncodeToString(content)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, encoded), nil
}

type CheckFileExistenceRequest struct {
	SpotifyID           string `json:"spotify_id"`
	TrackName           string `json:"track_name"`
	ArtistName          string `json:"artist_name"`
	AlbumName           string `json:"album_name,omitempty"`
	AlbumArtist         string `json:"album_artist,omitempty"`
	ReleaseDate         string `json:"release_date,omitempty"`
	ISRC                string `json:"isrc,omitempty"`
	TrackNumber         int    `json:"track_number,omitempty"`
	DiscNumber          int    `json:"disc_number,omitempty"`
	Position            int    `json:"position,omitempty"`
	UseAlbumTrackNumber bool   `json:"use_album_track_number,omitempty"`
	FilenameFormat      string `json:"filename_format,omitempty"`
	IncludeTrackNumber  bool   `json:"include_track_number,omitempty"`
	AudioFormat         string `json:"audio_format,omitempty"`
	RelativePath        string `json:"relative_path,omitempty"`
	IsExplicit          bool   `json:"is_explicit,omitempty"`
}

type CheckFileExistenceResult struct {
	SpotifyID  string `json:"spotify_id"`
	Exists     bool   `json:"exists"`
	FilePath   string `json:"file_path,omitempty"`
	TrackName  string `json:"track_name,omitempty"`
	ArtistName string `json:"artist_name,omitempty"`
}

type existingFileLookupIndex struct {
	byFilename map[string]string
	byISRC     map[string]string
}

func isAudioFileForExistenceCheck(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".flac", ".mp3", ".m4a":
		return true
	default:
		return false
	}
}

func normalizeExistingFileIdentifier(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func buildExistingFileLookupIndex(scanRoot string, mode string) existingFileLookupIndex {
	index := existingFileLookupIndex{
		byFilename: make(map[string]string),
		byISRC:     make(map[string]string),
	}

	scanRoot = backend.NormalizePath(scanRoot)
	if scanRoot == "" {
		return index
	}

	_ = filepath.Walk(scanRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() || !isAudioFileForExistenceCheck(path) {
			return nil
		}
		if info.Size() <= 100*1024 {
			return nil
		}

		if _, exists := index.byFilename[info.Name()]; !exists {
			index.byFilename[info.Name()] = path
		}

		if mode == "filename" {
			return nil
		}

		metadata, metadataErr := backend.ExtractFullMetadataFromFile(path)
		if metadataErr != nil {
			return nil
		}

		if normalizedISRC := normalizeExistingFileIdentifier(metadata.ISRC); normalizedISRC != "" {
			if _, exists := index.byISRC[normalizedISRC]; !exists {
				index.byISRC[normalizedISRC] = path
			}
		}

		return nil
	})

	return index
}

func (a *App) CheckFilesExistence(outputDir string, rootDir string, tracks []CheckFileExistenceRequest) []CheckFileExistenceResult {
	if len(tracks) == 0 {
		return []CheckFileExistenceResult{}
	}

	outputDir = backend.NormalizePath(outputDir)
	if rootDir != "" {
		rootDir = backend.NormalizePath(rootDir)
	}

	defaultFilenameFormat := "title-artist"
	redownloadWithSuffix := backend.GetRedownloadWithSuffixSetting()
	existingFileCheckMode := backend.GetExistingFileCheckModeSetting()
	scanRoot := outputDir
	if rootDir != "" {
		scanRoot = rootDir
	}

	type result struct {
		index  int
		result CheckFileExistenceResult
	}

	resultsChan := make(chan result, len(tracks))
	var lookupIndex existingFileLookupIndex
	var lookupIndexOnce sync.Once
	getLookupIndex := func() existingFileLookupIndex {
		lookupIndexOnce.Do(func() {
			lookupIndex = buildExistingFileLookupIndex(scanRoot, existingFileCheckMode)
		})
		return lookupIndex
	}

	for i, track := range tracks {
		go func(idx int, t CheckFileExistenceRequest) {
			res := CheckFileExistenceResult{
				SpotifyID:  t.SpotifyID,
				TrackName:  t.TrackName,
				ArtistName: t.ArtistName,
				Exists:     false,
			}

			if t.TrackName == "" || t.ArtistName == "" {
				resultsChan <- result{index: idx, result: res}
				return
			}

			filenameFormat := t.FilenameFormat
			if filenameFormat == "" {
				filenameFormat = defaultFilenameFormat
			}
			isrc := strings.TrimSpace(t.ISRC)
			shouldResolveISRC := existingFileCheckMode == "isrc" || strings.Contains(filenameFormat, "{isrc}")
			if isrc == "" && shouldResolveISRC && t.SpotifyID != "" {
				isrc = backend.ResolveTrackISRC(t.SpotifyID)
			}

			trackNumber := t.Position
			if t.UseAlbumTrackNumber && t.TrackNumber > 0 {
				trackNumber = t.TrackNumber
			}

			fileExt := ".flac"
			switch strings.ToLower(strings.TrimSpace(t.AudioFormat)) {
			case "mp3":
				fileExt = ".mp3"
			case "m4a", "m4a-aac", "m4a-alac", "alac", "atmos", "apple":
				fileExt = ".m4a"
			}

			expectedFilenameBase := backend.BuildExpectedFilename(
				backend.ApplyExplicitTitleSuffix(t.TrackName, t.IsExplicit),
				t.ArtistName,
				t.AlbumName,
				t.AlbumArtist,
				t.ReleaseDate,
				filenameFormat,
				"",
				"",
				t.IncludeTrackNumber,
				trackNumber,
				t.DiscNumber,
				t.UseAlbumTrackNumber,
				isrc,
			)

			expectedFilename := strings.TrimSuffix(expectedFilenameBase, ".flac") + fileExt

			targetDir := outputDir
			if t.RelativePath != "" {
				targetDir = filepath.Join(outputDir, t.RelativePath)
			}

			expectedPath := filepath.Join(targetDir, expectedFilename)
			if redownloadWithSuffix {
				expectedPath, _ = backend.ResolveOutputPathForDownload(expectedPath, true)
				resultsChan <- result{index: idx, result: res}
				return
			}

			normalizedISRC := normalizeExistingFileIdentifier(isrc)
			effectiveMode := existingFileCheckMode
			if effectiveMode == "isrc" && normalizedISRC == "" {
				effectiveMode = "filename"
			}

			switch effectiveMode {
			case "isrc":
				if path, ok := getLookupIndex().byISRC[normalizedISRC]; ok {
					res.Exists = true
					res.FilePath = path
				}
			default:
				if fileInfo, err := os.Stat(expectedPath); err == nil && fileInfo.Size() > 100*1024 {
					res.Exists = true
					res.FilePath = expectedPath
				} else if path, ok := getLookupIndex().byFilename[filepath.Base(expectedPath)]; ok {
					res.Exists = true
					res.FilePath = path
				}
			}

			resultsChan <- result{index: idx, result: res}
		}(i, track)
	}

	results := make([]CheckFileExistenceResult, len(tracks))

	for i := 0; i < len(tracks); i++ {
		r := <-resultsChan
		results[r.index] = r.result
	}

	return results
}

func (a *App) SkipDownloadItem(itemID, filePath string) {
	backend.SkipDownloadItem(itemID, filePath)
}

func (a *App) GetTrackISRC(spotifyTrackID string) string {
	return backend.ResolveTrackISRC(spotifyTrackID)
}

func (a *App) GetPreviewURL(trackID string) (string, error) {
	return backend.GetPreviewURL(trackID)
}

func (a *App) GetConfigPath() (string, error) {
	dir, err := backend.GetFFmpegDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

func (a *App) GetFontsPath() (string, error) {
	dir, err := backend.GetFFmpegDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "fonts.json"), nil
}

func (a *App) SaveSettings(settings map[string]interface{}) error {
	configPath, err := a.GetConfigPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(configPath)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(configPath, data, 0644)
}

func (a *App) SaveFonts(fonts []map[string]interface{}) error {
	fontsPath, err := a.GetFontsPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(fontsPath)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}

	data, err := json.MarshalIndent(fonts, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(fontsPath, data, 0644)
}

func (a *App) LoadSettings() (map[string]interface{}, error) {
	configPath, err := a.GetConfigPath()
	if err != nil {
		return nil, err
	}

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return nil, nil
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var settings map[string]interface{}
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, err
	}

	return settings, nil
}

func (a *App) LoadFonts() ([]map[string]interface{}, error) {
	fontsPath, err := a.GetFontsPath()
	if err != nil {
		return nil, err
	}

	if _, err := os.Stat(fontsPath); os.IsNotExist(err) {
		return nil, nil
	}

	data, err := os.ReadFile(fontsPath)
	if err != nil {
		return nil, err
	}

	var fonts []map[string]interface{}
	if err := json.Unmarshal(data, &fonts); err != nil {
		return nil, err
	}
	if fonts == nil {
		return []map[string]interface{}{}, nil
	}

	return fonts, nil
}

func (a *App) CheckFFmpegInstalled() (bool, error) {
	return backend.IsFFmpegInstalled()
}

func (a *App) CreateM3U8File(m3u8Name string, outputDir string, filePaths []string) error {
	if len(filePaths) == 0 {
		return nil
	}

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return err
	}

	fnName := m3u8Name

	safeName := backend.SanitizeFilename(fnName)
	if safeName == "" {
		safeName = "playlist"
	}

	m3u8Path := filepath.Join(outputDir, safeName+".m3u8")

	f, err := os.Create(m3u8Path)
	if err != nil {
		return err
	}
	defer f.Close()

	if _, err := f.WriteString("#EXTM3U\n"); err != nil {
		return err
	}

	for _, path := range filePaths {
		if path == "" {
			continue
		}

		relPath, err := filepath.Rel(outputDir, path)
		if err != nil {

			relPath = path
		}

		relPath = filepath.ToSlash(relPath)

		if _, err := f.WriteString(relPath + "\n"); err != nil {
			return err
		}
	}

	return nil
}
