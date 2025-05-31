import { config } from '../config.js';
import { ChunkPool } from './ChunkPool.js';
import { ChunkPriorityQueue } from './ChunkPriorityQueue.js';
import { SpatialHashGrid } from './SpatialHashGrid.js';
import { WorkerPool } from '../workers/WorkerPool.js';
import { ChunkCache } from './ChunkCache.js';

/**
 * Advanced Chunk Loading System for Three.js
 * Features: Priority loading, predictive streaming, worker parallelization
 */
export class ChunkLoader {
    constructor(world, scene) {
        this.world = world;
        this.scene = scene;
        
        // Core systems
        this.chunkPool = new ChunkPool();
        this.priorityQueue = new ChunkPriorityQueue();
        this.spatialGrid = new SpatialHashGrid(config.chunkSize);
        this.cache = new ChunkCache();
        
        // Worker pools
        this.terrainWorkerPool = new WorkerPool('js/workers/TerrainWorker.js', 4);
        this.meshWorkerPool = new WorkerPool('js/workers/MeshWorker.js', 4);
        
        // State tracking
        this.loadingChunks = new Map();
        this.activeChunks = new Map();
        this.lastPlayerPos = { x: 0, z: 0 };
        this.playerVelocity = { x: 0, z: 0 };
        
        // Performance settings
        this.maxConcurrentLoads = 8;
        this.maxChunksInMemory = 256;
        this.loadBudgetMs = 16; // Max ms per frame for loading
        
        // Predictive loading
        this.predictionDistance = 2; // Chunks ahead to predict
        this.lastUpdateTime = performance.now();
    }

    /**
     * Main update loop - called each frame
     */
    async update(playerPos, camera) {
        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastUpdateTime) / 1000;
        this.lastUpdateTime = currentTime;
        
        // Update player velocity for prediction
        this.updatePlayerVelocity(playerPos, deltaTime);
        
        // Calculate visible and predicted chunks
        const requiredChunks = this.calculateRequiredChunks(playerPos, camera);
        
        // Update priority queue
        this.updatePriorities(requiredChunks, playerPos, camera);
        
        // Process loading queue with frame budget
        await this.processLoadingQueue(currentTime);
        
        // Unload distant chunks
        this.unloadDistantChunks(playerPos);
        
