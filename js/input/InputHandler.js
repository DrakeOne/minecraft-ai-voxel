import { config, BlockType } from '../config.js';

// Input handling
export class InputHandler {
    constructor(canvas, player, world, camera, scene) {
        this.canvas = canvas;
        this.player = player;
        this.world = world;
        this.camera = camera;
        this.scene = scene;
        
        this.keys = {};
        this.mouse = { x: 0, y: 0, locked: false };
        this.touch = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 };
        this.joystick = { x: 0, y: 0, active: false };
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Keyboard
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
        });
        
        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // Mouse
        this.canvas.addEventListener('click', () => {
            if (!this.mouse.locked && !this.isMobile()) {
                this.canvas.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.mouse.locked = document.pointerLockElement === this.canvas;
        });

        document.addEventListener('mousemove', (e) => {
            if (this.mouse.locked) {
                this.mouse.x += e.movementX;
                this.mouse.y += e.movementY;
            }
        });

        // Mouse buttons
        this.canvas.addEventListener('mousedown', (e) => {
            if (this.mouse.locked) {
                if (e.button === 0) this.breakBlock();
                if (e.button === 2) this.placeBlock();
            }
        });

        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // Touch controls
        this.canvas.addEventListener('touchstart', (e) => {
            if (!this.joystick.active && e.touches.length === 1) {
                this.touch.active = true;
                this.touch.startX = e.touches[0].clientX;
                this.touch.startY = e.touches[0].clientY;
                this.touch.currentX = this.touch.startX;
                this.touch.currentY = this.touch.startY;
            }
        });

        this.canvas.addEventListener('touchmove', (e) => {
            if (this.touch.active && e.touches.length === 1) {
                e.preventDefault();
                this.touch.currentX = e.touches[0].clientX;
                this.touch.currentY = e.touches[0].clientY;
                
                const deltaX = this.touch.currentX - this.touch.startX;
                const deltaY = this.touch.currentY - this.touch.startY;
                
                this.mouse.x += deltaX * config.mobileMoveSensitivity;
                this.mouse.y += deltaY * config.mobileMoveSensitivity;
                
                this.touch.startX = this.touch.currentX;
                this.touch.startY = this.touch.currentY;
            }
        });

        this.canvas.addEventListener('touchend', () => {
            this.touch.active = false;
        });

        // Mobile controls
        this.setupMobileControls();

        // Window resize
        window.addEventListener('resize', () => {
            const width = window.innerWidth;
            const height = window.innerHeight;
            
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            
            if (window.renderer) {
                window.renderer.setSize(width, height, false);
                window.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            }
        });
    }

    setupMobileControls() {
        // Joystick
        const joystick = document.getElementById('joystick');
        const joystickKnob = document.getElementById('joystick-knob');
        
        if (!joystick || !joystickKnob) return;
        
        const handleJoystick = (e) => {
            const touch = e.touches[0];
            const rect = joystick.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            let deltaX = touch.clientX - centerX;
            let deltaY = touch.clientY - centerY;
            
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            const maxDistance = rect.width / 2 - 20;
            
            if (distance > maxDistance) {
                deltaX = (deltaX / distance) * maxDistance;
                deltaY = (deltaY / distance) * maxDistance;
            }
            
            joystickKnob.style.transform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px))`;
            
            this.joystick.x = deltaX / maxDistance;
            this.joystick.y = deltaY / maxDistance;
        };

        joystick.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.joystick.active = true;
            handleJoystick(e);
        });

        joystick.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (this.joystick.active) {
                handleJoystick(e);
            }
        });

        joystick.addEventListener('touchend', () => {
            this.joystick.active = false;
            this.joystick.x = 0;
            this.joystick.y = 0;
            joystickKnob.style.transform = 'translate(-50%, -50%)';
        });

        // Action buttons
        const jumpBtn = document.getElementById('jumpBtn');
        if (jumpBtn) {
            jumpBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.keys['Space'] = true;
            });
            
            jumpBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.keys['Space'] = false;
            });
        }

        const breakBtn = document.getElementById('breakBtn');
        if (breakBtn) {
            breakBtn.addEventListener('click', () => {
                this.breakBlock();
            });
        }

        const placeBtn = document.getElementById('placeBtn');
        if (placeBtn) {
            placeBtn.addEventListener('click', () => {
                this.placeBlock();
            });
        }
    }

    getInput() {
        const input = {
            forward: this.keys['KeyW'] || this.keys['ArrowUp'] || this.joystick.y < -0.3,
            backward: this.keys['KeyS'] || this.keys['ArrowDown'] || this.joystick.y > 0.3,
            left: this.keys['KeyA'] || this.keys['ArrowLeft'] || this.joystick.x < -0.3,
            right: this.keys['KeyD'] || this.keys['ArrowRight'] || this.joystick.x > 0.3,
            jump: this.keys['Space'],
            mouseX: this.mouse.x,
            mouseY: this.mouse.y
        };

        // Apply mouse movement to player rotation
        if (this.mouse.locked || this.touch.active || this.isMobile()) {
            this.player.rotation.y -= this.mouse.x * config.mouseSensitivity;
            this.player.rotation.x -= this.mouse.y * config.mouseSensitivity;
            this.player.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.player.rotation.x));
            
            this.mouse.x = 0;
            this.mouse.y = 0;
        }

        return input;
    }

    breakBlock() {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        
        const pos = this.player.position.clone();
        pos.y += this.player.eyeHeight;
        
        for (let i = 0; i < 50; i++) {
            const checkPos = pos.clone().add(
                raycaster.ray.direction.clone().multiplyScalar(i * 0.1)
            );
            
            const block = this.world.getBlockAt(checkPos.x, checkPos.y, checkPos.z);
            if (block !== BlockType.AIR) {
                this.world.setBlockAt(checkPos.x, checkPos.y, checkPos.z, BlockType.AIR, this.scene);
                break;
            }
        }
    }

    placeBlock() {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        
        const pos = this.player.position.clone();
        pos.y += this.player.eyeHeight;
        
        let lastEmpty = null;
        
        for (let i = 0; i < 50; i++) {
            const checkPos = pos.clone().add(
                raycaster.ray.direction.clone().multiplyScalar(i * 0.1)
            );
            
            const block = this.world.getBlockAt(checkPos.x, checkPos.y, checkPos.z);
            
            if (block === BlockType.AIR) {
                lastEmpty = checkPos.clone();
            } else if (lastEmpty) {
                // Don't place block if it would intersect with player
                const playerFeet = this.player.position.y;
                const playerHead = this.player.position.y + this.player.height;
                const blockY = Math.floor(lastEmpty.y);
                
                if (Math.floor(lastEmpty.x) === Math.floor(this.player.position.x) &&
                    Math.floor(lastEmpty.z) === Math.floor(this.player.position.z) &&
                    blockY >= playerFeet - 0.1 && blockY <= playerHead + 0.1) {
                    return;
                }
                
                this.world.setBlockAt(lastEmpty.x, lastEmpty.y, lastEmpty.z, BlockType.STONE, this.scene);
                break;
            }
        }
    }

    isMobile() {
        return window.matchMedia('(max-width: 768px)').matches || 
               window.matchMedia('(pointer: coarse)').matches;
    }
}