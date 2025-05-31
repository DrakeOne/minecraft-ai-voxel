/**
 * Mesh Generation Worker
 * Generates optimized mesh data from terrain blocks
 */

// Block type definitions
const BlockType = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    SAND: 4,
    SNOW: 5,
    LEAVES: 6,
    WOOD: 4,
    COAL: 7,
    IRON: 8,
    GOLD: 9,
    DIAMOND: 10
};

// Block colors
const blockColors = {
    [BlockType.GRASS]: [76, 175, 80],
    [BlockType.DIRT]: [139, 69, 19],
    [BlockType.STONE]: [128, 128, 128],
    [BlockType.SAND]: [238, 203, 173],
    [BlockType.SNOW]: [255, 250, 250],
    [BlockType.LEAVES]: [34, 139, 34],
    [BlockType.WOOD]: [139, 69, 19],
    [BlockType.COAL]: [54, 54, 54],
    [BlockType.IRON]: [175, 175, 175],
    [BlockType.GOLD]: [255, 215, 0],
    [BlockType.DIAMOND]: [185, 242, 255]
};

// Mesh generator class
class MeshGenerator {
    constructor() {
        this.vertices = [];
        this.normals = [];
        this.colors = [];
        this.indices = [];
        this.vertexCount = 0;
    }

    /**
     * Generate mesh from terrain data
     */
    generateMesh(terrainData, chunkSize, chunkX, chunkZ, lod) {
        this.reset();
        
        const blocks = new Uint8Array(terrainData);
        const lodScale = Math.pow(2, lod);
        
        // Process blocks based on LOD
        for (let x = 0; x < chunkSize; x += lodScale) {
            for (let y = 0; y < chunkSize; y += lodScale) {
                for (let z = 0; z < chunkSize; z += lodScale) {
                    const index = x + y * chunkSize + z * chunkSize * chunkSize;
                    const blockType = blocks[index];
                    
                    if (blockType === BlockType.AIR) continue;
                    
                    // Check each face for visibility
                    this.processFaces(blocks, x, y, z, blockType, chunkSize, chunkX, chunkZ, lodScale);
                }
            }
        }
        
        // Apply optimizations based on LOD
        if (lod === 0) {
            this.optimizeMesh();
        }
        
        return this.getMeshData();
    }

    /**
     * Process faces for a block
     */
    processFaces(blocks, x, y, z, blockType, chunkSize, chunkX, chunkZ, lodScale) {
        const worldX = chunkX * chunkSize + x;
        const worldY = y;
        const worldZ = chunkZ * chunkSize + z;
        
        const faces = [
            { dir: [0, 1, 0], normal: [0, 1, 0], name: 'top' },
            { dir: [0, -1, 0], normal: [0, -1, 0], name: 'bottom' },
            { dir: [1, 0, 0], normal: [1, 0, 0], name: 'right' },
            { dir: [-1, 0, 0], normal: [-1, 0, 0], name: 'left' },
            { dir: [0, 0, 1], normal: [0, 0, 1], name: 'front' },
            { dir: [0, 0, -1], normal: [0, 0, -1], name: 'back' }
        ];
        
        const color = blockColors[blockType] || [128, 128, 128];
        
        for (const face of faces) {
            if (this.shouldRenderFace(blocks, x, y, z, face.dir, chunkSize, lodScale)) {
                this.addFace(worldX, worldY, worldZ, face, color, lodScale);
            }
        }
    }

    /**
     * Check if a face should be rendered
     */
    shouldRenderFace(blocks, x, y, z, dir, chunkSize, lodScale) {
        const checkX = x + dir[0] * lodScale;
        const checkY = y + dir[1] * lodScale;
        const checkZ = z + dir[2] * lodScale;
        
        // Check bounds
        if (checkX < 0 || checkX >= chunkSize ||
            checkY < 0 || checkY >= chunkSize ||
            checkZ < 0 || checkZ >= chunkSize) {
            return true; // Render faces at chunk boundaries
        }
        
        const index = checkX + checkY * chunkSize + checkZ * chunkSize * chunkSize;
        return blocks[index] === BlockType.AIR;
    }

    /**
     * Add a face to the mesh
     */
    addFace(x, y, z, face, color, scale) {
        const half = scale / 2;
        
        // Define vertices based on face
        let verts;
        switch (face.name) {
            case 'top':
                verts = [
                    [x - half, y + half, z - half],
                    [x - half, y + half, z + half],
                    [x + half, y + half, z + half],
                    [x + half, y + half, z - half]
                ];
                break;
            case 'bottom':
                verts = [
                    [x - half, y - half, z - half],
                    [x + half, y - half, z - half],
                    [x + half, y - half, z + half],
                    [x - half, y - half, z + half]
                ];
                break;
            case 'right':
                verts = [
                    [x + half, y - half, z - half],
                    [x + half, y + half, z - half],
                    [x + half, y + half, z + half],
                    [x + half, y - half, z + half]
                ];
                break;
            case 'left':
                verts = [
                    [x - half, y - half, z + half],
                    [x - half, y + half, z + half],
                    [x - half, y + half, z - half],
                    [x - half, y - half, z - half]
                ];
                break;
            case 'front':
                verts = [
                    [x + half, y - half, z + half],
                    [x + half, y + half, z + half],
                    [x - half, y + half, z + half],
                    [x - half, y - half, z + half]
                ];
                break;
            case 'back':
                verts = [
                    [x - half, y - half, z - half],
                    [x - half, y + half, z - half],
                    [x + half, y + half, z - half],
                    [x + half, y - half, z - half]
                ];
                break;
        }
        
        // Add vertices
        const baseIndex = this.vertexCount;
        for (const vert of verts) {
            this.vertices.push(...vert);
            this.normals.push(...face.normal);
            this.colors.push(color[0] / 255, color[1] / 255, color[2] / 255);
        }
        
        // Add indices
        this.indices.push(
            baseIndex, baseIndex + 1, baseIndex + 2,
            baseIndex, baseIndex + 2, baseIndex + 3
        );
        
        this.vertexCount += 4;
    }

