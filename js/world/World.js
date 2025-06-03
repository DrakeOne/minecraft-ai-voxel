import { config, stats } from '../config.js';
import { Chunk } from './Chunk.js';
import { ChunkColumn } from './ChunkColumn.js';
import { ChunkLoader } from './ChunkLoader.js';
import { WorkerManager } from './WorkerManager.js';

// Frustum Culling Class with prediction
class FrustumCuller {
    constructor() {
        this.frustum = new THREE.Frustum();
        this.matrix = new THREE.Matrix4();
        this.expandedFrustum = new THREE.Frustum(); // For predictive loading
        this.expandedMatrix = new THREE.Matrix4();
    }

    update(camera, expansionFactor = 1.5) {
        // Update normal frustum
        this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.matrix);
        
        // Create expanded frustum for predictive loading
        const expandedCamera = camera.clone();
        expandedCamera.fov = camera.fov * expansionFactor;
        expandedCamera.updateProjectionMatrix();
        this.expandedMatrix.multiplyMatrices(expandedCamera.projectionMatrix, camera.matrixWorldInverse);
        this.expandedFrustum.setFromProjectionMatrix(this.expandedMatrix);
    }

    isChunkVisible(chunkX, chunkZ) {
        const min = new THREE.Vector3(
            chunkX * config.chunkSize - 0.5,
            -0.5,
            chunkZ * config.chunkSize - 0.5
        );
        const max = new THREE.Vector3(
            (chunkX + 1) * config.chunkSize + 0.5,
            config.worldHeight + 0.5,
            (chunkZ + 1) * config.chunkSize + 0.5
        );
        
        const box = new THREE.Box3(min, max);
        return this.frustum.intersectsBox(box);
    }
    
    isChunkInExpandedView(chunkX, chunkZ) {
        const min = new THREE.Vector3(
            chunkX * config.chunkSize - 0.5,
            -0.5,
            chunkZ * config.chunkSize - 0.5
        );
        const max = new THREE.Vector3(
            (chunkX + 1) * config.chunkSize + 0.5,
            config.worldHeight + 0.5,
            (chunkZ + 1) * config.chunkSize + 0.5
        );
        
        const box = new THREE.Box3(min, max);
        return this.expandedFrustum.intersectsBox(box);
    }
}

// World management
export class World {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.chunkColumns = new Map();
        this.loadedChunks = new Set();
        this.frustumCuller = new FrustumCuller();
        
        // Predictive loading
        this.playerVelocity = new THREE.Vector3();
        this.lastPlayerPos = new THREE.Vector3();
        this.chunkLoadQueue = [];
        this.priorityQueue = new Map(); // Priority-based loading
        
        // Performance settings
        this.maxChunksPerFrame = 3; // Limit chunks processed per frame
        this.predictiveDistance = 2; // Chunks to predict ahead
        
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
    
    // NEW: Get chunk column for vertical chunks system
    getChunkColumn(x, z) {
        const key = this.getChunkKey(x, z);
        if (!this.chunkColumns.has(key)) {
            this.chunkColumns.set(key, new ChunkColumn(x, z, this));
        }
        return this.chunkColumns.get(key);
    }

    // Get block from world coordinates (handles cross-chunk queries)
    getBlockAtWorldCoords(worldX, worldY, worldZ) {
        const chunkX = Math.floor(worldX / config.chunkSize);
        const chunkZ = Math.floor(worldZ / config.chunkSize);
        const localX = ((worldX % config.chunkSize) + config.chunkSize) % config.chunkSize;
        const localZ = ((worldZ % config.chunkSize) + config.chunkSize) % config.chunkSize;
        
        // Use chunk columns if workers are enabled
        if (this.workerManager && this.workerManager.isEnabled() && config.features.useWorkers) {
            const chunkColumn = this.getChunkColumn(chunkX, chunkZ);
            return chunkColumn.getBlock(localX, worldY, localZ);
        }
        
        // Fallback to regular chunks
        const chunk = this.getChunk(chunkX, chunkZ);
        return chunk.getBlock(localX, worldY, localZ);
    }

    // Calculate chunk priority based on distance and direction
    calculateChunkPriority(chunkX, chunkZ, playerX, playerZ, playerVelocity) {
        const dx = chunkX * config.chunkSize - playerX;
        const dz = chunkZ * config.chunkSize - playerZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Direction factor - prioritize chunks in movement direction
        let directionBonus = 0;
        if (playerVelocity.length() > 0.1) {
            const chunkDir = new THREE.Vector2(dx, dz).normalize();
            const moveDir = new THREE.Vector2(playerVelocity.x, playerVelocity.z).normalize();
            directionBonus = Math.max(0, chunkDir.dot(moveDir)) * 50;
        }
        
        // Lower priority value = higher priority
        return distance - directionBonus;
    }

