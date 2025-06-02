import { config, stats } from '../config.js';
import { Chunk } from './Chunk.js';
import { ChunkLoader } from './ChunkLoader.js';
import { WorkerManager } from './WorkerManager.js';

// Frustum Culling Class (mantener para compatibilidad)
class FrustumCuller {
    constructor() {
        this.frustum = new THREE.Frustum();
        this.matrix = new THREE.Matrix4();
    }

    update(camera) {
        // Update projection-view matrix
        this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.matrix);
    }

    isChunkVisible(chunkX, chunkZ) {
        // Create bounding box for the chunk with small margin to prevent pop-in
        const min = new THREE.Vector3(
            chunkX * config.chunkSize - 0.5,
            -0.5,
            chunkZ * config.chunkSize - 0.5
        );
        const max = new THREE.Vector3(
            (chunkX + 1) * config.chunkSize + 0.5,
            config.chunkSize + 0.5,
            (chunkZ + 1) * config.chunkSize + 0.5
        );
        
        const box = new THREE.Box3(min, max);
        return this.frustum.intersectsBox(box);
    }
}

// World management
export class World {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.loadedChunks = new Set();
        this.frustumCuller = new FrustumCuller();
        
        // NUEVO: Sistema avanzado de carga de chunks
        this.useAdvancedLoader = config.features.useAdvancedLoader;
        if (this.useAdvancedLoader) {
            this.chunkLoader = new ChunkLoader(this, scene);
        }
        
        // NUEVO: Worker Manager para generación asíncrona
        this.workerManager = null;
        if (config.features.useWorkers) {
            console.log('[World] Attempting to initialize Web Workers...');
            try {
                this.workerManager = new WorkerManager(this, scene);
                
                // Update stats based on worker status
                setTimeout(() => {
                    if (this.workerManager && this.workerManager.isEnabled()) {
                        stats.workerStatus = 'enabled';
                        console.log('[World] Web Workers enabled successfully');
                    } else {
                        stats.workerStatus = 'disabled';
                        console.log('[World] Web Workers disabled or failed to initialize');
                        config.features.useWorkers = false;
                    }
                }, 1500);
            } catch (error) {
                console.error('[World] Failed to initialize WorkerManager:', error);
                config.features.useWorkers = false;
                stats.workerStatus = 'failed';
            }
        }
        
