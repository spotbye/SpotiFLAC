package backend

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type AmazonDownloader struct {
	client  *http.Client
	regions []string
}

type AmazonStreamResponse struct {
	StreamURL     string `json:"streamUrl"`
	DecryptionKey string `json:"decryptionKey"`
}

var (
	amazonMusicDebugKeyOnce sync.Once
	amazonMusicDebugKey     string
	amazonMusicDebugKeyErr  error
)

var amazonMusicDebugKeySeedParts = [][]byte{
	[]byte("spotif"),
	[]byte("lac:am"),
	[]byte("azon:spotbye:api:v1"),
}

var amazonMusicDebugKeyAAD = []byte{
	0x61, 0x6d, 0x61, 0x7a, 0x6f, 0x6e, 0x7c, 0x73, 0x70, 0x6f, 0x74, 0x62,
	0x79, 0x65, 0x7c, 0x64, 0x65, 0x62, 0x75, 0x67, 0x7c, 0x76, 0x31,
}

var amazonMusicDebugKeyNonce = []byte{
	0x52, 0x1f, 0xa4, 0x9c, 0x13, 0x77, 0x5b, 0xe2, 0x81, 0x44, 0x90, 0x6d,
}

var amazonMusicDebugKeyCiphertext = []byte{
	0x5b, 0xf9, 0xc1, 0x2e, 0x58, 0xf8, 0x5b, 0xc0, 0x04, 0x68, 0x7e, 0xff,
	0x3d, 0xd6, 0x8b, 0xe3, 0x86, 0x49, 0x6c, 0xfd, 0xc1, 0x49, 0x0b, 0xfb,
}

var amazonMusicDebugKeyTag = []byte{
	0x6c, 0x21, 0x98, 0x51, 0xf2, 0x38, 0x4b, 0x4a, 0x23, 0xe1, 0xc6, 0xd7,
	0x65, 0x7f, 0xfb, 0xa1,
}

