package backend

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	pathfilepath "path/filepath"
	"strconv"
	"strings"

	"go.senan.xyz/taglib"
	"golang.org/x/text/unicode/norm"
)

type MetadataTagSelection struct {
	Title       bool
	Artist      bool
	Album       bool
	AlbumArtist bool
	Date        bool
	TrackNumber bool
	DiscNumber  bool
	Genre       bool
	Composer    bool
	Copyright   bool
	Label       bool
	ISRC        bool
	UPC         bool
	Comment     bool
}

func TagFile(filePath string, metadata Metadata, coverPath string) error {
	filePath = norm.NFC.String(filePath)

	tags := buildTagMap(filePath, metadata)
	if len(tags) > 0 {
		if err := taglib.WriteTags(filePath, tags, taglib.Clear); err != nil {
			return fmt.Errorf("failed to write tags: %w", err)
		}
	}

	if coverPath != "" && fileExists(coverPath) {
		if err := writeTagImage(filePath, coverPath); err != nil {
			fmt.Printf("Warning: failed to write cover art: %v\n", err)
		}
	}

	if err := applyContainerSpecificTags(filePath, metadata, tags); err != nil {
		fmt.Printf("Warning: failed to apply container-specific tags: %v\n", err)
	}

	return nil
}

func ApplyMetadataTagSelection(filePath string, selection MetadataTagSelection) error {
	filePath = norm.NFC.String(filePath)
	tags, err := taglib.ReadTags(filePath)
	if err != nil {
		return fmt.Errorf("failed to read tags: %w", err)
	}

	disabled := make(map[string]struct{})
	addDisabled := func(enabled bool, keys ...string) {
		if enabled {
			return
		}
		for _, key := range keys {
			disabled[strings.ToUpper(strings.TrimSpace(key))] = struct{}{}
		}
	}
	addDisabled(selection.Title, taglib.Title)
	addDisabled(selection.Artist, taglib.Artist)
	addDisabled(selection.Album, taglib.Album)
	addDisabled(selection.AlbumArtist, taglib.AlbumArtist, "ALBUM ARTIST")
	addDisabled(selection.Date, taglib.Date, taglib.ReleaseDate, "YEAR", "ORIGINALDATE", "ORIGINALYEAR")
	addDisabled(selection.TrackNumber, taglib.TrackNumber, "TRACK", "TRACKTOTAL", "TOTALTRACKS")
	addDisabled(selection.DiscNumber, taglib.DiscNumber, "DISC", "DISCTOTAL", "TOTALDISCS", "PART", "PARTNUMBER")
	addDisabled(selection.Genre, taglib.Genre)
	addDisabled(selection.Composer, taglib.Composer)
	addDisabled(selection.Copyright, taglib.Copyright)
	addDisabled(selection.Label, taglib.Label, "PUBLISHER", "ORGANIZATION")
	addDisabled(selection.ISRC, taglib.ISRC)
	addDisabled(selection.UPC, preferredUPCTagKey, "UPC", "BARCODE")
	addDisabled(selection.Comment, taglib.Comment)
	if len(disabled) == 0 {
		return nil
	}
	for key := range tags {
		if _, remove := disabled[strings.ToUpper(strings.TrimSpace(key))]; remove {
			delete(tags, key)
		}
	}
	if err := taglib.WriteTags(filePath, tags, taglib.Clear); err != nil {
		return fmt.Errorf("failed to write filtered tags: %w", err)
	}
	return nil
}

