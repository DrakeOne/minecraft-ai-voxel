// DEBUG: Agrega logs exhaustivos en el main loop
import { config, stats } from './config.js';
import { World } from './world/World.js';
import { Player } from './player/Player.js';
import { InputHandler } from './input/InputHandler.js';
import { WorkerManager } from './world/WorkerManager.js';

console.log('[Main] Initializing game with config:', config);

// Initialize Three.js
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87CEEB, 10, config.chunkSize * config.renderDistance * 1.5);
scene.background = new THREE.Color(0x87CEEB);

// Camera setup
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

// Renderer setup with optimizations
const canvas = document.getElementById('gameCanvas');
if (!canvas) {
    console.error('[Main] Canvas element not found!');
    throw new Error('Canvas element not found');
}

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: "high-performance",
    alpha: false,
    stencil: false,
    depth: true
});

console.log('[Main] Renderer created with capabilities:', {
    webgl2: renderer.capabilities.isWebGL2,
    maxTextures: renderer.capabilities.maxTextures,
    maxVertices: renderer.capabilities.maxVertices
});

// Make renderer globally accessible for resize handler
window.renderer = renderer;

// Ensure proper sizing
function updateRendererSize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    
    console.log('[Main] Renderer resized:', { width, height, pixelRatio: renderer.getPixelRatio() });
}

updateRendererSize();

// Enable optimizations
renderer.shadowMap.enabled = false;
renderer.sortObjects = true;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(50, 100, 50);
scene.add(directionalLight);

// Initialize game objects
console.log('[Main] Creating world instance...');
const world = new World(scene);

console.log('[Main] Creating player instance...');
const player = new Player(world);

console.log('[Main] Setting up input handler...');
const inputHandler = new InputHandler(canvas, player, world, camera, scene);

// Make stats globally accessible for UI
window.gameStats = stats;

// Listen for worker toggle events
window.addEventListener('toggleWorkers', (e) => {
    console.log('[Main] Toggle workers:', e.detail);
    if (e.detail) {
        // Enable workers
        config.features.useWorkers = true;
        if (!world.workerManager) {
            world.workerManager = new WorkerManager(world, scene);
        }
        // Check if workers initialized successfully
        setTimeout(() => {
            if (world.workerManager && world.workerManager.isEnabled()) {
                stats.workerStatus = 'enabled';
                console.log('[Main] Workers enabled successfully');
            } else {
                stats.workerStatus = 'failed';
                config.features.useWorkers = false;
                console.log('[Main] Workers failed to initialize');
            }
        }, 1000);
    } else {
        // Disable workers
        config.features.useWorkers = false;
        if (world.workerManager) {
            world.workerManager.dispose();
            world.workerManager = null;
        }
        stats.workerStatus = 'disabled';
        console.log('[Main] Workers disabled');
    }
});

// Prevent iOS bounce and ensure proper sizing
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());

// Game loop
let lastTime = performance.now();
let frameCount = 0;
let lastFpsUpdate = performance.now();

function animate() {
    const currentTime = performance.now();
    const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1);
    lastTime = currentTime;

    // Update FPS counter
    frameCount++;
    if (currentTime - lastFpsUpdate > 1000) {
        stats.fps = Math.round(frameCount * 1000 / (currentTime - lastFpsUpdate));
        frameCount = 0;
        lastFpsUpdate = currentTime;
        
        console.log('[Main] Performance stats:', {
            fps: stats.fps,
            visibleChunks: stats.visibleChunks,
            totalChunks: stats.totalChunks,
            faces: stats.totalFaces,
            frameTime: stats.frameTime.toFixed(2)
        });
        
        // Log world stats if available
        if (world.getStats) {
            const worldStats = world.getStats();
            console.log('[Main] World stats:', worldStats);
        }
    }

    // Update game state
    const input = inputHandler.getInput();
    player.update(deltaTime, input, camera);
    
    // Log player position every 60 frames
    if (frameCount % 60 === 0) {
        console.log('[Main] Player position:', {
            x: Math.floor(player.position.x),
            y: Math.floor(player.position.y),
            z: Math.floor(player.position.z)
        });
    }
    
    // Update chunks
    console.log('[Main] Updating chunks around player...');
    world.updateChunksAroundPlayer(player.position.x, player.position.z, camera, scene);

    // Update HUD
    document.getElementById('fps').textContent = `FPS: ${stats.fps}`;
    document.getElementById('coords').textContent = 
        `X: ${Math.floor(player.position.x)} Y: ${Math.floor(player.position.y)} Z: ${Math.floor(player.position.z)}`;
    document.getElementById('debug').textContent = 
        `Faces: ${stats.totalFaces} | Chunks: ${stats.visibleChunks}/${stats.totalChunks}`;

    // Render
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

// Start game
window.addEventListener('load', () => {
    console.log('[Main] Game loading...');
    
    // Hide loading screen
    setTimeout(() => {
        const loadingProgress = document.getElementById('loadingProgress');
        if (loadingProgress) {
            loadingProgress.style.width = '100%';
        }
        setTimeout(() => {
            const loading = document.getElementById('loading');
            if (loading) {
                loading.style.display = 'none';
                console.log('[Main] Loading screen hidden, starting game loop');
                animate();
            }
        }, 300);
    }, 100);
});

// Handle window resize
window.addEventListener('resize', () => {
    console.log('[Main] Window resized');
    updateRendererSize();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    console.log('[Main] Cleaning up...');
    if (world.dispose) {
        world.dispose();
    }
});