// Reference for name mapping and field standardization.
// includes api sourced object formats for future reference.


const FIELD_ALIASES = {
    // Core fields
    'trackid':            'trackID',        //App
    'track uri':          'trackID',        //Sample
    'uri':                'trackID',        //Spotify

    'title':              'title',          //App
    'track name':         'title',          //Sample
    'name':               'title',          //Spotify

    'album':              'album',          //App, Spotify
    'album name':         'album',          //Sample

    'artist':             'artist',         //App
    'artist name(s)':     'artist',         //Sample
    'artists':            'artist',         //Spotify

    // 'artist names':       'artist', //None yet
    // 'track id':           'trackID',//None yet
    // 'spotify uri':        'trackID',//None yet
    // 'track title':        'title',  //None yet

    // Optional fields
    'release date':       'releaseDate',    //Sample

    'duration (ms)':      'duration',       //Sample
    'duration_ms':        'duration',       //Spotify

    'popularity':         'popularity',     //Sample, Spotify
    'explicit':           'explicit',       //Sample, Spotify
    //'added by':           'addedBy',        //Sample //NOTE: Currently skipping, not fundamental to track data
    'added at':           'addedAt',        //Sample
    'genres':             'genre',          //Sample
    'record label':       'recordLabel',    //Sample
    'danceability':       'danceability',   //Sample,Spotify
    'energy':             'energy',         //Sample,Spotify
    'key':                'key',            //Sample,Spotify
    'loudness':           'loudness',       //Sample,Spotify
    'mode':               'mode',           //Sample,Spotify
    'speechiness':        'speechiness',    //Sample,Spotify
    'acousticness':       'acousticness',   //Sample,Spotify
    'instrumentalness':   'instrumentalness',//Sample,Spotify
    'liveness':           'liveness',       //Sample,Spotify
    'valence':            'valence',        //Sample,Spotify
    'tempo':              'tempo',          //Sample,Spotify

    'time signature':     'timeSignature',  //Sample
    'time_signature':     'timeSignature',  //Spotify

    //Not found
    'genre':              'genre',
    'bpm':                'tempo',

    //Spotify Only
    "available_markets":"available_markets",
    "disc_number":"disc_number",
    "external_ids":"external_ids",
    "external_urls":"external_urls",
    "href":"href",
    "is_playable":"is_playable",
    "linked_from":"linked_from",
    "id":"id",//Should match URI minus "spotify:track:". Unsure of best approach. Since context is assumed for a spotifyAdapter this could save us some stripping.
    "restrictions":"restrictions",
    "preview_url":"preview_url",
    "track_number":"track_number",
    "type":"type",
    "is_local":"is_local",
    "analysis_url":"analysis_url",
};





const sample_fields = [
    'Track URI',
    'Track Name',
    'Album Name',
    'Artist Name(s)',
    'Release Date',
    'Duration (ms)',
    'Popularity',
    'Explicit',
    'Added By',
    'Added At',
    'Genres',
    'Record Label',
    'Danceability',
    'Energy',
    'Key',
    'Loudness',
    'Mode',
    'Speechiness',
    'Acousticness',
    'Instrumentalness',
    'Liveness',
    'Valence',
    'Tempo',
    'Time Signature',
]


const api_track_fields = [
    "album",
    "artists",
    "available_markets",
    "disc_number",
    "duration_ms",
    "explicit",
    "external_ids",
    "external_urls",
    "href",
    "id",
    "is_playable",
    "linked_from",
    "restrictions",
    "name",
    "popularity",
    "preview_url",
    "track_number",
    "type",
    "uri",
    "is_local"
]

const api_audio_fields = [
    "acousticness",
    "analysis_url",
    "danceability",
    "duration_ms",
    "energy",
    "id",
    "instrumentalness",
    "key",
    "liveness",
    "loudness",
    "mode",
    "speechiness",
    "tempo",
    "time_signature",
    "track_href",
    "type",
    "uri",
    "valence"
]






const api_track_object = {
  "album": {
    "album_type": "compilation",
    "total_tracks": 9,
    "available_markets": [
      "CA",
      "BR",
      "IT"
    ],
    "external_urls": {
      "spotify": "string"
    },
    "href": "string",
    "id": "2up3OPMp9Tb4dAKM2erWXQ",
    "images": [
      {
        "url": "https://i.scdn.co/image/ab67616d00001e02ff9ca10b55ce82ae553c8228",
        "height": 300,
        "width": 300
      }
    ],
    "name": "string",
    "release_date": "1981-12",
    "release_date_precision": "year",
    "restrictions": {
      "reason": "market"
    },
    "type": "album",
    "uri": "spotify:album:2up3OPMp9Tb4dAKM2erWXQ",
    "artists": [
      {
        "external_urls": {
          "spotify": "string"
        },
        "href": "string",
        "id": "string",
        "name": "string",
        "type": "artist",
        "uri": "string"
      }
    ]
  },
  "artists": [
    {
      "external_urls": {
        "spotify": "string"
      },
      "href": "string",
      "id": "string",
      "name": "string",
      "type": "artist",
      "uri": "string"
    }
  ],
  "available_markets": [
    "string"
  ],
  "disc_number": 0,
  "duration_ms": 0,
  "explicit": false,
  "external_ids": {
    "isrc": "string",
    "ean": "string",
    "upc": "string"
  },
  "external_urls": {
    "spotify": "string"
  },
  "href": "string",
  "id": "string",
  "is_playable": false,
  "linked_from": {},
  "restrictions": {
    "reason": "string"
  },
  "name": "string",
  "popularity": 0,
  "preview_url": "string",
  "track_number": 0,
  "type": "track",
  "uri": "string",
  "is_local": false
}

const api_audio_object = {
  "acousticness": 0.00242,
  "analysis_url": "https://api.spotify.com/v1/audio-analysis/2takcwOaAZWiXQijPHIx7B",
  "danceability": 0.585,
  "duration_ms": 237040,
  "energy": 0.842,
  "id": "2takcwOaAZWiXQijPHIx7B",
  "instrumentalness": 0.00686,
  "key": 9,
  "liveness": 0.0866,
  "loudness": -5.883,
  "mode": 0,
  "speechiness": 0.0556,
  "tempo": 118.211,
  "time_signature": 4,
  "track_href": "https://api.spotify.com/v1/tracks/2takcwOaAZWiXQijPHIx7B",
  "type": "audio_features",
  "uri": "spotify:track:2takcwOaAZWiXQijPHIx7B",
  "valence": 0.428
}

