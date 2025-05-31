import { config, BlockType, blockColors, stats } from '../config.js';

// Chunk management with FIXED face rendering
export class Chunk {
    constructor(x, z, world) {
        this.x = x;
        this.z = z;
        this.world = world;
        this.blocks = new Uint8Array(config.chunkSize * config.chunkSize * config.chunkSize);
        this.mesh = null;
        this.needsUpdate = true;
        this.generateTerrain();
    }

    generateTerrain() {
        // Simple flat world generation with some variety
        for (let x = 0; x < config.chunkSize; x++) {
            for (let z = 0; z < config.chunkSize; z++) {
                const worldX = this.x * config.chunkSize + x;
                const worldZ = this.z * config.chunkSize + z;
                
                // Generate flat terrain at y=0
                this.setBlock(x, 0, z, BlockType.GRASS);
                
                // Add some random blocks for variety
                if (Math.random() < 0.02) {
                    const height = Math.floor(Math.random() * 3) + 1;
                    for (let y = 1; y <= height; y++) {
                        this.setBlock(x, y, z, BlockType.STONE);
                    }
                }
            }
        }
    }

    getBlock(x, y, z) {
        if (x < 0 || x >= config.chunkSize || 
            y < 0 || y >= config.chunkSize || 
            z < 0 || z >= config.chunkSize) {
            return BlockType.AIR;
        }
        const index = x + y * config.chunkSize + z * config.chunkSize * config.chunkSize;
        return this.blocks[index];
    }

    setBlock(x, y, z, type) {
        if (x < 0 || x >= config.chunkSize || 
            y < 0 || y >= config.chunkSize || 
            z < 0 || z >= config.chunkSize) {
            return;
        }
        const index = x + y * config.chunkSize + z * config.chunkSize * config.chunkSize;
        this.blocks[index] = type;
        this.needsUpdate = true;
    }

    // Check if a face should be rendered by checking adjacent block
    shouldRenderFace(localX, localY, localZ, dir) {
        const checkX = localX + dir[0];
        const checkY = localY + dir[1];
        const checkZ = localZ + dir[2];
        
        // If checking within chunk bounds
        if (checkX >= 0 && checkX < config.chunkSize &&
            checkY >= 0 && checkY < config.chunkSize &&
            checkZ >= 0 && checkZ < config.chunkSize) {
            return this.getBlock(checkX, checkY, checkZ) === BlockType.AIR;
        }
        
        // If checking outside chunk bounds, check neighboring chunk
        const worldX = this.x * config.chunkSize + checkX;
        const worldY = checkY;
        const worldZ = this.z * config.chunkSize + checkZ;
        
        return this.world.getBlockAtWorldCoords(worldX, worldY, worldZ) === BlockType.AIR;
    }

    updateMesh(scene) {
        if (!this.needsUpdate) return;

        // Remove old mesh
        if (this.mesh) {
            scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }

        // Create optimized merged geometry
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const normals = [];
        const colors = [];
        const indices = [];
        let vertexCount = 0;
        let faceCount = 0;

        // Generate visible faces only (culling)
        for (let x = 0; x < config.chunkSize; x++) {
            for (let y = 0; y < config.chunkSize; y++) {
                for (let z = 0; z < config.chunkSize; z++) {
                    const block = this.getBlock(x, y, z);
                    if (block === BlockType.AIR) continue;

                    const worldX = this.x * config.chunkSize + x;
                    const worldY = y;
                    const worldZ = this.z * config.chunkSize + z;

                    // Check each face for visibility
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
                        if (this.shouldRenderFace(x, y, z, face.dir)) {
                            const startVertex = vertexCount;
                            this.addFace(vertices, normals, colors, indices, worldX, worldY, worldZ, face, color);
                            vertexCount += 4;
                            faceCount++;
                        }
                    });
                }
            }
        }

        if (vertices.length === 0) {
            this.needsUpdate = false;
            return;
        }

        // Set geometry attributes
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        
        // IMPORTANT: Compute bounding box for proper rendering
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        // Create mesh with vertex colors
        const material = new THREE.MeshLambertMaterial({ 
            vertexColors: true,
            side: THREE.FrontSide // FIXED: Use FrontSide only
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        scene.add(this.mesh);

        stats.totalFaces = faceCount;
        this.needsUpdate = false;
    }

    // FIXED: Corrected vertex winding order for proper face culling
    addFace(vertices, normals, colors, indices, x, y, z, face, color) {
        const size = config.blockSize;
        const half = size / 2;

        // Define vertices for each face with correct winding order
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
                    [x - half, y - half, z + half],
                    [x - half, y + half, z + half],
                    [x + half, y + half, z + half],
                    [x + half, y - half, z + half]
                ];
                normal = [0, 0, 1];
                break;
            case 'back':
                faceVertices = [
                    [x + half, y - half, z - half],
                    [x + half, y + half, z - half],
                    [x - half, y + half, z - half],
                    [x - half, y - half, z - half]
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

        // Add indices for two triangles (FIXED: Correct winding order)
        indices.push(
            baseIndex, baseIndex + 1, baseIndex + 2,
            baseIndex, baseIndex + 2, baseIndex + 3
        );
    }
}