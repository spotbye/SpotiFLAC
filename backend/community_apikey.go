package backend

import (
	"fmt"
	"net/http"
	"strings"
)

func communityUserAgent() string {
	version := strings.TrimSpace(AppVersion)
	if version == "" || version == "Unknown" {
		return "SpotiFLAC"
	}
	return "SpotiFLAC/" + version
}

func setCommunityRequestHeaders(req *http.Request) error {
	session, err := ensureCommunitySession()
	if err != nil {
		return fmt.Errorf("community verification failed: %w", err)
	}
	if err := signCommunityRequest(req, session); err != nil {
		return fmt.Errorf("failed to sign community request: %w", err)
	}

	req.Header.Set("User-Agent", communityUserAgent())
	return nil
}
