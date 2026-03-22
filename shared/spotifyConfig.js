// Spotify app configuration

// Client ID is intentionally public: PKCE flow doesn't use a client secret so this is safe to expose. Future implementation with a backend will move this to an environment variable set from the backend.
export const SPOTIFY_CLIENT_ID    = '95ba1274418d436a8540ebee2d22c8ed';// FUTURE: Move to env var once before deployment.

// Redirect URI for Spotify auth callback. Works for root-hosted sites and project-site subpaths.
export const SPOTIFY_REDIRECT_URI = window.location.origin + window.location.pathname;

// Scopes to request during Spotify auth. Review later and tighten scope when possible.
export const SPOTIFY_SCOPES       = 'playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private';

// Time to wait between sequential API calls to avoid hitting rate limits.
export const SLEEP_BETWEEN_PLAYLISTS_MS = 1000;