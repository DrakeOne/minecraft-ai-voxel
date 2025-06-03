import { config, BlockType, blockColors } from '../config.js';

// ChunkColumn manages vertical sub-chunks for increased world height
export class ChunkColumn {
    constructor(x, z, world) {
        this.x = x;
        this.z = z;
        this.world = world;
        
        // Map to store sub-chunks (only non-empty ones)
        this.subChunks = new Map();
        
        // Height map for optimization (stores highest solid block per x,z)
        this.heightMap = new Uint8Array(config.chunkSize * config.chunkSize);
        
        // Track which sub-chunks need mesh updates
        this.dirtySubChunks = new Set();
    }
    
    // Get a sub-chunk, creating it if necessary
    getOrCreateSubChunk(subY) {
        const key = subY;
        if (!this.subChunks.has(key)) {
            this.subChunks.set(key, {
                y: subY,
                blocks: new Uint8Array(config.chunkSize * config.subChunkHeight * config.chunkSize),
                mesh: null,
                isEmpty: true
            });
        }
        return this.subChunks.get(key);
    }
    
    // Get block at world coordinates
    getBlock(localX, worldY, localZ) {
        if (localX < 0 || localX >= config.chunkSize || 
            worldY < 0 || worldY >= config.worldHeight || 
            localZ < 0 || localZ >= config.chunkSize) {
            return BlockType.AIR;
        }
        
        const subY = Math.floor(worldY / config.subChunkHeight);
        const subChunk = this.subChunks.get(subY);
        
        if (!subChunk || subChunk.isEmpty) {
            return BlockType.AIR;
        }
        
        const localY = worldY % config.subChunkHeight;
        const index = localX + localY * config.chunkSize + localZ * config.chunkSize * config.subChunkHeight;
        return subChunk.blocks[index];
    }
    
    // Set block at world coordinates
    setBlock(localX, worldY, localZ, type) {
        if (localX < 0 || localX >= config.chunkSize || 
            worldY < 0 || worldY >= config.worldHeight || 
            localZ < 0 || localZ >= config.chunkSize) {
            return;
        }
        
        const subY = Math.floor(worldY / config.subChunkHeight);
        const subChunk = this.getOrCreateSubChunk(subY);
        
        const localY = worldY % config.subChunkHeight;
        const index = localX + localY * config.chunkSize + localZ * config.chunkSize * config.subChunkHeight;
        
        const oldType = subChunk.blocks[index];
        subChunk.blocks[index] = type;
        
        // Update empty status
        if (type !== BlockType.AIR && subChunk.isEmpty) {
            subChunk.isEmpty = false;
        }
        
        // Update height map
        if (type !== BlockType.AIR && worldY > this.heightMap[localX + localZ * config.chunkSize]) {
            this.heightMap[localX + localZ * config.chunkSize] = worldY;
        }
        
        // Mark sub-chunk as dirty
        this.dirtySubChunks.add(subY);
        
        // Also mark adjacent sub-chunks if on boundary
        if (localY === 0 && subY > 0) {
            this.dirtySubChunks.add(subY - 1);
        }
        if (localY === config.subChunkHeight - 1 && subY < config.verticalChunks - 1) {
            this.dirtySubChunks.add(subY + 1);
        }
    }
    
    // Set blocks from buffer (used by workers)
    setSubChunkBlocks(subY, blocks) {
        const subChunk = this.getOrCreateSubChunk(subY);
        subChunk.blocks = new Uint8Array(blocks);
        
        // Check if empty
        subChunk.isEmpty = true;
        for (let i = 0; i < blocks.length; i++) {
            if (blocks[i] !== BlockType.AIR) {
                subChunk.isEmpty = false;
                break;
            }
        }
        
        // Update height map
        for (let x = 0; x < config.chunkSize; x++) {
            for (let z = 0; z < config.chunkSize; z++) {
                for (let y = config.subChunkHeight - 1; y >= 0; y--) {
                    const worldY = subY * config.subChunkHeight + y;
                    const index = x + y * config.chunkSize + z * config.chunkSize * config.subChunkHeight;
                    if (subChunk.blocks[index] !== BlockType.AIR) {
                        const heightIndex = x + z * config.chunkSize;
                        if (worldY > this.heightMap[heightIndex]) {
                            this.heightMap[heightIndex] = worldY;
                        }
                        break;
                    }
                }
            }
        }
        
        this.dirtySubChunks.add(subY);
    }
    
    // Check if a face should be rendered
    shouldRenderFace(localX, worldY, localZ, dir) {
        const checkX = localX + dir[0];
        const checkY = worldY + dir[1];
        const checkZ = localZ + dir[2];
        
        // Check within column
        if (checkX >= 0 && checkX < config.chunkSize &&
            checkY >= 0 && checkY < config.worldHeight &&
            checkZ >= 0 && checkZ < config.chunkSize) {
            return this.getBlock(checkX, checkY, checkZ) === BlockType.AIR;
        }
        
        // Check neighboring columns
        const worldX = this.x * config.chunkSize + checkX;
        const worldZ = this.z * config.chunkSize + checkZ;
        
        return this.world.getBlockAtWorldCoords(worldX, checkY, worldZ) === BlockType.AIR;
    }
    
