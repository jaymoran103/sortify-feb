//class providing sample data to work with.


class SampleTracks{
    constructor(){
        this.emptyTrackData = {
            "TrackID": "track",
            "Track Name": "",
            "Album Name": "",
            "Artist Name(s)": ""
        }
        this.trackData0 = {
            "TrackID": "track0",
            "Track Name": "Dry the Rain",
            "Album Name": "The Three E.P.'s",
            "Artist Name(s)": "The Beta Band"
        }
        this.trackData1 = {
            "TrackID": "track1",
            "Track Name": "Boom Boom",
            "Album Name": "Burnin'",
            "Artist Name(s)": "John Lee Hooker"
        }
        this.trackData2 = {
            "TrackID": "track2",
            "Track Name": "Driving All Night",
            "Album Name": "Going Back Home",
            "Artist Name(s)": "Sherman Robertson"
        }
        this.trackData3 = {
            "TrackID": "track",
            "Track Name": "Little Angel Child",
            "Album Name": "Fast Fingers",
            "Artist Name(s)": "Jimmy Dawkins"
        }
        this.trackData4 = {
            "TrackID": "track4",
            "Track Name": "Got To Have Money",
            "Album Name": "Living Chicago Blues, Vol. 4",//Compilation album, "Various Artists" is unlinked. might cause interesting behavior down the road
            "Artist Name(s)": "Luther\"Guitar Junior\" Johnson"
        }
        this.tracks = [this.trackData0,this.trackData1,this.trackData2,this.trackData3,this.trackData4]
    }

    //Get track by id, or randomly if id is undefined/invalid
    getTrack(id){
        if (!id||id<0||id>=this.tracks.length){ //Ensure id falls within valid range, replacing with random index if necessary
            id = Math.floor(Math.random() * this.tracks.length);
        }
        return this.tracks[id];
    }

    createEmptyPlaylist(){
        return {
            name: "Empty Playlist "+ Date.now(),
            tracks: []
        };
    }

    //return playlist with all tracks
    createSamplePlaylist() {
        const sampleTracks = new SampleTracks();
        return {
            name: "Sample Playlist "+ Date.now(),
            // tracks: Array.from(SampleTracks.tracks)
            tracks: Array.from(this.tracks)
        };
    }

    //Generates playlist with 3 random tracks. Nothing prevents duplicates but none of this matters
    createRandomPlaylist(){
        return {
            name: "Random Playlist "+ Date.now(),
            tracks: [this.getTrack(),
                     this.getTrack(),
                     this.getTrack()]
        };
    }

    getUniqueTrack(){
        trackData = {
            "TrackID" : Date.now(),
            "Track Name": "Unique Track "+ Date.now(),
            "Album Name": "Unique Album "+ Date.now(),
            "Artist Name(s)": "Unique Artist "+ Date.now()
        }
        return trackData;
    }



}

export {SampleTracks};