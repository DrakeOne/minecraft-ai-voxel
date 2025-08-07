/**
 * OptimizedRenderer - Sistema de renderizado con InstancedMesh
 * Se integra con el sistema existente para mejorar el rendimiento
 */

import { config, BlockType, blockColors } from '../config.js';
import { Logger } from '../utils/Logger.js';

export class OptimizedRenderer {
    constructor(scene) {
        this.scene = scene;
        this.instancedMeshes = new Map();
        this.instanceMatrices = new Map();
        this.instanceCounts = new Map();
        this.maxInstancesPerType = 100000;
        
        // Pool de matrices para evitar garbage collection
        this.matrixPool = [];
        this.tempMatrix = new THREE.Matrix4();
        
        this.initializeInstancedMeshes();
        
        Logger.info('[OptimizedRenderer] Initialized with InstancedMesh support');
    }
    
    initializeInstancedMeshes() {
        // Geometría compartida para todos los bloques
        const geometry = new THREE.BoxGeometry(
            config.blockSize * 0.99, // Slightly smaller to prevent z-fighting
            config.blockSize * 0.99,
            config.blockSize * 0.99
        );
        
        // Crear un InstancedMesh para cada tipo de bloque
        for (const [name, type] of Object.entries(BlockType)) {
            if (type === BlockType.AIR) continue;
            
            const color = blockColors[type];
            if (!color) continue;
            
            // Material con mejor rendimiento
            const material = new THREE.MeshLambertMaterial({
                color: color,
                // Optimizaciones de material
                precision: 'lowp',
                dithering: false,
                flatShading: true
            });
            
            // Crear InstancedMesh
            const mesh = new THREE.InstancedMesh(
                geometry,
                material,
                this.maxInstancesPerType
            );
            
            // Optimizaciones de mesh
            mesh.castShadow = false; // Desactivar sombras para mejor rendimiento
            mesh.receiveShadow = false;
            mesh.frustumCulled = true;
            mesh.matrixAutoUpdate = false;
            
            // Inicializar con count 0 (invisible hasta que se añadan instancias)
            mesh.count = 0;
            mesh.visible = false;
            
            // Guardar referencias
            this.instancedMeshes.set(type, mesh);
            this.instanceMatrices.set(type, new Float32Array(this.maxInstancesPerType * 16));
            this.instanceCounts.set(type, 0);
            
            // Añadir a la escena
            this.scene.add(mesh);
            
            Logger.debug(`[OptimizedRenderer] Created InstancedMesh for block type ${name}`);
        }
    }
    
    // Resetear contadores antes de actualizar
    beginUpdate() {
        for (const [type] of this.instancedMeshes) {
            this.instanceCounts.set(type, 0);
        }
    }
    
    // Añadir un bloque al batch
    addBlock(blockType, worldX, worldY, worldZ) {
        if (blockType === BlockType.AIR) return;
        
        const mesh = this.instancedMeshes.get(blockType);
        if (!mesh) return;
        
        const count = this.instanceCounts.get(blockType);
        if (count >= this.maxInstancesPerType) {
            Logger.warn(`[OptimizedRenderer] Max instances reached for block type ${blockType}`);
            return;
        }
        
        // Crear matriz de transformación
        this.tempMatrix.makeTranslation(worldX, worldY, worldZ);
        
        // Guardar en el array de matrices
        const matrices = this.instanceMatrices.get(blockType);
        this.tempMatrix.toArray(matrices, count * 16);
        
        // Incrementar contador
        this.instanceCounts.set(blockType, count + 1);
    }
    
    // Añadir múltiples bloques de una vez (más eficiente)
    addBlocks(blocks) {
        for (const block of blocks) {
            this.addBlock(block.type, block.x, block.y, block.z);
        }
    }
    
