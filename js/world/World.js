import { config, stats } from '../config.js';
import { Chunk } from './Chunk.js';
import { ChunkColumn } from './ChunkColumn.js';
import { ChunkLoader } from './ChunkLoader.js';
import { WorkerManager } from './WorkerManager.js';
import { MemoryManager } from './MemoryManager.js';
import { Logger } from '../utils/Logger.js';

// Frustum Culling Class - OPTIMIZADO Y PERFECCIONADO
class FrustumCuller {
    constructor() {
        this.frustum = new THREE.Frustum();
        this.matrix = new THREE.Matrix4();
        this.expandedFrustum = new THREE.Frustum();
        this.expandedMatrix = new THREE.Matrix4();
        
        // Cache para evitar recálculos
        this.visibilityCache = new Map();
        this.cacheFrameCount = 0;
        this.CACHE_LIFETIME = 5; // Frames antes de recalcular
        
        // Bounding boxes pre-calculadas
        this.boundingBoxes = new Map();
    }

    update(camera, expansionFactor = 1.5) {
        // Limpiar cache cada N frames
        this.cacheFrameCount++;
        if (this.cacheFrameCount > this.CACHE_LIFETIME) {
            this.visibilityCache.clear();
            this.cacheFrameCount = 0;
        }
        
        // Update normal frustum
        this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.matrix);
        
        // Create expanded frustum for predictive loading
        const expandedCamera = camera.clone();
        expandedCamera.fov = Math.min(camera.fov * expansionFactor, 120); // Limitar expansión
        expandedCamera.updateProjectionMatrix();
        this.expandedMatrix.multiplyMatrices(expandedCamera.projectionMatrix, camera.matrixWorldInverse);
        this.expandedFrustum.setFromProjectionMatrix(this.expandedMatrix);
    }

    // Obtener o crear bounding box para un chunk
    getChunkBoundingBox(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        
        if (!this.boundingBoxes.has(key)) {
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
            
            this.boundingBoxes.set(key, new THREE.Box3(min, max));
        }
        
        return this.boundingBoxes.get(key);
    }

    isChunkVisible(chunkX, chunkZ, forceCheck = false) {
        const key = `${chunkX},${chunkZ}`;
        
        // Usar cache si existe y no se fuerza el chequeo
        if (!forceCheck && this.visibilityCache.has(key)) {
            return this.visibilityCache.get(key);
        }
        
        const box = this.getChunkBoundingBox(chunkX, chunkZ);
        const isVisible = this.frustum.intersectsBox(box);
        
        // Guardar en cache
        this.visibilityCache.set(key, isVisible);
        
        return isVisible;
    }
    
    isChunkInExpandedView(chunkX, chunkZ) {
        const box = this.getChunkBoundingBox(chunkX, chunkZ);
        return this.expandedFrustum.intersectsBox(box);
    }
    
    // Método optimizado para chequear múltiples chunks
    filterVisibleChunks(chunks, forceCheck = false) {
        return chunks.filter(([x, z]) => this.isChunkVisible(x, z, forceCheck));
    }
    
    // Limpiar recursos
    dispose() {
        this.visibilityCache.clear();
        this.boundingBoxes.clear();
    }
}

// World management - OPTIMIZADO
export class World {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.chunkColumns = new Map();
        this.loadedChunks = new Set();
        this.frustumCuller = new FrustumCuller();
        
        // Sistema de gestión de memoria
        this.memoryManager = new MemoryManager();
        
        // Predictive loading
        this.playerVelocity = new THREE.Vector3();
        this.lastPlayerPos = new THREE.Vector3();
        this.chunkLoadQueue = [];
        this.priorityQueue = new Map();
        
        // Performance settings
        this.maxChunksPerFrame = config.performance.maxChunksPerFrame || 3;
        this.predictiveDistance = config.performance.predictiveDistance || 2;
        
        // Estadísticas de frustum culling
        this.cullingStats = {
            totalChecked: 0,
            totalCulled: 0,
            efficiency: 0
        };
        
        // NUEVO: Sistema avanzado de carga de chunks
        this.useAdvancedLoader = config.features.useAdvancedLoader;
        if (this.useAdvancedLoader) {
            this.chunkLoader = new ChunkLoader(this, scene);
        }
        