func buildTagMap(filePath string, metadata Metadata) map[string][]string {
	tags := make(map[string][]string)
	ext := strings.ToLower(pathfilepath.Ext(filePath))
	isFLACLike := ext == ".flac" || ext == ".ogg"
	isMP3 := ext == ".mp3"
	separator := resolveMetadataSeparator(metadata.Separator)

	addTag := func(key, value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		tags[key] = []string{value}
	}
	addTagValues := func(key string, values []string) {
		var cleaned []string
		for _, value := range values {
			value = strings.TrimSpace(value)
			if value != "" {
				cleaned = append(cleaned, value)
			}
		}
		if len(cleaned) > 0 {
			tags[key] = cleaned
		}
	}

	addTag(taglib.Title, metadata.Title)

	addTagValues(taglib.Artist, SplitArtistCredits(metadata.Artist, separator))
	if _, ok := tags[taglib.Artist]; !ok {
		addTag(taglib.Artist, metadata.Artist)
	}

	addTag(taglib.Album, metadata.Album)

	addTagValues(taglib.AlbumArtist, SplitArtistCredits(metadata.AlbumArtist, separator))
	if _, ok := tags[taglib.AlbumArtist]; !ok {
		addTag(taglib.AlbumArtist, metadata.AlbumArtist)
	}

	addTag(taglib.Date, metadata.Date)

	if metadata.TrackNumber > 0 {
		trackValue := strconv.Itoa(metadata.TrackNumber)
		if !isFLACLike && metadata.TotalTracks > 0 {
			trackValue = fmt.Sprintf("%d/%d", metadata.TrackNumber, metadata.TotalTracks)
		}
		addTag(taglib.TrackNumber, trackValue)
	}
	if metadata.TotalTracks > 0 && isFLACLike {
		totalTracks := strconv.Itoa(metadata.TotalTracks)
		addTag("TRACKTOTAL", totalTracks)
		addTag("TOTALTRACKS", totalTracks)
	}

	if metadata.DiscNumber > 0 {
		discValue := strconv.Itoa(metadata.DiscNumber)
		if !isFLACLike && metadata.TotalDiscs > 0 {
			discValue = fmt.Sprintf("%d/%d", metadata.DiscNumber, metadata.TotalDiscs)
		}
		addTag(taglib.DiscNumber, discValue)
	}
	if metadata.TotalDiscs > 0 && isFLACLike {
		totalDiscs := strconv.Itoa(metadata.TotalDiscs)
		addTag("DISCTOTAL", totalDiscs)
		addTag("TOTALDISCS", totalDiscs)
	}

	addTag(taglib.Copyright, metadata.Copyright)

	if isMP3 {
		addTag(taglib.Label, metadata.Publisher)
	} else {
		addTag("PUBLISHER", metadata.Publisher)
	}

	addTagValues(taglib.Composer, SplitArtistCredits(metadata.Composer, separator))
	if _, ok := tags[taglib.Composer]; !ok {
		addTag(taglib.Composer, metadata.Composer)
	}

	addTag(taglib.ISRC, metadata.ISRC)
	addTag(preferredUPCTagKey, metadata.UPC)

	addTagValues(taglib.Genre, SplitMetadataValues(metadata.Genre, separator))
	if _, ok := tags[taglib.Genre]; !ok {
		addTag(taglib.Genre, metadata.Genre)
	}

	addTag(taglib.Lyrics, metadata.Lyrics)

	if isFLACLike {
		addTag("DESCRIPTION", metadata.Description)
	}

	addTag(taglib.Comment, resolveMetadataComment(metadata))

	return tags
}

func writeTagImage(filePath string, coverPath string) error {
	imgData, err := os.ReadFile(coverPath)
	if err != nil {
		return fmt.Errorf("failed to read cover image: %w", err)
	}
	if len(imgData) == 0 {
		return fmt.Errorf("cover image is empty")
	}

	mimeType := http.DetectContentType(imgData)
	if idx := strings.Index(mimeType, ";"); idx >= 0 {
		mimeType = mimeType[:idx]
	}
	if mimeType == "application/octet-stream" {
		mimeType = ""
	}

	if err := taglib.WriteImageOptions(norm.NFC.String(filePath), imgData, 0, "Front Cover", "Cover", mimeType); err != nil {
		return fmt.Errorf("failed to write image: %w", err)
	}
	return nil
}

func applyContainerSpecificTags(filePath string, metadata Metadata, tags map[string][]string) error {
	if strings.ToLower(pathfilepath.Ext(filePath)) != ".m4a" {
		return nil
	}
	if strings.TrimSpace(metadata.Description) == "" {
		return nil
	}

	if err := writeM4AStandardDescription(filePath, metadata.Description); err != nil {
		return err
	}

	if len(tags) > 0 {
		if err := taglib.WriteTags(filePath, tags, 0); err != nil {
			return fmt.Errorf("failed to restore taglib tags after M4A description write: %w", err)
		}
	}

	return nil
}

func writeM4AStandardDescription(filePath, description string) error {
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return err
	}
	if err := ValidateExecutable(ffmpegPath); err != nil {
		return err
	}

	tmpOutputFile := strings.TrimSuffix(filePath, pathfilepath.Ext(filePath)) + ".tmp" + pathfilepath.Ext(filePath)
	defer func() {
		if _, err := os.Stat(tmpOutputFile); err == nil {
			_ = os.Remove(tmpOutputFile)
		}
	}()

	if err := runFFmpegM4ARewrite(ffmpegPath, filePath, tmpOutputFile,
		"-map", "0",
		"-codec", "copy",
		"-map_metadata", "0",
		"-metadata", "description="+description,
	); err != nil {
		return fmt.Errorf("ffmpeg failed to write M4A description: %w", err)
	}

	if err := os.Rename(tmpOutputFile, filePath); err != nil {
		return fmt.Errorf("failed to replace M4A after description write: %w", err)
	}

	return nil
}

