package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type QobuzDownloader struct {
	client      *http.Client
	customURL   string
	SourceURL   string
	SourceLabel string
}

func (q *QobuzDownloader) SetCustomAPIURL(apiURL string) {
	apiURL = strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if !strings.HasPrefix(apiURL, "https://") {
		apiURL = ""
	}
	q.customURL = apiURL
}

type QobuzTrack struct {
	ID                  int64   `json:"id"`
	Title               string  `json:"title"`
	Version             string  `json:"version"`
	Duration            int     `json:"duration"`
	TrackNumber         int     `json:"track_number"`
	MediaNumber         int     `json:"media_number"`
	ISRC                string  `json:"isrc"`
	Copyright           string  `json:"copyright"`
	MaximumBitDepth     int     `json:"maximum_bit_depth"`
	MaximumSamplingRate float64 `json:"maximum_sampling_rate"`
	Hires               bool    `json:"hires"`
	HiresStreamable     bool    `json:"hires_streamable"`
	ReleaseDateOriginal string  `json:"release_date_original"`
	Performer           struct {
		Name string `json:"name"`
		ID   int64  `json:"id"`
	} `json:"performer"`
	Album struct {
		Title string `json:"title"`
		ID    string `json:"id"`
		Image struct {
			Small     string `json:"small"`
			Thumbnail string `json:"thumbnail"`
			Large     string `json:"large"`
		} `json:"image"`
		Artist struct {
			Name string `json:"name"`
			ID   int64  `json:"id"`
		} `json:"artist"`
		Label struct {
			Name string `json:"name"`
		} `json:"label"`
	} `json:"album"`
}

type qobuzPublicSearchResponse struct {
	Tracks struct {
		Total int          `json:"total"`
		Items []QobuzTrack `json:"items"`
	} `json:"tracks"`
}

var qobuzStreamingURLPattern = regexp.MustCompile(`https?://[^\s"'<>\\)]+`)