    // Predictive chunk loading
    updateChunksWithPrediction(playerPos, playerVelocity, camera) {
        const chunkX = Math.floor(playerPos.x / config.chunkSize);
        const chunkZ = Math.floor(playerPos.z / config.chunkSize);
        
        // Clear priority queue
        this.priorityQueue.clear();
        
        // Calculate extended range based on velocity
        const speed = playerVelocity.length();
        const dynamicRange = config.renderDistance + Math.min(Math.floor(speed / 5), this.predictiveDistance);
        
        // Build priority queue for all chunks in extended range
        for (let x = -dynamicRange; x <= dynamicRange; x++) {
            for (let z = -dynamicRange; z <= dynamicRange; z++) {
                const cx = chunkX + x;
                const cz = chunkZ + z;
                const key = this.getChunkKey(cx, cz);
                
                // Skip if already loaded
                if (this.loadedChunks.has(key)) continue;
                
                // Check if in expanded frustum
                if (!this.frustumCuller.isChunkInExpandedView(cx, cz)) continue;
                
                const priority = this.calculateChunkPriority(cx, cz, playerPos.x, playerPos.z, playerVelocity);
                this.priorityQueue.set(key, { x: cx, z: cz, priority });
            }
        }
        
        // Sort by priority
        const sortedChunks = Array.from(this.priorityQueue.entries())
            .sort((a, b) => a[1].priority - b[1].priority)
            .slice(0, this.maxChunksPerFrame);
        
        // Load highest priority chunks
        for (const [key, chunk] of sortedChunks) {
            this.loadChunk(chunk.x, chunk.z);
        }
    }

    // Load a single chunk
    loadChunk(cx, cz) {
        const key = this.getChunkKey(cx, cz);
        if (this.loadedChunks.has(key)) return;
        
        this.loadedChunks.add(key);
        
        // Use chunk columns if workers are enabled
        if (this.workerManager && this.workerManager.isEnabled() && config.features.useWorkers) {
            // Request async generation for chunk column
            const requested = this.workerManager.requestChunk(cx, cz);
            if (!requested && config.features.fallbackToSync) {
                // Fallback to sync generation
                this.generateChunkColumnSync(cx, cz);
            }
        } else {
            // Regular chunk generation
            const chunk = this.getChunk(cx, cz);
            chunk.updateMesh(this.scene);
        }
    }

    // Sync fallback for chunk column generation
    generateChunkColumnSync(cx, cz) {
        const chunkColumn = this.getChunkColumn(cx, cz);
        // Generate simple terrain for all sub-chunks
        for (let subY = 0; subY < config.verticalChunks; subY++) {
            const baseY = subY * config.subChunkHeight;
            const subChunk = chunkColumn.getOrCreateSubChunk(subY);
            
            // Simple terrain generation for fallback
            if (baseY < 64) {
                for (let x = 0; x < config.chunkSize; x++) {
                    for (let z = 0; z < config.chunkSize; z++) {
                        for (let y = 0; y < config.subChunkHeight; y++) {
                            const worldY = baseY + y;
                            if (worldY < 60) {
                                chunkColumn.setBlock(x, worldY, z, 3); // Stone
                            } else if (worldY === 60) {
                                chunkColumn.setBlock(x, worldY, z, 1); // Grass
                            }
                        }
                    }
                }
            }
        }
        chunkColumn.updateAllDirtyMeshes(this.scene);
    }

    updateChunksAroundPlayer(playerX, playerZ, camera, scene) {
        // NUEVO: Usar el sistema avanzado si está activado
        if (this.useAdvancedLoader && this.chunkLoader) {
            this.chunkLoader.update({ x: playerX, z: playerZ }, camera);
            return;
        }
        
        // Update frustum culling
        this.frustumCuller.update(camera);
        
        // Calculate player velocity for prediction
        const currentPos = new THREE.Vector3(playerX, 0, playerZ);
        this.playerVelocity.subVectors(currentPos, this.lastPlayerPos);
        this.lastPlayerPos.copy(currentPos);
        
        // Use predictive loading
        this.updateChunksWithPrediction(currentPos, this.playerVelocity, camera);
        
        const chunkX = Math.floor(playerX / config.chunkSize);
        const chunkZ = Math.floor(playerZ / config.chunkSize);
        const newLoadedChunks = new Set();

        // Keep chunks within render distance
        for (let x = -config.renderDistance; x <= config.renderDistance; x++) {
            for (let z = -config.renderDistance; z <= config.renderDistance; z++) {
                const cx = chunkX + x;
                const cz = chunkZ + z;
                const key = this.getChunkKey(cx, cz);
                
                // Always keep chunks in render distance
                if (this.loadedChunks.has(key)) {
                    newLoadedChunks.add(key);
                }
                
                // Load visible chunks not yet loaded
                if (!this.loadedChunks.has(key) && this.frustumCuller.isChunkVisible(cx, cz)) {
                    this.loadChunk(cx, cz);
                    newLoadedChunks.add(key);
                }
            }
        }

        // Unload chunks outside render distance
        for (const key of this.loadedChunks) {
            if (!newLoadedChunks.has(key)) {
                const [x, z] = key.split(',').map(Number);
                const distance = Math.max(Math.abs(x - chunkX), Math.abs(z - chunkZ));
                
                // Keep a buffer zone to prevent constant loading/unloading
                if (distance > config.renderDistance + 2) {
                    this.unloadChunk(key);
                }
            }
        }

        this.loadedChunks = newLoadedChunks;
        
        // Update stats for debugging
        stats.visibleChunks = newLoadedChunks.size;
        stats.totalChunks = (config.renderDistance * 2 + 1) * (config.renderDistance * 2 + 1);
    }

