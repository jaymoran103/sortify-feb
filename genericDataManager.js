//more general implementation of CRUD methods, for now we just need playlist records bvut ill probably swap for more general methods in the future.
class GenericDataManager {
    constructor() {
        this.db = null;
        console.log("GenericDataManager constructor called");
    }

    // Initialize IndexedDB
    async init() {
        console.log("Initializing IndexedDB...");
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("SortifyDB", 1);

            request.onupgradeneeded = (event) => {
                this.db = event.target.result;
                this.createObjectStore(this.db,"playlists")
            };
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    // Create a new object store if it doesn't exist
    async createObjectStore(database, storeName, options = { keyPath: "id", autoIncrement: true }) {
        if (database) {
            throw new Error("Database not initialized");
        }
        if (database.objectStoreNames.contains(storeName)) {
            console.warn(`Attempted to create Object store ${storeName}, but it already exists!`);
            return;
        }
        else{
            database.createObjectStore(storeName, options);
        }
    }

    //General create operation
    async genericCreate(storeName, data) {
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        const transaction = this.db.transaction([storeName], "readwrite");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.add(data);

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => {resolve(request.result);};
            transaction.onerror = (event) => {reject(event.target.error);};
            request.onsuccess = (event) => {console.log(`Data added to ${storeName} successfully`);};
            request.onerror = (event) => {console.error(`Error adding data to ${storeName}:`, event.target.error);};
        });
    }

    //General read operation
    async genericGetAll(storeName) {
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        const transaction = this.db.transaction([storeName], "readonly");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                console.log(`Data retrieved from ${storeName} successfully`);
                console.table(event.target.result);
                resolve(event.target.result);
            };
            request.onerror = (event) => {
                console.error(`Error retrieving data from ${storeName}:`, event.target.error);
                reject(event.target.error);
            };
        });

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => {resolve();};
            transaction.onerror = (event) => {reject(event.target.error);};
            request.onsuccess = (event) => {console.log(`Data deleted from ${storeName} successfully`);};
            request.onerror = (event) => {console.error(`Error deleting data from ${storeName}:`, event.target.error);};           
        });
    }

    //General update operation
    async genericUpdate(storeName, key, updatedData) {
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        const transaction = this.db.transaction([storeName], "readwrite");
        const objectStore = transaction.objectStore(storeName);
        const getRequest = objectStore.get(key);

        return new Promise((resolve, reject) => {
            getRequest.onsuccess = (event) => {
                const data = event.target.result;
                if (!data) {
                    reject(new Error(`No record found with key ${key} in ${storeName}`));
                    return;
                }
                // Update the data with the new values
                Object.assign(data, updatedData);
                const updateRequest = objectStore.put(data);

                updateRequest.onsuccess = () => {
                    console.log(`Data updated in ${storeName} successfully`);
                    resolve();
                };
                updateRequest.onerror = (event) => {
                    console.error(`Error updating data in ${storeName}:`, event.target.error);
                    reject(event.target.error);
                };
            };
            getRequest.onerror = (event) => {
                console.error(`Error retrieving data for update from ${storeName}:`, event.target.error);
                reject(event.target.error);
            };
        }); 
    }

    //Generic delete operation
    async genericDelete(storeName, key) {
        if (!this.db) {
            throw new Error("Database not initialized");
        }
        
        const transaction = this.db.transaction([storeName], "readwrite");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.delete(key);

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => {resolve();};
            transaction.onerror = (event) => {reject(event.target.error);};
            request.onsuccess = (event) => {console.log(`Data deleted from ${storeName} successfully`);};
            request.onerror = (event) => {console.error(`Error deleting data from ${storeName}:`, event.target.error);};
        });
    }
}




export {GenericDataManager};
