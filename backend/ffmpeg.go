package backend

import (
	"archive/tar"
	"archive/zip"

	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ulikunitz/xz"
	"golang.org/x/text/unicode/norm"
)

type executableCandidate struct {
	path   string
	source string
}

func ValidateExecutable(path string) error {
	cleanedPath := filepath.Clean(path)
	if cleanedPath == "" {
		return fmt.Errorf("empty path")
	}

	if !filepath.IsAbs(cleanedPath) {
		return fmt.Errorf("path must be absolute: %s", path)
	}

	info, err := os.Stat(cleanedPath)
	if err != nil {
		return fmt.Errorf("failed to stat file: %w", err)
	}

	if info.IsDir() {
		return fmt.Errorf("path is a directory: %s", path)
	}

	if runtime.GOOS != "windows" {
		if info.Mode()&0111 == 0 {
			return fmt.Errorf("file is not executable: %s", path)
		}
	}

	base := filepath.Base(cleanedPath)
	validNames := map[string]bool{
		"ffmpeg":      true,
		"ffmpeg.exe":  true,
		"ffprobe":     true,
		"ffprobe.exe": true,
	}
	if !validNames[base] {
		return fmt.Errorf("invalid executable name: %s", base)
	}

	return nil
}

func GetAppDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(homeDir, ".spotiflac"), nil
}

func EnsureAppDir() (string, error) {
	appDir, err := GetAppDir()
	if err != nil {
		return "", err
	}

	if err := os.MkdirAll(appDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create app directory: %w", err)
	}

	return appDir, nil
}

func GetFFmpegDir() (string, error) {
	return EnsureAppDir()
}

func copyExecutable(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}

	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err = io.Copy(out, in); err != nil {
		return err
	}

	if err := out.Sync(); err != nil {
		return err
	}

	return prepareExecutableForUse(dst)
}

func appendExecutableCandidate(candidates []executableCandidate, seen map[string]struct{}, path, source string) []executableCandidate {
	cleanedPath := filepath.Clean(strings.TrimSpace(path))
	if cleanedPath == "" {
		return candidates
	}
	if _, exists := seen[cleanedPath]; exists {
		return candidates
	}

	seen[cleanedPath] = struct{}{}
	return append(candidates, executableCandidate{
		path:   cleanedPath,
		source: source,
	})
}

func resolveSystemExecutable(executableName string) string {
	if runtime.GOOS == "darwin" {
		candidates := []string{
			"/opt/homebrew/bin/" + executableName,
			"/usr/local/bin/" + executableName,
		}
		for _, candidate := range candidates {
			if _, err := os.Stat(candidate); err == nil {
				return candidate
			}
		}
	}

	if runtime.GOOS != "windows" {
		path, err := exec.Command("which", executableName).Output()
		if err == nil {
			trimmed := strings.TrimSpace(string(path))
			if trimmed != "" {
				return trimmed
			}
		}
	}

	path, err := exec.LookPath(executableName)
	if err == nil {
		return path
	}

	return ""
}

func runExecutableVersionCheck(path string) error {
	cmd := exec.Command(path, "-version")
	setHideWindow(cmd)
	return cmd.Run()
}

func removeMacOSQuarantineAttribute(path string) error {
	cmd := exec.Command("xattr", "-d", "com.apple.quarantine", path)
	setHideWindow(cmd)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}

	trimmedOutput := strings.TrimSpace(string(output))
	lowerOutput := strings.ToLower(trimmedOutput)
	if strings.Contains(lowerOutput, "no such xattr") || strings.Contains(lowerOutput, "attribute not found") {
		return nil
	}

	if trimmedOutput != "" {
		return fmt.Errorf("%w: %s", err, trimmedOutput)
	}

	return err
}

func prepareExecutableForUse(path string) error {
	cleanedPath := filepath.Clean(strings.TrimSpace(path))
	if cleanedPath == "" {
		return fmt.Errorf("empty path")
	}

	if runtime.GOOS == "windows" {
		return nil
	}

	if err := os.Chmod(cleanedPath, 0755); err != nil {
		return fmt.Errorf("failed to mark executable: %w", err)
	}

	if runtime.GOOS == "darwin" {
		if err := removeMacOSQuarantineAttribute(cleanedPath); err != nil {
			fmt.Printf("[FFmpeg] Warning: failed to remove macOS quarantine from %s: %v\n", cleanedPath, err)
		}
	}

	return nil
}

