class DataManager {
    constructor() {
        this.db = null;
        console.log("DataManager constructor called");
    }

    // Initialize IndexedDB
    async init() {
        console.log("Initializing IndexedDB ");
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("SortifyDB", 1);

            // Ensure object store exists
            request.onupgradeneeded = (event) => {
                this.db = event.target.result;
                if (!this.db.objectStoreNames.contains('playlists')){
                    this.db.createObjectStore("playlists", { keyPath: "id", autoIncrement: true });
                }
            }
            
            // Handle errors and success
            request.onerror = (event) => {
                reject(event.target.error);
            };
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };
        });
    }

    async createPlaylist(playlistData) {

        // Ensure DB is initialized, or throw error
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        //Sample data for testing
        if (!playlistData){
            playlistData = {
                name: "New Playlist",
                tracks: []
            };
        }
        console.log("Creating playlist with data: ", playlistData);

        const transaction = this.db.transaction(["playlists"], "readwrite");
        const objectStore = transaction.objectStore("playlists");
        const request = objectStore.add(playlistData);

        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                // console.log("Playlists retrieved successfully: ", event.target.result);
                console.log("Playlist created successfully: ");
                console.table(event.target.result);
                resolve(event.target.result);
            };
            request.onerror = (event) => {//TODO down the road, reject on transaction error instead of request
                console.error("Error creating playlist:", event.target.error);
                reject(event.target.error);
            };
        });
    }

    async updatePlaylist(id){//Proof of concept, updates playlist name 
        // Ensure DB is initialized, or throw error
        if (!this.db) {
            throw new Error("Database not initialized");
        }
        
        const transaction = this.db.transaction(["playlists"], "readwrite");
        const objectStore = transaction.objectStore("playlists");
        const getRequest = objectStore.get(id);

        let oldName;
        let newName;

        getRequest.onsuccess = () => {
            const record = getRequest.result;
            if (!record){
                console.error("Record with id '"+id+"' not found, can't update. Try 'put'");
                transaction.abort(); 
                // reject(new Error(`Playlist with id ${id} not found, can't update record`));
                return;
            }
            const updatedRecord = {...record};//Make shallow copies, 
            updatedRecord.name += "-Updated";

            //Update variables for logging/POC
            oldName = record.name;
            newName = updatedRecord.name;

            objectStore.put(updatedRecord);
        };

        transaction.oncomplete = () => {
            console.log(`Update successful: Playlist with id '${id}' renamed ${oldName} -> ${newName}`);
            // resolve(request.result);
        };
        transaction.onerror = (event) => {reject(event.target.error);};
    }

    async getAllPlaylists(){

        // Ensure DB is initialized, or throw error
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        const transaction = this.db.transaction(["playlists"], "readonly");
        const objectStore = transaction.objectStore("playlists");
        const request = objectStore.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                // console.log("Playlists retrieved successfully: ", event.target.result);
                let playlists = event.target.result;
                if (playlists.length>0){
                console.log("Playlists retrieved successfully: ");
                console.table(event.target.result);
                }
                else {
                    console.log("No playlists to retrieve from IndexedDB!");
                }
                resolve(event.target.result);
            };
            request.onerror = (event) => {
                console.error("Error retrieving playlists:", event.target.error);
                reject(event.target.error);
            };
        });
    }

    async getPlaylist(id) {
        // console.log("getPlaylist not implemented yet");

        //Sample id for testing
        if (!id){
            let defaultID = 10;
            console.warn(`No id provided for getPlaylist, using default id=${defaultID} for testing`);
            id=defaultID;
        }
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        const transaction = this.db.transaction(["playlists"], "readonly");
        const objectStore = transaction.objectStore("playlists");
        const request = objectStore.get(id);

        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                if (event.target.result) {
                    console.log("Playlist retrieved successfully: ", event.target.result);
                } else {
                    console.warn("No playlist found with id: ", id);
                }
                resolve(event.target.result);
            };
            request.onerror = (event) => {
                console.error("Error retrieving playlist:", event.target.error);
                reject(event.target.error);
            };
        });    
    }

    async deleteAllPlaylists() {
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        const transaction = this.db.transaction(["playlists"], "readwrite");
        const objectStore = transaction.objectStore("playlists");
        const request = objectStore.clear();

        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                console.log("All playlists deleted successfully");
                resolve();
            };
            request.onerror = (event) => {
                console.error("Error deleting playlists:", event.target.error);
                reject(event.target.error);
            };
        });
    }
}



export {DataManager};
