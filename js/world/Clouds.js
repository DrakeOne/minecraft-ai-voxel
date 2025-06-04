// Clouds.js - Minecraft-style cloud system
export class Clouds {
    constructor(scene) {
        this.scene = scene;
        this.cloudHeight = 128; // Y position of clouds
        this.cloudSpeed = 0.5; // Movement speed
        this.cloudSize = 512; // Size of cloud layer
        this.cloudScale = 8; // Scale of individual cloud blocks
        
        // Cloud pattern (simulating clouds.png)
        this.cloudPattern = this.generateCloudPattern();
        
        // Create cloud meshes
        this.cloudMeshes = [];
        this.createClouds();
        
        // Position offset for movement
        this.offset = 0;
    }
    
    // Generate a procedural cloud pattern (instead of loading clouds.png)
    generateCloudPattern() {
        const size = 64; // Pattern size
        const pattern = [];
        
        // Create cloud pattern using simple noise
        for (let x = 0; x < size; x++) {
            pattern[x] = [];
            for (let z = 0; z < size; z++) {
                // Simple cloud generation algorithm
                const noise1 = Math.sin(x * 0.1) * Math.cos(z * 0.1);
                const noise2 = Math.sin(x * 0.05 + 100) * Math.cos(z * 0.05 + 100);
                const noise3 = Math.sin(x * 0.2 - 50) * Math.cos(z * 0.2 - 50);
                
                const value = (noise1 + noise2 * 0.5 + noise3 * 0.25) / 1.75;
                
                // Threshold for cloud presence
                pattern[x][z] = value > 0.1 ? 1 : 0;
                
                // Add some random holes for variety
                if (pattern[x][z] === 1 && Math.random() < 0.1) {
                    pattern[x][z] = 0;
                }
            }
        }
        
        // Smooth the pattern (make clouds more cohesive)
        const smoothed = [];
        for (let x = 0; x < size; x++) {
            smoothed[x] = [];
            for (let z = 0; z < size; z++) {
                let sum = 0;
                let count = 0;
                
                // Check neighbors
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        const nx = x + dx;
                        const nz = z + dz;
                        if (nx >= 0 && nx < size && nz >= 0 && nz < size) {
                            sum += pattern[nx][nz];
                            count++;
                        }
                    }
                }
                
                // Smooth threshold
                smoothed[x][z] = (sum / count) > 0.4 ? 1 : 0;
            }
        }
        
        return smoothed;
    }
    
    createClouds() {
        // Create cloud geometry (reusable for all cloud blocks)
        const cloudGeometry = new THREE.BoxGeometry(
            this.cloudScale,
            this.cloudScale * 0.5, // Clouds are flatter
            this.cloudScale
        );
        
        // Cloud material with transparency
        const cloudMaterial = new THREE.MeshLambertMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        
        // Create instanced mesh for better performance
        const patternSize = this.cloudPattern.length;
        const instances = [];
        
        // Count cloud blocks
        let instanceCount = 0;
        for (let x = 0; x < patternSize; x++) {
            for (let z = 0; z < patternSize; z++) {
                if (this.cloudPattern[x][z] === 1) {
                    instanceCount++;
                }
            }
        }
        
        // Create instanced mesh
        this.cloudMesh = new THREE.InstancedMesh(
            cloudGeometry,
            cloudMaterial,
            instanceCount * 4 // Repeat pattern 2x2
        );
        
        // Position cloud instances
        let index = 0;
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        
        // Create 2x2 repetition of the pattern
        for (let repeatX = 0; repeatX < 2; repeatX++) {
            for (let repeatZ = 0; repeatZ < 2; repeatZ++) {
                for (let x = 0; x < patternSize; x++) {
                    for (let z = 0; z < patternSize; z++) {
                        if (this.cloudPattern[x][z] === 1) {
                            position.set(
                                (x + repeatX * patternSize - patternSize) * this.cloudScale,
                                this.cloudHeight,
                                (z + repeatZ * patternSize - patternSize) * this.cloudScale
                            );
                            
                            matrix.makeTranslation(position.x, position.y, position.z);
                            this.cloudMesh.setMatrixAt(index, matrix);
                            index++;
                        }
                    }
                }
            }
        }
        
        this.cloudMesh.instanceMatrix.needsUpdate = true;
        this.cloudMesh.frustumCulled = false; // Always render clouds
        this.scene.add(this.cloudMesh);
        
        // Store original positions for movement
        this.basePositions = [];
        for (let i = 0; i < index; i++) {
            const m = new THREE.Matrix4();
            this.cloudMesh.getMatrixAt(i, m);
            const p = new THREE.Vector3();
            p.setFromMatrixPosition(m);
            this.basePositions.push(p.clone());
        }
    }
    
    update(deltaTime, camera) {
        if (!this.cloudMesh) return;
        
        // Move clouds
        this.offset += this.cloudSpeed * deltaTime;
        
        // Update cloud positions
        const matrix = new THREE.Matrix4();
        const patternSize = this.cloudPattern.length * this.cloudScale;
        
        for (let i = 0; i < this.basePositions.length; i++) {
            const basePos = this.basePositions[i];
            
            // Calculate new position with wrapping
            let newX = basePos.x - this.offset;
            
            // Wrap around when clouds go too far
            while (newX < camera.position.x - patternSize) {
                newX += patternSize * 2;
            }
            while (newX > camera.position.x + patternSize) {
                newX -= patternSize * 2;
            }
            
            // Keep clouds centered around player in Z axis
            let newZ = basePos.z;
            const zOffset = camera.position.z - newZ;
            if (Math.abs(zOffset) > patternSize) {
                newZ += Math.sign(zOffset) * patternSize * 2;
            }
            
            matrix.makeTranslation(newX, this.cloudHeight, newZ);
            this.cloudMesh.setMatrixAt(i, matrix);
        }
        
        this.cloudMesh.instanceMatrix.needsUpdate = true;
        
        // Update material opacity based on time of day (optional)
        // For now, keep it constant
    }
    
    // Set cloud rendering quality
    setQuality(quality) {
        if (!this.cloudMesh) return;
        
        if (quality === 'fast') {
            // Fast graphics - more opaque, no shadows
            this.cloudMesh.material.opacity = 0.9;
            this.cloudMesh.castShadow = false;
            this.cloudMesh.receiveShadow = false;
        } else {
            // Fancy graphics - translucent, with shadows
            this.cloudMesh.material.opacity = 0.8;
            this.cloudMesh.castShadow = true;
            this.cloudMesh.receiveShadow = true;
        }
    }
    
    dispose() {
        if (this.cloudMesh) {
            this.scene.remove(this.cloudMesh);
            this.cloudMesh.geometry.dispose();
            this.cloudMesh.material.dispose();
        }
    }
}