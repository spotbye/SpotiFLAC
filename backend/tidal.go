package backend

import (
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type TidalDownloader struct {
	client     *http.Client
	timeout    time.Duration
	maxRetries int
	apiURL     string
	SourceURL  string
}

type TidalAPIResponse struct {
	OriginalTrackURL string `json:"OriginalTrackUrl"`
}

type TidalAPIResponseV2 struct {
	Version string `json:"version"`
	Data    struct {
		TrackID           int64  `json:"trackId"`
		AssetPresentation string `json:"assetPresentation"`
		AudioMode         string `json:"audioMode"`
		AudioQuality      string `json:"audioQuality"`
		ManifestMimeType  string `json:"manifestMimeType"`
		ManifestHash      string `json:"manifestHash"`
		Manifest          string `json:"manifest"`
		BitDepth          int    `json:"bitDepth"`
		SampleRate        int    `json:"sampleRate"`
	} `json:"data"`
}

type TidalManifestAPIResponse struct {
	Data struct {
		Data struct {
			Attributes struct {
				URI     string   `json:"uri"`
				Formats []string `json:"formats"`
			} `json:"attributes"`
		} `json:"data"`
	} `json:"data"`
}

type TidalBTSManifest struct {
	MimeType       string   `json:"mimeType"`
	Codecs         string   `json:"codecs"`
	EncryptionType string   `json:"encryptionType"`
	URLs           []string `json:"urls"`
}

func getConfiguredTidalAPIAttemptList() ([]string, error) {
	customAPI := GetCustomTidalAPISetting()
	if customAPI == "" {
		return nil, fmt.Errorf("no configured custom tidal api instance")
	}
	return []string{customAPI}, nil
}

func buildTidalOutputPath(outputDir, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyTrackNumber, spotifyDiscNumber int, isrcOverride string, useFirstArtistOnly bool, quality string) (string, bool, error) {
	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", false, fmt.Errorf("directory error: %w", err)
		}
	}

	artistNameForFile := sanitizeFilename(spotifyArtistName)
	albumArtistForFile := sanitizeFilename(spotifyAlbumArtist)
	if useFirstArtistOnly {
		artistNameForFile = sanitizeFilename(GetFirstArtist(spotifyArtistName))
		albumArtistForFile = sanitizeFilename(GetFirstArtist(spotifyAlbumArtist))
	}

	trackTitleForFile := sanitizeFilename(spotifyTrackName)
	albumTitleForFile := sanitizeFilename(spotifyAlbumName)

	filename := buildTidalFilename(trackTitleForFile, artistNameForFile, albumTitleForFile, albumArtistForFile, spotifyReleaseDate, spotifyTrackNumber, spotifyDiscNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber, isrcOverride)
	if isTidalAtmosQuality(quality) {
		filename = strings.TrimSuffix(filename, ".flac") + ".m4a"
	}
	outputFilename := filepath.Join(outputDir, filename)

	outputFilename, alreadyExists := ResolveOutputPathForDownload(outputFilename, GetRedownloadWithSuffixSetting())
	return outputFilename, alreadyExists, nil
}

