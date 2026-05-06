package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

func buildFormattedFilenameBase(trackName, artistName, albumName, albumArtist, releaseDate, filenameFormat, playlistName, playlistOwner, isrc string, includeTrackNumber bool, position, discNumber int, useAlbumTrackNumber bool) string {
	safeTitle := SanitizeFilename(trackName)
	safeArtist := SanitizeFilename(artistName)
	safeAlbum := SanitizeFilename(albumName)
	safeAlbumArtist := SanitizeFilename(albumArtist)
	safeISRC := SanitizeOptionalFilename(isrc)

	safePlaylist := SanitizeFilename(playlistName)
	safeCreator := SanitizeFilename(playlistOwner)

	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	var filename string

	if strings.Contains(filenameFormat, "{") {
		filename = filenameFormat
		filename = strings.ReplaceAll(filename, "{title}", safeTitle)
		filename = strings.ReplaceAll(filename, "{artist}", safeArtist)
		filename = strings.ReplaceAll(filename, "{album}", safeAlbum)
		filename = strings.ReplaceAll(filename, "{album_artist}", safeAlbumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)
		filename = strings.ReplaceAll(filename, "{date}", SanitizeFilename(releaseDate))
		filename = strings.ReplaceAll(filename, "{playlist}", safePlaylist)
		filename = strings.ReplaceAll(filename, "{creator}", safeCreator)
		filename = strings.ReplaceAll(filename, "{isrc}", safeISRC)

		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

		if position > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", position))
		} else {

			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
	} else {

		switch filenameFormat {
		case "artist-title":
			filename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
		case "title":
			filename = safeTitle
		default:
			filename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
		}

		if includeTrackNumber && position > 0 {
			filename = fmt.Sprintf("%02d. %s", position, filename)
		}
	}

	return filename
}

func BuildExpectedFilename(trackName, artistName, albumName, albumArtist, releaseDate, filenameFormat, playlistName, playlistOwner string, includeTrackNumber bool, position, discNumber int, useAlbumTrackNumber bool, extra ...string) string {
	isrc := ""
	if len(extra) > 0 {
		isrc = extra[0]
	}

	return buildFormattedFilenameBase(trackName, artistName, albumName, albumArtist, releaseDate, filenameFormat, playlistName, playlistOwner, isrc, includeTrackNumber, position, discNumber, useAlbumTrackNumber) + ".flac"
}

func ResolveOutputPathForDownload(path string, redownloadWithSuffix bool) (string, bool) {
	if ExistingFileCheckDisabled() {
		return path, false
	}

	if !redownloadWithSuffix {
		if info, err := os.Stat(path); err == nil && info.Size() > 0 {
			return path, true
		}
		return path, false
	}

	if info, err := os.Stat(path); err != nil || info.Size() == 0 {
		return path, false
	}

	ext := filepath.Ext(path)
	base := strings.TrimSuffix(path, ext)

	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s_%02d%s", base, i, ext)
		if info, err := os.Stat(candidate); err != nil || info.Size() == 0 {
			return candidate, false
		}
	}
}

func mustFileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func SanitizeFilename(name string) string {

	sanitized := strings.ReplaceAll(name, "/", " ")

	re := regexp.MustCompile(`[<>:"\\|?*]`)
	sanitized = re.ReplaceAllString(sanitized, " ")

	var result strings.Builder
	for _, r := range sanitized {

		if r < 0x20 && r != 0x09 && r != 0x0A && r != 0x0D {
			continue
		}
		if r == 0x7F {
			continue
		}

		if unicode.IsControl(r) && r != 0x09 && r != 0x0A && r != 0x0D {
			continue
		}

		result.WriteRune(r)
	}

	sanitized = result.String()
	sanitized = strings.TrimSpace(sanitized)

	sanitized = strings.Trim(sanitized, ". ")

	re = regexp.MustCompile(`\s+`)
	sanitized = re.ReplaceAllString(sanitized, " ")

	re = regexp.MustCompile(`_+`)
	sanitized = re.ReplaceAllString(sanitized, "_")

	sanitized = strings.Trim(sanitized, "_ ")

	if sanitized == "" {
		return "Unknown"
	}

	if !utf8.ValidString(sanitized) {

		sanitized = strings.ToValidUTF8(sanitized, "_")
	}

	return sanitized
}

func GetFirstArtist(artistString string) string {
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

func NormalizePath(folderPath string) string {
	return strings.ReplaceAll(folderPath, "/", string(filepath.Separator))
}

func GetSeparator() string {
	settings, err := LoadConfigSettings()
	if err != nil || settings == nil {
		return "; "
	}

	if sep, ok := settings["separator"].(string); ok {
		if sep == "comma" {
			return ", "
		}
		if sep == "semicolon" {
			return "; "
		}
	}
	return "; "
}

func SanitizeFolderPath(folderPath string) string {

	normalizedPath := strings.ReplaceAll(folderPath, "/", string(filepath.Separator))

	sep := string(filepath.Separator)

	parts := strings.Split(normalizedPath, sep)
	sanitizedParts := make([]string, 0, len(parts))

	for i, part := range parts {

		if i == 0 && len(part) == 2 && part[1] == ':' {
			sanitizedParts = append(sanitizedParts, part)
			continue
		}

		if i == 0 && part == "" {
			sanitizedParts = append(sanitizedParts, part)
			continue
		}

		sanitized := sanitizeFolderName(part)
		if sanitized != "" {
			sanitizedParts = append(sanitizedParts, sanitized)
		}
	}

	return strings.Join(sanitizedParts, sep)
}

func sanitizeFolderName(name string) string { return SanitizeFilename(name) }

func sanitizeFilename(name string) string {
	return SanitizeFilename(name)
}

func SanitizeOptionalFilename(name string) string {
	if strings.TrimSpace(name) == "" {
		return ""
	}
	return SanitizeFilename(name)
}
