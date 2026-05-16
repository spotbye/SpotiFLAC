package backend

import (
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const ytDlpReleaseBaseURL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download"

type YouTubeDownloader struct{}

func NewYouTubeDownloader() *YouTubeDownloader {
	return &YouTubeDownloader{}
}

func getYtDlpName() string {
	if runtime.GOOS == "windows" {
		return "yt-dlp.exe"
	}
	return "yt-dlp"
}

func getYtDlpDownloadURL() (string, error) {
	switch runtime.GOOS {
	case "windows":
		return ytDlpReleaseBaseURL + "/yt-dlp.exe", nil
	case "linux":
		switch runtime.GOARCH {
		case "amd64":
			return ytDlpReleaseBaseURL + "/yt-dlp_linux", nil
		case "arm64":
			return ytDlpReleaseBaseURL + "/yt-dlp_linux_aarch64", nil
		default:
			return "", fmt.Errorf("unsupported Linux architecture: %s", runtime.GOARCH)
		}
	case "darwin":
		return ytDlpReleaseBaseURL + "/yt-dlp_macos", nil
	default:
		return "", fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

func GetYtDlpPath() (string, error) {
	ytDlpName := getYtDlpName()

	if systemPath := resolveSystemExecutable(ytDlpName); systemPath != "" {
		if runYtDlpVersionCheck(systemPath) == nil {
			return systemPath, nil
		}
	}

	appDir, err := GetAppDir()
	if err != nil {
		return "", err
	}
	localPath := filepath.Join(appDir, ytDlpName)
	if _, err := os.Stat(localPath); err == nil {
		if prepareExecutableForUse(localPath) == nil {
			if runYtDlpVersionCheck(localPath) == nil {
				return localPath, nil
			}
		}
	}

	return "", fmt.Errorf("yt-dlp not found in app directory or system path")
}

func IsYtDlpInstalled() bool {
	_, err := GetYtDlpPath()
	return err == nil
}

func runYtDlpVersionCheck(path string) error {
	cmd := exec.Command(path, "--version")
	setHideWindow(cmd)
	return cmd.Run()
}

func DownloadYtDlp() error {
	url, err := getYtDlpDownloadURL()
	if err != nil {
		return err
	}

	appDir, err := EnsureAppDir()
	if err != nil {
		return err
	}

	destPath := filepath.Join(appDir, getYtDlpName())

	fmt.Printf("[yt-dlp] Downloading from: %s\n", url)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download yt-dlp: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download yt-dlp: HTTP %d", resp.StatusCode)
	}

	tmpFile, err := os.CreateTemp("", "yt-dlp-*")
	if err != nil {
		return err
	}
	tmpName := tmpFile.Name()
	defer os.Remove(tmpName)

	var downloaded int64
	buf := make([]byte, 32*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			tmpFile.Write(buf[:n])
			downloaded += int64(n)
			fmt.Printf("\r[yt-dlp] Downloaded: %.2f MB", float64(downloaded)/(1024*1024))
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			tmpFile.Close()
			return readErr
		}
	}
	tmpFile.Close()
	fmt.Printf("\n[yt-dlp] Download complete (%.2f MB)\n", float64(downloaded)/(1024*1024))

	if err := copyExecutable(tmpName, destPath); err != nil {
		return fmt.Errorf("failed to install yt-dlp: %w", err)
	}
	if err := prepareExecutableForUse(destPath); err != nil {
		return fmt.Errorf("failed to prepare yt-dlp: %w", err)
	}

	fmt.Printf("[yt-dlp] Installed to: %s\n", destPath)
	return nil
}

type ytSearchResult struct {
	ID       string
	Duration float64
	Title    string
}

func searchYouTube(ytDlpPath, query string, count int) ([]ytSearchResult, error) {
	searchQuery := fmt.Sprintf("ytsearch%d:%s", count, query)
	cmd := exec.Command(ytDlpPath,
		"--print", "%(id)s\t%(duration)s\t%(title)s",
		"--skip-download",
		searchQuery,
	)
	setHideWindow(cmd)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("yt-dlp search failed: %w", err)
	}

	var results []ytSearchResult
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 2 {
			continue
		}
		dur, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
		if err != nil {
			continue
		}
		title := ""
		if len(parts) >= 3 {
			title = strings.TrimSpace(parts[2])
		}
		results = append(results, ytSearchResult{
			ID:       strings.TrimSpace(parts[0]),
			Duration: dur,
			Title:    title,
		})
	}
	return results, nil
}