func runFFmpegM4ARewrite(ffmpegPath, inputPath, tmpOutputFile string, extraArgs ...string) error {
	muxers := []string{"ipod", "mp4"}
	var lastErr error
	var lastOutput string
	var lastMuxer string

	for _, muxer := range muxers {
		_ = os.Remove(tmpOutputFile)

		cmdArgs := []string{"-y", "-i", inputPath}
		cmdArgs = append(cmdArgs, extraArgs...)
		cmdArgs = append(cmdArgs, "-f", muxer, tmpOutputFile)

		cmd := exec.Command(ffmpegPath, cmdArgs...)
		setHideWindow(cmd)

		output, err := cmd.CombinedOutput()
		if err == nil {
			return nil
		}

		lastErr = err
		lastOutput = strings.TrimSpace(string(output))
		lastMuxer = muxer

		if muxer == "ipod" && shouldRetryM4ARewriteWithMP4(lastOutput) {
			continue
		}
		break
	}

	return fmt.Errorf("ffmpeg failed to rewrite M4A with muxer %s: %s - %w", lastMuxer, lastOutput, lastErr)
}

func shouldRetryM4ARewriteWithMP4(output string) bool {
	lower := strings.ToLower(output)
	return strings.Contains(lower, "codec not currently supported in container") ||
		strings.Contains(lower, "could not find tag for codec eac3") ||
		strings.Contains(lower, "could not find tag for codec ac3") ||
		strings.Contains(lower, "could not write header")
}

func extractCoverArtWithTagLib(filePath string) (string, error) {
	imgData, err := taglib.ReadImage(norm.NFC.String(filePath))
	if err != nil {
		return "", err
	}
	if len(imgData) == 0 {
		return "", fmt.Errorf("no cover art found")
	}

	ext := imageExtensionFromBytes(imgData)
	tmpFile, err := os.CreateTemp("", "cover-*"+ext)
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	defer tmpFile.Close()

	if _, err := tmpFile.Write(imgData); err != nil {
		os.Remove(tmpFile.Name())
		return "", fmt.Errorf("failed to write cover art: %w", err)
	}

	return tmpFile.Name(), nil
}

func extractLyricsWithTagLib(filePath string) (string, error) {
	tags, err := taglib.ReadTags(norm.NFC.String(filePath))
	if err != nil {
		return "", err
	}

	for _, key := range []string{taglib.Lyrics, "UNSYNCEDLYRICS", "SYNCEDLYRICS", "LYRIC"} {
		for _, value := range tags[key] {
			if strings.TrimSpace(value) != "" {
				return value, nil
			}
		}
	}

	return "", nil
}

func imageExtensionFromBytes(data []byte) string {
	switch http.DetectContentType(data) {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}

func extractFullMetadataWithTagLib(filePath string) (Metadata, error) {
	tags, err := taglib.ReadTags(norm.NFC.String(filePath))
	if err != nil {
		return Metadata{}, err
	}

	normalized := normalizeTagMap(tags)
	artistValues := nonEmptyTagValues(normalized[strings.ToUpper(taglib.Artist)])
	albumArtistValues := nonEmptyTagValues(normalized[strings.ToUpper(taglib.AlbumArtist)])
	composerValues := nonEmptyTagValues(normalized[strings.ToUpper(taglib.Composer)])
	genreValues := nonEmptyTagValues(normalized[strings.ToUpper(taglib.Genre)])

	metadata := Metadata{
		Title:       firstTagValue(normalized, taglib.Title),
		Artist:      strings.Join(artistValues, "; "),
		Album:       firstTagValue(normalized, taglib.Album),
		AlbumArtist: strings.Join(albumArtistValues, "; "),
		Date:        firstTagValue(normalized, taglib.Date),
		ReleaseDate: firstTagValue(normalized, taglib.ReleaseDate),
		Publisher:   firstNonEmptyTagValue(normalized, "PUBLISHER", taglib.Label),
		Composer:    strings.Join(composerValues, "; "),
		URL:         firstTagValue(normalized, taglib.URL),
		Description: firstTagValue(normalized, "DESCRIPTION"),
		Comment:     firstTagValue(normalized, taglib.Comment),
		ISRC:        firstTagValue(normalized, taglib.ISRC),
		UPC:         firstPreferredNormalizedUPCValue(normalized),
		Genre:       strings.Join(genreValues, "; "),
		Lyrics:      firstNonEmptyTagValue(normalized, taglib.Lyrics, "UNSYNCEDLYRICS", "SYNCEDLYRICS", "LYRIC"),
		Copyright:   firstTagValue(normalized, taglib.Copyright),
	}

	trackNumber, totalTracks := extractTrackNumbers(normalized, taglib.TrackNumber, "TRACK", "TRACKNUMBER")
	discNumber, totalDiscs := extractTrackNumbers(normalized, taglib.DiscNumber, "DISC", "DISCNUMBER")
	if metadata.Date == "" {
		metadata.Date = metadata.ReleaseDate
	}
	metadata.TrackNumber = trackNumber
	metadata.TotalTracks = totalTracks
	metadata.DiscNumber = discNumber
	metadata.TotalDiscs = totalDiscs

	return metadata, nil
}

func normalizeTagMap(tags map[string][]string) map[string][]string {
	normalized := make(map[string][]string, len(tags))
	for key, values := range tags {
		normalized[strings.ToUpper(strings.TrimSpace(key))] = values
	}
	return normalized
}

func nonEmptyTagValues(values []string) []string {
	var cleaned []string
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			cleaned = append(cleaned, value)
		}
	}
	return cleaned
}

