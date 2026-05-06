package backend

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type QobuzDownloader struct {
	client *http.Client
	appID  string
}

type QobuzSearchResponse struct {
	Query  string `json:"query"`
	Tracks struct {
		Limit  int          `json:"limit"`
		Offset int          `json:"offset"`
		Total  int          `json:"total"`
		Items  []QobuzTrack `json:"items"`
	} `json:"tracks"`
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

type QobuzStreamResponse struct {
	URL string `json:"url"`
}

type qobuzMusicDLRequest struct {
	URL     string `json:"url"`
	Quality string `json:"quality"`
}

type qobuzMusicDLResponse struct {
	Success     bool   `json:"success"`
	Type        string `json:"type"`
	URLType     string `json:"url_type"`
	TrackID     string `json:"track_id"`
	Quality     string `json:"quality_label"`
	DownloadURL string `json:"download_url"`
	Message     string `json:"message"`
	Error       string `json:"error"`
}

const qobuzMusicDLProbeTrackID int64 = 341032040

var (
	qobuzMusicDLDebugKeyOnce sync.Once
	qobuzMusicDLDebugKey     string
	qobuzMusicDLDebugKeyErr  error
)

var qobuzMusicDLDebugKeySeedParts = [][]byte{
	{0x73, 0x70, 0x6f, 0x74, 0x69, 0x66},
	{0x6c, 0x61, 0x63, 0x3a, 0x71, 0x6f},
	{0x62, 0x75, 0x7a, 0x3a, 0x6d, 0x75, 0x73, 0x69, 0x63, 0x64, 0x6c, 0x3a, 0x76, 0x31},
}

var qobuzMusicDLDebugKeyAAD = []byte{
	0x71, 0x6f, 0x62, 0x75, 0x7a, 0x7c, 0x6d, 0x75, 0x73, 0x69, 0x63, 0x64,
	0x6c, 0x7c, 0x64, 0x65, 0x62, 0x75, 0x67, 0x7c, 0x76, 0x31,
}

var qobuzMusicDLDebugKeyNonce = []byte{
	0x91, 0x2a, 0x5c, 0x77, 0x0f, 0x33, 0xa8, 0x14, 0x62, 0x9d, 0xce, 0x41,
}

var qobuzMusicDLDebugKeyCiphertext = []byte{
	0xf3, 0x4a, 0x83, 0x45, 0x24, 0xb6, 0x22, 0xaf, 0xd6, 0xc3, 0x6e, 0x2d,
	0x56, 0xd1, 0xbb, 0x0b, 0xe9, 0x1b, 0x4f, 0x1c, 0x5f, 0x41, 0x55, 0xc2,
	0xc6, 0xdf, 0xad, 0x21, 0x58, 0xfe, 0xd5, 0xb8, 0x2d, 0x29, 0xf9, 0x9e,
	0x6f, 0xd6,
}

var qobuzMusicDLDebugKeyTag = []byte{
	0x69, 0x0c, 0x42, 0x70, 0x14, 0x83, 0xff, 0x14, 0xc8, 0xbe, 0x17, 0x00,
	0x69, 0xb1, 0xfe, 0xbb,
}

func NewQobuzDownloader() *QobuzDownloader {
	return &QobuzDownloader{
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
		appID: qobuzDefaultAPIAppID,
	}
}

func previewQobuzResponseBody(body []byte, maxLen int) string {
	preview := strings.TrimSpace(string(body))
	if len(preview) > maxLen {
		return preview[:maxLen] + "..."
	}
	return preview
}

func buildQobuzOpenTrackURL(trackID int64) string {
	return fmt.Sprintf("https://open.qobuz.com/track/%d", trackID)
}

func getQobuzMusicDLDebugKey() (string, error) {
	qobuzMusicDLDebugKeyOnce.Do(func() {
		hasher := sha256.New()
		for _, part := range qobuzMusicDLDebugKeySeedParts {
			hasher.Write(part)
		}

		block, err := aes.NewCipher(hasher.Sum(nil))
		if err != nil {
			qobuzMusicDLDebugKeyErr = err
			return
		}

		gcm, err := cipher.NewGCM(block)
		if err != nil {
			qobuzMusicDLDebugKeyErr = err
			return
		}

		sealed := make([]byte, 0, len(qobuzMusicDLDebugKeyCiphertext)+len(qobuzMusicDLDebugKeyTag))
		sealed = append(sealed, qobuzMusicDLDebugKeyCiphertext...)
		sealed = append(sealed, qobuzMusicDLDebugKeyTag...)

		plaintext, err := gcm.Open(nil, qobuzMusicDLDebugKeyNonce, sealed, qobuzMusicDLDebugKeyAAD)
		if err != nil {
			qobuzMusicDLDebugKeyErr = err
			return
		}

		qobuzMusicDLDebugKey = string(plaintext)
	})

	if qobuzMusicDLDebugKeyErr != nil {
		return "", qobuzMusicDLDebugKeyErr
	}

	return qobuzMusicDLDebugKey, nil
}

func (q *QobuzDownloader) searchByISRC(isrc string) (*QobuzTrack, error) {
	if strings.HasPrefix(isrc, "qobuz_") {
		trackID := strings.TrimPrefix(isrc, "qobuz_")
		resp, err := doQobuzSignedRequest(http.MethodGet, "track/get", url.Values{"track_id": {trackID}}, q.client)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch track: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
		}

		var trackResp QobuzTrack
		if err := json.NewDecoder(resp.Body).Decode(&trackResp); err != nil {
			return nil, fmt.Errorf("failed to decode response: %w", err)
		}

		return &trackResp, nil
	}

	resp, err := doQobuzSignedRequest(http.MethodGet, "track/search", url.Values{
		"query": {isrc},
		"limit": {"1"},
	}, q.client)
	if err != nil {
		return nil, fmt.Errorf("failed to search track: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var searchResp QobuzSearchResponse

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if len(body) == 0 {
		return nil, fmt.Errorf("API returned empty response")
	}

	if err := json.Unmarshal(body, &searchResp); err != nil {

		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		return nil, fmt.Errorf("failed to decode response: %w (response: %s)", err, bodyStr)
	}

	if len(searchResp.Tracks.Items) == 0 {
		return nil, fmt.Errorf("track not found for ISRC: %s", isrc)
	}

	return &searchResp.Tracks.Items[0], nil
}

func buildQobuzAPIURL(apiBase string, trackID int64, quality string) string {
	return fmt.Sprintf("%s%d&quality=%s", apiBase, trackID, quality)
}

func (q *QobuzDownloader) DownloadFromStandard(apiBase string, trackID int64, quality string) (string, error) {
	apiURL := buildQobuzAPIURL(apiBase, trackID, quality)
	req, err := NewRequestWithDefaultHeaders(http.MethodGet, apiURL, nil)
	if err != nil {
		return "", err
	}

	resp, err := q.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if len(body) == 0 {
		return "", fmt.Errorf("empty body")
	}

	var streamResp QobuzStreamResponse
	if err := json.Unmarshal(body, &streamResp); err == nil && streamResp.URL != "" {
		return streamResp.URL, nil
	}

	var nestedResp struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &nestedResp); err == nil && nestedResp.Data.URL != "" {
		return nestedResp.Data.URL, nil
	}

	return "", fmt.Errorf("invalid response")
}

func (q *QobuzDownloader) DownloadFromMusicDL(trackID int64, quality string) (string, error) {
	if strings.TrimSpace(quality) == "" {
		quality = "6"
	}

	debugKey, err := getQobuzMusicDLDebugKey()
	if err != nil {
		return "", fmt.Errorf("failed to decrypt MusicDL debug key: %w", err)
	}

	payload, err := json.Marshal(qobuzMusicDLRequest{
		URL:     buildQobuzOpenTrackURL(trackID),
		Quality: strings.TrimSpace(quality),
	})
	if err != nil {
		return "", fmt.Errorf("failed to encode MusicDL request: %w", err)
	}

	req, err := NewRequestWithDefaultHeaders(http.MethodPost, GetQobuzMusicDLDownloadAPIURL(), bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("failed to create MusicDL request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Debug-Key", debugKey)

	resp, err := q.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to reach MusicDL: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read MusicDL response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("MusicDL returned status %d: %s", resp.StatusCode, previewQobuzResponseBody(body, 256))
	}

	var downloadResp qobuzMusicDLResponse
	if err := json.Unmarshal(body, &downloadResp); err != nil {
		return "", fmt.Errorf("failed to decode MusicDL response: %w (%s)", err, previewQobuzResponseBody(body, 256))
	}

	if !downloadResp.Success {
		message := strings.TrimSpace(downloadResp.Error)
		if message == "" {
			message = strings.TrimSpace(downloadResp.Message)
		}
		if message == "" {
			message = "MusicDL reported failure"
		}
		return "", fmt.Errorf("%s", message)
	}

	downloadURL := strings.TrimSpace(downloadResp.DownloadURL)
	if downloadURL == "" {
		return "", fmt.Errorf("MusicDL response did not include a download_url")
	}

	return downloadURL, nil
}

func CheckQobuzMusicDLStatus(client *http.Client) bool {
	if client == nil {
		client = &http.Client{Timeout: 4 * time.Second}
	}

	downloader := &QobuzDownloader{client: client, appID: qobuzDefaultAPIAppID}
	_, err := downloader.DownloadFromMusicDL(qobuzMusicDLProbeTrackID, "27")
	return err == nil
}

func (q *QobuzDownloader) GetDownloadURL(trackID int64, quality string, allowFallback bool) (string, error) {
	qualityCode := quality
	if qualityCode == "" || qualityCode == "5" {
		qualityCode = "6"
	}

	fmt.Printf("Getting download URL for track ID: %d with requested quality: %s\n", trackID, qualityCode)

	downloadFunc := func(qual string) (string, error) {
		type Provider struct {
			Name string
			API  string
			Func func() (string, error)
		}

		providerMap := make(map[string]Provider)
		providerIDs := []string{GetQobuzMusicDLDownloadAPIURL()}

		providerMap[GetQobuzMusicDLDownloadAPIURL()] = Provider{
			Name: "MusicDL",
			API:  GetQobuzMusicDLDownloadAPIURL(),
			Func: func() (string, error) {
				return q.DownloadFromMusicDL(trackID, qual)
			},
		}

		for _, api := range GetQobuzStreamAPIBaseURLs() {
			currentAPI := api
			providerIDs = append(providerIDs, currentAPI)
			providerMap[currentAPI] = Provider{
				Name: "Standard(" + currentAPI + ")",
				API:  currentAPI,
				Func: func() (string, error) {
					return q.DownloadFromStandard(currentAPI, trackID, qual)
				},
			}
		}

		orderedProviderIDs := prioritizeProviders("qobuz", providerIDs)
		primaryProviderID := GetQobuzMusicDLDownloadAPIURL()
		if len(orderedProviderIDs) > 1 && orderedProviderIDs[0] != primaryProviderID {
			reordered := []string{primaryProviderID}
			for _, providerID := range orderedProviderIDs {
				if providerID == primaryProviderID {
					continue
				}
				reordered = append(reordered, providerID)
			}
			orderedProviderIDs = reordered
		}
		var lastErr error
		for _, providerID := range orderedProviderIDs {
			p, ok := providerMap[providerID]
			if !ok {
				continue
			}

			fmt.Printf("Trying Provider: %s (Quality: %s)...\n", p.Name, qual)

			url, err := p.Func()
			if err == nil {
				fmt.Printf("✓ Success\n")
				recordProviderSuccess("qobuz", p.API)
				return url, nil
			}

			fmt.Printf("Provider failed: %v\n", err)
			recordProviderFailure("qobuz", p.API)
			lastErr = err
		}
		return "", lastErr
	}

	url, err := downloadFunc(qualityCode)
	if err == nil {
		return url, nil
	}

	currentQuality := qualityCode

	if currentQuality == "27" && allowFallback {
		fmt.Printf("⚠ Download with quality 27 failed, trying fallback to 7 (24-bit Standard)...\n")
		url, err := downloadFunc("7")
		if err == nil {
			fmt.Println("✓ Success with fallback quality 7")
			return url, nil
		}

		currentQuality = "7"
	}

	if currentQuality == "7" && allowFallback {
		fmt.Printf("⚠ Download with quality 7 failed, trying fallback to 6 (16-bit Lossless)...\n")
		url, err := downloadFunc("6")
		if err == nil {
			fmt.Println("✓ Success with fallback quality 6")
			return url, nil
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
					fmt.Println("✓ MusicBrainz metadata fetched")
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

	track, err := q.searchByISRC(isrc)
	if err != nil {
		return "", err
	}

	artists := spotifyArtistName
	trackTitle := spotifyTrackName
	albumTitle := spotifyAlbumName

	fmt.Printf("Found track: %s - %s\n", artists, trackTitle)
	fmt.Printf("Album: %s\n", albumTitle)

	qualityInfo := "Standard"
	if track.Hires {
		qualityInfo = fmt.Sprintf("Hi-Res (%d-bit / %.1f kHz)", track.MaximumBitDepth, track.MaximumSamplingRate)
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
	if alreadyExists && !ExistingFileCheckDisabled() {
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