    // Procesar chunk completo
    addChunk(chunk, chunkX, chunkZ) {
        const size = config.chunkSize;
        const worldX = chunkX * size;
        const worldZ = chunkZ * size;
        
        // Iterar sobre todos los bloques del chunk
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                for (let z = 0; z < size; z++) {
                    const blockType = chunk.getBlock(x, y, z);
                    if (blockType === BlockType.AIR) continue;
                    
                    // Verificar si el bloque es visible (tiene al menos una cara expuesta)
                    if (this.isBlockVisible(chunk, x, y, z)) {
                        this.addBlock(
                            blockType,
                            worldX + x,
                            y,
                            worldZ + z
                        );
                    }
                }
            }
        }
    }
    
    // Verificar si un bloque tiene al menos una cara visible
    isBlockVisible(chunk, x, y, z) {
        // Verificar las 6 direcciones
        const directions = [
            [1, 0, 0], [-1, 0, 0],  // X axis
            [0, 1, 0], [0, -1, 0],  // Y axis
            [0, 0, 1], [0, 0, -1]   // Z axis
        ];
        
        for (const [dx, dy, dz] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            
            // Si está en el borde del chunk, considerarlo visible
            if (nx < 0 || nx >= config.chunkSize ||
                ny < 0 || ny >= config.chunkSize ||
                nz < 0 || nz >= config.chunkSize) {
                return true;
            }
            
            // Si el bloque adyacente es aire, esta cara es visible
            if (chunk.getBlock(nx, ny, nz) === BlockType.AIR) {
                return true;
            }
        }
        
        return false;
    }
    
    // Finalizar actualización y aplicar cambios
    endUpdate() {
        let totalInstances = 0;
        let visibleMeshes = 0;
        
        for (const [type, mesh] of this.instancedMeshes) {
            const count = this.instanceCounts.get(type);
            
            if (count > 0) {
                // Copiar matrices al InstancedMesh
                const matrices = this.instanceMatrices.get(type);
                
                for (let i = 0; i < count; i++) {
                    this.tempMatrix.fromArray(matrices, i * 16);
                    mesh.setMatrixAt(i, this.tempMatrix);
                }
                
                // Marcar matrices como necesitando actualización
                mesh.instanceMatrix.needsUpdate = true;
                mesh.count = count;
                mesh.visible = true;
                
                totalInstances += count;
                visibleMeshes++;
            } else {
                // Ocultar mesh si no hay instancias
                mesh.visible = false;
            }
        }
        
        // Actualizar estadísticas
        if (config.stats) {
            config.stats.totalInstances = totalInstances;
            config.stats.visibleMeshes = visibleMeshes;
            config.stats.drawCalls = visibleMeshes; // Un draw call por tipo de bloque visible
        }
        
        Logger.verbose(`[OptimizedRenderer] Updated ${totalInstances} instances across ${visibleMeshes} meshes`);
    }
    
    // Método completo para actualizar todos los chunks visibles
    updateVisibleChunks(chunks) {
        this.beginUpdate();
        
        for (const chunk of chunks) {
            if (chunk && chunk.blocks) {
                this.addChunk(chunk, chunk.x, chunk.z);
            }
        }
        
        this.endUpdate();
    }
    
    // Limpiar recursos
    dispose() {
        Logger.info('[OptimizedRenderer] Disposing...');
        
        for (const [type, mesh] of this.instancedMeshes) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        
        this.instancedMeshes.clear();
        this.instanceMatrices.clear();
        this.instanceCounts.clear();
        this.matrixPool = [];
        
        Logger.info('[OptimizedRenderer] Disposed');
    }
    
    // Obtener estadísticas de rendimiento
    getStats() {
        const stats = {
            meshes: this.instancedMeshes.size,
            totalInstances: 0,
            memoryUsage: 0
        };
        
        for (const [type, count] of this.instanceCounts) {
            stats.totalInstances += count;
        }
        
        // Estimar uso de memoria (16 floats por matriz * 4 bytes por float)
        stats.memoryUsage = stats.totalInstances * 16 * 4;
        
        return stats;
    }
}

// Singleton para uso global
let rendererInstance = null;

export function getOptimizedRenderer(scene) {
    if (!rendererInstance && scene) {
        rendererInstance = new OptimizedRenderer(scene);
    }
    return rendererInstance;
}

export function disposeOptimizedRenderer() {
    if (rendererInstance) {
        rendererInstance.dispose();
        rendererInstance = null;
    }
}