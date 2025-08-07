import { config, stats } from '../config.js';
import { Chunk } from './Chunk.js';
import { ChunkColumn } from './ChunkColumn.js';
import { ChunkLoader } from './ChunkLoader.js';
import { WorkerManager } from './WorkerManager.js';
import { MemoryManager } from './MemoryManager.js';
import { Logger } from '../utils/Logger.js';

// Sistema de Frustum Culling mejorado con priorización
class FrustumCuller {
    constructor() {
        this.frustum = new THREE.Frustum();
        this.matrix = new THREE.Matrix4();
        this.visibilityCache = new Map();
        this.cacheFrameCount = 0;
        this.CACHE_LIFETIME = 2; // Reducido para respuesta más rápida
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
        
        // Distancia al jugador
        const dx = chunkCenterX - playerPos.x;
        const dz = chunkCenterZ - playerPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Dirección hacia el chunk
        const toChunk = new THREE.Vector3(dx, 0, dz).normalize();
        
        // Factor de dirección de vista (más importante)
        const viewDot = toChunk.dot(cameraDirection);
        const viewFactor = (viewDot + 1) * 0.5; // 0 a 1
        
        // Prioridad base por distancia (invertida para que menor = mejor)
        let priority = distance / config.chunkSize;
        
        // CRÍTICO: Chunks directamente en frente tienen máxima prioridad
        if (viewFactor > 0.8) {
            priority *= 0.1; // 90% reducción para chunks al frente
        } else if (viewFactor > 0.5) {
            priority *= 0.3; // 70% reducción para chunks semi-frontales
        } else if (viewFactor > 0) {
            priority *= 0.6; // 40% reducción para chunks laterales
        } else {
            priority *= 2; // Penalización para chunks detrás
        }
        
        // Bonus para chunks muy cercanos (radio 2)
        if (distance < config.chunkSize * 2) {
            priority *= 0.1; // Máxima prioridad para chunks inmediatos
        }
        
        // Si el jugador se mueve, priorizar la dirección de movimiento
        if (isMoving) {
            const moveDot = toChunk.dot(isMoving);
            if (moveDot > 0.5) {
                priority *= 0.5; // Bonus para dirección de movimiento
            }
        }
        
        return priority;
    }
    