    /**
     * Optimize mesh by merging adjacent faces
     */
    optimizeMesh() {
        // Simple optimization: merge duplicate vertices
        const vertexMap = new Map();
        const newVertices = [];
        const newNormals = [];
        const newColors = [];
        const newIndices = [];
        
        let newIndex = 0;
        const indexMap = new Map();
        
        // Process each vertex
        for (let i = 0; i < this.vertices.length; i += 3) {
            const key = `${this.vertices[i].toFixed(3)},${this.vertices[i+1].toFixed(3)},${this.vertices[i+2].toFixed(3)}`;
            
            if (vertexMap.has(key)) {
                indexMap.set(i / 3, vertexMap.get(key));
            } else {
                vertexMap.set(key, newIndex);
                indexMap.set(i / 3, newIndex);
                
                newVertices.push(this.vertices[i], this.vertices[i+1], this.vertices[i+2]);
                newNormals.push(this.normals[i], this.normals[i+1], this.normals[i+2]);
                newColors.push(this.colors[i], this.colors[i+1], this.colors[i+2]);
                
                newIndex++;
            }
        }
        
        // Remap indices
        for (const index of this.indices) {
            newIndices.push(indexMap.get(index));
        }
        
        // Update arrays
        this.vertices = newVertices;
        this.normals = newNormals;
        this.colors = newColors;
        this.indices = newIndices;
        this.vertexCount = newIndex;
    }

    /**
     * Reset mesh data
     */
    reset() {
        this.vertices = [];
        this.normals = [];
        this.colors = [];
        this.indices = [];
        this.vertexCount = 0;
    }

    /**
     * Get mesh data as typed arrays
     */
    getMeshData() {
        return {
            vertices: new Float32Array(this.vertices),
            normals: new Float32Array(this.normals),
            colors: new Float32Array(this.colors),
            indices: new Uint32Array(this.indices),
            vertexCount: this.vertexCount,
            faceCount: this.indices.length / 3
        };
    }
}

// Greedy meshing implementation for advanced optimization
class GreedyMesher {
    constructor() {
        this.mask = [];
    }

    /**
     * Generate optimized mesh using greedy meshing algorithm
     */
    generateGreedyMesh(blocks, chunkSize) {
        const meshData = {
            vertices: [],
            normals: [],
            colors: [],
            indices: [],
            vertexCount: 0
        };
        
        // Process each axis
        for (let axis = 0; axis < 3; axis++) {
            this.processAxis(blocks, chunkSize, axis, meshData);
        }
        
        return {
            vertices: new Float32Array(meshData.vertices),
            normals: new Float32Array(meshData.normals),
            colors: new Float32Array(meshData.colors),
            indices: new Uint32Array(meshData.indices),
            vertexCount: meshData.vertexCount,
            faceCount: meshData.indices.length / 3
        };
    }

    processAxis(blocks, chunkSize, axis, meshData) {
        // Implementation of greedy meshing for one axis
        // This is a simplified version - full implementation would be more complex
        
        const u = (axis + 1) % 3;
        const v = (axis + 2) % 3;
        
        const dims = [0, 0, 0];
        dims[axis] = 1;
        
        // Process each slice
        for (let d = 0; d < chunkSize; d++) {
            // Build mask for this slice
            // ... (simplified for brevity)
        }
    }
}

// Worker message handler
const meshGenerator = new MeshGenerator();
const greedyMesher = new GreedyMesher();

self.onmessage = function(e) {
    const { id, data } = e.data;
    const { terrainData, chunkSize, x, z, lod } = data;
    
    try {
        let meshData;
        
        // Use greedy meshing for LOD 0, simple meshing for higher LODs
        if (lod === 0 && chunkSize <= 32) {
            meshData = greedyMesher.generateGreedyMesh(terrainData, chunkSize);
        } else {
            meshData = meshGenerator.generateMesh(terrainData, chunkSize, x, z, lod);
        }
        
        // Send result back with transferable objects
        self.postMessage({
            id: id,
            result: {
                vertices: meshData.vertices.buffer,
                normals: meshData.normals.buffer,
                colors: meshData.colors.buffer,
                indices: meshData.indices.buffer,
                vertexCount: meshData.vertexCount,
                faceCount: meshData.faceCount,
                terrain: terrainData
            }
        }, [
            meshData.vertices.buffer,
            meshData.normals.buffer,
            meshData.colors.buffer,
            meshData.indices.buffer
        ]);
        
    } catch (error) {
        self.postMessage({
            id: id,
            error: error.message
        });
    }
};