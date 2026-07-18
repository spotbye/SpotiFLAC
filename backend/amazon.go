package backend

import (
	"bytes"
	"encoding/json"
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

type AmazonDownloader struct {
	client    *http.Client
	regions   []string
	SourceURL string
}

func NewAmazonDownloader() *AmazonDownloader {
	return &AmazonDownloader{
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
		regions: []string{"us", "eu"},
	}
}

func (a *AmazonDownloader) GetAmazonURLFromSpotify(spotifyTrackID string) (string, error) {
	fmt.Println("Getting Amazon URL...")
	client := NewSongLinkClient()
	urls, err := client.GetAllURLsFromSpotify(spotifyTrackID, "")
	if err != nil {
		return "", fmt.Errorf("failed to get Amazon URL: %w", err)
	}

	amazonURL := normalizeAmazonMusicURL(urls.AmazonURL)
	if amazonURL == "" {
		return "", fmt.Errorf("amazon Music link not found")
	}
	fmt.Printf("Found Amazon URL: %s\n", amazonURL)
	return amazonURL, nil
}

type amazonCommunityResponse struct {
	ASIN      string   `json:"asin"`
	Codec     string   `json:"codec"`
	BitDepth  int      `json:"bit_depth"`
	URL       string   `json:"url"`
	StreamURL string   `json:"stream_url"`
	Key       string   `json:"key"`
	KeySpecs  []string `json:"key_specs"`
	Captcha   string   `json:"captcha"`
}

func amazonCommunityNormalizeQuality(quality string) string {
	switch strings.ToLower(strings.TrimSpace(quality)) {
	case "16", "lossless", "cd":
		return "16"
	case "atmos", "eac3", "dolby":
		return "atmos"
	default:
		return "24"
	}
}

func (a *AmazonDownloader) downloadFromCommunity(amazonURL, outputDir, quality string) (string, error) {

	asinRegex := regexp.MustCompile(`(B[0-9A-Z]{9})`)
	asin := asinRegex.FindString(amazonURL)
	if asin == "" {
		return "", fmt.Errorf("failed to extract ASIN from URL: %s", amazonURL)
	}

	payload, err := json.Marshal(map[string]string{
		"id":      asin,
		"quality": amazonCommunityNormalizeQuality(quality),
		"country": "US",
	})
	if err != nil {
		return "", err
	}

	fmt.Printf("Fetching from Amazon API (ASIN: %s)...\n", asin)
	resp, err := doCommunityRequest(a.client, "Amazon", func() (*http.Request, error) {
		req, err := NewRequestWithDefaultHeaders(http.MethodPost, GetAmazonCommunityDownloadURL(), bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		if err := setCommunityRequestHeaders(req); err != nil {
			return nil, err
		}
		return req, nil
	})
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("Amazon API returned status %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var apiResp amazonCommunityResponse
	if err := json.Unmarshal(bodyBytes, &apiResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	streamURL := strings.TrimSpace(apiResp.StreamURL)
	if streamURL == "" {
		streamURL = strings.TrimSpace(apiResp.URL)
	}
	if streamURL == "" {
		return "", fmt.Errorf("no stream URL found in response")
	}

	keySpecs := apiResp.KeySpecs
	if len(keySpecs) == 0 {
		if key := strings.TrimSpace(apiResp.Key); key != "" {
			keySpecs = []string{key}
		}
	}

	encryptedPath := filepath.Join(outputDir, fmt.Sprintf("%s.encrypted.mp4", asin))
	out, err := os.Create(encryptedPath)
	if err != nil {
		return "", err
	}
	defer func() {
		out.Close()
		os.Remove(encryptedPath)
	}()

	dlReq, err := NewRequestWithDefaultHeaders(http.MethodGet, streamURL, nil)
	if err != nil {
		return "", err
	}
	if captcha := strings.TrimSpace(apiResp.Captcha); captcha != "" {
		dlReq.Header.Set("x-captcha-token", captcha)
	}

	dlResp, err := a.client.Do(dlReq)
	if err != nil {
		return "", err
	}
	defer dlResp.Body.Close()

	fmt.Printf("Downloading track: %s\n", asin)
	pw := NewProgressWriter(out)
	if _, err = io.Copy(pw, dlResp.Body); err != nil {
		return "", err
	}
	out.Close()

	fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))

	remuxInput := encryptedPath
	if len(keySpecs) > 0 {
		fmt.Printf("Decrypting file...\n")
		decryptedPath := filepath.Join(outputDir, fmt.Sprintf("%s.decrypted.mp4", asin))
		if err := decryptWithMP4FF(keySpecs, encryptedPath, decryptedPath); err != nil {
			return "", err
		}
		defer os.Remove(decryptedPath)
		remuxInput = decryptedPath
		fmt.Println("Decryption successful")
	}

	targetExt := ".flac"
	codec := strings.ToLower(strings.TrimSpace(apiResp.Codec))
	if amazonCommunityNormalizeQuality(quality) == "atmos" || codec == "eac3" || codec == "ec-3" || codec == "ac-3" {
		targetExt = ".m4a"
	}
	finalPath := filepath.Join(outputDir, asin+targetExt)

	if err := amazonRemuxWithFFmpeg(remuxInput, finalPath, targetExt); err != nil {
		return "", err
	}

	if info, err := os.Stat(finalPath); err != nil || info.Size() == 0 {
		return "", fmt.Errorf("remuxed file missing or empty")
	}

	return finalPath, nil
}

func amazonRemuxWithFFmpeg(inputPath, outputPath, targetExt string) error {
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return fmt.Errorf("ffmpeg not found for remux: %w", err)
	}
	if err := ValidateExecutable(ffmpegPath); err != nil {
		return fmt.Errorf("invalid ffmpeg executable: %w", err)
	}

	runFFmpeg := func(args ...string) (string, error) {
		cmd := exec.Command(ffmpegPath, args...)
		setHideWindow(cmd)
		output, err := cmd.CombinedOutput()
		return string(output), err
	}

	args := []string{"-y", "-i", inputPath, "-map", "0:a:0", "-vn", "-c:a", "copy"}
	if targetExt == ".m4a" {
		args = append(args, "-f", "mp4")
	}
	args = append(args, outputPath)

	if output, err := runFFmpeg(args...); err != nil {
		if targetExt == ".flac" {
			if output2, err2 := runFFmpeg("-y", "-i", inputPath, "-map", "0:a:0", "-vn", "-c:a", "flac", outputPath); err2 == nil {
				return nil
			} else {
				output = output2
				err = err2
			}
		}
		if len(output) > 500 {
			output = output[len(output)-500:]
		}
		return fmt.Errorf("ffmpeg remux failed: %v\nTail Output: %s", err, output)
	}
	return nil
}

func (a *AmazonDownloader) DownloadFromService(amazonURL, outputDir, quality string) (string, error) {
	return a.downloadFromCommunity(amazonURL, outputDir, quality)
}

func (a *AmazonDownloader) DownloadByURL(amazonURL, outputDir, quality, filenameFormat, playlistName, playlistOwner string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL string, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, embedMaxQualityCover bool, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL string, allowFallback bool, allowAtmosFallback bool, atmosFallbackQuality string, useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool) (string, error) {

	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("failed to create output directory: %w", err)
		}
	}

	if spotifyTrackName != "" && spotifyArtistName != "" {
		filenameArtist := spotifyArtistName
		filenameAlbumArtist := spotifyAlbumArtist
		if useFirstArtistOnly {
			filenameArtist = GetFirstArtist(spotifyArtistName)
			filenameAlbumArtist = GetFirstArtist(spotifyAlbumArtist)
		}
		expectedFilename := BuildExpectedFilename(spotifyTrackName, filenameArtist, spotifyAlbumName, filenameAlbumArtist, spotifyReleaseDate, filenameFormat, playlistName, playlistOwner, includeTrackNumber, position, spotifyDiscNumber, false, isrcOverride)
		expectedPath := filepath.Join(outputDir, expectedFilename)

		if !GetRedownloadWithSuffixSetting() {
			if fileInfo, err := os.Stat(expectedPath); err == nil && fileInfo.Size() > 0 {
				fmt.Printf("File already exists: %s (%.2f MB)\n", expectedPath, float64(fileInfo.Size())/(1024*1024))
				return "EXISTS:" + expectedPath, nil
			}
		}
	}

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
					if fetchedMeta, err := FetchMusicBrainzMetadata(isrc, spotifyTrackName, spotifyArtistName, spotifyAlbumName, useSingleGenre, embedGenre); err == nil {
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

	fmt.Printf("Using Amazon URL: %s\n", amazonURL)
	a.SourceURL = amazonURL

	filePath, err := a.DownloadFromService(amazonURL, outputDir, quality)
	if err != nil && amazonCommunityNormalizeQuality(quality) == "atmos" && allowAtmosFallback {
		fallbackQuality := "24"
		if strings.TrimSpace(atmosFallbackQuality) == "16" {
			fallbackQuality = "16"
		}
		fmt.Printf("Dolby Atmos unavailable/failed, falling back to %s-bit FLAC...\n", fallbackQuality)
		filePath, err = a.DownloadFromService(amazonURL, outputDir, fallbackQuality)
		if err != nil && fallbackQuality == "24" && allowFallback {
			fmt.Println("24-bit FLAC unavailable/failed, falling back to 16-bit FLAC...")
			filePath, err = a.DownloadFromService(amazonURL, outputDir, "16")
		}
	}
	if err != nil {
		return "", err
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

	originalFileDir := filepath.Dir(filePath)
	originalFileBase := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))

	if spotifyTrackName != "" && spotifyArtistName != "" {
		safeArtist := sanitizeFilename(spotifyArtistName)
		safeAlbumArtist := sanitizeFilename(spotifyAlbumArtist)

		if useFirstArtistOnly {
			safeArtist = sanitizeFilename(GetFirstArtist(spotifyArtistName))
			safeAlbumArtist = sanitizeFilename(GetFirstArtist(spotifyAlbumArtist))
		}

		safeTitle := sanitizeFilename(spotifyTrackName)
		safeAlbum := sanitizeFilename(spotifyAlbumName)

		year := ""
		if len(spotifyReleaseDate) >= 4 {
			year = spotifyReleaseDate[:4]
		}

		var newFilename string

		if strings.Contains(filenameFormat, "{") {
			newFilename = filenameFormat
			newFilename = strings.ReplaceAll(newFilename, "{title}", safeTitle)
			newFilename = strings.ReplaceAll(newFilename, "{artist}", safeArtist)
			newFilename = strings.ReplaceAll(newFilename, "{album}", safeAlbum)
			newFilename = strings.ReplaceAll(newFilename, "{album_artist}", safeAlbumArtist)
			newFilename = strings.ReplaceAll(newFilename, "{year}", year)
			newFilename = strings.ReplaceAll(newFilename, "{date}", SanitizeFilename(spotifyReleaseDate))
			newFilename = strings.ReplaceAll(newFilename, "{isrc}", SanitizeOptionalFilename(isrc))

			if spotifyDiscNumber > 0 {
				newFilename = strings.ReplaceAll(newFilename, "{disc}", fmt.Sprintf("%d", spotifyDiscNumber))
			} else {
				newFilename = strings.ReplaceAll(newFilename, "{disc}", "")
			}

			if position > 0 {
				newFilename = strings.ReplaceAll(newFilename, "{track}", fmt.Sprintf("%02d", position))
			} else {

				newFilename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(newFilename, "")
				newFilename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(newFilename, "")
				newFilename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(newFilename, "")
			}
		} else {

			switch filenameFormat {
			case "artist-title":
				newFilename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
			case "title":
				newFilename = safeTitle
			default:
				newFilename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
			}

			if includeTrackNumber && position > 0 {
				newFilename = fmt.Sprintf("%02d. %s", position, newFilename)
			}
		}

		ext := filepath.Ext(filePath)
		if ext == "" {
			ext = ".flac"
		}
		newFilename = newFilename + ext
		newFilePath := filepath.Join(outputDir, newFilename)
		if GetRedownloadWithSuffixSetting() {
			newFilePath, _ = ResolveOutputPathForDownload(newFilePath, true)
		}

		if err := os.Rename(filePath, newFilePath); err != nil {
			fmt.Printf("Warning: Failed to rename file: %v\n", err)
		} else {
			filePath = newFilePath
			fmt.Printf("Renamed to: %s\n", newFilename)
		}
	}

	fmt.Println("Embedding Spotify metadata...")

	coverPath := ""

	if spotifyCoverURL != "" {
		coverPath = filePath + ".cover.jpg"
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
		Title:       spotifyTrackName,
		Artist:      spotifyArtistName,
		Album:       spotifyAlbumName,
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

	if err := EmbedMetadataToConvertedFile(filePath, metadata, coverPath); err != nil {
		fmt.Printf("Warning: Failed to embed metadata: %v\n", err)
	} else {
		fmt.Println("Metadata embedded successfully")
	}

	if strings.HasSuffix(strings.ToLower(filePath), ".flac") {

		originalM4aPath := filepath.Join(originalFileDir, originalFileBase+".m4a")
		if _, err := os.Stat(originalM4aPath); err == nil {
			if err := os.Remove(originalM4aPath); err != nil {
				fmt.Printf("Warning: Failed to remove M4A file: %v\n", err)
			} else {
				fmt.Printf("Cleaned up original M4A file: %s\n", filepath.Base(originalM4aPath))
			}
		}
	}

	fmt.Println("Done")
	fmt.Println("Downloaded successfully from Amazon Music")
	return filePath, nil
}

func (a *AmazonDownloader) DownloadBySpotifyID(spotifyTrackID, outputDir, quality, filenameFormat, playlistName, playlistOwner string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL string, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, embedMaxQualityCover bool, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL string,
	allowFallback bool, allowAtmosFallback bool, atmosFallbackQuality string, useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool,
) (string, error) {

	amazonURL, err := a.GetAmazonURLFromSpotify(spotifyTrackID)
	if err != nil {
		return "", err
	}

	return a.DownloadByURL(amazonURL, outputDir, quality, filenameFormat, playlistName, playlistOwner, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, embedMaxQualityCover, spotifyTotalDiscs, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL, allowFallback, allowAtmosFallback, atmosFallbackQuality, useFirstArtistOnly, useSingleGenre, embedGenre)
}
