/**
 * Object Pool for Chunk instances
 * Reuses chunk objects to minimize garbage collection
 */
export class ChunkPool {
    constructor(initialSize = 50) {
        this.available = [];
        this.inUse = new Set();
        
        // Pre-allocate chunks
        for (let i = 0; i < initialSize; i++) {
            this.available.push(new PooledChunk());
        }
        
        // Statistics
        this.stats = {
            created: initialSize,
            reused: 0,
            currentlyInUse: 0,
            peakUsage: 0
        };
    }

    /**
     * Acquire a chunk from the pool
     */
    acquire() {
        let chunk;
        
        if (this.available.length > 0) {
            chunk = this.available.pop();
            this.stats.reused++;
        } else {
            chunk = new PooledChunk();
            this.stats.created++;
        }
        
        this.inUse.add(chunk);
        this.stats.currentlyInUse = this.inUse.size;
        this.stats.peakUsage = Math.max(this.stats.peakUsage, this.inUse.size);
        
        chunk.reset();
        return chunk;
    }

    /**
     * Release a chunk back to the pool
     */
    release(chunk) {
        if (!this.inUse.has(chunk)) {
            console.warn('Attempting to release chunk not from this pool');
            return;
        }
        
        this.inUse.delete(chunk);
        chunk.dispose();
        this.available.push(chunk);
        
        this.stats.currentlyInUse = this.inUse.size;
    }

    /**
     * Pre-warm the pool with additional chunks
     */
    preWarm(count) {
        for (let i = 0; i < count; i++) {
            this.available.push(new PooledChunk());
            this.stats.created++;
        }
    }

    /**
     * Trim excess chunks from the pool
     */
    trim(maxAvailable = 100) {
        while (this.available.length > maxAvailable) {
            const chunk = this.available.pop();
            chunk.destroy();
        }
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            ...this.stats,
            available: this.available.length,
            efficiency: this.stats.reused / (this.stats.reused + this.stats.created)
        };
    }

    /**
     * Clear the pool
     */
    clear() {
        // Dispose all in-use chunks
        for (const chunk of this.inUse) {
            chunk.dispose();
        }
        this.inUse.clear();
        
        // Destroy all available chunks
        for (const chunk of this.available) {
            chunk.destroy();
        }
        this.available = [];
        
        // Reset stats
        this.stats = {
            created: 0,
            reused: 0,
            currentlyInUse: 0,
            peakUsage: 0
        };
    }
}

/**
 * Pooled Chunk class with efficient memory management
 */
class PooledChunk {
    constructor() {
        this.worldX = 0;
        this.worldZ = 0;
        this.mesh = null;
        this.geometry = null;
        this.material = null;
        this.blocks = null;
        this.isDirty = false;
        this.lastUsed = 0;
        this.lod = 0;
        
        // Pre-allocate material for reuse
        this.material = new THREE.MeshLambertMaterial({
            vertexColors: true,
            side: THREE.FrontSide
        });
    }

    /**
     * Reset chunk for reuse
     */
    reset() {
        this.worldX = 0;
        this.worldZ = 0;
        this.isDirty = false;
        this.lastUsed = performance.now();
        this.lod = 0;
        
        // Clear blocks data
        if (this.blocks) {
            this.blocks.fill(0);
        }
    }

    /**
     * Set chunk position
     */
    setPosition(x, z) {
        this.worldX = x;
        this.worldZ = z;
        
        if (this.mesh) {
            this.mesh.position.set(
                x * config.chunkSize,
                0,
                z * config.chunkSize
            );
        }
    }

    /**
     * Set chunk geometry
     */
    setGeometry(geometry) {
        // Dispose old geometry
        if (this.geometry && this.geometry !== geometry) {
            this.geometry.dispose();
        }
        
        this.geometry = geometry;
        
        // Create or update mesh
        if (!this.mesh) {
            this.mesh = new THREE.Mesh(this.geometry, this.material);
            this.mesh.matrixAutoUpdate = false; // Manual matrix updates for performance
        } else {
            this.mesh.geometry = this.geometry;
        }
        
        // Update position
        this.mesh.position.set(
            this.worldX * config.chunkSize,
            0,
            this.worldZ * config.chunkSize
        );
        this.mesh.updateMatrix();
    }

    /**
     * Add chunk to scene
     */
    addToScene(scene) {
        if (this.mesh && !this.mesh.parent) {
            scene.add(this.mesh);
        }
    }

    /**
     * Remove chunk from scene
     */
    removeFromScene(scene) {
        if (this.mesh && this.mesh.parent === scene) {
            scene.remove(this.mesh);
        }
    }

    /**
     * Dispose chunk resources (keep for reuse)
     */
    dispose() {
        // Remove from scene but keep resources
        if (this.mesh && this.mesh.parent) {
            this.mesh.parent.remove(this.mesh);
        }
        
        // Dispose geometry
        if (this.geometry) {
            this.geometry.dispose();
            this.geometry = null;
        }
        
        // Keep material for reuse
        if (this.mesh) {
            this.mesh.geometry = null;
        }
    }

    /**
     * Destroy chunk completely (when removing from pool)
     */
    destroy() {
        this.dispose();
        
        // Dispose material
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }
        
        // Clear mesh
        if (this.mesh) {
            this.mesh = null;
        }
        
        // Clear blocks
        this.blocks = null;
    }

    /**
     * Get chunk memory usage estimate
     */
    getMemoryUsage() {
        let bytes = 0;
        
        // Geometry memory
        if (this.geometry) {
            const positions = this.geometry.attributes.position;
            const normals = this.geometry.attributes.normal;
            const colors = this.geometry.attributes.color;
            const indices = this.geometry.index;
            
            if (positions) bytes += positions.array.byteLength;
            if (normals) bytes += normals.array.byteLength;
            if (colors) bytes += colors.array.byteLength;
            if (indices) bytes += indices.array.byteLength;
        }
        
        // Blocks data
        if (this.blocks) {
            bytes += this.blocks.byteLength;
        }
        
        return bytes;
    }

    /**
     * Update chunk LOD
     */
    setLOD(level) {
        this.lod = level;
        
        // Adjust material based on LOD
        if (this.material) {
            // Lower LOD = simpler shading
            this.material.flatShading = level > 1;
            this.material.needsUpdate = true;
        }
    }
}

// Import config after class definitions to avoid circular dependency
import { config } from '../config.js';