func finalizeTidalDownload(outputFilename, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL string, useSingleGenre bool, embedGenre bool) {
	trackTitle := spotifyTrackName
	artistName := spotifyArtistName
	albumTitle := spotifyAlbumName

	type mbResult struct {
		ISRC     string
		Metadata Metadata
	}

	metaChan := make(chan mbResult, 1)
	if embedGenre && spotifyURL != "" {
		go func() {
			res := mbResult{}
			var isrc string
			parts := strings.Split(spotifyURL, "/")
			if len(parts) > 0 {
				sID := strings.Split(parts[len(parts)-1], "?")[0]
				if sID != "" {
					client := NewSongLinkClient()
					if val, err := client.GetISRC(sID); err == nil {
						isrc = val
					}
				}
			}
			res.ISRC = isrc
			if isrc != "" {
				if ShouldSkipMusicBrainzMetadataFetch() {
					fmt.Println("Skipping MusicBrainz metadata fetch because status check is offline.")
				} else {
					fmt.Println("Fetching MusicBrainz metadata...")
					if fetchedMeta, err := FetchMusicBrainzMetadata(isrc, trackTitle, artistName, albumTitle, useSingleGenre, embedGenre); err == nil {
						res.Metadata = fetchedMeta
						fmt.Println("MusicBrainz metadata fetched")
					} else {
						fmt.Printf("Warning: Failed to fetch MusicBrainz metadata: %v\n", err)
					}
				}
			}
			metaChan <- res
		}()
	} else {
		close(metaChan)
	}

	isrc := strings.TrimSpace(isrcOverride)
	var mbMeta Metadata
	if spotifyURL != "" {
		result := <-metaChan
		if isrc == "" {
			isrc = result.ISRC
		}
		mbMeta = result.Metadata
	}

	upc := ""
	if spotifyURL != "" {
		if identifiers, err := GetSpotifyTrackIdentifiersDirect(spotifyURL); err == nil || identifiers.ISRC != "" || identifiers.UPC != "" {
			if strings.TrimSpace(isrc) == "" && strings.TrimSpace(identifiers.ISRC) != "" {
				isrc = strings.TrimSpace(identifiers.ISRC)
			}
			upc = strings.TrimSpace(identifiers.UPC)
		}
	}

	fmt.Println("Adding metadata...")

	coverPath := ""
	if spotifyCoverURL != "" {
		coverPath = outputFilename + ".cover.jpg"
		coverClient := NewCoverClient()
		if err := coverClient.DownloadCoverToPath(spotifyCoverURL, coverPath, embedMaxQualityCover); err != nil {
			fmt.Printf("Warning: Failed to download Spotify cover: %v\n", err)
			coverPath = ""
		} else {
			defer os.Remove(coverPath)
			fmt.Println("Spotify cover downloaded")
		}
	}

	trackNumberToEmbed := spotifyTrackNumber
	if trackNumberToEmbed == 0 {
		trackNumberToEmbed = 1
	}

	metadata := Metadata{
		Title:       trackTitle,
		Artist:      artistName,
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

	if err := EmbedMetadata(outputFilename, metadata, coverPath); err != nil {
		fmt.Printf("Tagging failed: %v\n", err)
	} else {
		fmt.Println("Metadata saved")
	}
}

func NewTidalDownloader(apiURL string) *TidalDownloader {
	apiURL = strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if !strings.HasPrefix(apiURL, "https://") {
		apiURL = ""
	}
	return &TidalDownloader{
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
		timeout:    5 * time.Second,
		maxRetries: 3,
		apiURL:     apiURL,
	}
}

func (t *TidalDownloader) GetAvailableAPIs() ([]string, error) {
	apis, err := getConfiguredTidalAPIAttemptList()
	if err == nil && len(apis) > 0 {
		return apis, nil
	}

	return nil, err
}

func (t *TidalDownloader) GetTidalURLFromSpotify(spotifyTrackID string) (string, error) {
	fmt.Println("Getting Tidal URL...")
	client := NewSongLinkClient()
	urls, err := client.GetAllURLsFromSpotify(spotifyTrackID, "")
	if err != nil {
		return "", fmt.Errorf("failed to get Tidal URL: %w", err)
	}

	tidalURL := urls.TidalURL
	if tidalURL == "" {
		return "", fmt.Errorf("tidal link not found")
	}
	fmt.Printf("Found Tidal URL: %s\n", tidalURL)
	return tidalURL, nil
}

func (t *TidalDownloader) GetTrackIDFromURL(tidalURL string) (int64, error) {

	parts := strings.Split(tidalURL, "/track/")
	if len(parts) < 2 {
		return 0, fmt.Errorf("invalid tidal URL format")
	}

	trackIDStr := strings.Split(parts[1], "?")[0]
	trackIDStr = strings.TrimSpace(trackIDStr)

	var trackID int64
	_, err := fmt.Sscanf(trackIDStr, "%d", &trackID)
	if err != nil {
		return 0, fmt.Errorf("failed to parse track ID: %w", err)
	}

	return trackID, nil
}

func (t *TidalDownloader) GetDownloadURL(trackID int64, quality string) (string, error) {
	fmt.Println("Fetching URL...")
	if strings.TrimSpace(t.apiURL) == "" {
		fmt.Println("No custom Tidal instance configured, using community tdl-a endpoint")
		return t.getTidalCommunityDownloadURL(trackID, quality)
	}

	url := fmt.Sprintf("%s/track/?id=%d&quality=%s", t.apiURL, trackID, quality)
	if isTidalAtmosQuality(quality) {
		url = fmt.Sprintf("%s/trackManifests/?id=%d&formats=EAC3_JOC&adaptive=true&manifestType=MPEG_DASH&uriScheme=DATA&usage=PLAYBACK", t.apiURL, trackID)
	}
	fmt.Printf("Tidal API URL: %s\n", url)

	req, err := NewRequestWithDefaultHeaders(http.MethodGet, url, nil)
	if err != nil {
		fmt.Printf("failed to create request: %v\n", err)
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := t.client.Do(req)
	if err != nil {
		fmt.Printf("Tidal API request failed: %v\n", err)
		return "", fmt.Errorf("failed to get download URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		fmt.Printf("Tidal API returned status code: %d\n", resp.StatusCode)
		return "", fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Failed to read response body: %v\n", err)
		return "", fmt.Errorf("failed to read response: %w", err)
	}
	if isTidalAtmosQuality(quality) {
		var manifestResponse TidalManifestAPIResponse
		if err := json.Unmarshal(body, &manifestResponse); err != nil {
			return "", fmt.Errorf("failed to decode Tidal Atmos response: %w", err)
		}
		attributes := manifestResponse.Data.Data.Attributes
		if !containsString(attributes.Formats, "EAC3_JOC") {
			return "", fmt.Errorf("Dolby Atmos is not available for this track")
		}
		const dataPrefix = "data:application/dash+xml;base64,"
		if !strings.HasPrefix(attributes.URI, dataPrefix) {
			return "", fmt.Errorf("Tidal Atmos response did not contain an inline DASH manifest")
		}
		return "MANIFEST:" + strings.TrimPrefix(attributes.URI, dataPrefix), nil
	}

	var v2Response TidalAPIResponseV2
	if err := json.Unmarshal(body, &v2Response); err == nil && v2Response.Data.Manifest != "" {
		fmt.Println("Tidal manifest found (v2 API)")
		return "MANIFEST:" + v2Response.Data.Manifest, nil
	}

	var apiResponses []TidalAPIResponse
	if err := json.Unmarshal(body, &apiResponses); err != nil {

		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		fmt.Printf("Failed to decode Tidal API response: %v (response: %s)\n", err, bodyStr)
		return "", fmt.Errorf("failed to decode response: %w (response: %s)", err, bodyStr)
	}

	if len(apiResponses) == 0 {
		fmt.Println("Tidal API returned empty response")
		return "", fmt.Errorf("no download URL in response")
	}

	for _, item := range apiResponses {
		if item.OriginalTrackURL != "" {
			fmt.Println("Tidal download URL found")
			return item.OriginalTrackURL, nil
		}
	}

	fmt.Println("No valid download URL in Tidal API response")
	return "", fmt.Errorf("download URL not found in response")
}

func (t *TidalDownloader) DownloadFile(url, filepath string, quality string) error {

	if strings.HasPrefix(url, "MANIFEST:") {
		return t.DownloadFromManifest(strings.TrimPrefix(url, "MANIFEST:"), filepath, quality)
	}

	req, err := NewRequestWithDefaultHeaders(http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	downloadClient := &http.Client{Timeout: 5 * time.Minute}
	resp, err := downloadClient.Do(req)

	if err != nil {
		return fmt.Errorf("failed to download file: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	out, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer out.Close()

	pw := NewProgressWriter(out)
	_, err = io.Copy(pw, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))

	fmt.Println("Download complete")
	return nil
}

func (t *TidalDownloader) DownloadFromManifest(manifestB64, outputPath string, quality string) error {
	directURL, initURL, mediaURLs, mimeType, err := parseManifest(manifestB64)
	if err != nil {
		return fmt.Errorf("failed to parse manifest: %w", err)
	}

	isLosslessRequested := quality == "LOSSLESS" || quality == "HI_RES" || quality == "HI_RES_LOSSLESS"
	isActualLossless := strings.Contains(strings.ToLower(mimeType), "flac") || mimeType == ""
	if isLosslessRequested && !isActualLossless {
		return fmt.Errorf("requested %s quality but Tidal provided lossy format (%s). Aborting download", quality, mimeType)
	}

	client := &http.Client{
		Timeout: 120 * time.Second,
	}

	doRequest := func(url string) (*http.Response, error) {
		req, err := NewRequestWithDefaultHeaders(http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		return client.Do(req)
	}

	if directURL != "" && (strings.Contains(strings.ToLower(mimeType), "flac") || mimeType == "") {
		fmt.Println("Downloading file...")

		resp, err := doRequest(directURL)
		if err != nil {
			return fmt.Errorf("failed to download file: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return fmt.Errorf("download failed with status %d", resp.StatusCode)
		}

		out, err := os.Create(outputPath)
		if err != nil {
			return fmt.Errorf("failed to create file: %w", err)
		}
		defer out.Close()

		pw := NewProgressWriter(out)
		_, err = io.Copy(pw, resp.Body)
		if err != nil {
			return fmt.Errorf("failed to write file: %w", err)
		}

		fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))
		fmt.Println("Download complete")
		return nil
	}

	tempPath := outputPath + ".m4a.tmp"

	if directURL != "" {
		fmt.Printf("Downloading non-FLAC file (%s)...\n", mimeType)

		resp, err := doRequest(directURL)
		if err != nil {
			return fmt.Errorf("failed to download file: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return fmt.Errorf("download failed with status %d", resp.StatusCode)
		}

		out, err := os.Create(tempPath)
		if err != nil {
			return fmt.Errorf("failed to create temp file: %w", err)
		}

		pw := NewProgressWriter(out)
		_, err = io.Copy(pw, resp.Body)
		out.Close()

		if err != nil {
			os.Remove(tempPath)
			return fmt.Errorf("failed to write temp file: %w", err)
		}

		fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))

	} else {

		fmt.Printf("Downloading %d segments...\n", len(mediaURLs)+1)

		out, err := os.Create(tempPath)
		if err != nil {
			return fmt.Errorf("failed to create temp file: %w", err)
		}

		fmt.Print("Downloading init segment... ")
		resp, err := doRequest(initURL)
		if err != nil {
			out.Close()
			os.Remove(tempPath)
			return fmt.Errorf("failed to download init segment: %w", err)
		}
		if resp.StatusCode != 200 {
			resp.Body.Close()
			out.Close()
			os.Remove(tempPath)
			return fmt.Errorf("init segment download failed with status %d", resp.StatusCode)
		}
		_, err = io.Copy(out, resp.Body)
		resp.Body.Close()
		if err != nil {
			out.Close()
			os.Remove(tempPath)
			return fmt.Errorf("failed to write init segment: %w", err)
		}
		fmt.Println("OK")

		totalSegments := len(mediaURLs)
		var totalBytes int64
		lastTime := time.Now()
		var lastBytes int64
		for i, mediaURL := range mediaURLs {
			resp, err := doRequest(mediaURL)
			if err != nil {
				out.Close()
				os.Remove(tempPath)
				return fmt.Errorf("failed to download segment %d: %w", i+1, err)
			}
			if resp.StatusCode != 200 {
				resp.Body.Close()
				out.Close()
				os.Remove(tempPath)
				return fmt.Errorf("segment %d download failed with status %d", i+1, resp.StatusCode)
			}
			n, err := io.Copy(out, resp.Body)
			totalBytes += n
			resp.Body.Close()
			if err != nil {
				out.Close()
				os.Remove(tempPath)
				return fmt.Errorf("failed to write segment %d: %w", i+1, err)
			}

			mbDownloaded := float64(totalBytes) / (1024 * 1024)
			now := time.Now()
			timeDiff := now.Sub(lastTime).Seconds()
			var speedMBps float64
			if timeDiff > 0.1 {
				bytesDiff := float64(totalBytes - lastBytes)
				speedMBps = (bytesDiff / (1024 * 1024)) / timeDiff
				SetDownloadSpeed(speedMBps)
				lastTime = now
				lastBytes = totalBytes
			}
			SetDownloadProgress(mbDownloaded)

			fmt.Printf("\rDownloading: %.2f MB (%d/%d segments)", mbDownloaded, i+1, totalSegments)
		}

		out.Close()

		tempInfo, _ := os.Stat(tempPath)
		fmt.Printf("\rDownloaded: %.2f MB (Complete)          \n", float64(tempInfo.Size())/(1024*1024))
	}

	isAtmos := isTidalAtmosQuality(quality)
	if isAtmos && !strings.Contains(strings.ToLower(mimeType), "ec-3") && !strings.Contains(strings.ToLower(mimeType), "eac3") {
		return fmt.Errorf("requested Dolby Atmos but Tidal provided %s", mimeType)
	}

	if isAtmos {
		fmt.Println("Remuxing Dolby Atmos to M4A...")
	} else {
		fmt.Println("Converting to FLAC...")
	}
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return fmt.Errorf("ffmpeg not found: %w", err)
	}

	if err := ValidateExecutable(ffmpegPath); err != nil {
		return fmt.Errorf("invalid ffmpeg executable: %w", err)
	}

	codec := "flac"
	if isAtmos {
		codec = "copy"
	}
	ffmpegArgs := []string{"-y", "-i", tempPath, "-vn", "-c:a", codec}
	if isAtmos {

		ffmpegArgs = append(ffmpegArgs, "-f", "mp4")
	}
	ffmpegArgs = append(ffmpegArgs, outputPath)
	cmd := exec.Command(ffmpegPath, ffmpegArgs...)
	setHideWindow(cmd)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		m4aPath := outputPath
		if !isAtmos {
			m4aPath = strings.TrimSuffix(outputPath, ".flac") + ".m4a"
		}
		os.Rename(tempPath, m4aPath)
		return fmt.Errorf("ffmpeg conversion failed (M4A saved as %s): %w - %s", m4aPath, err, stderr.String())
	}

	os.Remove(tempPath)
	fmt.Println("Download complete")

	return nil
}

func (t *TidalDownloader) DownloadByURL(tidalURL, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL string, allowFallback bool, allowAtmosFallback bool, atmosFallbackQuality string, useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool) (string, error) {
	fmt.Printf("Using Tidal URL: %s\n", tidalURL)
	t.SourceURL = tidalURL

	trackID, err := t.GetTrackIDFromURL(tidalURL)
	if err != nil {
		return "", err
	}

	if trackID == 0 {
		return "", fmt.Errorf("no track ID found")
	}

	outputFilename, alreadyExists, err := buildTidalOutputPath(outputDir, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, useAlbumTrackNumber, spotifyTrackNumber, spotifyDiscNumber, isrcOverride, useFirstArtistOnly, quality)
	if err != nil {
		return "", err
	}
	if alreadyExists {
		fmt.Printf("File already exists: %s (%.2f MB)\n", outputFilename, float64(mustFileSize(outputFilename))/(1024*1024))
		return "EXISTS:" + outputFilename, nil
	}

	qualities := []string{quality}
	if isTidalAtmosQuality(quality) && allowAtmosFallback {
		fallbackQuality := "HI_RES_LOSSLESS"
		if strings.TrimSpace(atmosFallbackQuality) == "16" {
			fallbackQuality = "LOSSLESS"
		}
		qualities = append(qualities, fallbackQuality)
		if fallbackQuality == "HI_RES_LOSSLESS" && allowFallback {
			qualities = append(qualities, "LOSSLESS")
		}
	} else if isTidalHiResQuality(quality) && allowFallback {
		qualities = append(qualities, "LOSSLESS")
	}

	var lastErr error
	for index, candidateQuality := range qualities {
		if index > 0 {
			fmt.Printf("%s unavailable/failed, falling back to %s...\n", qualities[index-1], candidateQuality)
			outputFilename, alreadyExists, err = buildTidalOutputPath(outputDir, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, useAlbumTrackNumber, spotifyTrackNumber, spotifyDiscNumber, isrcOverride, useFirstArtistOnly, candidateQuality)
			if err != nil {
				return outputFilename, err
			}
			if alreadyExists {
				return "EXISTS:" + outputFilename, nil
			}
		}

		downloadURL, candidateErr := t.GetDownloadURL(trackID, candidateQuality)
		if candidateErr != nil {
			if IsDownloadCancelledError(candidateErr) {
				return outputFilename, candidateErr
			}
			lastErr = candidateErr
			continue
		}

		fmt.Printf("Downloading to: %s\n", outputFilename)
		if candidateErr = t.DownloadFile(downloadURL, outputFilename, candidateQuality); candidateErr == nil {
			lastErr = nil
			break
		}
		cleanupTidalDownloadArtifacts(outputFilename)
		lastErr = candidateErr
	}
	if lastErr != nil {
		return outputFilename, fmt.Errorf("all requested Tidal qualities failed: %w", lastErr)
	}

	finalizeTidalDownload(outputFilename, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyTotalDiscs, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL, useSingleGenre, embedGenre)

	fmt.Println("Done")
	fmt.Println("Downloaded successfully from Tidal")
	return outputFilename, nil
}

func (t *TidalDownloader) DownloadByURLWithFallback(tidalURL, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL string, allowFallback bool, useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool) (string, error) {
	fmt.Printf("Using Tidal URL: %s\n", tidalURL)

	trackID, err := t.GetTrackIDFromURL(tidalURL)
	if err != nil {
		return "", err
	}

	if trackID == 0 {
		return "", fmt.Errorf("no track ID found")
	}

	outputFilename, alreadyExists, err := buildTidalOutputPath(outputDir, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, useAlbumTrackNumber, spotifyTrackNumber, spotifyDiscNumber, isrcOverride, useFirstArtistOnly, quality)
	if err != nil {
		return "", err
	}
	if alreadyExists {
		fmt.Printf("File already exists: %s (%.2f MB)\n", outputFilename, float64(mustFileSize(outputFilename))/(1024*1024))
		return "EXISTS:" + outputFilename, nil
	}

	fmt.Printf("Downloading to: %s\n", outputFilename)
	successAPI, err := t.downloadWithRotatingAPIs(trackID, outputFilename, quality, allowFallback)
	if err != nil {
		cleanupTidalDownloadArtifacts(outputFilename)
		return outputFilename, err
	}
	fmt.Printf("Downloaded using API: %s\n", successAPI)

	finalizeTidalDownload(outputFilename, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyTotalDiscs, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL, useSingleGenre, embedGenre)

	fmt.Println("Done")
	fmt.Println("Downloaded successfully from Tidal")
	return outputFilename, nil
}

func (t *TidalDownloader) Download(spotifyTrackID, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL string, allowFallback bool, allowAtmosFallback bool, atmosFallbackQuality string, useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool) (string, error) {

	tidalURL, err := t.GetTidalURLFromSpotify(spotifyTrackID)
	if err != nil {
		return "", fmt.Errorf("songlink/songstats couldn't find Tidal URL: %w", err)
	}

	return t.DownloadByURL(tidalURL, outputDir, quality, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyTotalDiscs, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL, allowFallback, allowAtmosFallback, atmosFallbackQuality, useFirstArtistOnly, useSingleGenre, embedGenre)
}

type SegmentTemplate struct {
	Initialization string `xml:"initialization,attr"`
	Media          string `xml:"media,attr"`
	Timeline       struct {
		Segments []struct {
			Duration int64 `xml:"d,attr"`
			Repeat   int   `xml:"r,attr"`
		} `xml:"S"`
	} `xml:"SegmentTimeline"`
}

type MPD struct {
	XMLName xml.Name `xml:"MPD"`
	Period  struct {
		AdaptationSets []struct {
			MimeType        string `xml:"mimeType,attr"`
			Codecs          string `xml:"codecs,attr"`
			Representations []struct {
				ID              string           `xml:"id,attr"`
				Codecs          string           `xml:"codecs,attr"`
				Bandwidth       int              `xml:"bandwidth,attr"`
				SegmentTemplate *SegmentTemplate `xml:"SegmentTemplate"`
			} `xml:"Representation"`
			SegmentTemplate *SegmentTemplate `xml:"SegmentTemplate"`
		} `xml:"AdaptationSet"`
	} `xml:"Period"`
}

func parseManifest(manifestB64 string) (directURL string, initURL string, mediaURLs []string, mimeType string, err error) {
	manifestBytes, err := base64.StdEncoding.DecodeString(manifestB64)
	if err != nil {
		return "", "", nil, "", fmt.Errorf("failed to decode manifest: %w", err)
	}

	manifestStr := string(manifestBytes)

	if strings.HasPrefix(strings.TrimSpace(manifestStr), "{") {
		var btsManifest TidalBTSManifest
		if err := json.Unmarshal(manifestBytes, &btsManifest); err != nil {
			return "", "", nil, "", fmt.Errorf("failed to parse BTS manifest: %w", err)
		}

		if len(btsManifest.URLs) == 0 {
			return "", "", nil, "", fmt.Errorf("no URLs in BTS manifest")
		}

		fmt.Printf("Manifest: BTS format (%s, %s)\n", btsManifest.MimeType, btsManifest.Codecs)
		return btsManifest.URLs[0], "", nil, btsManifest.MimeType, nil
	}

	fmt.Println("Manifest: DASH format")

	var mpd MPD
	var segTemplate *SegmentTemplate
	var dashMimeType string

	if err := xml.Unmarshal(manifestBytes, &mpd); err == nil {
		var selectedBandwidth int
		var selectedCodecs string
		var selectedMimeType string

		for _, as := range mpd.Period.AdaptationSets {

			if as.SegmentTemplate != nil {

				if segTemplate == nil {
					segTemplate = as.SegmentTemplate
					selectedCodecs = as.Codecs
					selectedMimeType = as.MimeType
				}
			}

			for _, rep := range as.Representations {
				if rep.SegmentTemplate != nil {
					if rep.Bandwidth > selectedBandwidth {
						selectedBandwidth = rep.Bandwidth
						segTemplate = rep.SegmentTemplate

						if rep.Codecs != "" {
							selectedCodecs = rep.Codecs
						} else {
							selectedCodecs = as.Codecs
						}

						selectedMimeType = as.MimeType
					}
				}
			}
		}

		if selectedBandwidth > 0 {
			fmt.Printf("Selected stream: Codec=%s, Bandwidth=%d bps\n", selectedCodecs, selectedBandwidth)
			dashMimeType = fmt.Sprintf("%s; codecs=\"%s\"", selectedMimeType, selectedCodecs)
		}
	}

	var mediaTemplate string
	segmentCount := 0

	if segTemplate != nil {
		initURL = segTemplate.Initialization
		mediaTemplate = segTemplate.Media

		for _, seg := range segTemplate.Timeline.Segments {
			segmentCount += seg.Repeat + 1
		}
	}

	if segmentCount > 0 && initURL != "" && mediaTemplate != "" {
		initURL = strings.ReplaceAll(initURL, "&amp;", "&")
		mediaTemplate = strings.ReplaceAll(mediaTemplate, "&amp;", "&")

		fmt.Printf("Parsed manifest via XML: %d segments\n", segmentCount)

		for i := 1; i <= segmentCount; i++ {
			mediaURL := strings.ReplaceAll(mediaTemplate, "$Number$", fmt.Sprintf("%d", i))
			mediaURLs = append(mediaURLs, mediaURL)
		}
		return "", initURL, mediaURLs, dashMimeType, nil
	}

	fmt.Println("Using regex fallback for DASH manifest...")

	initRe := regexp.MustCompile(`initialization="([^"]+)"`)
	mediaRe := regexp.MustCompile(`media="([^"]+)"`)

	if match := initRe.FindStringSubmatch(manifestStr); len(match) > 1 {
		initURL = match[1]
	}
	if match := mediaRe.FindStringSubmatch(manifestStr); len(match) > 1 {
		mediaTemplate = match[1]
	}

	if initURL == "" {
		return "", "", nil, "", fmt.Errorf("no initialization URL found in manifest")
	}

	initURL = strings.ReplaceAll(initURL, "&amp;", "&")
	mediaTemplate = strings.ReplaceAll(mediaTemplate, "&amp;", "&")

	segmentCount = 0

	segTagRe := regexp.MustCompile(`<S\s+[^>]*>`)
	matches := segTagRe.FindAllString(manifestStr, -1)

	for _, match := range matches {
		repeat := 0
		rRe := regexp.MustCompile(`r="(\d+)"`)
		if rMatch := rRe.FindStringSubmatch(match); len(rMatch) > 1 {
			fmt.Sscanf(rMatch[1], "%d", &repeat)
		}
		segmentCount += repeat + 1
	}

	if segmentCount == 0 {
		return "", "", nil, "", fmt.Errorf("no segments found in manifest (XML: %d, Regex: 0)", len(matches))
	}

	fmt.Printf("Parsed manifest via Regex: %d segments\n", segmentCount)

	for i := 1; i <= segmentCount; i++ {
		mediaURL := strings.ReplaceAll(mediaTemplate, "$Number$", fmt.Sprintf("%d", i))
		mediaURLs = append(mediaURLs, mediaURL)
	}

	return "", initURL, mediaURLs, dashMimeType, nil
}

func (t *TidalDownloader) downloadWithRotatingAPIs(trackID int64, outputFilename string, quality string, allowFallback bool) (string, error) {
	qualities := []string{quality}
	if isTidalHiResQuality(quality) && allowFallback {
		qualities = append(qualities, "LOSSLESS")
	}

	var lastErr error
	for idx, candidateQuality := range qualities {
		if idx > 0 {
			fmt.Printf("%s unavailable/failed on all APIs, falling back to %s...\n", quality, candidateQuality)
		}

		apiURL, err := t.tryDownloadAcrossTidalAPIs(trackID, outputFilename, candidateQuality, false)
		if err == nil {
			return apiURL, nil
		}
		lastErr = err
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("no tidal api succeeded")
	}
	return "", lastErr
}

func (t *TidalDownloader) tryDownloadAcrossTidalAPIs(trackID int64, outputFilename string, quality string, refreshed bool) (string, error) {
	apis, err := getConfiguredTidalAPIAttemptList()
	if err != nil && len(apis) == 0 {
		return "", fmt.Errorf("failed to load tidal api list: %w", err)
	}
	if len(apis) == 0 {
		return "", fmt.Errorf("no tidal apis available")
	}

	var lastErr error
	errors := make([]string, 0, len(apis))

	for _, apiURL := range apis {
		fmt.Printf("Trying Tidal API: %s\n", apiURL)

		downloader := NewTidalDownloader(apiURL)
		downloadURL, err := downloader.GetDownloadURL(trackID, quality)
		if err != nil {
			lastErr = err
			errors = append(errors, fmt.Sprintf("%s: %v", apiURL, err))
			continue
		}

		if err := downloader.DownloadFile(downloadURL, outputFilename, quality); err != nil {
			lastErr = err
			cleanupTidalDownloadArtifacts(outputFilename)
			errors = append(errors, fmt.Sprintf("%s: %v", apiURL, err))
			continue
		}

		return apiURL, nil
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("all tidal apis failed")
	}

	fmt.Println("All Tidal APIs failed:")
	for _, item := range errors {
		fmt.Printf("  %s\n", item)
	}

	return "", fmt.Errorf("all tidal apis failed for quality %s: %w", quality, lastErr)
}

func cleanupTidalDownloadArtifacts(outputPath string) {
	if outputPath == "" {
		return
	}

	_ = os.Remove(outputPath)
	_ = os.Remove(outputPath + ".m4a.tmp")
}

func isTidalHiResQuality(quality string) bool {
	normalized := strings.TrimSpace(strings.ToUpper(quality))
	return normalized == "HI_RES" || normalized == "HI_RES_LOSSLESS"
}

func isTidalAtmosQuality(quality string) bool {
	normalized := strings.TrimSpace(strings.ToUpper(quality))
	return normalized == "ATMOS" || normalized == "DOLBY" || normalized == "EAC3" || normalized == "EAC3_JOC"
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), wanted) {
			return true
		}
	}
	return false
}

func buildTidalFilename(title, artist, album, albumArtist, releaseDate string, trackNumber, discNumber int, format string, includeTrackNumber bool, position int, useAlbumTrackNumber bool, extra ...string) string {
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