    // Unload a chunk
    unloadChunk(key) {
        // Unload chunk columns if using workers
        if (this.workerManager && this.workerManager.isEnabled() && config.features.useWorkers) {
            const chunkColumn = this.chunkColumns.get(key);
            if (chunkColumn) {
                chunkColumn.dispose(this.scene);
                this.chunkColumns.delete(key);
            }
        } else {
            // Unload regular chunks
            const chunk = this.chunks.get(key);
            if (chunk && chunk.mesh) {
                this.scene.remove(chunk.mesh);
                chunk.mesh.geometry.dispose();
                chunk.mesh.material.dispose();
                chunk.mesh = null;
            }
        }
        this.loadedChunks.delete(key);
    }

    // NEW: Method to dynamically update render distance
    updateRenderDistance(newDistance) {
        console.log('[World] Updating render distance from', config.renderDistance, 'to', newDistance);
        
        const oldDistance = config.renderDistance;
        config.renderDistance = newDistance;
        
        // If using advanced loader, update it
        if (this.useAdvancedLoader && this.chunkLoader) {
            console.log('[World] Advanced loader will update on next cycle');
            return;
        }
        
        // Update max chunks per frame based on render distance
        this.maxChunksPerFrame = Math.max(3, Math.min(10, Math.floor(newDistance / 2)));
        
        // Force immediate chunk update
        const playerX = window.player ? window.player.position.x : 0;
        const playerZ = window.player ? window.player.position.z : 0;
        this.updateChunksAroundPlayer(playerX, playerZ, this.scene._camera || camera, this.scene);
        
        console.log('[World] Render distance update complete');
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
        
        // Use chunk columns if workers are enabled
        if (this.workerManager && this.workerManager.isEnabled() && config.features.useWorkers) {
            const chunkColumn = this.getChunkColumn(chunkX, chunkZ);
            chunkColumn.setBlock(localX, worldY, localZ, type);
            chunkColumn.updateAllDirtyMeshes(scene);
            
            // Update neighboring chunk columns if on boundary
            const columnsToUpdate = new Set();
            
            if (localX === 0) columnsToUpdate.add(this.getChunkColumn(chunkX - 1, chunkZ));
            if (localX === config.chunkSize - 1) columnsToUpdate.add(this.getChunkColumn(chunkX + 1, chunkZ));
            if (localZ === 0) columnsToUpdate.add(this.getChunkColumn(chunkX, chunkZ - 1));
            if (localZ === config.chunkSize - 1) columnsToUpdate.add(this.getChunkColumn(chunkX, chunkZ + 1));
            
            columnsToUpdate.forEach(column => {
                if (column && this.loadedChunks.has(this.getChunkKey(column.x, column.z))) {
                    column.updateAllDirtyMeshes(scene);
                }
            });
        } else {
            // Regular chunk system
            const chunk = this.getChunk(chunkX, chunkZ);
            chunk.setBlock(localX, worldY, localZ, type);
            chunk.updateMesh(scene);
            
            // Update all potentially affected adjacent chunks
            const chunksToUpdate = new Set();
            
            if (localX === 0) chunksToUpdate.add(this.getChunk(chunkX - 1, chunkZ));
            if (localX === config.chunkSize - 1) chunksToUpdate.add(this.getChunk(chunkX + 1, chunkZ));
            if (localZ === 0) chunksToUpdate.add(this.getChunk(chunkX, chunkZ - 1));
            if (localZ === config.chunkSize - 1) chunksToUpdate.add(this.getChunk(chunkX, chunkZ + 1));
            
            chunksToUpdate.forEach(chunk => {
                if (chunk && this.loadedChunks.has(this.getChunkKey(chunk.x, chunk.z))) {
                    chunk.updateMesh(scene);
                }
            });
        }
    }
    
    // NUEVO: Obtener estadísticas del sistema
    getStats() {
        const baseStats = {
            chunksLoaded: this.loadedChunks.size,
            totalChunks: this.chunks.size,
            totalChunkColumns: this.chunkColumns.size,
            workerEnabled: this.workerManager ? this.workerManager.isEnabled() : false,
            queueSize: this.priorityQueue.size,
            maxChunksPerFrame: this.maxChunksPerFrame
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
        
        // Limpiar chunk columns
        for (const chunkColumn of this.chunkColumns.values()) {
            chunkColumn.dispose(this.scene);
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
        this.chunkColumns.clear();
        this.loadedChunks.clear();
        this.priorityQueue.clear();
    }
}