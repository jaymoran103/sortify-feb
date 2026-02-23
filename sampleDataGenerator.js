//class providing sample data to work with.
import {createTrack,createPlaylist} from "./models.js";

class SampleTracks{
    constructor(){
        this.emptyTrackData = {
            "trackID": "track",
            "Track Name": "-",
            "Album Name": "-",
            "Artist Name(s)": "-"
        }
        this.trackData0 = {
            "trackID": "track0",
            "title": "Dry the Rain",
            "album": "The Three E.P.'s",
            "artist": "The Beta Band"
        }
        this.trackData1 = {
            "trackID": "track1",
            "title": "Boom Boom",
            "album": "Burnin'",
            "artist": "John Lee Hooker"
        }
        this.trackData2 = {
            "trackID": "track2",
            "title": "Driving All Night",
            "album": "Going Back Home",
            "artist": "Sherman Robertson"
        }
        this.trackData3 = {
            "trackID": "track",
            "title": "Little Angel Child",
            "album": "Fast Fingers",
            "artist": "Jimmy Dawkins"
        }
        this.trackData4 = {
            "trackID": "track4",
            "title": "Got To Have Money",
            "album": "Living Chicago Blues, Vol. 4",//Compilation album, "Various Artists" is unlinked. might cause interesting behavior down the road
            "artist": "Luther \"Guitar Junior\" Johnson"//escape character shows up in console but not on page, keep an eye on and ensure these are handled right for real data
        }
        this.tracks = [this.trackData0,this.trackData1,this.trackData2,this.trackData3,this.trackData4]
        this.trackIDs = this.tracks.map(track => track.trackID);
    }

    //Get track by id, or randomly if id is undefined/invalid
    getSampleTrackData(id){
        console.log(`Retrieving track with ID '${id}' from sample data`);
        if (!id||id<0||id>=this.tracks.length){ //Ensure id falls within valid range, replacing with random index if necessary
            id = Math.floor(Math.random() * this.tracks.length);
        }
        // console.log(this.tracks[id]);
        return this.tracks[id];
    }

    getSampleID(id){
        return this.getSampleTrackData(id).trackID;//Piggybacking on getSampleTrackData, this could stand alone

        // if (!id||id<0||id>=this.tracks.length){ //Ensure id falls within valid range, replacing with random index if necessary
        //     id = Math.floor(Math.random() * this.tracks.length);
        // }
        // return this.tracks[id].trackID;
    }


    //based on given ID string, return track data. 
    //TODO pitch this as soon as track data is stored properly in DB
    getDataFromID(id){
        for (const realID in this.tracks){
            if (this.tracks[realID].trackID === id){
                return this.tracks[realID];
            }
        }
        console.warn(`No track found with ID '${id}' in sample data`);
        return this.emptyTrackData;
    }

   
    //return playlist with all tracks
    createSamplePlaylist() {
        const sampleTracks = new SampleTracks();
        return createPlaylist("Sample Playlist "+ Date.now(), sampleTracks.trackIDs);
    }

    //Generates playlist with 3 random tracks. Nothing prevents duplicates but none of this matters
    createRandomPlaylist(){
        const sampleTracks = new SampleTracks();
        let randomTrackIDs = [
            sampleTracks.getSampleID(),
            sampleTracks.getSampleID(),
            sampleTracks.getSampleID()
        ];
        return createPlaylist("Random Playlist "+ Date.now(), randomTrackIDs);
    }





    //------
    // TODO dont really need these, keeping for now
    getUniqueTrack(){
        trackData = {
            "trackID" : Date.now(),
            "Track Name": "Unique Track "+ Date.now(),
            "Album Name": "Unique Album "+ Date.now(),
            "Artist Name(s)": "Unique Artist "+ Date.now()
        }
        return trackData;
    }
    createEmptyPlaylist(){
        return createPlaylist("Empty Playlist "+ Date.now(), []);
    }

}

export {SampleTracks};