    updatePriorities(chunks, playerPos, camera) {
        this.priorities.clear();
        
        // Obtener dirección de la cámara
        const cameraDirection = new THREE.Vector3(0, 0, -1);
        cameraDirection.applyQuaternion(camera.quaternion);
        cameraDirection.y = 0;
        cameraDirection.normalize();
        
        // Calcular velocidad del jugador
        const playerMovement = new THREE.Vector3();
        playerMovement.subVectors(playerPos, this.lastPlayerPos);
        const isMoving = playerMovement.length() > 0.1 ? playerMovement.normalize() : null;
        
        this.lastPlayerPos.copy(playerPos);
        this.lastCameraDirection.copy(cameraDirection);
        
        // Calcular prioridades
        for (const [chunkX, chunkZ] of chunks) {
            const priority = this.calculatePriority(
                chunkX, chunkZ, 
                playerPos, 
                cameraDirection, 
                isMoving
            );
            this.priorities.set(`${chunkX},${chunkZ}`, priority);
        }
        
        // Ordenar chunks por prioridad
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

// World management - OPTIMIZADO TIPO MINECRAFT
export class World {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.chunkColumns = new Map();
        this.loadedChunks = new Set();
        this.loadingChunks = new Set();
        this.frustumCuller = new FrustumCuller();
        this.prioritySystem = new ChunkPrioritySystem();
        this.memoryManager = new MemoryManager();
        
        // Control de carga
        this.chunksToLoad = [];
        this.lastUpdateTime = 0;
        this.updateInterval = 50; // ms entre actualizaciones
        this.maxChunksPerUpdate = 3; // Chunks por actualización
        
        // Sistema avanzado de carga
        this.useAdvancedLoader = config.features.useAdvancedLoader;
        if (this.useAdvancedLoader) {
            this.chunkLoader = new ChunkLoader(this, scene);
        }
        
        // Worker Manager
        this.workerManager = null;
        if (config.features.useWorkers) {
            Logger.info('[World] Initializing Web Workers...');
            try {
                this.workerManager = new WorkerManager(this, scene);
                setTimeout(() => {
                    if (this.workerManager && this.workerManager.isEnabled()) {
                        stats.workerStatus = 'enabled';
                        Logger.info('[World] Web Workers enabled');
                    } else {
                        stats.workerStatus = 'disabled';
                        config.features.useWorkers = false;
                    }
                }, 1500);
            } catch (error) {
                Logger.error('[World] Failed to initialize WorkerManager:', error);
                config.features.useWorkers = false;
                stats.workerStatus = 'failed';
            }
        }
        
        this.seed = Math.floor(Math.random() * 1000000);
        Logger.info('[World] World initialized with improved chunk loading');
    }

    getChunkKey(x, z) {
        return `${x},${z}`;
    }

    getChunk(x, z) {
        const key = this.getChunkKey(x, z);
        if (!this.chunks.has(key)) {
            if (this.memoryManager.canAllocateChunk()) {
                this.chunks.set(key, new Chunk(x, z, this));
                this.memoryManager.registerChunk(key);
            } else {
                Logger.warn('[World] Memory limit reached');
                this.memoryManager.freeOldestChunks(this, 5);
                return null;
            }
        }
        return this.chunks.get(key);
    }
    
    getChunkColumn(x, z) {
        const key = this.getChunkKey(x, z);
        if (!this.chunkColumns.has(key)) {
            if (this.memoryManager.canAllocateChunk()) {
                this.chunkColumns.set(key, new ChunkColumn(x, z, this));
                this.memoryManager.registerChunk(key);
            } else {
                Logger.warn('[World] Memory limit reached');
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
        
        if (this.workerManager && this.workerManager.isEnabled() && config.features.useWorkers) {
            const chunkColumn = this.getChunkColumn(chunkX, chunkZ);
            return chunkColumn ? chunkColumn.getBlock(localX, worldY, localZ) : 0;
        }
        
        const chunk = this.getChunk(chunkX, chunkZ);
        return chunk ? chunk.getBlock(localX, worldY, localZ) : 0;
    }

    // NUEVO: Sistema de actualización tipo Minecraft
    updateChunksAroundPlayer(playerX, playerZ, camera, scene) {
        const currentTime = performance.now();
        
        // Limitar frecuencia de actualización completa
        if (currentTime - this.lastUpdateTime < this.updateInterval) {
            this.processChunkQueue();
            return;
        }
        
        this.lastUpdateTime = currentTime;
        
        // Usar loader avanzado si está activo
        if (this.useAdvancedLoader && this.chunkLoader) {
            this.chunkLoader.update({ x: playerX, z: playerZ }, camera);
            return;
        }
        
        // Actualizar frustum
        this.frustumCuller.update(camera);
        
        const playerChunkX = Math.floor(playerX / config.chunkSize);
        const playerChunkZ = Math.floor(playerZ / config.chunkSize);
        
        // PASO 1: Identificar TODOS los chunks necesarios
        const requiredChunks = new Map();
        const renderDistSq = config.renderDistance * config.renderDistance;
        
        for (let dx = -config.renderDistance - 1; dx <= config.renderDistance + 1; dx++) {
            for (let dz = -config.renderDistance - 1; dz <= config.renderDistance + 1; dz++) {
                const distSq = dx * dx + dz * dz;
                if (distSq <= renderDistSq + 2) { // +2 para buffer
                    const chunkX = playerChunkX + dx;
                    const chunkZ = playerChunkZ + dz;
                    const key = this.getChunkKey(chunkX, chunkZ);
                    requiredChunks.set(key, [chunkX, chunkZ]);
                }
            }
        }
        
        // PASO 2: Actualizar prioridades
        const playerPos = new THREE.Vector3(playerX, 0, playerZ);
        this.prioritySystem.updatePriorities(
            Array.from(requiredChunks.values()),
            playerPos,
            camera
        );
        
        // PASO 3: Cargar chunks prioritarios
        this.chunksToLoad = [];
        const chunksToProcess = this.prioritySystem.getNextChunks(999); // Obtener todos ordenados
        
        for (const [chunkX, chunkZ] of chunksToProcess) {
            const key = this.getChunkKey(chunkX, chunkZ);
            
            // Skip si ya está cargado o cargando
            if (this.loadedChunks.has(key) || this.loadingChunks.has(key)) {
                continue;
            }
            
            // Verificar visibilidad ANTES de cargar
            const isVisible = this.frustumCuller.isChunkVisible(chunkX, chunkZ);
            const distance = Math.sqrt(
                Math.pow(chunkX - playerChunkX, 2) + 
                Math.pow(chunkZ - playerChunkZ, 2)
            );
            
            // Cargar si: está visible O está muy cerca (radio 2)
            if (isVisible || distance <= 2) {
                this.chunksToLoad.push([chunkX, chunkZ, key]);
            }
        }
        
        // PASO 4: Procesar cola de carga inmediatamente
        this.processChunkQueue();
        
        // PASO 5: Descargar chunks lejanos
        this.unloadDistantChunks(playerChunkX, playerChunkZ, requiredChunks);
        
        // Actualizar estadísticas
        this.updateStats();
    }
    
    // Procesar cola de chunks a cargar
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
    
    // Límite adaptativo basado en rendimiento
    getAdaptiveChunkLimit() {
        if (stats.fps > 50) return 5;
        if (stats.fps > 40) return 4;
        if (stats.fps > 30) return 3;
        if (stats.fps > 20) return 2;
        return 1;
    }

    // Cargar un chunk individual
    loadChunk(cx, cz, key) {
        if (this.loadedChunks.has(key) || this.loadingChunks.has(key)) return;
        
        this.loadingChunks.add(key);
        Logger.debug(`[World] Loading chunk ${key}`);
        
        if (this.workerManager && this.workerManager.isEnabled() && config.features.useWorkers) {
            // Generación asíncrona con workers
            const requested = this.workerManager.requestChunk(cx, cz);
            if (requested) {
                // El worker manejará la carga
                setTimeout(() => {
                    this.loadingChunks.delete(key);
                    this.loadedChunks.add(key);
                }, 100);
            } else if (config.features.fallbackToSync) {
                this.generateChunkSync(cx, cz, key);
            }
        } else {
            // Generación síncrona
            this.generateChunkSync(cx, cz, key);
        }
    }
    
    // Generación síncrona de chunk
    generateChunkSync(cx, cz, key) {
        const chunk = this.getChunk(cx, cz);
        if (chunk) {
            chunk.updateMesh(this.scene);
            this.memoryManager.updateChunkAccess(key);
        }
        
        this.loadingChunks.delete(key);
        this.loadedChunks.add(key);
    }

    // Descargar chunks lejanos
    unloadDistantChunks(playerChunkX, playerChunkZ, requiredChunks) {
        const chunksToUnload = [];
        const maxDistance = config.renderDistance + 3; // Buffer de 3 chunks
        
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

    // Descargar un chunk
    unloadChunk(key) {
        Logger.debug(`[World] Unloading chunk ${key}`);
        
        if (this.workerManager && this.workerManager.isEnabled() && config.features.useWorkers) {
            const chunkColumn = this.chunkColumns.get(key);
            if (chunkColumn) {
                chunkColumn.dispose(this.scene);
                this.chunkColumns.delete(key);
            }
        } else {
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
        this.loadingChunks.delete(key);
    }

    // Actualizar distancia de renderizado
    updateRenderDistance(newDistance) {
        Logger.info(`[World] Updating render distance to ${newDistance}`);
        config.renderDistance = newDistance;
        
        // Ajustar límites basados en distancia
        this.maxChunksPerUpdate = Math.max(3, Math.min(10, Math.floor(newDistance / 2)));
        
        // Forzar actualización completa
        this.lastUpdateTime = 0;
    }
    
    // Actualizar estadísticas
    updateStats() {
        stats.visibleChunks = this.loadedChunks.size;
        stats.totalChunks = this.chunks.size + this.chunkColumns.size;
        stats.chunksInQueue = this.chunksToLoad.length;
        stats.chunksProcessing = this.loadingChunks.size;
        
        // Calcular eficiencia de culling
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
        
        if (this.workerManager && this.workerManager.isEnabled() && config.features.useWorkers) {
            const chunkColumn = this.getChunkColumn(chunkX, chunkZ);
            if (chunkColumn) {
                chunkColumn.setBlock(localX, worldY, localZ, type);
                chunkColumn.updateAllDirtyMeshes(scene);
                
                // Actualizar chunks vecinos si es necesario
                this.updateNeighborChunks(chunkX, chunkZ, localX, localZ, scene);
            }
        } else {
            const chunk = this.getChunk(chunkX, chunkZ);
            if (chunk) {
                chunk.setBlock(localX, worldY, localZ, type);
                chunk.updateMesh(scene);
                
                // Actualizar chunks vecinos si es necesario
                this.updateNeighborChunks(chunkX, chunkZ, localX, localZ, scene);
            }
        }
    }
    
    // Actualizar chunks vecinos cuando se modifica un borde
    updateNeighborChunks(chunkX, chunkZ, localX, localZ, scene) {
        const updates = [];
        
        if (localX === 0) updates.push([chunkX - 1, chunkZ]);
        if (localX === config.chunkSize - 1) updates.push([chunkX + 1, chunkZ]);
        if (localZ === 0) updates.push([chunkX, chunkZ - 1]);
        if (localZ === config.chunkSize - 1) updates.push([chunkX, chunkZ + 1]);
        
        for (const [cx, cz] of updates) {
            const key = this.getChunkKey(cx, cz);
            if (this.loadedChunks.has(key)) {
                if (this.workerManager && this.workerManager.isEnabled()) {
                    const column = this.chunkColumns.get(key);
                    if (column) column.updateAllDirtyMeshes(scene);
                } else {
                    const chunk = this.chunks.get(key);
                    if (chunk) chunk.updateMesh(scene);
                }
            }
        }
    }
    
    getStats() {
        return {
            chunksLoaded: this.loadedChunks.size,
            chunksLoading: this.loadingChunks.size,
            chunksQueued: this.chunksToLoad.length,
            totalChunks: this.chunks.size,
            totalColumns: this.chunkColumns.size,
            workerEnabled: this.workerManager ? this.workerManager.isEnabled() : false,
            memory: this.memoryManager.getStats(),
            cullingEfficiency: stats.cullingEfficiency + '%'
        };
    }
    
    dispose() {
        Logger.info('[World] Disposing world resources...');
        
        this.frustumCuller.dispose();
        this.memoryManager.dispose();
        
        if (this.workerManager) {
            this.workerManager.dispose();
            this.workerManager = null;
        }
        
        if (this.useAdvancedLoader && this.chunkLoader) {
            this.chunkLoader.dispose();
        }
        
        for (const chunkColumn of this.chunkColumns.values()) {
            chunkColumn.dispose(this.scene);
        }
        
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
        this.loadingChunks.clear();
        this.chunksToLoad = [];
        
        Logger.info('[World] World resources disposed');
    }
}