func resolveExecutablePath(executableName string) (string, string, error) {
	ffmpegDir, err := GetFFmpegDir()
	if err != nil {
		return "", "", err
	}

	localPath := filepath.Join(ffmpegDir, executableName)
	nextDir := filepath.Join(filepath.Dir(ffmpegDir), ".spotiflac-next")
	nextPath := filepath.Join(nextDir, executableName)
	localExists := false
	candidates := make([]executableCandidate, 0, 3)
	seen := make(map[string]struct{}, 3)

	if systemPath := resolveSystemExecutable(executableName); systemPath != "" {
		candidates = appendExecutableCandidate(candidates, seen, systemPath, "system")
	}

	if _, err := os.Stat(localPath); err == nil {
		localExists = true
		candidates = appendExecutableCandidate(candidates, seen, localPath, "local")
	}

	if !localExists {
		if _, err := os.Stat(nextPath); err == nil {
			if copyErr := copyExecutable(nextPath, localPath); copyErr == nil {
				fmt.Printf("[FFmpeg] Copied %s from SpotiFLAC-Next folder\n", executableName)
				candidates = appendExecutableCandidate(candidates, seen, localPath, "migrated")
			}
		}
	}

	var lastErr error
	for _, candidate := range candidates {
		if candidate.source != "system" {
			if err := prepareExecutableForUse(candidate.path); err != nil {
				lastErr = err
				fmt.Printf("[FFmpeg] Skipping %s %s: %v\n", candidate.source, candidate.path, err)
				continue
			}
		}

		if err := ValidateExecutable(candidate.path); err != nil {
			lastErr = err
			fmt.Printf("[FFmpeg] Skipping %s %s: %v\n", candidate.source, candidate.path, err)
			continue
		}

		if err := runExecutableVersionCheck(candidate.path); err != nil {
			lastErr = err
			fmt.Printf("[FFmpeg] Skipping %s %s: %v\n", candidate.source, candidate.path, err)
			continue
		}

		return candidate.path, localPath, nil
	}

	if len(candidates) > 0 {
		if lastErr != nil {
			return "", localPath, fmt.Errorf("no working %s executable found: %w", executableName, lastErr)
		}
		return "", localPath, fmt.Errorf("no working %s executable found", executableName)
	}

	return "", localPath, fmt.Errorf("%s not found in app directory or system path", executableName)
}

func GetFFmpegPath() (string, error) {
	ffmpegName := "ffmpeg"
	if runtime.GOOS == "windows" {
		ffmpegName = "ffmpeg.exe"
	}

	path, localPath, err := resolveExecutablePath(ffmpegName)
	if err != nil {
		if localPath != "" {
			return localPath, err
		}
		return "", err
	}

	return path, nil
}

func GetFFprobePath() (string, error) {
	ffprobeName := "ffprobe"
	if runtime.GOOS == "windows" {
		ffprobeName = "ffprobe.exe"
	}

	path, localPath, err := resolveExecutablePath(ffprobeName)
	if err != nil {
		if localPath != "" {
			return localPath, err
		}
		return "", err
	}

	return path, nil
}

func IsFFprobeInstalled() (bool, error) {
	_, err := GetFFprobePath()
	return err == nil, nil
}

func IsFFmpegInstalled() (bool, error) {
	if _, err := GetFFmpegPath(); err != nil {
		return false, nil
	}

	return IsFFprobeInstalled()
}

func GetBrewPath() string {
	brewPaths := []string{
		"/opt/homebrew/bin/brew",
		"/usr/local/bin/brew",
	}

	for _, path := range brewPaths {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}

	return ""
}

func IsBrewFFmpegInstalled() (bool, error) {
	brewPath := GetBrewPath()
	if brewPath == "" {
		return false, nil
	}

	cmd := exec.Command(brewPath, "list", "ffmpeg")
	setHideWindow(cmd)
	err := cmd.Run()
	return err == nil, nil
}

func InstallFFmpegWithBrew(progressCallback func(int, string)) error {
	brewPath := GetBrewPath()
	if brewPath == "" {
		return fmt.Errorf("brew not found")
	}

	progressCallback(10, "Installing FFmpeg via Homebrew...")

	cmd := exec.Command(brewPath, "install", "ffmpeg")
	setHideWindow(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to install ffmpeg: %w - %s", err, string(output))
	}

	progressCallback(100, "done")

	return nil
}

