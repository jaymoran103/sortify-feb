import { createPlaylist, createTrack } from "./models.js";

class Importer {

    constructor() {
        this.resetStats();
    }

    //Track stats about the import process, just for console printing for now
    resetStats() {
        this.totalTracksProcessed = 0;
        this.uniqueTracksAdded = 0;
        this.invalidTracksSkipped = 0;
    }

    //import playlist from CSV file, creating track records as needed and linking to new playlist record.
    async importPlaylistCSV(dataManager,file) {

        // console.log(`Importing playlist from file: ${file.name}`);
        const playlistName = file.name.replace('.csv','');

        //Get CSV data and split into lines, filtering empty lines and rejecting empty files
        const csvData = await this.readFileAsText(file);
        const lines = csvData.split('\n').filter(line => line.trim() !== '');
        if (lines.length < 2) {
            console.warn("CSV file is empty or only contains headers");
            return;
        }

        //Parse header, identify important column IDs
        
        const header = parseCSVLine(lines[0]);
        const trackIDIndex = 0;

        //Iterate through lines, pushing trackIDs to array and storing track metadata in database as needed.  
        const trackIDs = [];
        for (let i = 1; i < lines.length; i++) {
            const columns = parseCSVLine(lines[i]);

            //Store track if not already in database, then add track ID for playlist (storeTrackIfNeeded returns true unless a validation error occurs)
            let validTrack = await this.storeTrackIfNeeded(dataManager,columns);
            if (validTrack) {
                trackIDs.push(columns[trackIDIndex]);
            }

        }
        await this.storePlaylist(dataManager,playlistName,trackIDs);
        this.totalTracksProcessed += (lines.length - 1);                
    }

    // Helper function reads a csv file as text, returning a promise that resolves with the file contents
    readFileAsText(file){
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                resolve(event.target.result);
            }
            reader.onerror = (event) => {
                reject(event.target.error);
            }
            reader.readAsText(file);
        });
    }

    // Helper function stores playlist in database, logging success or failure
    async storePlaylist(dataManager, playlistName, trackIDs){
        const newPlaylist = createPlaylist(playlistName, trackIDs);
        try {
            await dataManager.createRecord("playlists", newPlaylist);
            // console.log(`Created new playlist '${playlistName}' with ${trackIDs.length} tracks and stored in database`)
        }
        catch (error) {
            console.error(`Error storing playlist '${playlistName}' in database:`, error);
            return;
        }
    }

    
    // Helper function checks if track already exists in database, creating new track record if not
    // Returns true if track is valid (regardeless of presence in database), false if track is invalid/malformed and should be skipped
    async storeTrackIfNeeded(dataManager,columns){

        
        const trackID = columns[0].trim();

        // Check if track already exists in database, skipping if so
        let dbTrack = await dataManager.getRecord("tracks", trackID);
        if (dbTrack) {
            // console.log(`Track'${trackID}' already stored!`);
            return true;
        }
        //FUTURE - if valildation gets more complex, this could go the class/type I implement for models down the road
        const requiredFields = {
            trackID: trackID,
            title: columns[1],
            artist: columns[2],
            album: columns[3], //FUTURE - account for case where an artist name actually contains a semicolon
        }
        // Validate required fields, skipping track if any are missing/invalid
        if (!isValidTrackData(requiredFields)) {
            // console.warn(`Skipping track with ID '${trackID}' due to missing required fields`);
            this.invalidTracksSkipped++;
            return false;
        }

        
        // Create a new track object
        const newTrack = createTrack(
            trackID,   //ID
            requiredFields.title,
            requiredFields.album,//album
            requiredFields.artist.replace(/;/g, ', '), //artist //FUTURE - account for case where an artist name actually contains a semicolon
        );
        try {
            await dataManager.createRecord("tracks", newTrack);
            // console.log(`Added '${trackID}' to database`);
            this.uniqueTracksAdded++;
            return true;

        }
        catch (error) {
            console.error(`Error storing track with ID '${trackID}' in database:`, error);
            return false;//TODO should this be true or false? till we're managing duplicates, I lean toward false, safer to skip
        }
    }
}

//Helper method ensures no given field is empty, undefined, or equal to "undefined" 
//TODO log skipped/invalid tracks somewhere visible to user? Nothing here is unexpected, but it'd be good form to notify them
function isValidTrackData(trackData) {
    
    if (trackData.trackID && trackData.trackID.includes(":local:")) {
        console.warn(`Track ID '${trackData.trackID}' is a local file, which isn't yet supported. Skipping.`);
        return false;
    }
    // console.log(`Validating track data for ID '${trackData.trackID}' - Title: '${trackData.title}', Artist: '${trackData.artist}', Album: '${trackData.album}'`);
    for (const key in trackData) {
        if (!trackData[key] || trackData[key] === "undefined") {

            //Slightly ugly, provide trackID or title if available.
            let identifier = trackData.trackID ? `ID '${trackData.trackID}'` : (trackData.title ? `Title '${trackData.title}'` : 'Unidentified track');

            console.warn(`Missing or invalid field '${key}' for '${identifier}'. Skipping this track.`);
            return false;
        }
    }
    
    return true;
}

// Helper function parses a csv line, handling quoted fields and commas within quotes
//TODO consider case where a line contains uneven quotes?
function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    // Iterate through each character in the line, building fields based on commas and quotes
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {// Toggle inQuotes flag when encountering a quote character
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {// Comma outside of quotes indicates end of field
            fields.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current.trim());// push remaining data as last field

    return fields;
}

export default Importer;
