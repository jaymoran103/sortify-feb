import { createPlaylist, createTrack } from "./models.js";

class Importer {

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


    //
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
            trackIDs.push(unwrapQuotes(columns[trackIDIndex]));

        }
        await this.storePlaylist(dataManager,playlistName,trackIDs);
                
    }
    

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

    async storeTrackIfNeeded(dataManager,columns){
        const trackID = unwrapQuotes(columns[0].trim());

        // Check if track already exists in database, skipping if so
        let dbTrack = await dataManager.getRecord("tracks", trackID);
        if (dbTrack) {
            // console.log(`Track with ID '${trackID}' already exists in database, skipping creation`);
            return;
        }
        // Create a new track object
        const newTrack = createTrack(
            trackID,   //ID
            unwrapQuotes(columns[1]),//title
            unwrapQuotes(columns[3]).replace(/;/g, ', '), //artist //FUTURE - account for case where an artist name actually contains a semicolon
            unwrapQuotes(columns[2]),//album

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




function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current.trim());// push remaining data as last field



    return fields;
}


//Helper function to remove wrapping quotes, with option to remove multiple layers of quotes if needed. 
function unwrapQuotes(str,removeAll = false){
    if (removeAll){
        while (str.startsWith('"') && str.endsWith('"')) {
            str = str.slice(1, -1);
        }
    } 
    else if (str.startsWith('"') && str.endsWith('"')) {
        str = str.slice(1, -1);
    }
    return str;

}

export default Importer;
