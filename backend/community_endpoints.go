package backend

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const communityDownloadPath = "/api/dl"

var communityURLSeedParts = [][]byte{
	[]byte("spotif"),
	[]byte("lac:co"),
	[]byte("mmunity:url:v1"),
}

var communityURLAAD = []byte("spotiflac|community|url|v1")

var (
	tidalCommunityURLNonce = []byte{
		0x67, 0xfc, 0xe8, 0xc2, 0x2e, 0x43, 0xef, 0x00, 0x03, 0x8e, 0xf7, 0x7c,
	}
	tidalCommunityURLCiphertext = []byte{
		0xeb, 0x2e, 0x2e, 0x26, 0xbf, 0x49, 0x8f, 0xc7, 0x5e, 0x14, 0x6c, 0xfb,
		0xd2, 0x24, 0x07, 0xf0, 0x9d, 0x17, 0x55, 0x03, 0x1b, 0x09, 0x20, 0x31,
		0x71, 0xeb, 0xf8, 0x7c, 0x33, 0x7d,
	}
	tidalCommunityURLTag = []byte{
		0xa8, 0x67, 0xc6, 0x71, 0x4c, 0x5c, 0x2a, 0xfc, 0x4e, 0x83, 0xfc, 0x0b,
		0x36, 0xcc, 0x21, 0xe9,
	}

	qobuzCommunityURLNonce = []byte{
		0x36, 0xf7, 0x2d, 0xdf, 0x93, 0xea, 0x36, 0x68, 0xb6, 0x66, 0xf0, 0x5a,
	}
	qobuzCommunityURLCiphertext = []byte{
		0x56, 0x5d, 0x00, 0xd6, 0x0b, 0x39, 0x8a, 0x14, 0xd3, 0x88, 0x30, 0x04,
		0x58, 0x3d, 0x8f, 0x1b, 0x09, 0x87, 0x02, 0xb3, 0x37, 0xf7, 0x09, 0xd3,
		0xeb, 0x44, 0x72, 0x47, 0xc9, 0x44,
	}
	qobuzCommunityURLTag = []byte{
		0x40, 0x9f, 0xa0, 0xe8, 0x50, 0x4a, 0x7e, 0xee, 0x29, 0x7e, 0x29, 0x01,
		0x6b, 0x05, 0x3a, 0xdc,
	}

	amazonCommunityURLNonce = []byte{
		0x3a, 0xb7, 0xd4, 0xd5, 0xd1, 0x7b, 0xbf, 0x11, 0x1d, 0x50, 0xfa, 0x81,
	}
	amazonCommunityURLCiphertext = []byte{
		0x7a, 0x2b, 0x4e, 0x52, 0x98, 0x85, 0x24, 0xa9, 0x58, 0xb9, 0x85, 0x63,
		0xef, 0x8e, 0x5a, 0x01, 0x3c, 0xa4, 0xf5, 0x94, 0xe4, 0x68, 0x46, 0x19,
		0x06, 0x48, 0x32, 0xd8, 0xb8, 0xfa,
	}
	amazonCommunityURLTag = []byte{
		0x6e, 0x13, 0x44, 0x7b, 0x9e, 0x5e, 0x7f, 0x95, 0x57, 0xc7, 0x8e, 0x80,
		0x42, 0x8e, 0x76, 0x49,
	}

	communityVerifyURLNonce = []byte{
		0x37, 0x68, 0x07, 0x7e, 0xe1, 0x02, 0x94, 0xd7, 0x24, 0xd7, 0xdc, 0x54,
	}
	communityVerifyURLCiphertext = []byte{
		0x01, 0x6d, 0xb0, 0x5f, 0x66, 0x08, 0xab, 0x6a, 0x99, 0x66, 0x5b, 0xfc,
		0x70, 0x99, 0xe6, 0xdb, 0x54, 0xa7, 0x9e, 0x20, 0xb9, 0x6b, 0xd3, 0xca,
		0x42, 0xb4, 0xaf, 0xc5, 0x69,
	}
	communityVerifyURLTag = []byte{
		0x1d, 0x91, 0x11, 0xce, 0xf7, 0xe2, 0x18, 0x76, 0xe0, 0x5d, 0xb3, 0xc5,
		0xee, 0x99, 0xe4, 0xf2,
	}
)

var (
	communityURLGCMOnce sync.Once
	communityURLGCM     cipher.AEAD
	communityURLGCMErr  error
)

func communityURLCipher() (cipher.AEAD, error) {
	communityURLGCMOnce.Do(func() {
		hasher := sha256.New()
		for _, part := range communityURLSeedParts {
			hasher.Write(part)
		}
		block, err := aes.NewCipher(hasher.Sum(nil))
		if err != nil {
			communityURLGCMErr = err
			return
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			communityURLGCMErr = err
			return
		}
		communityURLGCM = gcm
	})
	return communityURLGCM, communityURLGCMErr
}

