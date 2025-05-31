// DEBUG: Agrega logs exhaustivos en cada función clave
import { config } from '../config.js';
import { ChunkPool } from './ChunkPool.js';
import { ChunkPriorityQueue } from './ChunkPriorityQueue.js';
import { SpatialHashGrid } from './SpatialHashGrid.js';
import { WorkerPool } from '../workers/WorkerPool.js';
import { ChunkCache } from './ChunkCache.js';

export class ChunkLoader {
    constructor(world, scene) {
        this.world = world;
        this.scene = scene;
        this.chunkPool = new ChunkPool();
        this.priorityQueue = new ChunkPriorityQueue();
        this.spatialGrid = new SpatialHashGrid(config.chunkSize);
        this.cache = new ChunkCache();
        this.terrainWorkerPool = new WorkerPool('js/workers/TerrainWorker.js', 4);
        this.meshWorkerPool = new WorkerPool('js/workers/MeshWorker.js', 4);
        this.loadingChunks = new Map();
        this.activeChunks = new Map();
        this.lastPlayerPos = { x: 0, z: 0 };
        this.playerVelocity = { x: 0, z: 0 };
        this.maxConcurrentLoads = 8;
        this.maxChunksInMemory = 256;
        this.loadBudgetMs = 16;
        this.predictionDistance = 2;
        this.lastUpdateTime = performance.now();
    }