func getAmazonMusicDebugKey() (string, error) {
	amazonMusicDebugKeyOnce.Do(func() {
		hasher := sha256.New()
		for _, part := range amazonMusicDebugKeySeedParts {
			hasher.Write(part)
		}

		block, err := aes.NewCipher(hasher.Sum(nil))
		if err != nil {
			amazonMusicDebugKeyErr = err
			return
		}

		gcm, err := cipher.NewGCM(block)
		if err != nil {
			amazonMusicDebugKeyErr = err
			return
		}

		sealed := make([]byte, 0, len(amazonMusicDebugKeyCiphertext)+len(amazonMusicDebugKeyTag))
		sealed = append(sealed, amazonMusicDebugKeyCiphertext...)
		sealed = append(sealed, amazonMusicDebugKeyTag...)

		plaintext, err := gcm.Open(nil, amazonMusicDebugKeyNonce, sealed, amazonMusicDebugKeyAAD)
		if err != nil {
			amazonMusicDebugKeyErr = err
			return
		}

		amazonMusicDebugKey = string(plaintext)
	})

	if amazonMusicDebugKeyErr != nil {
		return "", amazonMusicDebugKeyErr
	}

	return amazonMusicDebugKey, nil
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

func (a *AmazonDownloader) DownloadFromAfkarXYZ(amazonURL, outputDir, quality string) (string, error) {

	asinRegex := regexp.MustCompile(`(B[0-9A-Z]{9})`)
	asin := asinRegex.FindString(amazonURL)
	if asin == "" {
		return "", fmt.Errorf("failed to extract ASIN from URL: %s", amazonURL)
	}

	apiURL := fmt.Sprintf("%s/api/track/%s", amazonMusicAPIBaseURL, asin)
	req, err := NewRequestWithDefaultHeaders(http.MethodGet, apiURL, nil)
	if err != nil {
		return "", err
	}

	debugKey, err := getAmazonMusicDebugKey()
	if err != nil {
		return "", fmt.Errorf("failed to decrypt Amazon debug key: %w", err)
	}
	req.Header.Set("X-Debug-Key", debugKey)

	fmt.Printf("Fetching from Amazon API (ASIN: %s)...\n", asin)
	resp, err := a.client.Do(req)
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

	var apiResp AmazonStreamResponse
	if err := json.Unmarshal(bodyBytes, &apiResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	if apiResp.StreamURL == "" {
		return "", fmt.Errorf("no stream URL found in response")
	}

	downloadURL := apiResp.StreamURL
	fileName := fmt.Sprintf("%s.m4a", asin)
	filePath := filepath.Join(outputDir, fileName)

	out, err := os.Create(filePath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	dlReq, err := NewRequestWithDefaultHeaders(http.MethodGet, downloadURL, nil)
	if err != nil {
		return "", err
	}

	dlResp, err := a.client.Do(dlReq)
	if err != nil {
		return "", err
	}
	defer dlResp.Body.Close()

	fmt.Printf("Downloading track: %s\n", fileName)
	pw := NewProgressWriter(out)
	_, err = io.Copy(pw, dlResp.Body)
	if err != nil {
		out.Close()
		os.Remove(filePath)
		return "", err
	}

	fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))

	if apiResp.DecryptionKey != "" {
		fmt.Printf("Decrypting file...\n")

		ffprobePath, err := GetFFprobePath()
		var codec string
		if err == nil {
			cmdProbe := exec.Command(ffprobePath,
				"-v", "quiet",
				"-select_streams", "a:0",
				"-show_entries", "stream=codec_name",
				"-of", "default=noprint_wrappers=1:nokey=1",
				filePath,
			)
			setHideWindow(cmdProbe)
			codecOutput, _ := cmdProbe.Output()
			codec = strings.TrimSpace(string(codecOutput))
			fmt.Printf("Detected codec: %s\n", codec)
		}

		targetExt := ".m4a"
		if codec == "flac" {
			targetExt = ".flac"
		}

		decryptedFilename := "dec_" + fileName + targetExt

		if targetExt == ".flac" && strings.HasSuffix(fileName, ".m4a") {
			decryptedFilename = "dec_" + strings.TrimSuffix(fileName, ".m4a") + ".flac"
		}

		decryptedPath := filepath.Join(outputDir, decryptedFilename)

		ffmpegPath, err := GetFFmpegPath()
		if err != nil {
			return "", fmt.Errorf("ffmpeg not found for decryption: %w", err)
		}

		if err := ValidateExecutable(ffmpegPath); err != nil {
			return "", fmt.Errorf("invalid ffmpeg executable: %w", err)
		}

		key := strings.TrimSpace(apiResp.DecryptionKey)

		cmd := exec.Command(ffmpegPath,
			"-decryption_key", key,
			"-i", filePath,
			"-c", "copy",
			"-y",
			decryptedPath,
		)

		setHideWindow(cmd)
		output, err := cmd.CombinedOutput()
		if err != nil {

			outStr := string(output)
			if len(outStr) > 500 {
				outStr = outStr[len(outStr)-500:]
			}
			return "", fmt.Errorf("ffmpeg decryption failed: %v\nTail Output: %s", err, outStr)
		}

		if info, err := os.Stat(decryptedPath); err != nil || info.Size() == 0 {
			return "", fmt.Errorf("decrypted file missing or empty")
		}

		if err := os.Remove(filePath); err != nil {
			fmt.Printf("Warning: Failed to remove encrypted file: %v\n", err)
		}

		finalPath := filepath.Join(outputDir, strings.TrimPrefix(decryptedFilename, "dec_"))
		if err := os.Rename(decryptedPath, finalPath); err != nil {
			return "", fmt.Errorf("failed to rename decrypted file: %w", err)
		}
		filePath = finalPath

		fmt.Println("Decryption successful")
	}

	return filePath, nil
}

func (a *AmazonDownloader) DownloadFromService(amazonURL, outputDir, quality string) (string, error) {
	return a.DownloadFromAfkarXYZ(amazonURL, outputDir, quality)
}

func (a *AmazonDownloader) DownloadByURL(amazonURL, outputDir, quality, filenameFormat, playlistName, playlistOwner string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL string, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, embedMaxQualityCover bool, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL string, useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool) (string, error) {

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

		if !GetRedownloadWithSuffixSetting() && !ExistingFileCheckDisabled() {
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
						fmt.Println("✓ MusicBrainz metadata fetched")
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

	filePath, err := a.DownloadFromService(amazonURL, outputDir, quality)
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
	fmt.Println("✓ Downloaded successfully from Amazon Music")
	return filePath, nil
}

func (a *AmazonDownloader) DownloadBySpotifyID(spotifyTrackID, outputDir, quality, filenameFormat, playlistName, playlistOwner string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL string, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, embedMaxQualityCover bool, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL string,
	useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool,
) (string, error) {

	amazonURL, err := a.GetAmazonURLFromSpotify(spotifyTrackID)
	if err != nil {
		return "", err
	}

	return a.DownloadByURL(amazonURL, outputDir, quality, filenameFormat, playlistName, playlistOwner, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, embedMaxQualityCover, spotifyTotalDiscs, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL, useFirstArtistOnly, useSingleGenre, embedGenre)
}