        // NUEVO: Worker Manager para generación asíncrona
        this.workerManager = null;
        if (config.features.useWorkers) {
            Logger.info('[World] Attempting to initialize Web Workers...');
            try {
                this.workerManager = new WorkerManager(this, scene);
                
                setTimeout(() => {
                    if (this.workerManager && this.workerManager.isEnabled()) {
                        stats.workerStatus = 'enabled';
                        Logger.info('[World] Web Workers enabled successfully');
                    } else {
                        stats.workerStatus = 'disabled';
                        Logger.info('[World] Web Workers disabled or failed to initialize');
                        config.features.useWorkers = false;
                    }
                }, 1500);
            } catch (error) {
                Logger.error('[World] Failed to initialize WorkerManager:', error);
                config.features.useWorkers = false;
                stats.workerStatus = 'failed';
            }
        }
        
        // Seed para generación procedural
        this.seed = Math.floor(Math.random() * 1000000);
        
        Logger.info('[World] World initialized with frustum culling and memory management');
    }

    getChunkKey(x, z) {
        return `${x},${z}`;
    }

    getChunk(x, z) {
        const key = this.getChunkKey(x, z);
        if (!this.chunks.has(key)) {
            // Verificar límite de memoria antes de crear nuevo chunk
            if (this.memoryManager.canAllocateChunk()) {
                this.chunks.set(key, new Chunk(x, z, this));
                this.memoryManager.registerChunk(key);
            } else {
                Logger.warn('[World] Memory limit reached, cannot create new chunk');
                // Intentar liberar memoria
                this.memoryManager.freeOldestChunks(this, 5);
                return null;
            }
        }
        return this.chunks.get(key);
    }
    
    // NEW: Get chunk column for vertical chunks system
    getChunkColumn(x, z) {
        const key = this.getChunkKey(x, z);
        if (!this.chunkColumns.has(key)) {
            if (this.memoryManager.canAllocateChunk()) {
                this.chunkColumns.set(key, new ChunkColumn(x, z, this));
                this.memoryManager.registerChunk(key);
            } else {
                Logger.warn('[World] Memory limit reached, cannot create new chunk column');
                return null;
            }
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
            return chunkColumn ? chunkColumn.getBlock(localX, worldY, localZ) : 0;
        }
        
        // Fallback to regular chunks
        const chunk = this.getChunk(chunkX, chunkZ);
        return chunk ? chunk.getBlock(localX, worldY, localZ) : 0;
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

    // OPTIMIZADO: Actualización de chunks con frustum culling perfeccionado
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
        
        const chunkX = Math.floor(playerX / config.chunkSize);
        const chunkZ = Math.floor(playerZ / config.chunkSize);
        
        // Estadísticas de culling
        this.cullingStats.totalChecked = 0;
        this.cullingStats.totalCulled = 0;
        
        // PASO 1: Identificar chunks que deben estar cargados
        const chunksToLoad = [];
        const chunksInRange = new Set();
        
        // Iterar sobre chunks en rango de render
        for (let x = -config.renderDistance; x <= config.renderDistance; x++) {
            for (let z = -config.renderDistance; z <= config.renderDistance; z++) {
                const cx = chunkX + x;
                const cz = chunkZ + z;
                const key = this.getChunkKey(cx, cz);
                
                this.cullingStats.totalChecked++;
                
                // FRUSTUM CULLING APLICADO CORRECTAMENTE
                const isVisible = this.frustumCuller.isChunkVisible(cx, cz);
                const isInExpandedView = this.frustumCuller.isChunkInExpandedView(cx, cz);
                
                if (!isVisible && !isInExpandedView) {
                    this.cullingStats.totalCulled++;
                    // Si el chunk no es visible y no está en vista expandida, skip
                    if (this.loadedChunks.has(key)) {
                        // Mantener chunks cercanos aunque no sean visibles
                        const distance = Math.max(Math.abs(cx - chunkX), Math.abs(cz - chunkZ));
                        if (distance <= 2) {
                            chunksInRange.add(key);
                        }
                    }
                    continue;
                }
                
                chunksInRange.add(key);
                
                // Si el chunk es visible y no está cargado, agregarlo a la cola
                if (isVisible && !this.loadedChunks.has(key)) {
                    const priority = this.calculateChunkPriority(cx, cz, playerX, playerZ, this.playerVelocity);
                    chunksToLoad.push({ x: cx, z: cz, key, priority });
                }
            }
        }
        
        // Calcular eficiencia del culling
        this.cullingStats.efficiency = this.cullingStats.totalCulled / Math.max(1, this.cullingStats.totalChecked);
        
        // PASO 2: Cargar chunks por prioridad
        chunksToLoad.sort((a, b) => a.priority - b.priority);
        const chunksToLoadThisFrame = chunksToLoad.slice(0, this.maxChunksPerFrame);
        
        for (const chunk of chunksToLoadThisFrame) {
            this.loadChunk(chunk.x, chunk.z);
            this.loadedChunks.add(chunk.key);
        }
        
        // PASO 3: Descargar chunks fuera de rango o no visibles
        const chunksToUnload = [];
        for (const key of this.loadedChunks) {
            if (!chunksInRange.has(key)) {
                const [x, z] = key.split(',').map(Number);
                const distance = Math.max(Math.abs(x - chunkX), Math.abs(z - chunkZ));
                
                // Mantener un buffer para evitar carga/descarga constante
                if (distance > config.renderDistance + 2) {
                    chunksToUnload.push(key);
                }
            }
        }
        
        // Descargar chunks
        for (const key of chunksToUnload) {
            this.unloadChunk(key);
            this.loadedChunks.delete(key);
        }
        
        // Update stats
        stats.visibleChunks = this.loadedChunks.size;
        stats.totalChunks = this.cullingStats.totalChecked;
        stats.culledChunks = this.cullingStats.totalCulled;
        stats.cullingEfficiency = Math.round(this.cullingStats.efficiency * 100);
        
        // Log culling stats solo en modo debug
        Logger.debug(`[World] Frustum Culling: ${stats.culledChunks}/${stats.totalChunks} chunks culled (${stats.cullingEfficiency}% efficiency)`);
    }

    // Load a single chunk
    loadChunk(cx, cz) {
        const key = this.getChunkKey(cx, cz);
        if (this.loadedChunks.has(key)) return;
        
        Logger.debug(`[World] Loading chunk ${key}`);
        
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
            if (chunk) {
                chunk.updateMesh(this.scene);
                this.memoryManager.updateChunkAccess(key);
            }
        }
    }

    // Sync fallback for chunk column generation
    generateChunkColumnSync(cx, cz) {
        const chunkColumn = this.getChunkColumn(cx, cz);
        if (!chunkColumn) return;
        
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

    // Unload a chunk
    unloadChunk(key) {
        Logger.debug(`[World] Unloading chunk ${key}`);
        
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
        
        this.memoryManager.unregisterChunk(key);
        this.loadedChunks.delete(key);
    }

    // NEW: Method to dynamically update render distance
    updateRenderDistance(newDistance) {
        Logger.info(`[World] Updating render distance from ${config.renderDistance} to ${newDistance}`);
        
        const oldDistance = config.renderDistance;
        config.renderDistance = newDistance;
        
        // If using advanced loader, update it
        if (this.useAdvancedLoader && this.chunkLoader) {
            Logger.debug('[World] Advanced loader will update on next cycle');
            return;
        }
        
        // Update max chunks per frame based on render distance
        this.maxChunksPerFrame = Math.max(3, Math.min(10, Math.floor(newDistance / 2)));
        
        // Force immediate chunk update
        const playerX = window.player ? window.player.position.x : 0;
        const playerZ = window.player ? window.player.position.z : 0;
        this.updateChunksAroundPlayer(playerX, playerZ, this.scene._camera || camera, this.scene);
        
        Logger.info('[World] Render distance update complete');
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
            if (chunkColumn) {
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
            }
        } else {
            // Regular chunk system
            const chunk = this.getChunk(chunkX, chunkZ);
            if (chunk) {
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
    }
    
    // NUEVO: Obtener estadísticas del sistema
    getStats() {
        const baseStats = {
            chunksLoaded: this.loadedChunks.size,
            totalChunks: this.chunks.size,
            totalChunkColumns: this.chunkColumns.size,
            workerEnabled: this.workerManager ? this.workerManager.isEnabled() : false,
            queueSize: this.priorityQueue.size,
            maxChunksPerFrame: this.maxChunksPerFrame,
            frustumCulling: {
                checked: this.cullingStats.totalChecked,
                culled: this.cullingStats.totalCulled,
                efficiency: `${Math.round(this.cullingStats.efficiency * 100)}%`
            },
            memory: this.memoryManager.getStats()
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
        Logger.info('[World] Disposing world resources...');
        
        // Dispose frustum culler
        this.frustumCuller.dispose();
        
        // Dispose memory manager
        this.memoryManager.dispose();
        
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
        
        Logger.info('[World] World resources disposed');
    }
}