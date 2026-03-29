package urlguard

import "strings"

func HostInScope(host string, scope ScopeRule) bool {
	host = strings.ToLower(strings.Trim(host, "."))

	for _, root := range scope.RootDomains {
		root = strings.ToLower(strings.Trim(root, "."))
		if host == root {
			return true
		}
		if scope.AllowSubdomains && strings.HasSuffix(host, "."+root) {
			return true
		}
	}

	return false
}
