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
        if (!database) {
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

    //Generic create operation
    async createRecord(storeName, data) {
        //Ensure database exists
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        //Create transaction, access store, create request to add data
        const transaction = this.db.transaction([storeName], "readwrite");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.add(data);

        return new Promise((resolve, reject) => {
            let result;
            request.onsuccess = () => {
                result = request.result;
            };
            transaction.oncomplete = () => {
                resolve(result);
            };
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
            transaction.onabort = (event) => {
                reject(event.target.error);
            }
        });
    }


    //Generic read operation
    async getRecord(storeName, key) {
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        const transaction = this.db.transaction([storeName], "readonly");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.get(key);

        return new Promise((resolve, reject) => {
            let result;
            request.onsuccess = () => {
                result = request.result;
            };
            transaction.oncomplete = () => {
                resolve(result);
            };
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
            transaction.onabort = (event) => {
                reject(event.target.error);
            }
        });
    }   

    //Generic get all operation
    async getAllRecords(storeName) {
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        const transaction = this.db.transaction([storeName], "readonly");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.getAll();

        return new Promise((resolve, reject) => {
            let result;
            request.onsuccess = () => {
                result = request.result;
            };
            transaction.oncomplete = () => {
                resolve(result);
            };
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
            transaction.onabort = (event) => {
                reject(event.target.error);
            }
        });
    }


    //Using this in place of a merge update method, until its clearer  what functionality is actually needed.
    async replaceRecord(storeName, key, newData) {

        //Ensure database exists
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        //Create transaction, access store, create request to replace data
        const transaction = this.db.transaction([storeName], "readwrite");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.put({...newData, id: key});//ensure this object is valid?

        return new Promise((resolve, reject) => {
            let result;
            request.onsuccess = () => {
                result = request.result;
                console.log(`result: ${result}`);
                console.log(`request.result: ${request.result}`);
            };
            transaction.oncomplete = () => {
                resolve(result);
            };
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
            transaction.onabort = (event) => {
                reject(event.target.error);
            }
        });
    }

    //Generic delete operation
    async deleteRecord(storeName, key) {

        //Ensure database exists
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        //Create transaction, access store, create request to delete data
        const transaction = this.db.transaction([storeName], "readwrite");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.delete(key);//ensure this object is valid?

        return new Promise((resolve, reject) => {
            let result;
            request.onsuccess = () => {
                result = request.result;
            };
            transaction.oncomplete = () => {
                resolve(result);
            };
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
            transaction.onabort = (event) => {
                reject(event.target.error);
            }
        });
    }

    //Generic clear operation
    async clearRecords(storeName) {

        //Ensure database exists
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        //Create transaction, access store, create request to clear data
        const transaction = this.db.transaction([storeName], "readwrite");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.clear();

        return new Promise((resolve, reject) => {
            let result;
            request.onsuccess = () => {
                result = request.result;
            };
            transaction.oncomplete = () => {
                resolve(result);
            };
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
            transaction.onabort = (event) => {
                reject(event.target.error);
            }
        });
    }
}

export {GenericDataManager};
