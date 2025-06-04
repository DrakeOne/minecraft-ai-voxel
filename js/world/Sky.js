// Sky.js - Beautiful gradient sky system for infinite worlds
export class Sky {
    constructor(scene) {
        this.scene = scene;
        this.time = 0;
        
        // Create sky dome
        this.createSkyDome();
        
        // Set initial fog with reduced density
        this.updateFog();
    }
    
    createSkyDome() {
        // Create a full sphere instead of hemisphere to avoid the dark circle issue
        const skyGeometry = new THREE.SphereGeometry(1000, 32, 32);
        
        // Create gradient material with vertex colors
        const skyMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vWorldPosition;
                varying float vY;
                
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    vY = normalize(position).y;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform vec3 horizonColor;
                uniform float offset;
                uniform float exponent;
                
                varying vec3 vWorldPosition;
                varying float vY;
                
                void main() {
                    // Use view-based gradient instead of world position
                    float h = vY;
                    
                    // Adjust the gradient curve
                    h = clamp(h + offset, -1.0, 1.0);
                    
                    // Remap from [-1, 1] to [0, 1]
                    float factor = (h + 1.0) * 0.5;
                    
                    // Create smooth gradient with better curve
                    vec3 color;
                    if (factor < 0.5) {
                        // Bottom to horizon - use smoother transition
                        float t = factor * 2.0;
                        t = smoothstep(0.0, 1.0, t);
                        color = mix(bottomColor, horizonColor, t);
                    } else {
                        // Horizon to top - more gradual transition
                        float t = (factor - 0.5) * 2.0;
                        t = pow(t, 0.6); // Less aggressive curve
                        color = mix(horizonColor, topColor, t);
                    }
                    
                    // Remove atmospheric scattering that was causing the dark circle
                    // Just use the clean gradient
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            uniforms: {
                topColor: { value: new THREE.Color(0x0084ff) }, // More vibrant blue
                bottomColor: { value: new THREE.Color(0xffffff) }, // White at bottom for cleaner look
                horizonColor: { value: new THREE.Color(0x87ceeb) }, // Classic sky blue
                offset: { value: 0.0 },
                exponent: { value: 0.6 }
            },
            side: THREE.BackSide,
            depthWrite: false
        });
        
        this.skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(this.skyDome);
        
        // Store material for updates
        this.skyMaterial = skyMaterial;
        
        // Remove horizon planes as they might be causing visual issues
        // The full sphere with proper gradient should be enough
    }
    
    updateFog() {
        // Update fog with reduced density (increased far distance)
        const fogColor = new THREE.Color(0x87ceeb); // Match horizon color
        this.scene.fog = new THREE.Fog(
            fogColor, 
            20, // Start distance (slightly increased)
            config.chunkSize * config.renderDistance * 2.5 // Far distance (increased from 1.5)
        );
        
        // Also update renderer clear color
        if (window.renderer) {
            window.renderer.setClearColor(fogColor);
        }
    }
    
    update(deltaTime, camera) {
        this.time += deltaTime;
        
        // Make sky dome follow camera position (infinite sky effect)
        if (camera && this.skyDome) {
            this.skyDome.position.x = camera.position.x;
            this.skyDome.position.z = camera.position.z;
            // Keep sky dome centered vertically on camera
            this.skyDome.position.y = camera.position.y;
        }
        
        // Remove the subtle animation to keep it static and clean
    }
    
    // Set custom sky colors
    setColors(top, horizon, bottom) {
        this.skyMaterial.uniforms.topColor.value = new THREE.Color(top);
        this.skyMaterial.uniforms.horizonColor.value = new THREE.Color(horizon);
        this.skyMaterial.uniforms.bottomColor.value = new THREE.Color(bottom);
        
        // Update fog to match
        this.scene.fog.color = new THREE.Color(horizon);
        if (window.renderer) {
            window.renderer.setClearColor(new THREE.Color(horizon));
        }
    }
    
    dispose() {
        if (this.skyDome) {
            this.scene.remove(this.skyDome);
            this.skyDome.geometry.dispose();
            this.skyDome.material.dispose();
        }
    }
}