func decryptCommunityURL(nonce, ciphertext, tag []byte) (string, error) {
	gcm, err := communityURLCipher()
	if err != nil {
		return "", err
	}
	sealed := make([]byte, 0, len(ciphertext)+len(tag))
	sealed = append(sealed, ciphertext...)
	sealed = append(sealed, tag...)
	plaintext, err := gcm.Open(nil, nonce, sealed, communityURLAAD)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

const communityRateLimitMaxRetries = 6

const communityRateLimitFallbackWait = 30 * time.Second

const communityCooldownFallbackMessage = "The server is taking a scheduled short break. Please try again in about %d minute(s)."

type communityCooldownError struct {
	service string
	seconds int
	message string
}

func (e *communityCooldownError) Error() string {
	return e.message
}

func IsCommunityCooldownError(err error) bool {
	var cooldownErr *communityCooldownError
	return errors.As(err, &cooldownErr)
}

func GetTidalCommunityDownloadURL() string {
	base, _ := decryptCommunityURL(tidalCommunityURLNonce, tidalCommunityURLCiphertext, tidalCommunityURLTag)
	return base + communityDownloadPath
}

func GetQobuzCommunityDownloadURL() string {
	base, _ := decryptCommunityURL(qobuzCommunityURLNonce, qobuzCommunityURLCiphertext, qobuzCommunityURLTag)
	return base + communityDownloadPath
}

func GetQobuzCommunityHealthURL() string {
	base, _ := decryptCommunityURL(qobuzCommunityURLNonce, qobuzCommunityURLCiphertext, qobuzCommunityURLTag)
	return base + "/health"
}

func GetAmazonCommunityDownloadURL() string {
	base, _ := decryptCommunityURL(amazonCommunityURLNonce, amazonCommunityURLCiphertext, amazonCommunityURLTag)
	return base + communityDownloadPath
}

func GetCommunityVerifyURL() string {
	base, _ := decryptCommunityURL(communityVerifyURLNonce, communityVerifyURLCiphertext, communityVerifyURLTag)
	return base
}

func communityRetryAfter(resp *http.Response) time.Duration {
	if resp == nil {
		return communityRateLimitFallbackWait
	}
	if ra := strings.TrimSpace(resp.Header.Get("Retry-After")); ra != "" {
		if secs, err := strconv.Atoi(ra); err == nil && secs >= 0 {
			return time.Duration(secs)*time.Second + 250*time.Millisecond
		}
	}
	if reset := strings.TrimSpace(resp.Header.Get("X-RateLimit-Reset")); reset != "" {
		if epoch, err := strconv.ParseInt(reset, 10, 64); err == nil {
			if wait := time.Until(time.Unix(epoch, 0)); wait > 0 {
				return wait + 250*time.Millisecond
			}
		}
	}
	return communityRateLimitFallbackWait
}

func newCommunityCooldownError(service string, resp *http.Response) *communityCooldownError {
	seconds := 0
	message := ""
	if resp != nil {
		if ra := strings.TrimSpace(resp.Header.Get("Retry-After")); ra != "" {
			if secs, err := strconv.Atoi(ra); err == nil && secs > 0 {
				seconds = secs
			}
		}
		if body, err := io.ReadAll(io.LimitReader(resp.Body, 4096)); err == nil {
			var parsed struct {
				Error string `json:"error"`
			}
			if json.Unmarshal(body, &parsed) == nil {
				message = strings.TrimSpace(parsed.Error)
			}
		}
		resp.Body.Close()
	}

	if seconds <= 0 {
		seconds = int(communityRateLimitFallbackWait / time.Second)
	}
	if message == "" {
		message = fmt.Sprintf(communityCooldownFallbackMessage, max(1, (seconds+59)/60))
	}

	SetCommunityCooldown(float64(seconds), message)
	fmt.Printf("%s community API on scheduled cooldown (503), back in ~%ds\n", service, seconds)

	return &communityCooldownError{service: service, seconds: seconds, message: message}
}

func doCommunityRequest(client *http.Client, service string, reqFn func() (*http.Request, error)) (*http.Response, error) {
	var lastErr error
	verificationRetried := false
	for attempt := 0; attempt <= communityRateLimitMaxRetries; attempt++ {
		req, err := reqFn()
		if err != nil {
			return nil, err
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}

		if resp.StatusCode == http.StatusServiceUnavailable {
			ClearRateLimitCooldown()
			return nil, newCommunityCooldownError(service, resp)
		}
		if (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusPreconditionRequired) && !verificationRetried {
			resp.Body.Close()
			clearCommunitySessionCredentials()
			verificationRetried = true
			attempt--
			continue
		}

		if resp.StatusCode != http.StatusTooManyRequests &&
			resp.StatusCode != http.StatusBadGateway &&
			resp.StatusCode != http.StatusGatewayTimeout {
			ClearRateLimitCooldown()
			ClearCommunityCooldown()
			return resp, nil
		}

		var wait time.Duration
		if resp.StatusCode == http.StatusTooManyRequests {
			wait = communityRetryAfter(resp)
			lastErr = fmt.Errorf("%s community API rate limited (429)", service)
		} else {
			wait = time.Duration(attempt+1) * 5 * time.Second
			lastErr = fmt.Errorf("%s community API returned %d", service, resp.StatusCode)
		}
		resp.Body.Close()

		if attempt == communityRateLimitMaxRetries {
			break
		}
		fmt.Printf("%s transient error, waiting %.0fs before retry (%d/%d)...\n", service, wait.Seconds(), attempt+1, communityRateLimitMaxRetries)
		SetRateLimitCooldown(wait.Seconds())
		if sleepErr := SleepWithDownloadContext(wait); sleepErr != nil {
			ClearRateLimitCooldown()
			return nil, sleepErr
		}
		ClearRateLimitCooldown()
	}
	return nil, lastErr
}
