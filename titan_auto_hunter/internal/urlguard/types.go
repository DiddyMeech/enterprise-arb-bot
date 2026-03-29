package urlguard

type ScopeRule struct {
	RootDomains     []string
	AllowSubdomains bool
	ExcludePaths    []string
	ExcludeExts     []string
}
