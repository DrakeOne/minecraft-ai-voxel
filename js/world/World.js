import { config, stats } from '../config.js';
import { ChunkColumn } from './ChunkColumn.js';
import { WorkerManager } from './WorkerManager.js';
import { MemoryManager } from './MemoryManager.js';
import { OptimizedRenderer } from './OptimizedRenderer.js';
import { Logger } from '../utils/Logger.js';

// Sistema de Frustum Culling mejorado con priorización
class FrustumCuller {
    constructor() {
        this.frustum = new THREE.Frustum();
        this.matrix = new THREE.Matrix4();
        this.visibilityCache = new Map();
        this.cacheFrameCount = 0;
        this.CACHE_LIFETIME = 2;
        this.boundingBoxes = new Map();
    }

    update(camera) {
        this.cacheFrameCount++;
        if (this.cacheFrameCount > this.CACHE_LIFETIME) {
            this.visibilityCache.clear();
            this.cacheFrameCount = 0;
        }
        
        this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.matrix);
    }

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
        
        if (!forceCheck && this.visibilityCache.has(key)) {
            return this.visibilityCache.get(key);
        }
        
        const box = this.getChunkBoundingBox(chunkX, chunkZ);
        const isVisible = this.frustum.intersectsBox(box);
        
        this.visibilityCache.set(key, isVisible);
        
        return isVisible;
    }
    
    dispose() {
        this.visibilityCache.clear();
        this.boundingBoxes.clear();
    }
}

// Sistema de priorización de chunks mejorado
class ChunkPrioritySystem {
    constructor() {
        this.priorities = new Map();
        this.loadQueue = [];
        this.lastCameraDirection = new THREE.Vector3();
        this.lastPlayerPos = new THREE.Vector3();
    }
    
    calculatePriority(chunkX, chunkZ, playerPos, cameraDirection, isMoving) {
        const chunkCenterX = chunkX * config.chunkSize + config.chunkSize / 2;
        const chunkCenterZ = chunkZ * config.chunkSize + config.chunkSize / 2;
        
        const dx = chunkCenterX - playerPos.x;
        const dz = chunkCenterZ - playerPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        const toChunk = new THREE.Vector3(dx, 0, dz).normalize();
        
        const viewDot = toChunk.dot(cameraDirection);
        const viewFactor = (viewDot + 1) * 0.5;
        
        let priority = distance / config.chunkSize;
        
        if (viewFactor > 0.8) {
            priority *= 0.1;
        } else if (viewFactor > 0.5) {
            priority *= 0.3;
        } else if (viewFactor > 0) {
            priority *= 0.6;
        } else {
            priority *= 2;
        }
        
        if (distance < config.chunkSize * 2) {
            priority *= 0.1;
        }
        
        if (isMoving) {
            const moveDot = toChunk.dot(isMoving);
            if (moveDot > 0.5) {
                priority *= 0.5;
            }
        }
        
        return priority;
    }
    
    updatePriorities(chunks, playerPos, camera) {
        this.priorities.clear();
        
        const cameraDirection = new THREE.Vector3(0, 0, -1);
        cameraDirection.applyQuaternion(camera.quaternion);
        cameraDirection.y = 0;
        cameraDirection.normalize();
        
        const playerMovement = new THREE.Vector3();
        playerMovement.subVectors(playerPos, this.lastPlayerPos);
        const isMoving = playerMovement.length() > 0.1 ? playerMovement.normalize() : null;
        
        this.lastPlayerPos.copy(playerPos);
        this.lastCameraDirection.copy(cameraDirection);
        
        for (const [chunkX, chunkZ] of chunks) {
            const priority = this.calculatePriority(
                chunkX, chunkZ, 
                playerPos, 
                cameraDirection, 
                isMoving
            );
            this.priorities.set(`${chunkX},${chunkZ}`, priority);
        }
        
        this.loadQueue = Array.from(chunks)
            .sort((a, b) => {
                const keyA = `${a[0]},${a[1]}`;
                const keyB = `${b[0]},${b[1]}`;
                return (this.priorities.get(keyA) || 999) - (this.priorities.get(keyB) || 999);
            });
    }
    