func NewQobuzDownloader() *QobuzDownloader {
	return &QobuzDownloader{
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func previewQobuzResponseBody(body []byte, maxLen int) string {
	preview := strings.TrimSpace(string(body))
	if len(preview) > maxLen {
		return preview[:maxLen] + "..."
	}
	return preview
}

func firstNonEmptyQobuzValue(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func normalizeQobuzSearchValue(value string) string {
	replacer := strings.NewReplacer(
		"&", " and ",
		"feat.", " ",
		"ft.", " ",
		"/", " ",
		"-", " ",
		"_", " ",
	)
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = replacer.Replace(normalized)
	return strings.Join(strings.Fields(normalized), " ")
}

func qobuzTrackDisplayArtist(track QobuzTrack) string {
	return firstNonEmptyQobuzValue(track.Performer.Name, track.Album.Artist.Name)
}

func qobuzTrackSupportsHiRes(track QobuzTrack) bool {
	if track.Hires || track.HiresStreamable {
		return true
	}
	return track.MaximumBitDepth >= 24 || track.MaximumSamplingRate > 48
}

func scoreQobuzSearchCandidate(track QobuzTrack, spotifyTrackName string, spotifyArtistName string, spotifyAlbumName string) int {
	score := 0

	titleNeedle := normalizeQobuzSearchValue(spotifyTrackName)
	titleHaystack := normalizeQobuzSearchValue(track.Title)
	switch {
	case titleNeedle != "" && titleHaystack == titleNeedle:
		score += 1000
	case titleNeedle != "" && (strings.Contains(titleHaystack, titleNeedle) || strings.Contains(titleNeedle, titleHaystack)):
		score += 500
	}

	artistNeedle := normalizeQobuzSearchValue(spotifyArtistName)
	artistHaystack := normalizeQobuzSearchValue(qobuzTrackDisplayArtist(track))
	artistMatched := false
	switch {
	case artistNeedle != "" && artistHaystack == artistNeedle:
		score += 300
		artistMatched = true
	case artistNeedle != "" && artistHaystack != "" && (strings.Contains(artistHaystack, artistNeedle) || strings.Contains(artistNeedle, artistHaystack)):
		score += 180
		artistMatched = true
	}

	if artistNeedle != "" && !artistMatched {
		needleTokens := strings.Fields(artistNeedle)
		haystackTokens := strings.Fields(artistHaystack)
		matchCount := 0
		for _, nt := range needleTokens {
			for _, ht := range haystackTokens {
				if nt == ht {
					matchCount++
					break
				}
			}
		}
		if matchCount > 0 {
			score += 50
			artistMatched = true
		} else {
			score -= 2000
		}
	}

	albumNeedle := normalizeQobuzSearchValue(spotifyAlbumName)
	albumHaystack := normalizeQobuzSearchValue(track.Album.Title)
	switch {
	case albumNeedle != "" && albumHaystack == albumNeedle:
		score += 150
	case albumNeedle != "" && albumHaystack != "" && (strings.Contains(albumHaystack, albumNeedle) || strings.Contains(albumNeedle, albumHaystack)):
		score += 90
	}

	if qobuzTrackSupportsHiRes(track) {
		score += 40
	} else if track.MaximumBitDepth >= 16 {
		score += 20
	}

	badKeywords := []string{"karaoke", "instrumental", "cover", "tribute", "as made famous by", "in the style of", "lullaby", "8 bit", "8-bit", "16 bit", "16-bit", "chill"}
	for _, kw := range badKeywords {
		if strings.Contains(titleHaystack, kw) && !strings.Contains(titleNeedle, kw) {
			score -= 2000
		}
		if strings.Contains(artistHaystack, kw) && !strings.Contains(artistNeedle, kw) {
			score -= 2000
		}
	}

	return score
}

func qobuzURLLooksStreamable(raw string) bool {
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

func findQobuzStreamingURLInPayload(payload interface{}) string {
	switch value := payload.(type) {
	case string:
		candidate := strings.ReplaceAll(strings.TrimSpace(value), `\/`, `/`)
		if qobuzURLLooksStreamable(candidate) {
			return candidate
		}
	case []interface{}:
		for _, item := range value {
			if url := findQobuzStreamingURLInPayload(item); url != "" {
				return url
			}
		}
	case map[string]interface{}:
		for _, key := range []string{"download_url", "url", "play_url", "stream_url", "link", "file"} {
			if nested, ok := value[key]; ok {
				if url := findQobuzStreamingURLInPayload(nested); url != "" {
					return url
				}
			}
		}
		for _, nested := range value {
			if url := findQobuzStreamingURLInPayload(nested); url != "" {
				return url
			}
		}
	}

	return ""
}

func extractQobuzStreamingURL(body []byte) string {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return ""
	}

	var directResp struct {
		URL         string `json:"url"`
		DownloadURL string `json:"download_url"`
		Data        struct {
			URL         string `json:"url"`
			DownloadURL string `json:"download_url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &directResp); err == nil {
		for _, candidate := range []string{
			directResp.DownloadURL,
			directResp.URL,
			directResp.Data.DownloadURL,
			directResp.Data.URL,
		} {
			if qobuzURLLooksStreamable(candidate) {
				return candidate
			}
		}
	}

	var genericPayload interface{}
	if err := json.Unmarshal(body, &genericPayload); err == nil {
		if streamURL := findQobuzStreamingURLInPayload(genericPayload); streamURL != "" {
			return streamURL
		}
	}

	if openIdx := strings.Index(trimmed, "("); openIdx >= 0 {
		if closeIdx := strings.LastIndex(trimmed, ")"); closeIdx > openIdx+1 {
			callbackBody := strings.TrimSpace(trimmed[openIdx+1 : closeIdx])
			if streamURL := extractQobuzStreamingURL([]byte(callbackBody)); streamURL != "" {
				return streamURL
			}
		}
	}

	for _, match := range qobuzStreamingURLPattern.FindAllString(trimmed, -1) {
		candidate := strings.ReplaceAll(match, `\/`, `/`)
		if qobuzURLLooksStreamable(candidate) {
			return candidate
		}
	}

	return ""
}

func (q *QobuzDownloader) searchByISRC(isrc string, spotifyTrackName string, spotifyArtistName string, spotifyAlbumName string) (*QobuzTrack, error) {
	if strings.HasPrefix(isrc, "qobuz_") {
		trackID := strings.TrimSpace(strings.TrimPrefix(isrc, "qobuz_"))
		resp, err := doQobuzSignedRequest(http.MethodGet, "track/get", url.Values{"track_id": {trackID}}, q.client)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch track from Qobuz public API: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
			return nil, fmt.Errorf("Qobuz public API track/get returned status %d: %s", resp.StatusCode, previewQobuzResponseBody(body, 256))
		}

		var trackResp QobuzTrack
		if err := json.NewDecoder(resp.Body).Decode(&trackResp); err != nil {
			return nil, fmt.Errorf("failed to decode Qobuz public track/get response: %w", err)
		}

		return &trackResp, nil
	}

	queries := []string{strings.TrimSpace(isrc)}
	if fallbackQuery := strings.TrimSpace(strings.Join([]string{spotifyTrackName, spotifyArtistName}, " ")); fallbackQuery != "" {
		queries = append(queries, fallbackQuery)
	}

	var lastErr error
	for _, query := range queries {
		if strings.TrimSpace(query) == "" {
			continue
		}

		var searchResp qobuzPublicSearchResponse
		if err := doQobuzSignedJSONRequest("track/search", url.Values{
			"query": {strings.TrimSpace(query)},
			"limit": {"10"},
		}, &searchResp); err != nil {
			lastErr = fmt.Errorf("failed to search Qobuz public API: %w", err)
			continue
		}

		if searchResp.Tracks.Total == 0 || len(searchResp.Tracks.Items) == 0 {
			lastErr = fmt.Errorf("track not found for query: %s", query)
			continue
		}

		bestIndex := 0
		bestScore := -1
		for idx, candidate := range searchResp.Tracks.Items {
			score := scoreQobuzSearchCandidate(candidate, spotifyTrackName, spotifyArtistName, spotifyAlbumName)
			if idx == 0 || score > bestScore {
				bestIndex = idx
				bestScore = score
			}
		}

		selected := searchResp.Tracks.Items[bestIndex]
		return &selected, nil
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("track not found for ISRC: %s", isrc)
	}
	return nil, lastErr
}

func (q *QobuzDownloader) GetDownloadURL(trackID int64, quality string, allowFallback bool) (string, error) {
	qualityCode := quality
	if qualityCode == "" || qualityCode == "5" {
		qualityCode = "6"
	}

	fmt.Printf("Getting download URL for track ID: %d with requested quality: %s\n", trackID, qualityCode)

	if strings.TrimSpace(q.customURL) != "" {
		fmt.Printf("Trying custom Qobuz instance...\n")
		url, err := q.getQobuzCustomDownloadURL(trackID, qualityCode)
		if err == nil {
			fmt.Printf("Success (custom Qobuz instance)\n")
			return url, nil
		}
		if IsDownloadCancelledError(err) {
			return "", err
		}
		fmt.Printf("Custom Qobuz instance failed: %v\n", err)
		if !allowFallback {
			return "", err
		}

	}

	downloadFunc := func(qual string) (string, error) {
		url, err := q.getQobuzCommunityDownloadURL(trackID, qual)
		if err == nil {
			fmt.Printf("Success (community qbz-a)\n")
			return url, nil
		}
		if !IsDownloadCancelledError(err) && !IsCommunityCooldownError(err) {
			fmt.Printf("Community qbz-a failed: %v\n", err)
		}
		return "", err
	}

	url, err := downloadFunc(qualityCode)
	if err == nil {
		return url, nil
	}
	if IsDownloadCancelledError(err) {
		return "", err
	}

	currentQuality := qualityCode

	if currentQuality == "27" && allowFallback {
		fmt.Printf("Download with quality 27 failed, trying fallback to 7 (24-bit Standard)...\n")
		url, err := downloadFunc("7")
		if err == nil {
			fmt.Println("Success with fallback quality 7")
			return url, nil
		}
		if IsDownloadCancelledError(err) {
			return "", err
		}

		currentQuality = "7"
	}

	if currentQuality == "7" && allowFallback {
		fmt.Printf("Download with quality 7 failed, trying fallback to 6 (16-bit Lossless)...\n")
		url, err := downloadFunc("6")
		if err == nil {
			fmt.Println("Success with fallback quality 6")
			return url, nil
		}
		if IsDownloadCancelledError(err) {
			return "", err
		}
	}

	return "", fmt.Errorf("all APIs and fallbacks failed. Last error: %v", err)
}

func (q *QobuzDownloader) DownloadFile(url, filepath string) error {
	fmt.Println("Starting file download...")

	downloadClient := &http.Client{
		Timeout: 5 * time.Minute,
	}

	req, err := NewRequestWithDefaultHeaders(http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("failed to create download request: %w", err)
	}

	resp, err := downloadClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download file: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	fmt.Printf("Creating file: %s\n", filepath)
	out, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer out.Close()

	fmt.Println("Downloading...")

	pw := NewProgressWriter(out)
	_, err = io.Copy(pw, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))
	return nil
}

func (q *QobuzDownloader) DownloadCoverArt(coverURL, filepath string) error {
	if coverURL == "" {
		return fmt.Errorf("no cover URL provided")
	}

	req, err := NewRequestWithDefaultHeaders(http.MethodGet, coverURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create cover request: %w", err)
	}

	resp, err := q.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download cover: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("cover download failed with status %d", resp.StatusCode)
	}

	out, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create cover file: %w", err)
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

func buildQobuzFilename(title, artist, album, albumArtist, releaseDate string, trackNumber, discNumber int, format string, includeTrackNumber bool, position int, useAlbumTrackNumber bool, extra ...string) string {
	var filename string
	isrc := ""
	if len(extra) > 0 {
		isrc = SanitizeOptionalFilename(extra[0])
	}

	numberToUse := position
	if useAlbumTrackNumber && trackNumber > 0 {
		numberToUse = trackNumber
	}

	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	if strings.Contains(format, "{") {
		filename = format
		filename = strings.ReplaceAll(filename, "{title}", title)
		filename = strings.ReplaceAll(filename, "{artist}", artist)
		filename = strings.ReplaceAll(filename, "{album}", album)
		filename = strings.ReplaceAll(filename, "{album_artist}", albumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)
		filename = strings.ReplaceAll(filename, "{date}", SanitizeFilename(releaseDate))
		filename = strings.ReplaceAll(filename, "{isrc}", isrc)

		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

		if numberToUse > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", numberToUse))
		} else {

			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
	} else {

		switch format {
		case "artist-title":
			filename = fmt.Sprintf("%s - %s", artist, title)
		case "title":
			filename = title
		default:
			filename = fmt.Sprintf("%s - %s", title, artist)
		}

		if includeTrackNumber && position > 0 {
			filename = fmt.Sprintf("%02d. %s", numberToUse, filename)
		}
	}

	return filename + ".flac"
}

func (q *QobuzDownloader) DownloadTrack(spotifyID, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, spotifyURL string, allowFallback bool, useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool) (string, error) {
	var isrc string
	if spotifyID != "" {
		linkClient := NewSongLinkClient()
		resolvedISRC, err := linkClient.GetISRCDirect(spotifyID)
		if err != nil {
			return "", fmt.Errorf("failed to get ISRC: %v", err)
		}
		isrc = resolvedISRC
	} else {
		return "", fmt.Errorf("spotify ID is required for Qobuz download")
	}

	return q.DownloadTrackWithISRC(isrc, outputDir, quality, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyTotalDiscs, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, spotifyURL, allowFallback, useFirstArtistOnly, useSingleGenre, embedGenre)
}

func (q *QobuzDownloader) DownloadTrackWithISRC(isrc, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, spotifyURL string, allowFallback bool, useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool) (string, error) {
	fmt.Printf("Fetching track info for ISRC: %s\n", isrc)

	metaChan := make(chan Metadata, 1)
	if embedGenre && isrc != "" {
		go func() {
			if ShouldSkipMusicBrainzMetadataFetch() {
				fmt.Println("Skipping MusicBrainz metadata fetch because status check is offline.")
				metaChan <- Metadata{}
			} else {
				fmt.Println("Fetching MusicBrainz metadata...")
				if fetchedMeta, err := FetchMusicBrainzMetadata(isrc, spotifyTrackName, spotifyArtistName, spotifyAlbumName, useSingleGenre, embedGenre); err == nil {
					fmt.Println("MusicBrainz metadata fetched")
					metaChan <- fetchedMeta
				} else {
					fmt.Printf("Warning: Failed to fetch MusicBrainz metadata: %v\n", err)
					metaChan <- Metadata{}
				}
			}
		}()
	} else {
		close(metaChan)
	}

	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("failed to create output directory: %w", err)
		}
	}

	track, err := q.searchByISRC(isrc, spotifyTrackName, spotifyArtistName, spotifyAlbumName)
	if err != nil {
		return "", err
	}

	matchedTitle := strings.TrimSpace(track.Title)
	if v := strings.TrimSpace(track.Version); v != "" {
		matchedTitle = matchedTitle + " (" + v + ")"
	}
	q.SourceURL = fmt.Sprintf("https://open.qobuz.com/track/%d", track.ID)
	q.SourceLabel = strings.TrimSpace(fmt.Sprintf("%s - %s", qobuzTrackDisplayArtist(*track), matchedTitle))

	artists := spotifyArtistName
	trackTitle := spotifyTrackName
	albumTitle := spotifyAlbumName

	fmt.Printf("Found track: %s - %s\n", artists, trackTitle)
	fmt.Printf("Album: %s\n", albumTitle)

	qualityInfo := "Standard"
	if track.Hires {
		if track.MaximumBitDepth > 0 && track.MaximumSamplingRate > 0 {
			qualityInfo = fmt.Sprintf("Hi-Res (%d-bit / %.1f kHz)", track.MaximumBitDepth, track.MaximumSamplingRate)
		} else if track.MaximumBitDepth > 0 {
			qualityInfo = fmt.Sprintf("Hi-Res available (%d-bit)", track.MaximumBitDepth)
		} else {
			qualityInfo = "Hi-Res available"
		}
	}
	fmt.Printf("Quality: %s\n", qualityInfo)

	fmt.Println("Getting download URL...")
	downloadURL, err := q.GetDownloadURL(track.ID, quality, allowFallback)
	if err != nil {
		return "", fmt.Errorf("failed to get download URL: %w", err)
	}

	if downloadURL == "" {
		return "", fmt.Errorf("received empty download URL")
	}

	urlPreview := downloadURL
	if len(downloadURL) > 60 {
		urlPreview = downloadURL[:60] + "..."
	}
	fmt.Printf("Download URL obtained: %s\n", urlPreview)

	safeArtist := sanitizeFilename(artists)
	safeAlbumArtist := sanitizeFilename(spotifyAlbumArtist)

	if useFirstArtistOnly {
		safeArtist = sanitizeFilename(GetFirstArtist(artists))
		safeAlbumArtist = sanitizeFilename(GetFirstArtist(spotifyAlbumArtist))
	}

	safeTitle := sanitizeFilename(trackTitle)
	safeAlbum := sanitizeFilename(albumTitle)

	filename := buildQobuzFilename(safeTitle, safeArtist, safeAlbum, safeAlbumArtist, spotifyReleaseDate, spotifyTrackNumber, spotifyDiscNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber, isrc)
	filepath := filepath.Join(outputDir, filename)
	filepath, alreadyExists := ResolveOutputPathForDownload(filepath, GetRedownloadWithSuffixSetting())
	if alreadyExists {
		fmt.Printf("File already exists: %s (%.2f MB)\n", filepath, float64(mustFileSize(filepath))/(1024*1024))
		return "EXISTS:" + filepath, nil
	}

	fmt.Printf("Downloading FLAC file to: %s\n", filepath)
	if err := q.DownloadFile(downloadURL, filepath); err != nil {
		return "", fmt.Errorf("failed to download file: %w", err)
	}

	fmt.Printf("Downloaded: %s\n", filepath)

	coverPath := ""

	if spotifyCoverURL != "" {
		coverPath = filepath + ".cover.jpg"
		coverClient := NewCoverClient()
		if err := coverClient.DownloadCoverToPath(spotifyCoverURL, coverPath, embedMaxQualityCover); err != nil {
			fmt.Printf("Warning: Failed to download Spotify cover: %v\n", err)
			coverPath = ""
		} else {
			defer os.Remove(coverPath)
			fmt.Println("Spotify cover downloaded")
		}
	}

	var mbMeta Metadata
	if isrc != "" {
		mbMeta = <-metaChan
	}

	fmt.Println("Embedding metadata and cover art...")

	trackNumberToEmbed := spotifyTrackNumber
	if trackNumberToEmbed == 0 {
		trackNumberToEmbed = 1
	}

	upc := ""
	if identifiers, err := GetSpotifyTrackIdentifiersDirect(spotifyURL); err == nil || identifiers.ISRC != "" || identifiers.UPC != "" {
		if strings.TrimSpace(isrc) == "" && strings.TrimSpace(identifiers.ISRC) != "" {
			isrc = strings.TrimSpace(identifiers.ISRC)
		}
		upc = strings.TrimSpace(identifiers.UPC)
	}

	metadata := Metadata{
		Title:       trackTitle,
		Artist:      artists,
		Album:       albumTitle,
		AlbumArtist: spotifyAlbumArtist,
		Date:        spotifyReleaseDate,
		TrackNumber: trackNumberToEmbed,
		TotalTracks: spotifyTotalTracks,
		DiscNumber:  spotifyDiscNumber,
		TotalDiscs:  spotifyTotalDiscs,
		URL:         spotifyURL,
		Comment:     spotifyURL,
		Copyright:   spotifyCopyright,
		Publisher:   spotifyPublisher,
		Composer:    spotifyComposer,
		Separator:   metadataSeparator,
		Description: "https://github.com/spotbye/SpotiFLAC",
		ISRC:        isrc,
		UPC:         upc,
		Genre:       mbMeta.Genre,
	}

	if err := EmbedMetadata(filepath, metadata, coverPath); err != nil {
		return "", fmt.Errorf("failed to embed metadata: %w", err)
	}

	fmt.Println("Metadata embedded successfully!")
	return filepath, nil
}
