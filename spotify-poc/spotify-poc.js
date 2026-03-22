// Improved upon in app implementation, leaving here for now for reference/posterity

const CLIENT_ID    = '95ba1274418d436a8540ebee2d22c8ed';
const REDIRECT_URI = window.location.origin + '/spotify-poc.html';
const SCOPES       = 'playlist-read-private playlist-read-collaborative';
const BASE_URL     = 'https://api.spotify.com/v1';

const output = document.getElementById('output');



//Main entry point
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

// PCKE HELPERS
function base64url(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let str = '';
    for (const byte of bytes) str += String.fromCharCode(byte);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateVerifier() {
    const bytes = crypto.getRandomValues(new Uint8Array(72));
    return base64url(bytes);
}

async function generateChallenge(verifier) {
    const encoded = new TextEncoder().encode(verifier);
    const hash    = await crypto.subtle.digest('SHA-256', encoded);
    return base64url(hash);
}


// AUTH FLOW

// Main auth method: Generate PKCE params, store in sessionStorage, and redirect to Spotify auth page
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

//Validate state, exchange code for token, store token, and fetch playlists
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
    // console.log('Token request body:', body.toString());//DEBUG

    // Exchange code for token
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString(),
    });
    // const response = await fetch('https://spotify.com/api/token', {
    //     method:  'POST',
    //     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    //     body:    body.toString(),
    //     mode:    'cors'
    // });

    // console.log('Token response:', response);//DEBUG
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        logError(`ERROR: Token exchange failed (${response.status}): ${err.error_description || err.error || 'Unknown'}`);
        return;
    }

    // Store token, clean up url + sessionStorage, 
    const data = await response.json();
    sessionStorage.setItem('access_token', data.access_token);
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('pkce_state');

    history.replaceState({}, '', window.location.pathname);

    //Log success and fetch playlists
    log('Token obtained. Fetching playlists...\n');
    await fetchPlaylists(data.access_token);
}

// given a valid token, fetches and logs playlists
async function fetchPlaylists(token) {
    //FUTURE: Use a loop with offset to fetch all playlists. 
    const response = await fetch(BASE_URL + '/me/playlists?limit=50', {
        headers: { 'Authorization': 'Bearer ' + token },
    });

    // console.log("Playlists response:", response);//DEBUG
    if (!response.ok) {
        logError(`ERROR: /me/playlists returned ${response.status}`);
        return;
    }

    const data = await response.json();
    log(`Found ${data.total} total playlists (showing up to 50):\n`);
    for (const item of data.items) {
        console.log(item.name);//DEBUG
        output.textContent += item.name + '\n';
    }
}


init();