func findBestDurationMatch(results []ytSearchResult, targetSeconds float64) *ytSearchResult {
	if len(results) == 0 {
		return nil
	}
	if targetSeconds <= 0 {
		return &results[0]
	}
	best := &results[0]
	bestDiff := math.Abs(results[0].Duration - targetSeconds)
	for i := 1; i < len(results); i++ {
		diff := math.Abs(results[i].Duration - targetSeconds)
		if diff < bestDiff {
			bestDiff = diff
			best = &results[i]
		}
	}
	return best
}

func (y *YouTubeDownloader) Download(
	trackName, artistName, albumName, albumArtist, releaseDate, coverURL, outputDir, filenameFormat string,
	includeTrackNumber bool, position, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyTotalDiscs int,
	copyright, publisher, composer, metadataSeparator, isrc, spotifyURL string,
	embedMaxQualityCover, useFirstArtistOnly, embedGenre bool,
	durationSeconds int, genre string,
) (string, error) {
	ytDlpPath, err := GetYtDlpPath()
	if err != nil {
		fmt.Println("[YouTube] yt-dlp not found, downloading...")
		if dlErr := DownloadYtDlp(); dlErr != nil {
			return "", fmt.Errorf("failed to install yt-dlp: %w", dlErr)
		}
		ytDlpPath, err = GetYtDlpPath()
		if err != nil {
			return "", fmt.Errorf("yt-dlp unavailable after install: %w", err)
		}
	}

	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return "", fmt.Errorf("ffmpeg not available for YouTube download: %w", err)
	}

	displayArtist := artistName
	if useFirstArtistOnly {
		displayArtist = GetFirstArtist(artistName)
	}
	query := fmt.Sprintf("%s %s", trackName, displayArtist)
	fmt.Printf("[YouTube] Searching: %s\n", query)

	results, err := searchYouTube(ytDlpPath, query, 5)
	if err != nil {
		return "", fmt.Errorf("YouTube search failed: %w", err)
	}
	if len(results) == 0 {
		return "", fmt.Errorf("no YouTube results for: %s", query)
	}

	best := findBestDurationMatch(results, float64(durationSeconds))
	if best == nil {
		return "", fmt.Errorf("no suitable YouTube result found")
	}
	diff := math.Abs(best.Duration - float64(durationSeconds))
	fmt.Printf("[YouTube] Best match: %s (%.0fs, diff=%.1fs)\n", best.Title, best.Duration, diff)

	displayAlbumArtist := albumArtist
	if useFirstArtistOnly {
		displayAlbumArtist = GetFirstArtist(albumArtist)
	}
	baseName := buildFormattedFilenameBase(
		trackName, displayArtist, albumName, displayAlbumArtist,
		releaseDate, filenameFormat, "", "", isrc,
		includeTrackNumber, position, spotifyDiscNumber, false,
	)

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create output directory: %w", err)
	}

	finalPath := filepath.Join(outputDir, baseName+".mp3")
	if GetRedownloadWithSuffixSetting() {
		finalPath, _ = ResolveOutputPathForDownload(finalPath, true)
	} else if info, statErr := os.Stat(finalPath); statErr == nil && info.Size() > 0 {
		fmt.Printf("[YouTube] File already exists: %s\n", finalPath)
		return "EXISTS:" + finalPath, nil
	}

	// Download raw audio to a temp file
	tmpBase := filepath.Join(os.TempDir(), fmt.Sprintf("spotiflac-yt-%d", time.Now().UnixNano()))
	tmpPattern := tmpBase + ".%(ext)s"
	videoURL := fmt.Sprintf("https://www.youtube.com/watch?v=%s", best.ID)

	dlCmd := exec.Command(ytDlpPath,
		"-f", "bestaudio[ext=m4a]/bestaudio/best",
		"--no-playlist",
		"--no-embed-metadata",
		"-o", tmpPattern,
		videoURL,
	)
	setHideWindow(dlCmd)
	fmt.Printf("[YouTube] Downloading audio: %s\n", videoURL)
	if dlOut, dlErr := dlCmd.CombinedOutput(); dlErr != nil {
		return "", fmt.Errorf("yt-dlp download failed: %w\n%s", dlErr, string(dlOut))
	}

	// Locate the downloaded file (extension depends on what yt-dlp chose)
	var downloadedFile string
	for _, ext := range []string{".m4a", ".webm", ".opus", ".mp4", ".ogg", ".mp3"} {
		candidate := tmpBase + ext
		if _, statErr := os.Stat(candidate); statErr == nil {
			downloadedFile = candidate
			break
		}
	}
	if downloadedFile == "" {
		return "", fmt.Errorf("downloaded audio file not found (base: %s)", tmpBase)
	}
	defer os.Remove(downloadedFile)

	// Convert to MP3 320kbps via ffmpeg, stripping all source metadata so
	// the output starts clean and id3v2 can write Spotify tags reliably.
	fmt.Println("[YouTube] Converting to MP3 320kbps...")
	convCmd := exec.Command(ffmpegPath,
		"-i", downloadedFile,
		"-map_metadata", "-1",
		"-codec:a", "libmp3lame",
		"-b:a", "320k",
		"-map", "0:a",
		"-id3v2_version", "3",
		"-write_id3v1", "0",
		"-y",
		finalPath,
	)
	setHideWindow(convCmd)
	if convOut, convErr := convCmd.CombinedOutput(); convErr != nil {
		return "", fmt.Errorf("ffmpeg conversion failed: %w\n%s", convErr, string(convOut))
	}

	// Download Spotify cover art
	coverPath := ""
	if coverURL != "" {
		coverPath = finalPath + ".cover.jpg"
		coverClient := NewCoverClient()
		if dlErr := coverClient.DownloadCoverToPath(coverURL, coverPath, embedMaxQualityCover); dlErr != nil {
			fmt.Printf("[YouTube] Warning: cover download failed: %v\n", dlErr)
			coverPath = ""
		} else {
			defer os.Remove(coverPath)
		}
	}

	// Embed full Spotify metadata
	trackNum := spotifyTrackNumber
	if trackNum == 0 {
		trackNum = 1
	}
	metadata := Metadata{
		Title:       trackName,
		Artist:      artistName,
		Album:       albumName,
		AlbumArtist: albumArtist,
		Date:        releaseDate,
		TrackNumber: trackNum,
		TotalTracks: spotifyTotalTracks,
		DiscNumber:  spotifyDiscNumber,
		TotalDiscs:  spotifyTotalDiscs,
		URL:         spotifyURL,
		Comment:     spotifyURL,
		Copyright:   copyright,
		Publisher:   publisher,
		Composer:    composer,
		Separator:   metadataSeparator,
		Description: "https://github.com/spotbye/SpotiFLAC",
		ISRC:        isrc,
		Genre:       genre,
	}

	fmt.Println("[YouTube] Embedding Spotify metadata...")
	if embedErr := EmbedMetadataToConvertedFile(finalPath, metadata, coverPath); embedErr != nil {
		fmt.Printf("[YouTube] Warning: metadata embed failed: %v\n", embedErr)
	} else {
		fmt.Println("[YouTube] Metadata embedded successfully")
	}

	fmt.Printf("[YouTube] ✓ Downloaded: %s\n", filepath.Base(finalPath))
	return finalPath, nil
}
