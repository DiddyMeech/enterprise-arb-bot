package urlguard

import (
	"context"
	"io"
	"net/http"
	"strings"
	"time"
)

var commonBlankTitles = map[string]struct{}{
	"":            {},
	"untitled":    {},
	"loading...":   {},
	"new page":    {},
}

func HasRealContent(rawURL string, timeout time.Duration) bool {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return false
	}

	client := &http.Client{
		Timeout: timeout,
	}

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return false
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*256))
	if err != nil {
		return false
	}

	text := strings.TrimSpace(string(body))
	if len(text) < 20 {
		return false
	}

	lower := strings.ToLower(text)
	for title := range commonBlankTitles {
		if strings.Contains(lower, "<title>"+title+"</title>") && len(text) < 200 {
			return false
		}
	}

	return true
}
