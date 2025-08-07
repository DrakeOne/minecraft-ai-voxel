import { config, BlockType, blockColors, stats } from '../config.js';

// Simple noise function for terrain generation
class SimpleNoise {
    constructor(seed = 12345) {
        this.seed = seed;
    }
    
    random(x, z) {
        const n = Math.sin(x * 12.9898 + z * 78.233 + this.seed) * 43758.5453;
        return (n - Math.floor(n));
    }
    
    noise2D(x, z, scale = 1) {
        x *= scale;
        z *= scale;
        
        const xi = Math.floor(x);
        const zi = Math.floor(z);
        
        const xf = x - xi;
        const zf = z - zi;
        
        // Smooth interpolation
        const u = xf * xf * (3 - 2 * xf);
        const v = zf * zf * (3 - 2 * zf);
        
        // Get corner values
        const aa = this.random(xi, zi);
        const ba = this.random(xi + 1, zi);
        const ab = this.random(xi, zi + 1);
        const bb = this.random(xi + 1, zi + 1);
        
        // Interpolate
        const x1 = aa * (1 - u) + ba * u;
        const x2 = ab * (1 - u) + bb * u;
        
        return (x1 * (1 - v) + x2 * v) * 2 - 1;
    }
    
    octaveNoise(x, z, octaves = 4, persistence = 0.5, scale = 0.02) {
        let total = 0;
        let amplitude = 1;
        let frequency = scale;
        let maxValue = 0;
        
        for (let i = 0; i < octaves; i++) {
            total += this.noise2D(x, z, frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= 2;
        }
        
        return total / maxValue;
    }
}

// Chunk management with IMPROVED terrain generation
export class Chunk {
    constructor(x, z, world) {
        this.x = x;
        this.z = z;
        this.world = world;
        this.blocks = new Uint8Array(config.chunkSize * config.chunkSize * config.chunkSize);
        this.mesh = null;
        this.needsUpdate = true;
        this.noise = new SimpleNoise(world.seed || 12345);
        this.generateTerrain();
    }

    generateTerrain() {
        // Generate terrain with hills and valleys
        for (let x = 0; x < config.chunkSize; x++) {
            for (let z = 0; z < config.chunkSize; z++) {
                const worldX = this.x * config.chunkSize + x;
                const worldZ = this.z * config.chunkSize + z;
                
                // Generate height using multiple octaves of noise
                const baseHeight = 5; // Base terrain height
                const hillHeight = 8; // Maximum hill height
                
                // Main terrain shape
                const terrainNoise = this.noise.octaveNoise(worldX, worldZ, 4, 0.5, 0.02);
                const detailNoise = this.noise.octaveNoise(worldX, worldZ, 2, 0.3, 0.1);
                
                // Calculate final height
                const height = Math.floor(
                    baseHeight + 
                    terrainNoise * hillHeight + 
                    detailNoise * 2
                );
                
                // Clamp height to chunk bounds
                const maxHeight = Math.min(height, config.chunkSize - 1);
                
                // Fill terrain layers
                for (let y = 0; y <= maxHeight; y++) {
                    let blockType = BlockType.STONE;
                    
                    // Surface layer
                    if (y === maxHeight) {
                        blockType = BlockType.GRASS;
                    }
                    // Dirt layer (2-3 blocks below surface)
                    else if (y >= maxHeight - 3 && y < maxHeight) {
                        blockType = BlockType.DIRT;
                    }
                    // Deep stone
                    else {
                        blockType = BlockType.STONE;
                    }
                    
                    this.setBlock(x, y, z, blockType);
                }
                
                // Add some random features
                if (Math.random() < 0.01 && maxHeight < config.chunkSize - 4) {
                    // Small stone pillars/rocks
                    const pillarHeight = Math.floor(Math.random() * 3) + 1;
                    for (let y = maxHeight + 1; y <= maxHeight + pillarHeight && y < config.chunkSize; y++) {
                        this.setBlock(x, y, z, BlockType.STONE);
                    }
                }
            }
        }
        
        // Add caves (simple implementation)
        this.generateCaves();
    }
    
    generateCaves() {
        // Simple cave generation using 3D noise
        for (let x = 1; x < config.chunkSize - 1; x++) {
            for (let y = 1; y < config.chunkSize - 1; y++) {
                for (let z = 1; z < config.chunkSize - 1; z++) {
                    const worldX = this.x * config.chunkSize + x;
                    const worldY = y;
                    const worldZ = this.z * config.chunkSize + z;
                    
                    // Cave noise (3D)
                    const caveNoise = this.noise.octaveNoise(worldX * 2, worldZ * 2 + worldY * 0.5, 2, 0.5, 0.05);
                    
                    // Create cave if noise is above threshold and not too close to surface
                    if (caveNoise > 0.6 && y < 8) {
                        this.setBlock(x, y, z, BlockType.AIR);
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
                    
                    // Add slight color variation for more natural look
                    const variation = 0.05;
                    color.r += (Math.random() - 0.5) * variation;
                    color.g += (Math.random() - 0.5) * variation;
                    color.b += (Math.random() - 0.5) * variation;

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
            side: THREE.FrontSide
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        scene.add(this.mesh);

        stats.totalFaces = faceCount;
        this.needsUpdate = false;
    }

    // Add face geometry with correct winding order
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

        // Add indices for two triangles
        indices.push(
            baseIndex, baseIndex + 1, baseIndex + 2,
            baseIndex, baseIndex + 2, baseIndex + 3
        );
    }
}