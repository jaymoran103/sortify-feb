//Basic data models for playlists and tracks. More metadata to come


//FUTURE define augmented session-layer playlist fields here? 


// Create playlist based on provided fields.
// Optional playlistURI is used for Spotify exports; 
// Optional timeAdded is also used for sorting by date added.
export function createPlaylist(name, trackIDs, playlistURI = null, timeAdded = null) {
    return {
        type: "playlist",
        name: name || "Playlist "+ Date.now(),
        trackIDs: trackIDs || [],
        playlistURI,
        timeAdded,
        lastModified: null      // set on save, not at creation
    }
}

//  Core Fields:
//   trackID        (unique identifier)
//   title
//   album
//   artist         (string, optionally comma-separated)
//   source         ('generated','csv','spotify',or 'unknown')

// Anticipated optional fields:
// Numbers:
//   tempo          (bpm)
//   duration       (ms)
//   key            (0–11, where 0 = C, 2 = D, etc.)
//   loudness       (dB)
//   timeSignature  (beats per bar?)
//   popularity     (0–100)
//   mode           (0 = minor, 1 = major)

// Doubles (0.0–1.0):
//   energy
//   danceability
//   valence
//   liveness
//   acousticness
//   speechiness
//   instrumentalness

// Strings:
//   explicit       (boolean)
//   addedAt        (ISO datetime string)
//   releaseDate    (ISO date or year only)
//   genre          (comma-separated string, e.g. "rock, blues")
//   recordLabel


//Create track based on provided fields. source indicates data origin ('generated','csv','spotify', 'unknown')
//optionalFields spreads any additional metadata onto the returned object.
export function createTrack(trackID, title, album, artist, source = 'unknown', optionalFields = {}){
    return {
        type:    "track",
        trackID: trackID || "track"+ Date.now(),
        title:   title   || "Untitled Track "+ Date.now(),
        album:   album   || "Unknown Album "+ Date.now(),
        artist:  artist  || "Unknown Artist "+ Date.now(),
        source:  source,
        ...optionalFields
    }
}