    getNextChunks(count) {
        return this.loadQueue.splice(0, count);
    }
}

// World management - CON OPTIMIZED RENDERER
export class World {
    constructor(scene) {
        this.scene = scene;
        this.chunkColumns = new Map();
        this.loadedChunks = new Set();
        this.loadingChunks = new Set();
        this.frustumCuller = new FrustumCuller();
        this.prioritySystem = new ChunkPrioritySystem();
        this.memoryManager = new MemoryManager();
        
        // NUEVO: Sistema de renderizado optimizado
        this.optimizedRenderer = new OptimizedRenderer(scene);
        this.useOptimizedRenderer = true; // Flag para activar/desactivar
        
        // Control de carga
        this.chunksToLoad = [];
        this.lastUpdateTime = 0;
        this.updateInterval = 50;
        this.maxChunksPerUpdate = 3;
        
        // Worker Manager - REQUERIDO
        this.workerManager = null;
        this.initializeWorkers();
        
        // Seed para generación procedural
        this.seed = Math.floor(Math.random() * 1000000);
        
        Logger.info('[World] World initialized with OptimizedRenderer and Minecraft terrain generator');
    }
    
    initializeWorkers() {
        Logger.info('[World] Initializing Web Workers (required)...');
        
        try {
            this.workerManager = new WorkerManager(this, this.scene);
            
            // Verificar que los workers se inicializaron correctamente
            setTimeout(() => {
                if (this.workerManager && this.workerManager.isEnabled()) {
                    stats.workerStatus = 'enabled';
                    Logger.info('[World] Web Workers enabled - Minecraft terrain ready');
                } else {
                    stats.workerStatus = 'failed';
                    Logger.error('[World] Web Workers failed - Game cannot run without workers');
                    // Mostrar mensaje de error al usuario
                    this.showWorkerError();
                }
            }, 1500);
        } catch (error) {
            Logger.error('[World] Failed to initialize WorkerManager:', error);
            stats.workerStatus = 'failed';
            this.showWorkerError();
        }
    }
    
