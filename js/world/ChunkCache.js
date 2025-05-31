/**
 * Multi-level Chunk Cache System
 * Memory -> IndexedDB -> Compression
 */
export class ChunkCache {
    constructor() {
        this.memoryCache = new Map();
        this.maxMemoryItems = 100;
        this.dbName = 'MinecraftVoxelCache';
        this.dbVersion = 1;
        this.db = null;
        
        // LRU tracking
        this.accessOrder = [];
        
        // Statistics
        this.stats = {
            memoryHits: 0,
            memoryMisses: 0,
            dbHits: 0,
            dbMisses: 0,
            compressionRatio: 0
        };
        
        this.initializeDB();
    }

    /**
     * Initialize IndexedDB
     */
    async initializeDB() {
        try {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => {
                console.error('Failed to open IndexedDB:', request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                console.log('ChunkCache IndexedDB initialized');
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create object store for chunks
                if (!db.objectStoreNames.contains('chunks')) {
                    const store = db.createObjectStore('chunks', { keyPath: 'key' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('size', 'size', { unique: false });
                }
                
                // Create object store for metadata
                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata', { keyPath: 'key' });
                }
            };
        } catch (error) {
            console.error('IndexedDB initialization failed:', error);
        }
    }

    /**
     * Get chunk from cache
     */
    async get(key) {
        // Check memory cache first
        if (this.memoryCache.has(key)) {
            this.updateLRU(key);
            this.stats.memoryHits++;
            return this.decompress(this.memoryCache.get(key));
        }
        
        this.stats.memoryMisses++;
        
        // Check IndexedDB
        if (this.db) {
            try {
                const data = await this.getFromDB(key);
                if (data) {
                    this.stats.dbHits++;
                    
                    // Add to memory cache
                    this.addToMemoryCache(key, data);
                    
                    return this.decompress(data);
                }
            } catch (error) {
                console.error('DB read error:', error);
            }
        }
        
        this.stats.dbMisses++;
        return null;
    }

    /**
     * Set chunk in cache
     */
    async set(key, data) {
        const compressed = this.compress(data);
        
        // Add to memory cache
        this.addToMemoryCache(key, compressed);
        
        // Save to IndexedDB
        if (this.db) {
            try {
                await this.saveToDB(key, compressed);
            } catch (error) {
                console.error('DB write error:', error);
            }
        }
    }

    /**
     * Add to memory cache with LRU eviction
     */
    addToMemoryCache(key, data) {
        // Remove if already exists
        if (this.memoryCache.has(key)) {
            const index = this.accessOrder.indexOf(key);
            if (index > -1) {
                this.accessOrder.splice(index, 1);
            }
        }
        
        // Add to cache
        this.memoryCache.set(key, data);
        this.accessOrder.push(key);
        
        // Evict if necessary
        while (this.memoryCache.size > this.maxMemoryItems) {
            const oldestKey = this.accessOrder.shift();
            this.memoryCache.delete(oldestKey);
        }
    }

    /**
     * Update LRU order
     */
    updateLRU(key) {
        const index = this.accessOrder.indexOf(key);
        if (index > -1) {
            this.accessOrder.splice(index, 1);
            this.accessOrder.push(key);
        }
    }

    /**
     * Get from IndexedDB
     */
    getFromDB(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chunks'], 'readonly');
            const store = transaction.objectStore('chunks');
            const request = store.get(key);
            
            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.data : null);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * Save to IndexedDB
     */
    saveToDB(key, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['chunks'], 'readwrite');
            const store = transaction.objectStore('chunks');
            
            const record = {
                key: key,
                data: data,
                timestamp: Date.now(),
                size: data.byteLength || data.length
            };
            
            const request = store.put(record);
            
            request.onsuccess = () => {
                resolve();
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * Compress chunk data
     */
    compress(data) {
        // Simple RLE compression for chunk data
        if (data.terrain && data.terrain instanceof Uint8Array) {
            const compressed = this.compressRLE(data.terrain);
            const ratio = compressed.length / data.terrain.length;
            this.stats.compressionRatio = this.stats.compressionRatio * 0.9 + ratio * 0.1;
            
            return {
                ...data,
                terrain: compressed,
                compressed: true
            };
        }
        return data;
    }

    /**
     * Decompress chunk data
     */
    decompress(data) {
        if (data.compressed && data.terrain) {
            return {
                ...data,
                terrain: this.decompressRLE(data.terrain),
                compressed: false
            };
        }
        return data;
    }

    /**
     * RLE compression
     */
    compressRLE(data) {
        const result = [];
        let current = data[0];
        let count = 1;
        
        for (let i = 1; i < data.length; i++) {
            if (data[i] === current && count < 255) {
                count++;
            } else {
                result.push(count, current);
                current = data[i];
                count = 1;
            }
        }
        
        result.push(count, current);
        return new Uint8Array(result);
    }

    /**
     * RLE decompression
     */
    decompressRLE(compressed) {
        const result = [];
        
        for (let i = 0; i < compressed.length; i += 2) {
            const count = compressed[i];
            const value = compressed[i + 1];
            
            for (let j = 0; j < count; j++) {
                result.push(value);
            }
        }
        
        return new Uint8Array(result);
    }

    /**
     * Clear memory cache
     */
    clearMemory() {
        this.memoryCache.clear();
        this.accessOrder = [];
    }

    /**
     * Clear all cache
     */
    async clear() {
        this.clearMemory();
        
        if (this.db) {
            try {
                const transaction = this.db.transaction(['chunks'], 'readwrite');
                const store = transaction.objectStore('chunks');
                await store.clear();
            } catch (error) {
                console.error('Failed to clear DB cache:', error);
            }
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const hitRate = (this.stats.memoryHits + this.stats.dbHits) / 
                       (this.stats.memoryHits + this.stats.memoryMisses + 
                        this.stats.dbHits + this.stats.dbMisses) || 0;
        
        return {
            ...this.stats,
            hitRate: hitRate,
            memoryCacheSize: this.memoryCache.size,
            avgCompressionRatio: this.stats.compressionRatio
        };
    }

    /**
     * Preload chunks
     */
    async preload(keys) {
        const promises = keys.map(key => this.get(key));
        return Promise.all(promises);
    }

    /**
     * Clean old entries from DB
     */
    async cleanup(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
        if (!this.db) return;
        
        const cutoff = Date.now() - maxAge;
        
        try {
            const transaction = this.db.transaction(['chunks'], 'readwrite');
            const store = transaction.objectStore('chunks');
            const index = store.index('timestamp');
            const range = IDBKeyRange.upperBound(cutoff);
            
            const request = index.openCursor(range);
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    store.delete(cursor.primaryKey);
                    cursor.continue();
                }
            };
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    }

    /**
     * Get cache size
     */
    async getCacheSize() {
        if (!this.db) return { memory: 0, db: 0 };
        
        let dbSize = 0;
        
        try {
            const transaction = this.db.transaction(['chunks'], 'readonly');
            const store = transaction.objectStore('chunks');
            const index = store.index('size');
            
            const request = index.openCursor();
            
            return new Promise((resolve) => {
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        dbSize += cursor.value.size;
                        cursor.continue();
                    } else {
                        resolve({
                            memory: this.getMemorySize(),
                            db: dbSize
                        });
                    }
                };
            });
        } catch (error) {
            console.error('Failed to get cache size:', error);
            return { memory: this.getMemorySize(), db: 0 };
        }
    }

    /**
     * Get memory cache size
     */
    getMemorySize() {
        let size = 0;
        for (const data of this.memoryCache.values()) {
            if (data.terrain) {
                size += data.terrain.byteLength || data.terrain.length;
            }
        }
        return size;
    }
}