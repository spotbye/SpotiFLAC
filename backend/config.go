package backend

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

func GetDefaultMusicPath() string {

	homeDir, err := os.UserHomeDir()
	if err != nil {

		return "C:\\Users\\Public\\Music"
	}

	return filepath.Join(homeDir, "Music")
}

func GetConfigPath() (string, error) {
	dir, err := EnsureAppDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(dir, "config.json"), nil
}

func LoadConfigSettings() (map[string]interface{}, error) {
	configPath, err := GetConfigPath()
	if err != nil {
		return nil, err
	}

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return nil, nil
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var settings map[string]interface{}
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, err
	}

	return settings, nil
}

func GetRedownloadWithSuffixSetting() bool {
	settings, err := LoadConfigSettings()
	if err != nil || settings == nil {
		return false
	}

	enabled, _ := settings["redownloadWithSuffix"].(bool)
	return enabled
}

func GetMoveFeaturedArtistsToTitleSetting() bool {
	settings, err := LoadConfigSettings()
	if err != nil || settings == nil {
		return false
	}

	enabled, _ := settings["moveFeaturedArtistsToTitle"].(bool)
	return enabled
}

func GetCustomTidalAPISetting() string {
	settings, err := LoadConfigSettings()
	if err != nil || settings == nil {
		return ""
	}

	customAPI, _ := settings["customTidalApi"].(string)
	customAPI = strings.TrimRight(strings.TrimSpace(customAPI), "/")
	if strings.HasPrefix(customAPI, "https://") {
		return customAPI
	}

	return ""
}

func normalizeExistingFileCheckMode(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "isrc", "upc":
		return "isrc"
	default:
		return "filename"
	}
}

func GetExistingFileCheckModeSetting() string {
	settings, err := LoadConfigSettings()
	if err != nil || settings == nil {
		return "filename"
	}

	rawMode, _ := settings["existingFileCheckMode"].(string)
	return normalizeExistingFileCheckMode(rawMode)
}

func GetLinkResolverSetting() string {
	settings, err := LoadConfigSettings()
	if err != nil || settings == nil {
		return linkResolverProviderDeezerSongLink
	}

	resolver, _ := settings["linkResolver"].(string)
	switch strings.TrimSpace(strings.ToLower(resolver)) {
	case "songlink", linkResolverProviderDeezerSongLink:
		return linkResolverProviderDeezerSongLink
	case "songstats":
		return linkResolverProviderSongstats
	case "":
		return linkResolverProviderDeezerSongLink
	default:
		return linkResolverProviderDeezerSongLink
	}
}

func GetLinkResolverAllowFallback() bool {
	settings, err := LoadConfigSettings()
	if err != nil || settings == nil {
		return true
	}

	allowFallback, ok := settings["allowResolverFallback"].(bool)
	if !ok {
		return true
	}

	return allowFallback
}