const ffmpegReleaseBaseURL = "https://github.com/spotbye/Dependencies/releases/download/FFmpeg-8.1"

func buildFFmpegReleaseURL(assetName string) string {
	return ffmpegReleaseBaseURL + "/" + assetName
}

func getFFmpegDownloadURLs() ([]string, []string, error) {
	switch runtime.GOOS {
	case "windows":
		return []string{buildFFmpegReleaseURL("ffmpeg-windows.zip")}, []string{buildFFmpegReleaseURL("ffprobe-windows.zip")}, nil
	case "linux":
		switch runtime.GOARCH {
		case "amd64":
			return []string{buildFFmpegReleaseURL("ffmpeg-linux-amd64.zip")}, []string{buildFFmpegReleaseURL("ffprobe-linux-amd64.zip")}, nil
		case "arm64":
			return []string{buildFFmpegReleaseURL("ffmpeg-linux-arm64v8.zip")}, []string{buildFFmpegReleaseURL("ffprobe-linux-arm64v8.zip")}, nil
		default:
			return nil, nil, fmt.Errorf("unsupported Linux architecture: %s", runtime.GOARCH)
		}
	case "darwin":
		switch runtime.GOARCH {
		case "amd64":
			return []string{buildFFmpegReleaseURL("ffmpeg-macos-amd64.zip")}, []string{buildFFmpegReleaseURL("ffprobe-macos-amd64.zip")}, nil
		case "arm64":
			return []string{buildFFmpegReleaseURL("ffmpeg-macos-arm64.zip")}, []string{buildFFmpegReleaseURL("ffprobe-macos-arm64.zip")}, nil
		default:
			return nil, nil, fmt.Errorf("unsupported macOS architecture: %s", runtime.GOARCH)
		}
	default:
		return nil, nil, fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}
}

func DownloadFFmpeg(progressCallback func(int)) error {

	SetDownloadProgress(0)
	SetDownloadSpeed(0)
	SetDownloading(true)
	defer SetDownloading(false)

	ffmpegDir, err := GetFFmpegDir()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(ffmpegDir, 0755); err != nil {
		return fmt.Errorf("failed to create ffmpeg directory: %w", err)
	}

	ffmpegInstalled, _ := IsFFmpegInstalled()
	ffprobeInstalled, _ := IsFFprobeInstalled()

	ffmpegURLs, ffprobeURLs, err := getFFmpegDownloadURLs()
	if err != nil {
		return err
	}

	if !ffmpegInstalled && !ffprobeInstalled {
		if err := downloadWithFallback(ffmpegURLs, ffmpegDir, progressCallback, 0, 50); err != nil {
			return err
		}
		if err := downloadWithFallback(ffprobeURLs, ffmpegDir, progressCallback, 50, 100); err != nil {
			return err
		}
		return nil
	}

	if !ffmpegInstalled {
		return downloadWithFallback(ffmpegURLs, ffmpegDir, progressCallback, 0, 100)
	}

	if !ffprobeInstalled {
		return downloadWithFallback(ffprobeURLs, ffmpegDir, progressCallback, 0, 100)
	}

	return nil
}

func downloadWithFallback(urls []string, destDir string, progressCallback func(int), start, end int) error {
	var lastErr error
	for _, url := range urls {
		fmt.Printf("[FFmpeg] Trying to download from: %s\n", url)
		err := downloadAndExtract(url, destDir, progressCallback, start, end)
		if err == nil {
			return nil
		}
		lastErr = err
		fmt.Printf("[FFmpeg] Attempt failed: %v\n", err)
	}
	return fmt.Errorf("all download attempts failed: %w", lastErr)
}