        // Seed para generación procedural
        this.seed = Math.floor(Math.random() * 1000000);
    }

    getChunkKey(x, z) {
        return `${x},${z}`;
    }

    getChunk(x, z) {
        const key = this.getChunkKey(x, z);
        if (!this.chunks.has(key)) {
            this.chunks.set(key, new Chunk(x, z, this));
        }
        return this.chunks.get(key);
    }

    // Get block from world coordinates (handles cross-chunk queries)
    getBlockAtWorldCoords(worldX, worldY, worldZ) {
        const chunkX = Math.floor(worldX / config.chunkSize);
        const chunkZ = Math.floor(worldZ / config.chunkSize);
        const localX = ((worldX % config.chunkSize) + config.chunkSize) % config.chunkSize;
        const localZ = ((worldZ % config.chunkSize) + config.chunkSize) % config.chunkSize;
        
        // FIX: Simplemente usar el sistema de chunks normal
        // No intentar usar ChunkLoader.getChunkAt que no existe
        const chunk = this.getChunk(chunkX, chunkZ);
        return chunk.getBlock(localX, worldY, localZ);
    }

    // NEW: Method to dynamically update render distance
    updateRenderDistance(newDistance) {
        console.log('[World] Updating render distance from', config.renderDistance, 'to', newDistance);
        
        const oldDistance = config.renderDistance;
        config.renderDistance = newDistance;
        
        // If using advanced loader, update it
        if (this.useAdvancedLoader && this.chunkLoader) {
            // The ChunkLoader will handle the update in the next update cycle
            console.log('[World] Advanced loader will update on next cycle');
            return;
        }
        
        // For basic system, we need to unload chunks outside new range
        if (newDistance < oldDistance) {
            console.log('[World] Unloading chunks outside new range...');
            
            // Get current player chunk position
            const playerChunkX = Math.floor(window.player.position.x / config.chunkSize);
            const playerChunkZ = Math.floor(window.player.position.z / config.chunkSize);
            
            // Create set of chunks that should remain loaded
            const chunksToKeep = new Set();
            for (let x = -newDistance; x <= newDistance; x++) {
                for (let z = -newDistance; z <= newDistance; z++) {
                    const cx = playerChunkX + x;
                    const cz = playerChunkZ + z;
                    chunksToKeep.add(this.getChunkKey(cx, cz));
                }
            }
            
            // Unload chunks outside new range
            for (const key of this.loadedChunks) {
                if (!chunksToKeep.has(key)) {
                    const chunk = this.chunks.get(key);
                    if (chunk && chunk.mesh) {
                        this.scene.remove(chunk.mesh);
                        chunk.mesh.geometry.dispose();
                        chunk.mesh.material.dispose();
                        chunk.mesh = null;
                    }
                    this.loadedChunks.delete(key);
                }
            }
        }
        
        // Update stats
        stats.totalChunks = (config.renderDistance * 2 + 1) * (config.renderDistance * 2 + 1);
        
        console.log('[World] Render distance update complete');
    }

    updateChunksAroundPlayer(playerX, playerZ, camera, scene) {
        // NUEVO: Usar el sistema avanzado si está activado
        if (this.useAdvancedLoader && this.chunkLoader) {
            this.chunkLoader.update({ x: playerX, z: playerZ }, camera);
            return;
        }
        
        // Sistema original (fallback)
        this.frustumCuller.update(camera);
        
        const chunkX = Math.floor(playerX / config.chunkSize);
        const chunkZ = Math.floor(playerZ / config.chunkSize);
        const newLoadedChunks = new Set();

        // Load chunks within render distance
        for (let x = -config.renderDistance; x <= config.renderDistance; x++) {
            for (let z = -config.renderDistance; z <= config.renderDistance; z++) {
                const cx = chunkX + x;
                const cz = chunkZ + z;
                
                // Check if chunk is visible in frustum
                if (!this.frustumCuller.isChunkVisible(cx, cz)) {
                    continue; // Skip chunks not visible
                }
                
                const key = this.getChunkKey(cx, cz);
                newLoadedChunks.add(key);
                
                if (!this.loadedChunks.has(key)) {
                    const chunk = this.getChunk(cx, cz);
                    
                    // NUEVO: Intentar usar workers si están disponibles
                    if (this.workerManager && this.workerManager.isEnabled() && config.features.useWorkers) {
                        // Request async generation
                        const requested = this.workerManager.requestChunk(cx, cz);
                        if (!requested && config.features.fallbackToSync) {
                            // Fallback to sync if worker request failed
                            chunk.updateMesh(scene);
                        }
                    } else {
                        // Sync generation
                        chunk.updateMesh(scene);
                    }
                }
            }
        }

        // Unload chunks outside render distance or not visible
        for (const key of this.loadedChunks) {
            if (!newLoadedChunks.has(key)) {
                const chunk = this.chunks.get(key);
                if (chunk && chunk.mesh) {
                    scene.remove(chunk.mesh);
                    chunk.mesh.geometry.dispose();
                    chunk.mesh.material.dispose();
                    chunk.mesh = null;
                }
            }
        }

        this.loadedChunks = newLoadedChunks;
        
        // Update stats for debugging
        stats.visibleChunks = newLoadedChunks.size;
        stats.totalChunks = (config.renderDistance * 2 + 1) * (config.renderDistance * 2 + 1);
    }

    getBlockAt(x, y, z) {
        return this.getBlockAtWorldCoords(Math.floor(x), Math.floor(y), Math.floor(z));
    }

    setBlockAt(x, y, z, type, scene) {
        const worldX = Math.floor(x);
        const worldY = Math.floor(y);
        const worldZ = Math.floor(z);
        
        const chunkX = Math.floor(worldX / config.chunkSize);
        const chunkZ = Math.floor(worldZ / config.chunkSize);
        const localX = ((worldX % config.chunkSize) + config.chunkSize) % config.chunkSize;
        const localZ = ((worldZ % config.chunkSize) + config.chunkSize) % config.chunkSize;
        
        const chunk = this.getChunk(chunkX, chunkZ);
        chunk.setBlock(localX, worldY, localZ, type);
        chunk.updateMesh(scene);
        
        // Update all potentially affected adjacent chunks
        const chunksToUpdate = new Set();
        
        // Check if block is on chunk boundary and update neighbors
        if (localX === 0) chunksToUpdate.add(this.getChunk(chunkX - 1, chunkZ));
        if (localX === config.chunkSize - 1) chunksToUpdate.add(this.getChunk(chunkX + 1, chunkZ));
        if (localZ === 0) chunksToUpdate.add(this.getChunk(chunkX, chunkZ - 1));
        if (localZ === config.chunkSize - 1) chunksToUpdate.add(this.getChunk(chunkX, chunkZ + 1));
        
        // Corner cases
        if (localX === 0 && localZ === 0) chunksToUpdate.add(this.getChunk(chunkX - 1, chunkZ - 1));
        if (localX === 0 && localZ === config.chunkSize - 1) chunksToUpdate.add(this.getChunk(chunkX - 1, chunkZ + 1));
        if (localX === config.chunkSize - 1 && localZ === 0) chunksToUpdate.add(this.getChunk(chunkX + 1, chunkZ - 1));
        if (localX === config.chunkSize - 1 && localZ === config.chunkSize - 1) chunksToUpdate.add(this.getChunk(chunkX + 1, chunkZ + 1));
        
        // Update all affected chunks
        chunksToUpdate.forEach(chunk => {
            if (chunk && this.loadedChunks.has(this.getChunkKey(chunk.x, chunk.z))) {
                chunk.updateMesh(scene);
            }
        });
    }
    
    // NUEVO: Obtener estadísticas del sistema
    getStats() {
        const baseStats = {
            chunksLoaded: this.loadedChunks.size,
            totalChunks: this.chunks.size,
            workerEnabled: this.workerManager ? this.workerManager.isEnabled() : false
        };
        
        if (this.useAdvancedLoader && this.chunkLoader) {
            return {
                ...baseStats,
                ...this.chunkLoader.getStats(),
                poolStats: this.chunkLoader.chunkPool.getStats(),
                cacheStats: this.chunkLoader.cache.getStats(),
                gridStats: this.chunkLoader.spatialGrid.getStats()
            };
        }
        
        return baseStats;
    }
    
    // NUEVO: Limpiar recursos
    dispose() {
        // Dispose worker manager
        if (this.workerManager) {
            this.workerManager.dispose();
            this.workerManager = null;
        }
        
        if (this.useAdvancedLoader && this.chunkLoader) {
            this.chunkLoader.dispose();
        }
        
        // Limpiar chunks existentes
        for (const chunk of this.chunks.values()) {
            if (chunk.mesh) {
                this.scene.remove(chunk.mesh);
                chunk.mesh.geometry.dispose();
                chunk.mesh.material.dispose();
            }
        }
        
        this.chunks.clear();
        this.loadedChunks.clear();
    }
}