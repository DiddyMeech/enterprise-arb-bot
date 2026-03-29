package urlguard

import "strings"

var disallowedExact = map[string]struct{}{
	"":            {},
	"#":           {},
	"/":           {},
	"about:blank": {},
}

var disallowedSchemes = map[string]struct{}{
	"javascript": {},
	"mailto":     {},
	"tel":        {},
	"about":      {},
	"data":       {},
	"file":       {},
}

func IsBlankValue(value string) bool {
	cleaned := strings.TrimSpace(value)
	_, found := disallowedExact[cleaned]
	return found
}

func IsDisallowedScheme(scheme string) bool {
	_, found := disallowedSchemes[strings.ToLower(strings.TrimSpace(scheme))]
	return found
}
