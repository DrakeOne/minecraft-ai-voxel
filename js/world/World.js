import { config, stats } from '../config.js';
import { Chunk } from './Chunk.js';

// Frustum Culling Class
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
    constructor() {
        this.chunks = new Map();
        this.loadedChunks = new Set();
        this.frustumCuller = new FrustumCuller();
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
        
        const chunk = this.getChunk(chunkX, chunkZ);
        return chunk.getBlock(localX, worldY, localZ);
    }

    updateChunksAroundPlayer(playerX, playerZ, camera, scene) {
        // Update frustum with current camera
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
                    chunk.updateMesh(scene);
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
}