        // Update spatial grid
        this.updateSpatialGrid();
    }

    /**
     * Calculate which chunks are needed based on position and prediction
     */
    calculateRequiredChunks(playerPos, camera) {
        const chunks = new Set();
        
        // Current position chunks
        const centerX = Math.floor(playerPos.x / config.chunkSize);
        const centerZ = Math.floor(playerPos.z / config.chunkSize);
        
        // Add visible chunks
        for (let x = -config.renderDistance; x <= config.renderDistance; x++) {
            for (let z = -config.renderDistance; z <= config.renderDistance; z++) {
                const chunkX = centerX + x;
                const chunkZ = centerZ + z;
                
                // Distance check
                const distance = Math.sqrt(x * x + z * z);
                if (distance <= config.renderDistance) {
                    chunks.add(`${chunkX},${chunkZ}`);
                }
            }
        }
        
        // Add predicted chunks based on velocity
        if (this.playerVelocity.x !== 0 || this.playerVelocity.z !== 0) {
            const predictedX = playerPos.x + this.playerVelocity.x * this.predictionDistance;
            const predictedZ = playerPos.z + this.playerVelocity.z * this.predictionDistance;
            
            const predCenterX = Math.floor(predictedX / config.chunkSize);
            const predCenterZ = Math.floor(predictedZ / config.chunkSize);
            
            // Add predicted area (smaller radius)
            for (let x = -2; x <= 2; x++) {
                for (let z = -2; z <= 2; z++) {
                    chunks.add(`${predCenterX + x},${predCenterZ + z}`);
                }
            }
        }
        
        return chunks;
    }

    /**
     * Update priority queue with chunk loading priorities
     */
    updatePriorities(requiredChunks, playerPos, camera) {
        this.priorityQueue.clear();
        
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(camera.quaternion);
        forward.y = 0;
        forward.normalize();
        
        for (const chunkKey of requiredChunks) {
            // Skip if already loaded or loading
            if (this.activeChunks.has(chunkKey) || this.loadingChunks.has(chunkKey)) {
                continue;
            }
            
            const [x, z] = chunkKey.split(',').map(Number);
            const chunkCenterX = x * config.chunkSize + config.chunkSize / 2;
            const chunkCenterZ = z * config.chunkSize + config.chunkSize / 2;
            
            // Calculate priority factors
            const distance = Math.sqrt(
                Math.pow(chunkCenterX - playerPos.x, 2) + 
                Math.pow(chunkCenterZ - playerPos.z, 2)
            );
            
            // Direction priority (chunks in view direction load first)
            const toChunk = new THREE.Vector3(
                chunkCenterX - playerPos.x,
                0,
                chunkCenterZ - playerPos.z
            ).normalize();
            const dotProduct = forward.dot(toChunk);
            const directionPriority = (dotProduct + 1) / 2; // 0 to 1
            
            // Combined priority (lower is better)
            const priority = distance * (2 - directionPriority);
            
            this.priorityQueue.enqueue({
                key: chunkKey,
                x: x,
                z: z,
                priority: priority,
                lod: this.calculateLOD(distance)
            });
        }
    }

    /**
     * Process loading queue with frame time budget
     */
    async processLoadingQueue(currentTime) {
        const frameStart = performance.now();
        let processed = 0;
        
        while (!this.priorityQueue.isEmpty() && 
               processed < this.maxConcurrentLoads &&
               (performance.now() - frameStart) < this.loadBudgetMs) {
            
            const chunkInfo = this.priorityQueue.dequeue();
            if (!chunkInfo) break;
            
            // Check cache first
            const cached = await this.cache.get(chunkInfo.key);
            if (cached) {
                this.applyChunkData(chunkInfo, cached);
                processed++;
                continue;
            }
            
            // Start async loading
            this.loadChunk(chunkInfo);
            processed++;
        }
    }

    /**
     * Load chunk asynchronously using workers
     */
    async loadChunk(chunkInfo) {
        const { key, x, z, lod } = chunkInfo;
        
        // Mark as loading
        this.loadingChunks.set(key, {
            startTime: performance.now(),
            info: chunkInfo
        });
        
        try {
            // Generate terrain in worker
            const terrainData = await this.terrainWorkerPool.execute({
                x: x,
                z: z,
                chunkSize: config.chunkSize,
                seed: this.world.seed || 12345,
                lod: lod
            });
            
            // Generate mesh in worker
            const meshData = await this.meshWorkerPool.execute({
                terrainData: terrainData.buffer,
                chunkSize: config.chunkSize,
                x: x,
                z: z,
                lod: lod
            }, [terrainData.buffer]); // Transfer ownership
            
            // Apply to scene
            this.applyMeshData(chunkInfo, meshData);
            
            // Cache the result
            await this.cache.set(key, {
                terrain: meshData.terrain,
                mesh: meshData
            });
            
        } catch (error) {
            console.error(`Failed to load chunk ${key}:`, error);
        } finally {
            this.loadingChunks.delete(key);
        }
    }

    /**
     * Apply mesh data to scene
     */
    applyMeshData(chunkInfo, meshData) {
        const { key, x, z } = chunkInfo;
        
        // Get chunk from pool
        const chunk = this.chunkPool.acquire();
        chunk.setPosition(x, z);
        
        // Create geometry from mesh data
        const geometry = new THREE.BufferGeometry();
        
        if (meshData.vertices.length > 0) {
            geometry.setAttribute('position', 
                new THREE.Float32BufferAttribute(meshData.vertices, 3));
            geometry.setAttribute('normal', 
                new THREE.Float32BufferAttribute(meshData.normals, 3));
            geometry.setAttribute('color', 
                new THREE.Float32BufferAttribute(meshData.colors, 3));
            geometry.setIndex(new THREE.Uint32BufferAttribute(meshData.indices, 1));
            
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
        }
        
        chunk.setGeometry(geometry);
        chunk.addToScene(this.scene);
        
        // Track active chunk
        this.activeChunks.set(key, chunk);
        
        // Update spatial grid
        this.spatialGrid.insert(x, z, chunk);
    }

    /**
     * Unload chunks that are too far away
     */
    unloadDistantChunks(playerPos) {
        const maxDistance = (config.renderDistance + 2) * config.chunkSize;
        const chunksToUnload = [];
        
        for (const [key, chunk] of this.activeChunks) {
            const distance = Math.sqrt(
                Math.pow(chunk.worldX * config.chunkSize - playerPos.x, 2) +
                Math.pow(chunk.worldZ * config.chunkSize - playerPos.z, 2)
            );
            
            if (distance > maxDistance) {
                chunksToUnload.push(key);
            }
        }
        
        // Unload chunks
        for (const key of chunksToUnload) {
            const chunk = this.activeChunks.get(key);
            if (chunk) {
                chunk.removeFromScene(this.scene);
                this.chunkPool.release(chunk);
                this.activeChunks.delete(key);
                this.spatialGrid.remove(chunk.worldX, chunk.worldZ);
            }
        }
        
        // Memory pressure check
        if (this.activeChunks.size > this.maxChunksInMemory) {
            this.performMemoryCleanup();
        }
    }

    /**
     * Calculate LOD level based on distance
     */
    calculateLOD(distance) {
        if (distance < config.chunkSize * 2) return 0; // Full detail
        if (distance < config.chunkSize * 4) return 1; // Medium detail
        if (distance < config.chunkSize * 6) return 2; // Low detail
        return 3; // Very low detail
    }

    /**
     * Update player velocity for predictive loading
     */
    updatePlayerVelocity(playerPos, deltaTime) {
        if (deltaTime > 0) {
            this.playerVelocity.x = (playerPos.x - this.lastPlayerPos.x) / deltaTime;
            this.playerVelocity.z = (playerPos.z - this.lastPlayerPos.z) / deltaTime;
        }
        
        this.lastPlayerPos.x = playerPos.x;
        this.lastPlayerPos.z = playerPos.z;
    }

    /**
     * Update spatial grid for fast lookups
     */
    updateSpatialGrid() {
        // Grid updates itself as chunks are added/removed
        // This method can be used for periodic cleanup
        this.spatialGrid.cleanup();
    }

    /**
     * Perform memory cleanup when pressure is high
     */
    performMemoryCleanup() {
        // Sort chunks by distance and unload furthest
        const sortedChunks = Array.from(this.activeChunks.entries())
            .sort((a, b) => {
                const distA = Math.sqrt(
                    Math.pow(a[1].worldX * config.chunkSize - this.lastPlayerPos.x, 2) +
                    Math.pow(a[1].worldZ * config.chunkSize - this.lastPlayerPos.z, 2)
                );
                const distB = Math.sqrt(
                    Math.pow(b[1].worldX * config.chunkSize - this.lastPlayerPos.x, 2) +
                    Math.pow(b[1].worldZ * config.chunkSize - this.lastPlayerPos.z, 2)
                );
                return distB - distA;
            });
        
        // Unload furthest chunks until under limit
        const toUnload = sortedChunks.slice(0, 
            this.activeChunks.size - this.maxChunksInMemory + 10);
        
        for (const [key, chunk] of toUnload) {
            chunk.removeFromScene(this.scene);
            this.chunkPool.release(chunk);
            this.activeChunks.delete(key);
            this.spatialGrid.remove(chunk.worldX, chunk.worldZ);
        }
    }

    /**
     * Get chunk at world position
     */
    getChunkAt(worldX, worldZ) {
        const chunkX = Math.floor(worldX / config.chunkSize);
        const chunkZ = Math.floor(worldZ / config.chunkSize);
        return this.spatialGrid.get(chunkX, chunkZ);
    }

    /**
     * Cleanup and dispose
     */
    dispose() {
        // Stop all workers
        this.terrainWorkerPool.terminate();
        this.meshWorkerPool.terminate();
        
        // Clear all chunks
        for (const [key, chunk] of this.activeChunks) {
            chunk.removeFromScene(this.scene);
            this.chunkPool.release(chunk);
        }
        
        this.activeChunks.clear();
        this.loadingChunks.clear();
        this.cache.clear();
    }
}