// Spotify PKCE auth manager. Handles auth state independent of DOM or app.js.
// Importable by any adapter that needs a Spotify access token.

import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, SPOTIFY_SCOPES} from './spotifyConfig.js';

// Keys for sessionStorage - move to spotifyConfig.js? if needed by other modules
const TOKEN_KEY    = 'spotify_access_token';
const EXPIRY_KEY   = 'spotify_token_expiry';
const VERIFIER_KEY = 'spotify_code_verifier';
const STATE_KEY    = 'spotify_auth_state';

// PKCE HELPERS (keeping module-private)
// Convert ArrayBuffer to URL-safe base64 string
function _base64url(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let str = '';
    for (const byte of bytes) str += String.fromCharCode(byte);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Generate a random PKCE verifier string
function _generateVerifier() {
    const bytes = crypto.getRandomValues(new Uint8Array(72));
    return _base64url(bytes);
}

// Generate a PKCE challenge from the verifier using SHA-256
async function _generateChallenge(verifier) {
    const encoded = new TextEncoder().encode(verifier);
    const hash    = await crypto.subtle.digest('SHA-256', encoded);
    return _base64url(hash);
}

// AUTH MANAGER

class SpotifyAuthManager {

    // True only if a token exists and hasn't passed its expiry timestamp
    isAuthenticated() {
        return !!(
            sessionStorage.getItem(TOKEN_KEY) &&
            Date.now() < Number(sessionStorage.getItem(EXPIRY_KEY))
        );
    }

    // Generate PKCE params, store in sessionStorage, redirect to Spotify auth page.
    // NOTE: This navigates away from the current page — execution does not continue after this call.
    async authenticate() {
        const verifier  = _generateVerifier();
        const challenge = await _generateChallenge(verifier);
        const state     = _generateVerifier().slice(0, 16);

        sessionStorage.setItem(VERIFIER_KEY, verifier);
        sessionStorage.setItem(STATE_KEY,    state);

        const params = new URLSearchParams({
            client_id:             SPOTIFY_CLIENT_ID,
            response_type:         'code',
            redirect_uri:          SPOTIFY_REDIRECT_URI,
            scope:                 SPOTIFY_SCOPES,
            code_challenge_method: 'S256',
            code_challenge:        challenge,
            state,
        });

        window.location.href = 'https://accounts.spotify.com/authorize?' + params.toString();
    }

    // Called on page load when ?code= is present. Verifies state, exchanges code for token,
    // stores token + expiry in sessionStorage, cleans the URL, returns the access token.
    async handleAuthCallback() {
        const urlParams     = new URLSearchParams(window.location.search);
        const code          = urlParams.get('code');
        const returnedState = urlParams.get('state');
        const storedState   = sessionStorage.getItem(STATE_KEY);
        const verifier      = sessionStorage.getItem(VERIFIER_KEY);

        if (!code)     throw new Error('No auth code in URL.');
        if (!verifier) throw new Error('Code verifier missing from sessionStorage — auth flow may have expired.');

        // Verify state to guard against CSRF
        if (storedState && returnedState !== storedState) {
            sessionStorage.removeItem(STATE_KEY);
            sessionStorage.removeItem(VERIFIER_KEY);
            throw new Error('State mismatch: Auth aborted.');
        }

        // Token endpoint requires form-encoded body, not JSON
        const body = new URLSearchParams({
            grant_type:    'authorization_code',
            code,
            redirect_uri:  SPOTIFY_REDIRECT_URI,
            client_id:     SPOTIFY_CLIENT_ID,
            code_verifier: verifier,
        });

        // Exchange the auth code for an access token
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    body.toString(),
        });

        //Validate response
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(`Token exchange failed (${response.status}): ${err.error_description || err.error || 'Unknown'}`);
        }

        // Store the token and its expiry time, then clean up PKCE params and URL
        const data = await response.json();
        sessionStorage.setItem(TOKEN_KEY,  data.access_token);
        sessionStorage.setItem(EXPIRY_KEY, String(Date.now() + data.expires_in * 1000));
        sessionStorage.removeItem(VERIFIER_KEY);
        sessionStorage.removeItem(STATE_KEY);

        // Keep the current path while dropping query parameters. This ensures a clean URL once auth completes, and works for both root-hosted sites and project-site subpaths.
        history.replaceState({}, '', window.location.pathname);
        return data.access_token;
    }

    // Returns a valid token. If not authenticated, triggers a redirect to Spotify login.
    // Callers should be aware this may navigate away on first call.
    async getAccessToken() {
        if (this.isAuthenticated()) return sessionStorage.getItem(TOKEN_KEY);
        await this.authenticate();
        // authenticate() redirects — execution does not continue in this page load
    }
}

export default new SpotifyAuthManager();
