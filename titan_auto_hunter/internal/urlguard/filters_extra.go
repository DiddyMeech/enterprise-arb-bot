package urlguard

import (
	"net/url"
	"path/filepath"
	"strings"
)

func IsJunkURL(normalized string, scope ScopeRule) bool {
	parsed, err := url.Parse(normalized)
	if err != nil {
		return true
	}

	p := strings.ToLower(parsed.Path)

	for _, badPath := range scope.ExcludePaths {
		if p == strings.ToLower(strings.TrimSpace(badPath)) {
			return true
		}
	}

	ext := strings.ToLower(filepath.Ext(p))
	for _, badExt := range scope.ExcludeExts {
		if ext == strings.ToLower(strings.TrimSpace(badExt)) {
			return true
		}
	}

	return false
}

func URLInScope(normalized string, scope ScopeRule) bool {
	parsed, err := url.Parse(normalized)
	if err != nil {
		return false
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return false
	}

	host := parsed.Hostname()
	if host == "" {
		return false
	}

	return HostInScope(host, scope)
}
