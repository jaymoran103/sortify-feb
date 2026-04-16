const DB_NAME = "SortifyDB";
const DB_VERSION = 4;

class DataManager {

    constructor() {
        this.db = null;
    }

    // Initialize IndexedDB, creating object stores if necessary.
    // If the existing database version is newer than the app version, open the existing database without forcing a version downgrade.
    async init() {
        try {
            await this.openDatabase(DB_VERSION);
        } catch (err) {
            if (err.name === 'VersionError') {
                console.warn('Existing IndexedDB version is newer than app version; opening the existing database without forcing a version downgrade.');
                await this.openDatabase();
            } else {
                throw err;
            }
        }
    }

    async openDatabase(version) {
        return new Promise((resolve, reject) => {
            const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);

            request.onupgradeneeded = (event) => {
                console.warn("DB Upgrade fired!");
                this.db = event.target.result;
                this.createObjectStore(this.db, "playlists");
                this.createObjectStore(this.db, "tracks", { keyPath: "trackID" });
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
        this.validateDB();
        if (database.objectStoreNames.contains(storeName)) {
            console.warn(`Overwriting Object store ${storeName}`);
            database.deleteObjectStore(storeName);
        }
        database.createObjectStore(storeName, options);
    }

    //Generic create operation
    async createRecord(storeName, data) {

        this.validateDB();

        //Create transaction, access store, create request to add data
        const transaction = this.db.transaction([storeName], "readwrite");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.add(data);

        return this.createPromise(transaction, request);
    }


    //Generic read operation
    async getRecord(storeName, key) {
        this.validateDB();

        //Create transaction, access store, create request to get data
        const transaction = this.db.transaction([storeName], "readonly");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.get(key);

        return this.createPromise(transaction, request);//FUTURE: add check for empty array here instead of checking in callers?
    } 

    //Generic get all operation
    async getAllRecords(storeName) {
        
        this.validateDB();

        //Create transaction, access store, create request to get all data
        const transaction = this.db.transaction([storeName], "readonly");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.getAll();

        return this.createPromise(transaction, request);//FUTURE: add check for empty array here instead of checking in callers?
    }


    //Using this in place of a merge update method, until its clearer  what functionality is actually needed.
    async replaceRecord(storeName, key, newData) {
        
        this.validateDB();

        //Create transaction, access store, create request to replace data (via put with same key)
        const transaction = this.db.transaction([storeName], "readwrite");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.put({...newData, id: key});//ensure this object is valid?

        return this.createPromise(transaction, request);
    }

    //Generic delete operation
    async deleteRecord(storeName, key) {

        this.validateDB();

        //Create transaction, access store, create request to delete data
        const transaction = this.db.transaction([storeName], "readwrite");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.delete(key);//ensure this object is valid?

        return this.createPromise(transaction, request);
    }

    //Generic clear operation
    async clearRecords(storeName) {

        this.validateDB();

        //Create transaction, access store, create request to clear data
        const transaction = this.db.transaction([storeName], "readwrite");
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.clear();

        return this.createPromise(transaction, request);
    }

    //Utility method to ensure database is initialized before performing any operations
    validateDB(){
        if (!this.db) {
            throw new Error("Database not initialized");
        }
    }

    // utility method to create a promise for a transaction and its associated request
    createPromise(transaction, request) {
        return new Promise((resolve, reject) => {
            let result;//FUTURE: might use an array to track results for multi-request transactions.
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

export default DataManager;
