/**
 * Spatial Hash Grid for O(1) chunk lookups
 * Optimized for sparse world with dynamic chunk loading
 */
export class SpatialHashGrid {
    constructor(cellSize = 16) {
        this.cellSize = cellSize;
        this.grid = new Map();
        this.chunkCount = 0;
        
        // Statistics
        this.stats = {
            lookups: 0,
            hits: 0,
            misses: 0,
            insertions: 0,
            deletions: 0
        };
    }

    /**
     * Generate hash key for coordinates
     */
    getKey(x, z) {
        return `${x},${z}`;
    }

    /**
     * Insert chunk into grid
     */
    insert(x, z, chunk) {
        const key = this.getKey(x, z);
        
        if (!this.grid.has(key)) {
            this.chunkCount++;
        }
        
        this.grid.set(key, chunk);
        this.stats.insertions++;
        
        // Store coordinates in chunk for reverse lookup
        chunk.gridX = x;
        chunk.gridZ = z;
    }

    /**
     * Get chunk at coordinates
     */
    get(x, z) {
        const key = this.getKey(x, z);
        this.stats.lookups++;
        
        if (this.grid.has(key)) {
            this.stats.hits++;
            return this.grid.get(key);
        }
        
        this.stats.misses++;
        return null;
    }

    /**
     * Remove chunk from grid
     */
    remove(x, z) {
        const key = this.getKey(x, z);
        
        if (this.grid.delete(key)) {
            this.chunkCount--;
            this.stats.deletions++;
            return true;
        }
        
        return false;
    }

    /**
     * Check if chunk exists at coordinates
     */
    has(x, z) {
        return this.grid.has(this.getKey(x, z));
    }

    /**
     * Get all chunks within radius
     */
    getChunksInRadius(centerX, centerZ, radius) {
        const chunks = [];
        const radiusSquared = radius * radius;
        
        // Calculate bounds
        const minX = Math.floor(centerX - radius);
        const maxX = Math.ceil(centerX + radius);
        const minZ = Math.floor(centerZ - radius);
        const maxZ = Math.ceil(centerZ + radius);
        
        // Check all potential chunks
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const chunk = this.get(x, z);
                if (chunk) {
                    // Distance check
                    const dx = x - centerX;
                    const dz = z - centerZ;
                    if (dx * dx + dz * dz <= radiusSquared) {
                        chunks.push(chunk);
                    }
                }
            }
        }
        
        return chunks;
    }

    /**
     * Get chunks in rectangular region
     */
    getChunksInRegion(minX, minZ, maxX, maxZ) {
        const chunks = [];
        
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const chunk = this.get(x, z);
                if (chunk) {
                    chunks.push(chunk);
                }
            }
        }
        
        return chunks;
    }

    /**
     * Get all chunks
     */
    getAllChunks() {
        return Array.from(this.grid.values());
    }

    /**
     * Get all chunk coordinates
     */
    getAllCoordinates() {
        return Array.from(this.grid.keys()).map(key => {
            const [x, z] = key.split(',').map(Number);
            return { x, z };
        });
    }

    /**
     * Clear the grid
     */
    clear() {
        this.grid.clear();
        this.chunkCount = 0;
    }

    /**
     * Get grid statistics
     */
    getStats() {
        const hitRate = this.stats.lookups > 0 
            ? this.stats.hits / this.stats.lookups 
            : 0;
            
        return {
            ...this.stats,
            hitRate: hitRate,
            chunkCount: this.chunkCount,
            memoryUsage: this.grid.size * 8 // Rough estimate
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            lookups: 0,
            hits: 0,
            misses: 0,
            insertions: 0,
            deletions: 0
        };
    }

    /**
     * Perform cleanup (remove any null entries)
     */
    cleanup() {
        const toRemove = [];
        
        for (const [key, chunk] of this.grid) {
            if (!chunk || chunk.disposed) {
                toRemove.push(key);
            }
        }
        
        for (const key of toRemove) {
            this.grid.delete(key);
            this.chunkCount--;
        }
        
        return toRemove.length;
    }

    /**
     * Get neighbors of a chunk
     */
    getNeighbors(x, z) {
        const neighbors = {
            north: this.get(x, z - 1),
            south: this.get(x, z + 1),
            east: this.get(x + 1, z),
            west: this.get(x - 1, z),
            northEast: this.get(x + 1, z - 1),
            northWest: this.get(x - 1, z - 1),
            southEast: this.get(x + 1, z + 1),
            southWest: this.get(x - 1, z + 1)
        };
        
        return neighbors;
    }

    /**
     * Find nearest chunk to coordinates
     */
    findNearest(x, z, maxDistance = 10) {
        let nearest = null;
        let minDistance = Infinity;
        
        // Spiral search pattern
        for (let radius = 0; radius <= maxDistance; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    // Only check perimeter
                    if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) {
                        continue;
                    }
                    
                    const chunk = this.get(x + dx, z + dz);
                    if (chunk) {
                        const distance = Math.sqrt(dx * dx + dz * dz);
                        if (distance < minDistance) {
                            minDistance = distance;
                            nearest = chunk;
                        }
                    }
                }
            }
            
            // Early exit if found
            if (nearest) break;
        }
        
        return nearest;
    }

    /**
     * Iterate over all chunks
     */
    forEach(callback) {
        for (const [key, chunk] of this.grid) {
            const [x, z] = key.split(',').map(Number);
            callback(chunk, x, z);
        }
    }

    /**
     * Map over all chunks
     */
    map(callback) {
        const results = [];
        
        for (const [key, chunk] of this.grid) {
            const [x, z] = key.split(',').map(Number);
            results.push(callback(chunk, x, z));
        }
        
        return results;
    }

    /**
     * Filter chunks
     */
    filter(predicate) {
        const results = [];
        
        for (const [key, chunk] of this.grid) {
            const [x, z] = key.split(',').map(Number);
            if (predicate(chunk, x, z)) {
                results.push(chunk);
            }
        }
        
        return results;
    }

    /**
     * Debug visualization
     */
    visualize(centerX = 0, centerZ = 0, radius = 5) {
        const lines = [];
        
        for (let z = centerZ - radius; z <= centerZ + radius; z++) {
            let line = '';
            for (let x = centerX - radius; x <= centerX + radius; x++) {
                if (x === centerX && z === centerZ) {
                    line += '@ '; // Player position
                } else if (this.has(x, z)) {
                    line += '■ '; // Loaded chunk
                } else {
                    line += '· '; // Empty
                }
            }
            lines.push(line);
        }
        
        return lines.join('\n');
    }
}