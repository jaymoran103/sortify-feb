import { createPlaylist, createTrack } from "./models.js";

class Importer {




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

            //Store track if not already in database, then add track ID for 
            await this.storeTrackIfNeeded(dataManager,columns);
            trackIDs.push(columns[trackIDIndex]);

        }
        await this.storePlaylist(dataManager,playlistName,trackIDs);
                
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
            console.log(`Created new playlist '${playlistName}' with ${trackIDs.length} tracks and stored in database`)
        }
        catch (error) {
            console.error(`Error storing playlist '${playlistName}' in database:`, error);
            return;
        }
    }

    
    // Helper function checks if track already exists in database, creating new track record if not
    async storeTrackIfNeeded(dataManager,columns){
        const trackID = columns[0].trim();

        // Check if track already exists in database, skipping if so
        let dbTrack = await dataManager.getRecord("tracks", trackID);
        if (dbTrack) {
            // console.log(`Track with ID '${trackID}' already exists in database, skipping creation`);
            return;
        }
        // Create a new track object
        const newTrack = createTrack(
            trackID,   //ID
            columns[1],//title
            columns[3].replace(/;/g, ', '), //artist //FUTURE - account for case where an artist name actually contains a semicolon
            columns[2],//album

        );
        try {
            await dataManager.createRecord("tracks", newTrack);
        }
        catch (error) {
            console.error(`Error storing track with ID '${trackID}' in database:`, error);
            return;
        }
    }
}

// Helper function parses a csv line, handling quoted fields and commas within quotes
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
