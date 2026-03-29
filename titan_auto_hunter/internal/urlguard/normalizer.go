package urlguard

import (
	"net"
	"net/url"
	"path"
	"sort"
	"strings"
)

func NormalizeURL(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if IsBlankValue(raw) {
		return "", false
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return "", false
	}

	if parsed.Scheme == "" || parsed.Host == "" {
		return "", false
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", false
	}
	if IsDisallowedScheme(scheme) {
		return "", false
	}

	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return "", false
	}

	port := parsed.Port()
	if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
		parsed.Host = host
	} else if port != "" {
		parsed.Host = net.JoinHostPort(host, port)
	} else {
		parsed.Host = host
	}

	parsed.Scheme = scheme
	parsed.Fragment = ""

	if parsed.Path == "" {
		parsed.Path = "/"
	} else {
		parsed.Path = path.Clean(parsed.Path)
		if !strings.HasPrefix(parsed.Path, "/") {
			parsed.Path = "/" + parsed.Path
		}
	}

	// Normalize query string order for stable dedupe
	q := parsed.Query()
	if len(q) > 0 {
		var pairs []string
		for key, vals := range q {
			sort.Strings(vals)
			for _, v := range vals {
				pairs = append(pairs, url.QueryEscape(key)+"="+url.QueryEscape(v))
			}
		}
		sort.Strings(pairs)
		parsed.RawQuery = strings.Join(pairs, "&")
	}

	return parsed.String(), true
}