    async update(playerPos, camera) {
        console.log('[ChunkLoader] update: playerPos=', playerPos, 'camera=', camera);
        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastUpdateTime) / 1000;
        this.lastUpdateTime = currentTime;
        this.updatePlayerVelocity(playerPos, deltaTime);
        const requiredChunks = this.calculateRequiredChunks(playerPos, camera);
        this.updatePriorities(requiredChunks, playerPos, camera);
        await this.processLoadingQueue(currentTime);
        this.unloadDistantChunks(playerPos);
        this.updateSpatialGrid();
    }

    // MÉTODO FALTANTE: Actualizar velocidad del jugador para predicción
    updatePlayerVelocity(playerPos, deltaTime) {
        if (deltaTime > 0) {
            this.playerVelocity.x = (playerPos.x - this.lastPlayerPos.x) / deltaTime;
            this.playerVelocity.z = (playerPos.z - this.lastPlayerPos.z) / deltaTime;
        }
        this.lastPlayerPos.x = playerPos.x;
        this.lastPlayerPos.z = playerPos.z;
    }

    calculateRequiredChunks(playerPos, camera) {
        const chunks = new Set();
        const centerX = Math.floor(playerPos.x / config.chunkSize);
        const centerZ = Math.floor(playerPos.z / config.chunkSize);
        for (let x = -config.renderDistance; x <= config.renderDistance; x++) {
            for (let z = -config.renderDistance; z <= config.renderDistance; z++) {
                const chunkX = centerX + x;
                const chunkZ = centerZ + z;
                const distance = Math.sqrt(x * x + z * z);
                if (distance <= config.renderDistance) {
                    chunks.add(`${chunkX},${chunkZ}`);
                }
            }
        }
        if (this.playerVelocity.x !== 0 || this.playerVelocity.z !== 0) {
            const predictedX = playerPos.x + this.playerVelocity.x * this.predictionDistance;
            const predictedZ = playerPos.z + this.playerVelocity.z * this.predictionDistance;
            const predCenterX = Math.floor(predictedX / config.chunkSize);
            const predCenterZ = Math.floor(predictedZ / config.chunkSize);
            for (let x = -2; x <= 2; x++) {
                for (let z = -2; z <= 2; z++) {
                    chunks.add(`${predCenterX + x},${predCenterZ + z}`);
                }
            }
        }
        console.log('[ChunkLoader] calculateRequiredChunks:', Array.from(chunks));
        return chunks;
    }

    updatePriorities(requiredChunks, playerPos, camera) {
        this.priorityQueue.clear();
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(camera.quaternion);
        forward.y = 0;
        forward.normalize();
        for (const chunkKey of requiredChunks) {
            if (this.activeChunks.has(chunkKey) || this.loadingChunks.has(chunkKey)) {
                continue;
            }
            const [x, z] = chunkKey.split(',').map(Number);
            const chunkCenterX = x * config.chunkSize + config.chunkSize / 2;
            const chunkCenterZ = z * config.chunkSize + config.chunkSize / 2;
            const distance = Math.sqrt(
                Math.pow(chunkCenterX - playerPos.x, 2) + 
                Math.pow(chunkCenterZ - playerPos.z, 2)
            );
            const toChunk = new THREE.Vector3(
                chunkCenterX - playerPos.x,
                0,
                chunkCenterZ - playerPos.z
            ).normalize();
            const dotProduct = forward.dot(toChunk);
            const directionPriority = (dotProduct + 1) / 2;
            const priority = distance * (2 - directionPriority);
            this.priorityQueue.enqueue({
                key: chunkKey,
                x: x,
                z: z,
                priority: priority,
                lod: this.calculateLOD(distance)
            });
            console.log('[ChunkLoader] Enqueue chunk', chunkKey, 'priority:', priority);
        }
    }

    // MÉTODO FALTANTE: Calcular nivel de detalle basado en distancia
    calculateLOD(distance) {
        if (distance < config.chunkSize * 2) return 0; // Full detail
        if (distance < config.chunkSize * 4) return 1; // Medium detail
        return 2; // Low detail
    }

    async processLoadingQueue(currentTime) {
        const frameStart = performance.now();
        let processed = 0;
        while (!this.priorityQueue.isEmpty() && 
               processed < this.maxConcurrentLoads &&
               (performance.now() - frameStart) < this.loadBudgetMs) {
            const chunkInfo = this.priorityQueue.dequeue();
            if (!chunkInfo) break;
            console.log('[ChunkLoader] processLoadingQueue: loading', chunkInfo);
            const cached = await this.cache.get(chunkInfo.key);
            if (cached) {
                this.applyChunkData(chunkInfo, cached);
                processed++;
                continue;
            }
            this.loadChunk(chunkInfo);
            processed++;
        }
    }

    // MÉTODO FALTANTE: Aplicar datos de chunk desde caché
    applyChunkData(chunkInfo, cachedData) {
        console.log('[ChunkLoader] Applying cached chunk data:', chunkInfo.key);
        this.applyMeshData(chunkInfo, cachedData.mesh);
    }

    async loadChunk(chunkInfo) {
        const { key, x, z, lod } = chunkInfo;
        this.loadingChunks.set(key, {
            startTime: performance.now(),
            info: chunkInfo
        });
        console.log('[ChunkLoader] loadChunk:', chunkInfo);
        try {
            const terrainData = await this.terrainWorkerPool.execute({
                x: x,
                z: z,
                chunkSize: config.chunkSize,
                seed: this.world.seed || 12345,
                lod: lod
            });
            console.log('[ChunkLoader] TerrainWorker result for', key, terrainData);
            const meshData = await this.meshWorkerPool.execute({
                terrainData: terrainData.buffer,
                chunkSize: config.chunkSize,
                x: x,
                z: z,
                lod: lod
            }, [terrainData.buffer]);
            console.log('[ChunkLoader] MeshWorker result for', key, meshData);
            this.applyMeshData(chunkInfo, meshData);
            await this.cache.set(key, {
                terrain: meshData.terrain,
                mesh: meshData
            });
            console.log('[ChunkLoader] Cache set:', key);
        } catch (error) {
            console.error('[ChunkLoader] Error loading chunk', key, error);
        } finally {
            this.loadingChunks.delete(key);
        }
    }

    applyMeshData(chunkInfo, meshData) {
        const { key, x, z } = chunkInfo;
        console.log('[ChunkLoader] applyMeshData:', chunkInfo, meshData);
        const chunk = this.chunkPool.acquire();
        chunk.setPosition(x, z);
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
        this.activeChunks.set(key, chunk);
        this.spatialGrid.insert(x, z, chunk);
    }

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
        for (const key of chunksToUnload) {
            const chunk = this.activeChunks.get(key);
            if (chunk) {
                chunk.removeFromScene(this.scene);
                this.chunkPool.release(chunk);
                this.activeChunks.delete(key);
                this.spatialGrid.remove(chunk.worldX, chunk.worldZ);
                console.log('[ChunkLoader] Unload chunk:', key);
            }
        }
        if (this.activeChunks.size > this.maxChunksInMemory) {
            this.performMemoryCleanup();
        }
    }

    // MÉTODO FALTANTE: Limpiar memoria cuando hay demasiados chunks
    performMemoryCleanup() {
        console.log('[ChunkLoader] Performing memory cleanup, chunks:', this.activeChunks.size);
        // Ordenar chunks por distancia y eliminar los más lejanos
        const sortedChunks = Array.from(this.activeChunks.entries())
            .sort((a, b) => {
                const [, chunkA] = a;
                const [, chunkB] = b;
                const distA = Math.sqrt(
                    Math.pow(chunkA.worldX * config.chunkSize - this.lastPlayerPos.x, 2) +
                    Math.pow(chunkA.worldZ * config.chunkSize - this.lastPlayerPos.z, 2)
                );
                const distB = Math.sqrt(
                    Math.pow(chunkB.worldX * config.chunkSize - this.lastPlayerPos.x, 2) +
                    Math.pow(chunkB.worldZ * config.chunkSize - this.lastPlayerPos.z, 2)
                );
                return distB - distA;
            });
        
        // Eliminar chunks hasta estar bajo el límite
        const chunksToRemove = this.activeChunks.size - Math.floor(this.maxChunksInMemory * 0.8);
        for (let i = 0; i < chunksToRemove && i < sortedChunks.length; i++) {
            const [key, chunk] = sortedChunks[i];
            chunk.removeFromScene(this.scene);
            this.chunkPool.release(chunk);
            this.activeChunks.delete(key);
            this.spatialGrid.remove(chunk.worldX, chunk.worldZ);
        }
    }

    // MÉTODO FALTANTE: Actualizar grid espacial
    updateSpatialGrid() {
        // El spatial grid se actualiza automáticamente en insert/remove
        // Este método puede usarse para optimizaciones futuras
    }

    // MÉTODO FALTANTE: Obtener chunk en coordenadas específicas
    getChunkAt(worldX, worldZ) {
        const chunkX = Math.floor(worldX / config.chunkSize);
        const chunkZ = Math.floor(worldZ / config.chunkSize);
        const key = `${chunkX},${chunkZ}`;
        return this.activeChunks.get(key);
    }

    // MÉTODO FALTANTE: Obtener estadísticas
    getStats() {
        return {
            activeChunks: this.activeChunks.size,
            loadingChunks: this.loadingChunks.size,
            queuedChunks: this.priorityQueue.size(),
            poolStats: this.chunkPool.getStats(),
            cacheStats: this.cache.getStats(),
            gridStats: this.spatialGrid.getStats()
        };
    }

    // MÉTODO FALTANTE: Limpiar recursos
    dispose() {
        // Limpiar todos los chunks activos
        for (const [key, chunk] of this.activeChunks) {
            chunk.removeFromScene(this.scene);
            this.chunkPool.release(chunk);
        }
        this.activeChunks.clear();
        this.loadingChunks.clear();
        this.priorityQueue.clear();
        this.spatialGrid.clear();
        
        // Dispose worker pools
        this.terrainWorkerPool.dispose();
        this.meshWorkerPool.dispose();
        
        console.log('[ChunkLoader] Disposed');
    }
}