    // Update mesh for a specific sub-chunk
    updateSubChunkMesh(subY, scene) {
        const subChunk = this.subChunks.get(subY);
        if (!subChunk || subChunk.isEmpty) {
            // Remove mesh if exists
            if (subChunk && subChunk.mesh) {
                scene.remove(subChunk.mesh);
                subChunk.mesh.geometry.dispose();
                subChunk.mesh.material.dispose();
                subChunk.mesh = null;
            }
            return;
        }
        
        // Remove old mesh
        if (subChunk.mesh) {
            scene.remove(subChunk.mesh);
            subChunk.mesh.geometry.dispose();
            subChunk.mesh.material.dispose();
        }
        
        // Generate new mesh
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const normals = [];
        const colors = [];
        const indices = [];
        let vertexCount = 0;
        
        const baseY = subY * config.subChunkHeight;
        
        // Generate visible faces
        for (let x = 0; x < config.chunkSize; x++) {
            for (let y = 0; y < config.subChunkHeight; y++) {
                for (let z = 0; z < config.chunkSize; z++) {
                    const worldY = baseY + y;
                    const index = x + y * config.chunkSize + z * config.chunkSize * config.subChunkHeight;
                    const block = subChunk.blocks[index];
                    
                    if (block === BlockType.AIR) continue;
                    
                    const worldX = this.x * config.chunkSize + x;
                    const worldZ = this.z * config.chunkSize + z;
                    
                    // Check each face
                    const faces = [
                        { dir: [0, 1, 0], name: 'top' },
                        { dir: [0, -1, 0], name: 'bottom' },
                        { dir: [1, 0, 0], name: 'right' },
                        { dir: [-1, 0, 0], name: 'left' },
                        { dir: [0, 0, 1], name: 'front' },
                        { dir: [0, 0, -1], name: 'back' }
                    ];
                    
                    const color = new THREE.Color(blockColors[block]);
                    
                    faces.forEach(face => {
                        if (this.shouldRenderFace(x, worldY, z, face.dir)) {
                            this.addFace(vertices, normals, colors, indices, worldX, worldY, worldZ, face, color, vertexCount);
                            vertexCount += 4;
                        }
                    });
                }
            }
        }
        
        if (vertices.length === 0) {
            subChunk.mesh = null;
            return;
        }
        
        // Set geometry attributes
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        
        // Create mesh
        const material = new THREE.MeshLambertMaterial({ 
            vertexColors: true,
            side: THREE.FrontSide
        });
        
        subChunk.mesh = new THREE.Mesh(geometry, material);
        scene.add(subChunk.mesh);
    }
    
    // Update all dirty sub-chunks
    updateAllDirtyMeshes(scene) {
        for (const subY of this.dirtySubChunks) {
            this.updateSubChunkMesh(subY, scene);
        }
        this.dirtySubChunks.clear();
    }
    
    // Add face geometry (same as original Chunk.js)
    addFace(vertices, normals, colors, indices, x, y, z, face, color, vertexCount) {
        const size = config.blockSize;
        const half = size / 2;
        
        let faceVertices = [];
        let normal = [0, 0, 0];
        
        switch(face.name) {
            case 'top':
                faceVertices = [
                    [x - half, y + half, z - half],
                    [x - half, y + half, z + half],
                    [x + half, y + half, z + half],
                    [x + half, y + half, z - half]
                ];
                normal = [0, 1, 0];
                break;
            case 'bottom':
                faceVertices = [
                    [x - half, y - half, z - half],
                    [x + half, y - half, z - half],
                    [x + half, y - half, z + half],
                    [x - half, y - half, z + half]
                ];
                normal = [0, -1, 0];
                break;
            case 'right':
                faceVertices = [
                    [x + half, y - half, z - half],
                    [x + half, y + half, z - half],
                    [x + half, y + half, z + half],
                    [x + half, y - half, z + half]
                ];
                normal = [1, 0, 0];
                break;
            case 'left':
                faceVertices = [
                    [x - half, y - half, z + half],
                    [x - half, y + half, z + half],
                    [x - half, y + half, z - half],
                    [x - half, y - half, z - half]
                ];
                normal = [-1, 0, 0];
                break;
            case 'front':
                faceVertices = [
                    [x + half, y - half, z + half],
                    [x + half, y + half, z + half],
                    [x - half, y + half, z + half],
                    [x - half, y - half, z + half]
                ];
                normal = [0, 0, 1];
                break;
            case 'back':
                faceVertices = [
                    [x - half, y - half, z - half],
                    [x - half, y + half, z - half],
                    [x + half, y + half, z - half],
                    [x + half, y - half, z - half]
                ];
                normal = [0, 0, -1];
                break;
        }
        
        // Add vertices
        const baseIndex = vertices.length / 3;
        faceVertices.forEach(vertex => {
            vertices.push(...vertex);
            normals.push(...normal);
            colors.push(color.r, color.g, color.b);
        });
        
        // Add indices
        indices.push(
            baseIndex, baseIndex + 1, baseIndex + 2,
            baseIndex, baseIndex + 2, baseIndex + 3
        );
    }
    
    // Dispose of all meshes
    dispose(scene) {
        for (const subChunk of this.subChunks.values()) {
            if (subChunk.mesh) {
                scene.remove(subChunk.mesh);
                subChunk.mesh.geometry.dispose();
                subChunk.mesh.material.dispose();
            }
        }
        this.subChunks.clear();
        this.dirtySubChunks.clear();
    }
}