func downloadAndExtract(url, destDir string, progressCallback func(int), progressStart, progressEnd int) error {

	tmpFile, err := os.CreateTemp("", "ffmpeg-*")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	client := &http.Client{}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download: HTTP %d", resp.StatusCode)
	}

	totalSize := resp.ContentLength
	var downloaded int64
	lastTime := time.Now()
	var lastBytes int64

	if totalSize > 0 {
		totalSizeMB := float64(totalSize) / (1024 * 1024)
		fmt.Printf("[FFmpeg] Total size: %.2f MB\n", totalSizeMB)
	} else {
		fmt.Printf("[FFmpeg] Downloading... (size unknown)\n")
	}

	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			_, writeErr := tmpFile.Write(buf[:n])
			if writeErr != nil {
				return fmt.Errorf("failed to write to temp file: %w", writeErr)
			}
			downloaded += int64(n)

			mbDownloaded := float64(downloaded) / (1024 * 1024)
			now := time.Now()
			timeDiff := now.Sub(lastTime).Seconds()
			var speedMBps float64

			if timeDiff > 0.1 {
				bytesDiff := float64(downloaded - lastBytes)
				speedMBps = (bytesDiff / (1024 * 1024)) / timeDiff
				lastTime = now
				lastBytes = downloaded
			}

			SetDownloadProgress(mbDownloaded)
			if speedMBps > 0 {
				SetDownloadSpeed(speedMBps)
			}

			if totalSize > 0 && progressCallback != nil {
				rawProgress := float64(downloaded) / float64(totalSize)
				scaledProgress := progressStart + int(rawProgress*float64(progressEnd-progressStart))
				progressCallback(scaledProgress)
			}

			if totalSize > 0 {
				percent := float64(downloaded) * 100 / float64(totalSize)
				if speedMBps > 0 {
					fmt.Printf("\r[FFmpeg] Downloading: %.2f MB / %.2f MB (%.1f%%) - %.2f MB/s",
						mbDownloaded, float64(totalSize)/(1024*1024), percent, speedMBps)
				} else {
					fmt.Printf("\r[FFmpeg] Downloading: %.2f MB / %.2f MB (%.1f%%)",
						mbDownloaded, float64(totalSize)/(1024*1024), percent)
				}
			} else {
				if speedMBps > 0 {
					fmt.Printf("\r[FFmpeg] Downloading: %.2f MB - %.2f MB/s", mbDownloaded, speedMBps)
				} else {
					fmt.Printf("\r[FFmpeg] Downloading: %.2f MB", mbDownloaded)
				}
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read response: %w", err)
		}
	}

	tmpFile.Close()

	if totalSize > 0 {
		fmt.Printf("\r[FFmpeg] Download complete: %.2f MB / %.2f MB (100%%)          \n",
			float64(downloaded)/(1024*1024), float64(totalSize)/(1024*1024))
	} else {
		fmt.Printf("\r[FFmpeg] Download complete: %.2f MB          \n", float64(downloaded)/(1024*1024))
	}
	fmt.Printf("[FFmpeg] Extracting...\n")

	if strings.HasSuffix(url, ".tar.xz") {
		return extractTarXz(tmpFile.Name(), destDir)
	}
	if strings.HasSuffix(url, ".zip") {
		return extractZip(tmpFile.Name(), destDir)
	}
	return fmt.Errorf("unsupported archive format for %s", url)
}

func extractZip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("failed to open zip: %w", err)
	}
	defer r.Close()

	ffmpegName := "ffmpeg"
	ffprobeName := "ffprobe"
	if runtime.GOOS == "windows" {
		ffmpegName = "ffmpeg.exe"
		ffprobeName = "ffprobe.exe"
	}

	foundFFmpeg := false
	foundFFprobe := false

	for _, f := range r.File {
		baseName := filepath.Base(f.Name)
		if f.FileInfo().IsDir() {
			continue
		}

		var destPath string
		if baseName == ffmpegName {
			destPath = filepath.Join(destDir, ffmpegName)
			foundFFmpeg = true
		} else if baseName == ffprobeName {
			destPath = filepath.Join(destDir, ffprobeName)
			foundFFprobe = true
		} else {

			continue
		}

		fmt.Printf("[FFmpeg] Found: %s\n", f.Name)

		rc, err := f.Open()
		if err != nil {
			return fmt.Errorf("failed to open file in zip: %w", err)
		}

		outFile, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
		if err != nil {
			rc.Close()
			return fmt.Errorf("failed to create output file: %w", err)
		}

		_, err = io.Copy(outFile, rc)
		rc.Close()
		outFile.Close()

		if err != nil {
			return fmt.Errorf("failed to extract file: %w", err)
		}

		if err := prepareExecutableForUse(destPath); err != nil {
			return fmt.Errorf("failed to prepare extracted executable: %w", err)
		}

		fmt.Printf("[FFmpeg] Extracted to: %s\n", destPath)
	}

	if !foundFFmpeg && !foundFFprobe {
		return fmt.Errorf("neither ffmpeg nor ffprobe found in archive")
	}

	if foundFFmpeg {
		fmt.Printf("[FFmpeg] ffmpeg extracted successfully\n")
	}
	if foundFFprobe {
		fmt.Printf("[FFmpeg] ffprobe extracted successfully\n")
	}

	return nil
}