    showWorkerError() {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255, 0, 0, 0.9);
            color: white;
            padding: 20px;
            border-radius: 10px;
            z-index: 10000;
            text-align: center;
        `;
        errorDiv.innerHTML = `
            <h2>⚠️ Error: Web Workers Required</h2>
            <p>This game requires Web Workers to generate terrain.</p>
            <p>Please use a modern browser that supports Web Workers.</p>
        `;
        document.body.appendChild(errorDiv);
    }

    getChunkKey(x, z) {
        return `${x},${z}`;
    }
    
    getChunkColumn(x, z) {
        const key = this.getChunkKey(x, z);
        if (!this.chunkColumns.has(key)) {
            if (this.memoryManager.canAllocateChunk()) {
                this.chunkColumns.set(key, new ChunkColumn(x, z, this));
                this.memoryManager.registerChunk(key);
            } else {
                Logger.warn('[World] Memory limit reached');
                this.memoryManager.freeOldestChunks(this, 5);
                return null;
            }
        }
        return this.chunkColumns.get(key);
    }

    getBlockAtWorldCoords(worldX, worldY, worldZ) {
        const chunkX = Math.floor(worldX / config.chunkSize);
        const chunkZ = Math.floor(worldZ / config.chunkSize);
        const localX = ((worldX % config.chunkSize) + config.chunkSize) % config.chunkSize;
        const localZ = ((worldZ % config.chunkSize) + config.chunkSize) % config.chunkSize;
        
        const chunkColumn = this.getChunkColumn(chunkX, chunkZ);
        return chunkColumn ? chunkColumn.getBlock(localX, worldY, localZ) : 0;
    }

    updateChunksAroundPlayer(playerX, playerZ, camera, scene) {
        const currentTime = performance.now();
        
        if (currentTime - this.lastUpdateTime < this.updateInterval) {
            this.processChunkQueue();
            return;
        }
        
        this.lastUpdateTime = currentTime;
        
        // Verificar que los workers estén listos
        if (!this.workerManager || !this.workerManager.isEnabled()) {
            return;
        }
        
        this.frustumCuller.update(camera);
        
        const playerChunkX = Math.floor(playerX / config.chunkSize);
        const playerChunkZ = Math.floor(playerZ / config.chunkSize);
        
        // Identificar chunks necesarios
        const requiredChunks = new Map();
        const renderDistSq = config.renderDistance * config.renderDistance;
        
        for (let dx = -config.renderDistance - 1; dx <= config.renderDistance + 1; dx++) {
            for (let dz = -config.renderDistance - 1; dz <= config.renderDistance + 1; dz++) {
                const distSq = dx * dx + dz * dz;
                if (distSq <= renderDistSq + 2) {
                    const chunkX = playerChunkX + dx;
                    const chunkZ = playerChunkZ + dz;
                    const key = this.getChunkKey(chunkX, chunkZ);
                    requiredChunks.set(key, [chunkX, chunkZ]);
                }
            }
        }
        
        // Actualizar prioridades
        const playerPos = new THREE.Vector3(playerX, 0, playerZ);
        this.prioritySystem.updatePriorities(
            Array.from(requiredChunks.values()),
            playerPos,
            camera
        );
        
        // Cargar chunks prioritarios
        this.chunksToLoad = [];
        const chunksToProcess = this.prioritySystem.getNextChunks(999);
        
        for (const [chunkX, chunkZ] of chunksToProcess) {
            const key = this.getChunkKey(chunkX, chunkZ);
            
            if (this.loadedChunks.has(key) || this.loadingChunks.has(key)) {
                continue;
            }
            
            const isVisible = this.frustumCuller.isChunkVisible(chunkX, chunkZ);
            const distance = Math.sqrt(
                Math.pow(chunkX - playerChunkX, 2) + 
                Math.pow(chunkZ - playerChunkZ, 2)
            );
            
            if (isVisible || distance <= 2) {
                this.chunksToLoad.push([chunkX, chunkZ, key]);
            }
        }
        
        this.processChunkQueue();
        this.unloadDistantChunks(playerChunkX, playerChunkZ, requiredChunks);
        
        // NUEVO: Actualizar renderizado optimizado
        if (this.useOptimizedRenderer) {
            this.updateOptimizedRendering();
        }
        
        this.updateStats();
    }
    
    // NUEVO: Método para actualizar el renderizado optimizado
    updateOptimizedRendering() {
        // Comenzar actualización
        this.optimizedRenderer.beginUpdate();
        
        // Procesar todos los chunks cargados
        for (const key of this.loadedChunks) {
            const [chunkX, chunkZ] = key.split(',').map(Number);
            const chunkColumn = this.chunkColumns.get(key);
            
            if (chunkColumn && this.frustumCuller.isChunkVisible(chunkX, chunkZ)) {
                // Procesar cada sub-chunk de la columna
                for (const [subY, subChunk] of chunkColumn.subChunks) {
                    if (!subChunk.isEmpty) {
                        this.addSubChunkToOptimizedRenderer(chunkColumn, subChunk, chunkX, subY, chunkZ);
                    }
                }
            }
        }
        
        // Finalizar actualización y aplicar cambios
        this.optimizedRenderer.endUpdate();
    }
    
    // NUEVO: Añadir sub-chunk al renderer optimizado
    addSubChunkToOptimizedRenderer(chunkColumn, subChunk, chunkX, subY, chunkZ) {
        const size = config.chunkSize;
        const subHeight = config.subChunkHeight;
        const worldX = chunkX * size;
        const worldZ = chunkZ * size;
        const baseY = subY * subHeight;
        
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < subHeight; y++) {
                for (let z = 0; z < size; z++) {
                    const worldY = baseY + y;
                    const index = x + y * size + z * size * subHeight;
                    const blockType = subChunk.blocks[index];
                    
                    if (blockType === 0) continue; // Skip air
                    
                    // Verificar si el bloque es visible
                    if (this.isBlockVisible(chunkColumn, x, worldY, z)) {
                        this.optimizedRenderer.addBlock(
                            blockType,
                            worldX + x,
                            worldY,
                            worldZ + z
                        );
                    }
                }
            }
        }
    }
    
    // NUEVO: Verificar si un bloque es visible
    isBlockVisible(chunkColumn, localX, worldY, localZ) {
        const directions = [
            [1, 0, 0], [-1, 0, 0],
            [0, 1, 0], [0, -1, 0],
            [0, 0, 1], [0, 0, -1]
        ];
        
        for (const [dx, dy, dz] of directions) {
            const nx = localX + dx;
            const ny = worldY + dy;
            const nz = localZ + dz;
            
            // Si está en el borde, considerarlo visible
            if (nx < 0 || nx >= config.chunkSize ||
                ny < 0 || ny >= config.worldHeight ||
                nz < 0 || nz >= config.chunkSize) {
                return true;
            }
            
            // Si el bloque adyacente es aire, es visible
            if (chunkColumn.getBlock(nx, ny, nz) === 0) {
                return true;
            }
        }
        
        return false;
    }
    
    processChunkQueue() {
        const chunksThisFrame = Math.min(
            this.chunksToLoad.length,
            this.getAdaptiveChunkLimit()
        );
        
        for (let i = 0; i < chunksThisFrame; i++) {
            const [chunkX, chunkZ, key] = this.chunksToLoad.shift();
            if (!key) break;
            
            this.loadChunk(chunkX, chunkZ, key);
        }
    }
    
    getAdaptiveChunkLimit() {
        if (stats.fps > 50) return 5;
        if (stats.fps > 40) return 4;
        if (stats.fps > 30) return 3;
        if (stats.fps > 20) return 2;
        return 1;
    }

    loadChunk(cx, cz, key) {
        if (this.loadedChunks.has(key) || this.loadingChunks.has(key)) return;
        
        this.loadingChunks.add(key);
        Logger.debug(`[World] Loading chunk ${key}`);
        
        // Solo generación con workers - sin fallback
        const requested = this.workerManager.requestChunk(cx, cz);
        if (requested) {
            setTimeout(() => {
                this.loadingChunks.delete(key);
                this.loadedChunks.add(key);
            }, 100);
        } else {
            Logger.warn(`[World] Failed to request chunk ${key}`);
            this.loadingChunks.delete(key);
        }
    }

    unloadDistantChunks(playerChunkX, playerChunkZ, requiredChunks) {
        const chunksToUnload = [];
        const maxDistance = config.renderDistance + 3;
        
        for (const key of this.loadedChunks) {
            if (!requiredChunks.has(key)) {
                const [x, z] = key.split(',').map(Number);
                const distance = Math.max(
                    Math.abs(x - playerChunkX), 
                    Math.abs(z - playerChunkZ)
                );
                
                if (distance > maxDistance) {
                    chunksToUnload.push(key);
                }
            }
        }
        
        for (const key of chunksToUnload) {
            this.unloadChunk(key);
        }
    }

    unloadChunk(key) {
        Logger.debug(`[World] Unloading chunk ${key}`);
        
        const chunkColumn = this.chunkColumns.get(key);
        if (chunkColumn) {
            // Si usamos el renderer optimizado, no necesitamos los meshes individuales
            if (!this.useOptimizedRenderer) {
                chunkColumn.dispose(this.scene);
            }
            this.chunkColumns.delete(key);
        }
        
        this.memoryManager.unregisterChunk(key);
        this.loadedChunks.delete(key);
        this.loadingChunks.delete(key);
    }

    updateRenderDistance(newDistance) {
        Logger.info(`[World] Updating render distance to ${newDistance}`);
        config.renderDistance = newDistance;
        this.maxChunksPerUpdate = Math.max(3, Math.min(10, Math.floor(newDistance / 2)));
        this.lastUpdateTime = 0;
    }
    
    updateStats() {
        stats.visibleChunks = this.loadedChunks.size;
        stats.totalChunks = this.chunkColumns.size;
        stats.chunksInQueue = this.chunksToLoad.length;
        stats.chunksProcessing = this.loadingChunks.size;
        
        let visibleInFrustum = 0;
        for (const key of this.loadedChunks) {
            const [x, z] = key.split(',').map(Number);
            if (this.frustumCuller.isChunkVisible(x, z)) {
                visibleInFrustum++;
            }
        }
        
        stats.cullingEfficiency = this.loadedChunks.size > 0 
            ? Math.round((visibleInFrustum / this.loadedChunks.size) * 100)
            : 0;
        
        // NUEVO: Estadísticas del renderer optimizado
        if (this.useOptimizedRenderer) {
            const rendererStats = this.optimizedRenderer.getStats();
            stats.totalInstances = rendererStats.totalInstances;
            stats.drawCalls = rendererStats.meshes;
        }
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
        
        const chunkColumn = this.getChunkColumn(chunkX, chunkZ);
        if (chunkColumn) {
            chunkColumn.setBlock(localX, worldY, localZ, type);
            
            // Si no usamos el renderer optimizado, actualizar meshes normales
            if (!this.useOptimizedRenderer) {
                chunkColumn.updateAllDirtyMeshes(scene);
            }
            
            this.updateNeighborChunks(chunkX, chunkZ, localX, localZ, scene);
            
            // Si usamos el renderer optimizado, forzar actualización
            if (this.useOptimizedRenderer) {
                this.updateOptimizedRendering();
            }
        }
    }
    
    updateNeighborChunks(chunkX, chunkZ, localX, localZ, scene) {
        const updates = [];
        
        if (localX === 0) updates.push([chunkX - 1, chunkZ]);
        if (localX === config.chunkSize - 1) updates.push([chunkX + 1, chunkZ]);
        if (localZ === 0) updates.push([chunkX, chunkZ - 1]);
        if (localZ === config.chunkSize - 1) updates.push([chunkX, chunkZ + 1]);
        
        for (const [cx, cz] of updates) {
            const key = this.getChunkKey(cx, cz);
            if (this.loadedChunks.has(key)) {
                const column = this.chunkColumns.get(key);
                if (column && !this.useOptimizedRenderer) {
                    column.updateAllDirtyMeshes(scene);
                }
            }
        }
    }
    
    // NUEVO: Toggle para activar/desactivar el renderer optimizado
    toggleOptimizedRenderer(enabled) {
        this.useOptimizedRenderer = enabled;
        
        if (enabled) {
            Logger.info('[World] Switching to OptimizedRenderer');
            // Ocultar meshes individuales
            for (const chunkColumn of this.chunkColumns.values()) {
                chunkColumn.hideAllMeshes();
            }
            // Actualizar renderer optimizado
            this.updateOptimizedRendering();
        } else {
            Logger.info('[World] Switching to standard renderer');
            // Ocultar meshes optimizados
            this.optimizedRenderer.beginUpdate();
            this.optimizedRenderer.endUpdate();
            // Mostrar meshes individuales
            for (const chunkColumn of this.chunkColumns.values()) {
                chunkColumn.showAllMeshes();
            }
        }
    }
    
    getStats() {
        const baseStats = {
            chunksLoaded: this.loadedChunks.size,
            chunksLoading: this.loadingChunks.size,
            chunksQueued: this.chunksToLoad.length,
            totalColumns: this.chunkColumns.size,
            workerEnabled: this.workerManager ? this.workerManager.isEnabled() : false,
            workerStats: this.workerManager ? this.workerManager.getStats() : null,
            memory: this.memoryManager.getStats(),
            cullingEfficiency: stats.cullingEfficiency + '%',
            optimizedRenderer: this.useOptimizedRenderer
        };
        
        // Añadir estadísticas del renderer optimizado si está activo
        if (this.useOptimizedRenderer) {
            const rendererStats = this.optimizedRenderer.getStats();
            baseStats.rendererStats = rendererStats;
        }
        
        return baseStats;
    }
    
    dispose() {
        Logger.info('[World] Disposing world resources...');
        
        this.frustumCuller.dispose();
        this.memoryManager.dispose();
        
        // NUEVO: Dispose del renderer optimizado
        if (this.optimizedRenderer) {
            this.optimizedRenderer.dispose();
            this.optimizedRenderer = null;
        }
        
        if (this.workerManager) {
            this.workerManager.dispose();
            this.workerManager = null;
        }
        
        for (const chunkColumn of this.chunkColumns.values()) {
            chunkColumn.dispose(this.scene);
        }
        
        this.chunkColumns.clear();
        this.loadedChunks.clear();
        this.loadingChunks.clear();
        this.chunksToLoad = [];
        
        Logger.info('[World] World resources disposed');
    }
}