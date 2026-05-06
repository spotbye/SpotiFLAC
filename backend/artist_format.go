package backend

import "strings"

func normalizeArtistSeparator(separator string) string {
	separator = strings.TrimSpace(separator)
	if separator == "," || separator == ";" {
		return separator
	}
	return ""
}

func splitArtistSegment(segment string, separator string) []string {
	segment = strings.TrimSpace(segment)
	if segment == "" {
		return nil
	}

	if strings.Contains(segment, "|||SEP|||") {
		return strings.Split(segment, "|||SEP|||")
	}

	parts := []string{segment}

	if separator = normalizeArtistSeparator(separator); separator != "" {
		var separated []string
		for _, part := range parts {
			for _, item := range strings.Split(part, separator) {
				separated = append(separated, item)
			}
		}
		parts = separated
	} else if strings.Contains(segment, ";") {
		var separated []string
		for _, part := range parts {
			for _, item := range strings.Split(part, ";") {
				separated = append(separated, item)
			}
		}
		parts = separated
	}

	return parts
}

func SplitArtistCredits(artistStr, separator string) []string {
	rawParts := splitArtistSegment(artistStr, separator)
	if len(rawParts) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(rawParts))
	result := make([]string, 0, len(rawParts))
	for _, part := range rawParts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, exists := seen[part]; exists {
			continue
		}
		seen[part] = struct{}{}
		result = append(result, part)
	}

	return result
}

// MoveFeaturedArtistsToTitle, when the "moveFeaturedArtistsToTitle" setting is
// enabled and the track has multiple credited artists, returns the lead artist
// alone alongside a title that has " (feat. ...)" appended for the remaining
// artists. When the setting is disabled, only one artist is credited, or the
// title already advertises a feature, the values are returned unchanged
// (except that, when the setting is on, the artist is still narrowed to the
// lead). The setting is read inside this helper so call sites stay simple.
func MoveFeaturedArtistsToTitle(artist, title, separator string) (string, string) {
	if !GetMoveFeaturedArtistsToTitleSetting() {
		return artist, title
	}

	credits := SplitArtistCredits(artist, separator)
	if len(credits) <= 1 {
		return artist, title
	}

	main := credits[0]
	feats := credits[1:]

	lowerTitle := strings.ToLower(title)
	featMarkers := []string{"(feat.", "(ft.", "(featuring", "[feat.", "[ft.", "[featuring"}
	for _, marker := range featMarkers {
		if strings.Contains(lowerTitle, marker) {
			return main, title
		}
	}

	suffix := " (feat. " + strings.Join(feats, " & ") + ")"
	newTitle := strings.TrimRight(title, " \t") + suffix
	return main, newTitle
}

func SplitMetadataValues(value, separator string) []string {
	rawParts := splitArtistSegment(value, separator)
	if len(rawParts) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(rawParts))
	result := make([]string, 0, len(rawParts))
	for _, part := range rawParts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, exists := seen[part]; exists {
			continue
		}
		seen[part] = struct{}{}
		result = append(result, part)
	}

	return result
}