func extractTarXz(tarXzPath, destDir string) error {
	file, err := os.Open(tarXzPath)
	if err != nil {
		return fmt.Errorf("failed to open tar.xz: %w", err)
	}
	defer file.Close()

	xzReader, err := xz.NewReader(file)
	if err != nil {
		return fmt.Errorf("failed to create xz reader: %w", err)
	}

	tarReader := tar.NewReader(xzReader)

	ffmpegName := "ffmpeg"
	ffprobeName := "ffprobe"
	foundFFmpeg := false
	foundFFprobe := false

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar: %w", err)
		}

		if header.Typeflag != tar.TypeReg {
			continue
		}

		baseName := filepath.Base(header.Name)
		var destPath string

		if baseName == ffmpegName {
			destPath = filepath.Join(destDir, ffmpegName)
			foundFFmpeg = true
		} else if baseName == ffprobeName {
			destPath = filepath.Join(destDir, ffprobeName)
			foundFFprobe = true
		} else {

			continue
		}

		fmt.Printf("[FFmpeg] Found: %s\n", header.Name)

		outFile, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
		if err != nil {
			return fmt.Errorf("failed to create output file: %w", err)
		}

		_, err = io.Copy(outFile, tarReader)
		outFile.Close()

		if err != nil {
			return fmt.Errorf("failed to extract file: %w", err)
		}

		if err := prepareExecutableForUse(destPath); err != nil {
			return fmt.Errorf("failed to prepare extracted executable: %w", err)
		}

		fmt.Printf("[FFmpeg] Extracted to: %s\n", destPath)
	}

	if !foundFFmpeg && !foundFFprobe {
		return fmt.Errorf("neither ffmpeg nor ffprobe found in archive")
	}

	if foundFFmpeg {
		fmt.Printf("[FFmpeg] ffmpeg extracted successfully\n")
	}
	if foundFFprobe {
		fmt.Printf("[FFmpeg] ffprobe extracted successfully\n")
	}

	return nil
}

type ConvertAudioRequest struct {
	InputFiles   []string `json:"input_files"`
	OutputFormat string   `json:"output_format"`
	Bitrate      string   `json:"bitrate"`
	Codec        string   `json:"codec"`
}

type ConvertAudioResult struct {
	InputFile  string `json:"input_file"`
	OutputFile string `json:"output_file"`
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
}

func ConvertDownloadedFile(inputFile, outputFormat, bitrate, codec string, deleteOriginal bool) (string, error) {
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return "", fmt.Errorf("failed to get ffmpeg path: %w", err)
	}
	if err := ValidateExecutable(ffmpegPath); err != nil {
		return "", fmt.Errorf("invalid ffmpeg executable: %w", err)
	}

	inputFile = norm.NFC.String(inputFile)
	outputFormat = strings.ToLower(strings.TrimSpace(outputFormat))
	inputExt := strings.ToLower(filepath.Ext(inputFile))
	outputExt := "." + outputFormat
	base := strings.TrimSuffix(filepath.Base(inputFile), inputExt)
	finalOutput := norm.NFC.String(filepath.Join(filepath.Dir(inputFile), base+outputExt))
	actualOutput := finalOutput
	if strings.EqualFold(inputExt, outputExt) {
		actualOutput = filepath.Join(filepath.Dir(inputFile), base+".autoconvert"+outputExt)
	}

	args := []string{"-i", inputFile, "-map_metadata", "-1", "-map_chapters", "-1", "-y"}
	switch outputFormat {
	case "mp3":
		args = append(args, "-codec:a", "libmp3lame", "-b:a", bitrate, "-map", "0:a", "-id3v2_version", "3")
	case "m4a":
		if codec == "alac" {
			args = append(args, "-codec:a", "alac", "-map", "0:a")
		} else {
			args = append(args, "-codec:a", "aac", "-b:a", bitrate, "-map", "0:a")
		}
	case "wav", "aiff":
		pcm := "pcm_s16le"
		if outputFormat == "aiff" {
			pcm = "pcm_s16be"
		}
		if sampleFmt, _ := pcmSampleFormatForInput(inputFile); sampleFmt == "s32" {
			if outputFormat == "aiff" {
				pcm = "pcm_s24be"
			} else {
				pcm = "pcm_s24le"
			}
		}
		args = append(args, "-codec:a", pcm, "-map", "0:a")
	case "opus":
		args = append(args, "-codec:a", "libopus", "-b:a", bitrate, "-map", "0:a")
	default:
		return "", fmt.Errorf("unsupported output format: %s", outputFormat)
	}
	args = append(args, actualOutput)
	cmd := exec.CommandContext(ActiveDownloadContext(), ffmpegPath, args...)
	setHideWindow(cmd)
	if output, runErr := cmd.CombinedOutput(); runErr != nil {
		_ = os.Remove(actualOutput)
		return "", fmt.Errorf("conversion failed: %v - %s", runErr, output)
	}

	metadata, _ := ExtractFullMetadataFromFile(inputFile)
	cover, _ := ExtractCoverArt(inputFile)
	if cover != "" {
		defer os.Remove(cover)
	}
	lyrics, _ := ExtractLyrics(inputFile)
	metadata.Lyrics = lyrics
	if err := EmbedMetadataToConvertedFile(actualOutput, metadata, cover); err != nil {
		fmt.Printf("[Auto Convert] Warning: metadata: %v\n", err)
	}
	if lyrics != "" {
		_ = EmbedLyricsOnlyUniversal(actualOutput, lyrics)
	}

	if strings.EqualFold(inputExt, outputExt) {
		backup := filepath.Join(filepath.Dir(inputFile), base+".autoconvert-backup"+inputExt)
		_ = os.Remove(backup)
		if err := os.Rename(inputFile, backup); err != nil {
			_ = os.Remove(actualOutput)
			return "", err
		}
		if err := os.Rename(actualOutput, finalOutput); err != nil {
			_ = os.Rename(backup, finalOutput)
			return "", err
		}
		_ = os.Remove(backup)
	} else if deleteOriginal {
		_ = os.Remove(inputFile)
	}
	return finalOutput, nil
}

