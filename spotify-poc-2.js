const CLIENT_ID    = '95ba1274418d436a8540ebee2d22c8ed';
const REDIRECT_URI = window.location.origin + '/spotify-poc.html';
const SCOPES       = 'playlist-read-private playlist-read-collaborative';
const BASE_URL     = 'https://api.spotify.com/v1';

const output = document.getElementById('output');


// Main entry point
function init() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('code')) {
        handleCallback().catch(err => logError('ERROR: ' + err.message));
    } else {
        const btn = document.getElementById('connect');
        btn.style.display = 'inline-block';
        btn.addEventListener('click', () => {
            handleConnect().catch(err => logError('ERROR: ' + err.message));
        });
    }
}


// LOGGING

function log(msg) {
    console.log(msg);
    output.textContent += msg + '\n';
}

function logError(msg) {
    console.error(msg);
    const span = document.createElement('span');
    span.className = 'error';
    span.textContent = msg + '\n';
    output.appendChild(span);
}


// PKCE HELPERS

// Convert ArrayBuffer to URL-safe base64 string
function base64url(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let str = '';
    for (const byte of bytes) str += String.fromCharCode(byte);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Generate a random PKCE verifier string
function generateVerifier() {
    const bytes = crypto.getRandomValues(new Uint8Array(72));
    return base64url(bytes);
}

// Generate a PKCE challenge from the verifier using SHA-256
async function generateChallenge(verifier) {
    const encoded = new TextEncoder().encode(verifier);
    const hash    = await crypto.subtle.digest('SHA-256', encoded);
    return base64url(hash);
}


// AUTH FLOW

// Generate PKCE params, store in sessionStorage, redirect to Spotify auth page
async function handleConnect() {
    const verifier  = generateVerifier();
    const challenge = await generateChallenge(verifier);
    const state     = generateVerifier().slice(0, 16);

    sessionStorage.setItem('pkce_verifier', verifier);
    sessionStorage.setItem('pkce_state',    state);

    const params = new URLSearchParams({
        client_id:             CLIENT_ID,
        response_type:         'code',
        redirect_uri:          REDIRECT_URI,
        scope:                 SCOPES,
        code_challenge_method: 'S256',
        code_challenge:        challenge,
        state,
    });

    window.location.href = 'https://accounts.spotify.com/authorize?' + params.toString();
}

// Exchange auth code for token, store it, clean URL, then run the demo
async function handleCallback() {

    //Get code + state from URL, and PKCE params from sessionStorage
    const urlParams     = new URLSearchParams(window.location.search);
    const code          = urlParams.get('code');
    const returnedState = urlParams.get('state');
    const storedState   = sessionStorage.getItem('pkce_state');
    const verifier      = sessionStorage.getItem('pkce_verifier');

    // Ensure code is present, likely due to manual navigation to the URL
    if (!code) {
        logError('ERROR: No auth code in URL.');
        return;
    }

    //Validate state
    if (storedState && returnedState !== storedState) {
        sessionStorage.removeItem('pkce_state');
        sessionStorage.removeItem('pkce_verifier');
        logError('ERROR: State mismatch, authentication aborted.');
        return;
    }

    // Ensure verifier is present
    if (!verifier) {
        logError('ERROR: Code verifier missing from sessionStorage.');
        return;
    }
    log('Exchanging code for token...');

    // Build body for token request
    const body = new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI,
        client_id:     CLIENT_ID,
        code_verifier: verifier,
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString(),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        logError(`ERROR: Token exchange failed (${response.status}): ${err.error_description || err.error || 'Unknown'}`);
        return;
    }

    const data = await response.json();
    sessionStorage.setItem('access_token', data.access_token);
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('pkce_state');

    history.replaceState({}, '', window.location.pathname);

    //Log success and fetch playlists
    log('Token obtained.\n');
    await runDemo(data.access_token);
}


// API HELPERS

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch wrapper: adds auth header, handles one 429 retry using Retry-After value
async function apiFetch(endpoint, token) {
    const url     = BASE_URL + endpoint;
    const headers = { 'Authorization': 'Bearer ' + token };
    let response  = await fetch(url, { headers });

    // Rate limited: wait the requested delay and retry once
    if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') || 1);
        await sleep((retryAfter + 1) * 1000);
        response = await fetch(url, { headers });
    }

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(`Spotify API ${response.status} on ${endpoint}${body.error?.message ? ': ' + body.error.message : ''}`);
    }

    return response.json();
}


// PLAYLIST FETCHING

// Fetch all playlists for the authenticated user, paginating until none remain
// Returns [{ id, name, itemCount }]
async function getAllPlaylists(token) {
    const all  = [];
    let offset = 0;

    while (true) {
        const data = await apiFetch(`/me/playlists?limit=50&offset=${offset}`, token);

        for (const item of data.items) {
            // API may return count under either key depending on playlist type
            const itemCount = item.items?.total ?? item.tracks?.total ?? 0;
            all.push({ id: item.id, name: item.name, itemCount });
        }

        if (!data.next) break;
        offset += 50;
    }

    log(`Fetched ${all.length} playlists total.\n`);
    return all;
}

// Fetch all tracks for a single playlist, paginating until none remain
// Uses /items endpoint (not deprecated /tracks). Track data lives at item.item.
// Returns array of raw Spotify track objects
async function getPlaylistItems(token, playlistId) {
    const all  = [];
    let offset = 0;

    while (true) {
        const data = await apiFetch(`/playlists/${playlistId}/items?limit=50&offset=${offset}`, token);

        for (const item of data.items) {
            // item.item is null for local files, deleted tracks, podcast episodes — skip those
            if (!item.item || !item.item.uri) continue;
            all.push(item.item);
        }

        if (!data.next) break;
        offset += 50;
    }

    log(`Fetched ${all.length} tracks.\n`);
    return all;
}


// DEMO

// Run after auth completes: print all playlists, then fetch + print tracks for the first one
async function runDemo(token) {
    log('--- All playlists ---');
    const playlists = await getAllPlaylists(token);

    for (const pl of playlists) {
        output.textContent += `${pl.name}  (${pl.itemCount} tracks)\n`;
    }

    if (playlists.length === 0) {
        log('No playlists found.');
        return;
    }

    const first = playlists[0];

    const last = playlists[playlists.length - 1];
    log(`\n--- Tracks in: ${first.name} ---`);
    const firstPlaylistItems = await getPlaylistItems(token, first.id);

    for (const track of firstPlaylistItems) {
        const artists = track.artists.map(a => a.name).join(', ');
        output.textContent += `${track.name}  —  ${artists}\n`;
    }

    const lastPlaylistItems = await getPlaylistItems(token, last.id);
    log(`\n--- Tracks in: ${last.name} ---`);

    for (const track of lastPlaylistItems) {
        const artists = track.artists.map(a => a.name).join(', ');
        output.textContent += `${track.name}  —  ${artists}\n`;
    }
}


init();