func firstTagValue(tags map[string][]string, key string) string {
	for _, value := range tags[strings.ToUpper(strings.TrimSpace(key))] {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func firstNonEmptyTagValue(tags map[string][]string, keys ...string) string {
	for _, key := range keys {
		if value := firstTagValue(tags, key); value != "" {
			return value
		}
	}
	return ""
}

func extractTrackNumbers(tags map[string][]string, primaryKey string, fallbackKeys ...string) (int, int) {
	totalKeys := []string{"TRACKTOTAL", "TOTALTRACKS"}
	if strings.Contains(strings.ToUpper(primaryKey), "DISC") {
		totalKeys = []string{"DISCTOTAL", "TOTALDISCS"}
	}

	for _, key := range append([]string{primaryKey}, fallbackKeys...) {
		value := firstTagValue(tags, key)
		if value == "" {
			continue
		}
		number, total := parseTagNumberPair(value)
		if total == 0 {
			total = parseTagInt(firstNonEmptyTagValue(tags, totalKeys...))
		}
		return number, total
	}

	return 0, parseTagInt(firstNonEmptyTagValue(tags, totalKeys...))
}

func parseTagNumberPair(value string) (int, int) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, 0
	}

	parts := strings.SplitN(value, "/", 2)
	number := parseTagInt(parts[0])
	total := 0
	if len(parts) == 2 {
		total = parseTagInt(parts[1])
	}
	return number, total
}

func parseTagInt(value string) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}

	digits := strings.Builder{}
	for _, r := range value {
		if r < '0' || r > '9' {
			if digits.Len() > 0 {
				break
			}
			continue
		}
		digits.WriteRune(r)
	}
	if digits.Len() == 0 {
		return 0
	}
	number, _ := strconv.Atoi(digits.String())
	return number
}

func hasMeaningfulMetadata(m Metadata) bool {
	return m.Title != "" || m.Artist != "" || m.Album != "" || m.AlbumArtist != "" ||
		m.Date != "" || m.ReleaseDate != "" || m.TrackNumber > 0 || m.TotalTracks > 0 ||
		m.DiscNumber > 0 || m.TotalDiscs > 0 || m.URL != "" || m.Copyright != "" ||
		m.Publisher != "" || m.Composer != "" || m.Lyrics != "" || m.Description != "" ||
		m.Comment != "" || m.ISRC != "" || m.UPC != "" || m.Genre != ""
}

func mergeExtractedMetadata(primary, fallback Metadata) Metadata {
	if primary.Title == "" {
		primary.Title = fallback.Title
	}
	if primary.Artist == "" {
		primary.Artist = fallback.Artist
	}
	if primary.Album == "" {
		primary.Album = fallback.Album
	}
	if primary.AlbumArtist == "" {
		primary.AlbumArtist = fallback.AlbumArtist
	}
	if primary.Publisher == "" {
		primary.Publisher = fallback.Publisher
	}
	if primary.Date == "" {
		primary.Date = fallback.Date
	}
	if primary.ReleaseDate == "" {
		primary.ReleaseDate = fallback.ReleaseDate
	}
	if primary.TrackNumber == 0 {
		primary.TrackNumber = fallback.TrackNumber
	}
	if primary.TotalTracks == 0 {
		primary.TotalTracks = fallback.TotalTracks
	}
	if primary.DiscNumber == 0 {
		primary.DiscNumber = fallback.DiscNumber
	}
	if primary.TotalDiscs == 0 {
		primary.TotalDiscs = fallback.TotalDiscs
	}
	if primary.URL == "" {
		primary.URL = fallback.URL
	}
	if primary.Copyright == "" {
		primary.Copyright = fallback.Copyright
	}
	if primary.Composer == "" {
		primary.Composer = fallback.Composer
	}
	if primary.Lyrics == "" {
		primary.Lyrics = fallback.Lyrics
	}
	if primary.Description == "" {
		primary.Description = fallback.Description
	}
	if primary.Comment == "" {
		primary.Comment = fallback.Comment
	}
	if primary.ISRC == "" {
		primary.ISRC = fallback.ISRC
	}
	if primary.UPC == "" {
		primary.UPC = fallback.UPC
	}
	if primary.Genre == "" {
		primary.Genre = fallback.Genre
	}
	return primary
}