func ConvertAudio(req ConvertAudioRequest) ([]ConvertAudioResult, error) {
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return nil, fmt.Errorf("failed to get ffmpeg path: %w", err)
	}

	if err := ValidateExecutable(ffmpegPath); err != nil {
		return nil, fmt.Errorf("invalid ffmpeg executable: %w", err)
	}

	installed, err := IsFFmpegInstalled()
	if err != nil || !installed {
		return nil, fmt.Errorf("ffmpeg is not installed")
	}

	results := make([]ConvertAudioResult, len(req.InputFiles))
	var wg sync.WaitGroup
	var mu sync.Mutex

	maxWorkers := min(runtime.NumCPU(), 8)
	sem := make(chan struct{}, maxWorkers)

	for i, inputFile := range req.InputFiles {
		wg.Add(1)
		go func(idx int, inputFile string) {
			defer wg.Done()

			sem <- struct{}{}
			defer func() { <-sem }()

			result := ConvertAudioResult{
				InputFile: inputFile,
			}

			inputExt := strings.ToLower(filepath.Ext(inputFile))
			baseName := strings.TrimSuffix(filepath.Base(inputFile), inputExt)
			inputDir := filepath.Dir(inputFile)

			outputFormatUpper := strings.ToUpper(req.OutputFormat)
			outputDir := filepath.Join(inputDir, outputFormatUpper)

			if err := os.MkdirAll(outputDir, 0755); err != nil {
				result.Error = fmt.Sprintf("failed to create output directory: %v", err)
				result.Success = false
				mu.Lock()
				results[idx] = result
				mu.Unlock()
				return
			}

			outputExt := "." + strings.ToLower(req.OutputFormat)
			outputFile := filepath.Join(outputDir, baseName+outputExt)
			outputFile = norm.NFC.String(outputFile)

			if inputExt == outputExt {
				result.Error = "Input and output formats are the same"
				result.Success = false
				mu.Lock()
				results[idx] = result
				mu.Unlock()
				return
			}

			result.OutputFile = outputFile

			var coverArtPath string
			var lyrics string
			var inputMetadata Metadata

			inputMetadata, err = ExtractFullMetadataFromFile(inputFile)
			if err != nil {
				fmt.Printf("[FFmpeg] Warning: Failed to extract metadata from %s: %v\n", inputFile, err)
			}

			inputFile = norm.NFC.String(inputFile)
			coverArtPath, err = ExtractCoverArt(inputFile)
			if err != nil {
				fmt.Printf("[FFmpeg] Warning: Failed to extract cover art from %s: %v\n", inputFile, err)
			}
			lyrics, err = ExtractLyrics(inputFile)
			if err != nil {
				fmt.Printf("[FFmpeg] Warning: Failed to extract lyrics from %s: %v\n", inputFile, err)
			} else if lyrics != "" {
				fmt.Printf("[FFmpeg] Lyrics extracted from %s: %d characters\n", inputFile, len(lyrics))
			} else {
				fmt.Printf("[FFmpeg] No lyrics found in %s\n", inputFile)
			}

			inputMetadata.Lyrics = lyrics

			args := []string{
				"-i", inputFile,
				"-y",
			}

			switch req.OutputFormat {
			case "mp3":
				args = append(args,
					"-codec:a", "libmp3lame",
					"-b:a", req.Bitrate,
					"-map", "0:a",
					"-id3v2_version", "3",
				)
			case "m4a":

				codec := req.Codec
				if codec == "" {
					codec = "aac"
				}

				if codec == "alac" {

					args = append(args,
						"-codec:a", "alac",
						"-map", "0:a",
					)
				} else {

					args = append(args,
						"-codec:a", "aac",
						"-b:a", req.Bitrate,
						"-map", "0:a",
					)
				}
			case "wav", "aiff":
				sampleFmt, rawBits := pcmSampleFormatForInput(inputFile)
				pcmCodec := "pcm_s16le"
				if req.OutputFormat == "aiff" {
					pcmCodec = "pcm_s16be"
				}
				if sampleFmt == "s32" {
					if req.OutputFormat == "aiff" {
						pcmCodec = "pcm_s24be"
					} else {
						pcmCodec = "pcm_s24le"
					}
				}
				args = append(args,
					"-codec:a", pcmCodec,
					"-map", "0:a",
				)
				if rawBits > 0 {
					args = append(args, "-bits_per_raw_sample", strconv.Itoa(rawBits))
				}
			case "opus":
				bitrate := req.Bitrate
				if bitrate == "" {
					bitrate = "192k"
				}
				args = append(args,
					"-codec:a", "libopus",
					"-b:a", bitrate,
					"-map", "0:a",
				)
			}

			args = append(args, outputFile)

			fmt.Printf("[FFmpeg] Converting: %s -> %s\n", inputFile, outputFile)

			cmd := exec.Command(ffmpegPath, args...)

			setHideWindow(cmd)
			output, err := cmd.CombinedOutput()
			if err != nil {
				result.Error = fmt.Sprintf("conversion failed: %s - %s", err.Error(), string(output))
				result.Success = false
				mu.Lock()
				results[idx] = result
				mu.Unlock()

				if coverArtPath != "" {
					os.Remove(coverArtPath)
				}
				return
			}

			if err := EmbedMetadataToConvertedFile(outputFile, inputMetadata, coverArtPath); err != nil {
				fmt.Printf("[FFmpeg] Warning: Failed to embed metadata: %v\n", err)
			} else {
				fmt.Printf("[FFmpeg] Metadata embedded successfully\n")
			}

			if lyrics != "" {
				if err := EmbedLyricsOnlyUniversal(outputFile, lyrics); err != nil {
					fmt.Printf("[FFmpeg] Warning: Failed to embed lyrics: %v\n", err)
				} else {
					fmt.Printf("[FFmpeg] Lyrics embedded successfully\n")
				}
			}

			if coverArtPath != "" {
				os.Remove(coverArtPath)
			}

			result.Success = true
			fmt.Printf("[FFmpeg] Successfully converted: %s\n", outputFile)

			mu.Lock()
			results[idx] = result
			mu.Unlock()
		}(i, inputFile)
	}

	wg.Wait()
	return results, nil
}

func pcmSampleFormatForInput(inputFile string) (sampleFmt string, rawBits int) {
	if meta, err := GetTrackMetadata(inputFile); err == nil && meta != nil && meta.BitsPerSample > 16 {
		return "s32", 24
	}
	return "s16", 0
}

type AudioFileInfo struct {
	Path     string `json:"path"`
	Filename string `json:"filename"`
	Format   string `json:"format"`
	Size     int64  `json:"size"`
}

func GetAudioFileInfo(filePath string) (*AudioFileInfo, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}

	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	return &AudioFileInfo{
		Path:     filePath,
		Filename: filepath.Base(filePath),
		Format:   ext,
		Size:     info.Size(),
	}, nil
}
