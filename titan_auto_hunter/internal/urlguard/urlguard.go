package urlguard

import "time"

func FilterURLs(rawURLs []string, scope ScopeRule, probe bool) []string {
	seen := make(map[string]struct{})
	var kept []string

	for _, raw := range rawURLs {
		normalized, ok := NormalizeURL(raw)
		if !ok {
			continue
		}

		if !URLInScope(normalized, scope) {
			continue
		}

		if IsJunkURL(normalized, scope) {
			continue
		}

		if _, exists := seen[normalized]; exists {
			continue
		}

		if probe && !HasRealContent(normalized, 8*time.Second) {
			continue
		}

		seen[normalized] = struct{}{}
		kept = append(kept, normalized)
	}

	return kept
}
