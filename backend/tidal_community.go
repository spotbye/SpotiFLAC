package backend

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type tidalCommunityResponse struct {
	Quality string `json:"quality"`
	URL     string `json:"url"`
	Lyric   string `json:"lyric"`
}

var tidalCommunityClient = &http.Client{Timeout: 60 * time.Second}

func mapTidalQualityToCommunity(quality string) string {
	switch strings.ToUpper(strings.TrimSpace(quality)) {
	case "ATMOS", "DOLBY", "EAC3", "EAC3_JOC":
		return "atmos"
	case "HI_RES_LOSSLESS", "HI_RES", "24":
		return "24"
	default:
		return "16"
	}
}

func (t *TidalDownloader) getTidalCommunityDownloadURL(trackID int64, quality string) (string, error) {
	payload, err := json.Marshal(map[string]string{
		"id":      fmt.Sprintf("%d", trackID),
		"quality": mapTidalQualityToCommunity(quality),
	})
	if err != nil {
		return "", err
	}

	resp, err := doCommunityRequest(tidalCommunityClient, "Tidal", func() (*http.Request, error) {
		req, err := NewRequestWithDefaultHeaders(http.MethodPost, GetTidalCommunityDownloadURL(), bytes.NewReader(payload))
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
		fmt.Printf("Tidal community request failed: %v\n", err)
		return "", fmt.Errorf("failed to get download URL: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		preview := string(body)
		if len(preview) > 200 {
			preview = preview[:200]
		}
		fmt.Printf("Tidal community API status %d: %s\n", resp.StatusCode, preview)
		return "", fmt.Errorf("tidal community API returned status %d: %s", resp.StatusCode, preview)
	}

	var parsed tidalCommunityResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("failed to decode tidal community response: %w", err)
	}
	if strings.TrimSpace(parsed.URL) == "" {
		return "", fmt.Errorf("no download URL in tidal community response")
	}
	fmt.Printf("Tidal community URL found (quality %s)\n", parsed.Quality)
	return parsed.URL, nil
}
