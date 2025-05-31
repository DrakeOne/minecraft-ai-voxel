import { config } from '../config.js';
import { BlockType } from '../config.js';

// Player controller with FIXED physics
export class Player {
    constructor(world) {
        this.world = world;
        this.position = new THREE.Vector3(8, 5, 8);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.rotation = new THREE.Euler(0, 0, 0, 'YXZ');
        this.isGrounded = false;
        this.canJump = true;
        
        // Player dimensions
        this.width = 0.8;
        this.height = 1.8;
        this.eyeHeight = 1.6;
    }

    update(deltaTime, input, camera) {
        // Apply gravity
        if (!this.isGrounded) {
            this.velocity.y += config.gravity * deltaTime;
            // Terminal velocity
            this.velocity.y = Math.max(this.velocity.y, -50);
        }

        // Movement
        const moveVector = new THREE.Vector3();
        
        if (input.forward) moveVector.z -= 1;
        if (input.backward) moveVector.z += 1;
        if (input.left) moveVector.x -= 1;
        if (input.right) moveVector.x += 1;

        if (moveVector.length() > 0) {
            moveVector.normalize();
            moveVector.multiplyScalar(config.moveSpeed);
            
            // Apply rotation
            moveVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation.y);
            
            this.velocity.x = moveVector.x;
            this.velocity.z = moveVector.z;
        } else {
            // Friction
            this.velocity.x *= 0.8;
            this.velocity.z *= 0.8;
        }

        // Jump
        if (input.jump && this.isGrounded && this.canJump) {
            this.velocity.y = config.jumpVelocity;
            this.isGrounded = false;
            this.canJump = false;
        }
        
        if (!input.jump) {
            this.canJump = true;
        }

        // FIXED: Proper collision detection
        this.updatePosition(deltaTime);

        // Update camera
        camera.position.copy(this.position);
        camera.position.y += this.eyeHeight;
        camera.rotation.order = 'YXZ';
        camera.rotation.y = this.rotation.y;
        camera.rotation.x = this.rotation.x;
    }

    updatePosition(deltaTime) {
        // Calculate next position
        const nextPos = this.position.clone();
        const movement = this.velocity.clone().multiplyScalar(deltaTime);
        
        // Check Y axis (vertical) first
        nextPos.y += movement.y;
        
        // Check feet and head positions
        const feetY = nextPos.y;
        const headY = nextPos.y + this.height;
        
        // Ground check (moving down)
        if (this.velocity.y <= 0) {
            // Check multiple points for feet
            const footPositions = [
                { x: nextPos.x - this.width/3, z: nextPos.z - this.width/3 },
                { x: nextPos.x + this.width/3, z: nextPos.z - this.width/3 },
                { x: nextPos.x - this.width/3, z: nextPos.z + this.width/3 },
                { x: nextPos.x + this.width/3, z: nextPos.z + this.width/3 },
                { x: nextPos.x, z: nextPos.z } // Center
            ];
            
            let hitGround = false;
            let highestGround = -Infinity;
            
            for (const foot of footPositions) {
                // Check a small distance below feet
                for (let checkY = feetY; checkY >= feetY - 0.1; checkY -= 0.05) {
                    const block = this.world.getBlockAt(foot.x, checkY, foot.z);
                    if (block !== BlockType.AIR) {
                        hitGround = true;
                        highestGround = Math.max(highestGround, Math.floor(checkY) + 1);
                        break;
                    }
                }
            }
            
            if (hitGround) {
                nextPos.y = highestGround;
                this.velocity.y = 0;
                this.isGrounded = true;
            } else {
                this.isGrounded = false;
            }
        }
        
        // Ceiling check (moving up)
        if (this.velocity.y > 0) {
            const headPositions = [
                { x: nextPos.x - this.width/3, z: nextPos.z - this.width/3 },
                { x: nextPos.x + this.width/3, z: nextPos.z - this.width/3 },
                { x: nextPos.x - this.width/3, z: nextPos.z + this.width/3 },
                { x: nextPos.x + this.width/3, z: nextPos.z + this.width/3 }
            ];
            
            for (const head of headPositions) {
                const block = this.world.getBlockAt(head.x, headY, head.z);
                if (block !== BlockType.AIR) {
                    this.velocity.y = 0;
                    break;
                }
            }
        }
        
        // Update Y position
        this.position.y = nextPos.y;
        
        // Check X axis (horizontal)
        nextPos.x = this.position.x + movement.x;
        if (this.checkHorizontalCollision(nextPos.x, this.position.y, this.position.z)) {
            this.velocity.x = 0;
        } else {
            this.position.x = nextPos.x;
        }
        
        // Check Z axis (horizontal)
        nextPos.z = this.position.z + movement.z;
        if (this.checkHorizontalCollision(this.position.x, this.position.y, nextPos.z)) {
            this.velocity.z = 0;
        } else {
            this.position.z = nextPos.z;
        }
    }

    checkHorizontalCollision(x, y, z) {
        // Check collision at multiple heights
        const checkHeights = [
            y + 0.1,           // Feet
            y + this.height/2, // Middle
            y + this.height - 0.1  // Head
        ];
        
        const checkPoints = [
            { x: x - this.width/2, z: z - this.width/2 },
            { x: x + this.width/2, z: z - this.width/2 },
            { x: x - this.width/2, z: z + this.width/2 },
            { x: x + this.width/2, z: z + this.width/2 }
        ];
        
        for (const height of checkHeights) {
            for (const point of checkPoints) {
                const block = this.world.getBlockAt(point.x, height, point.z);
                if (block !== BlockType.AIR) {
                    return true;
                }
            }
        }
        
        return false;
    }
}