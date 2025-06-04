// Sky.js - Beautiful gradient sky system for infinite worlds
export class Sky {
    constructor(scene) {
        this.scene = scene;
        this.time = 0;
        
        // Create sky dome
        this.createSkyDome();
        
        // Set initial fog
        this.updateFog();
    }
    
    createSkyDome() {
        // Create a large hemisphere for the sky
        const skyGeometry = new THREE.SphereGeometry(1000, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
        
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
                    // Create smooth gradient
                    float h = normalize(vWorldPosition).y;
                    h = max(0.0, h + offset);
                    
                    // Mix colors for smooth transition
                    vec3 color;
                    if (h < 0.5) {
                        // Bottom to horizon
                        float t = h * 2.0;
                        t = pow(t, exponent);
                        color = mix(bottomColor, horizonColor, t);
                    } else {
                        // Horizon to top
                        float t = (h - 0.5) * 2.0;
                        t = pow(t, 1.0 / exponent);
                        color = mix(horizonColor, topColor, t);
                    }
                    
                    // Add slight atmospheric scattering effect
                    float scatter = 1.0 - pow(max(0.0, vY), 3.0);
                    color = mix(color, horizonColor, scatter * 0.2);
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            uniforms: {
                topColor: { value: new THREE.Color(0x0077ff) }, // Deep blue
                bottomColor: { value: new THREE.Color(0x89b2eb) }, // Light blue
                horizonColor: { value: new THREE.Color(0xbdd4f1) }, // Very light blue
                offset: { value: 0.1 },
                exponent: { value: 0.8 }
            },
            side: THREE.BackSide,
            depthWrite: false
        });
        
        this.skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
        this.skyDome.rotation.x = Math.PI;
        this.scene.add(this.skyDome);
        
        // Store material for updates
        this.skyMaterial = skyMaterial;
        
        // Add subtle gradient plane at horizon for better blending
        const horizonGeometry = new THREE.PlaneGeometry(2000, 100);
        const horizonMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                varying vec2 vUv;
                
                void main() {
                    float alpha = 1.0 - vUv.y;
                    alpha = pow(alpha, 2.0);
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            uniforms: {
                color: { value: new THREE.Color(0xbdd4f1) }
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        
        // Create 4 horizon planes (north, south, east, west)
        const horizonPlanes = [];
        for (let i = 0; i < 4; i++) {
            const plane = new THREE.Mesh(horizonGeometry, horizonMaterial);
            plane.position.y = 0;
            plane.rotation.x = -Math.PI / 2;
            plane.rotation.z = (Math.PI / 2) * i;
            
            // Position planes at distance
            const angle = (Math.PI / 2) * i;
            plane.position.x = Math.cos(angle) * 900;
            plane.position.z = Math.sin(angle) * 900;
            
            // Rotate to face center
            plane.lookAt(0, 0, 0);
            plane.rotateX(-Math.PI / 2);
            
            horizonPlanes.push(plane);
            this.scene.add(plane);
        }
        
        this.horizonPlanes = horizonPlanes;
    }
    
    updateFog() {
        // Update fog color to match sky
        const fogColor = new THREE.Color(0x89b2eb);
        this.scene.fog.color = fogColor;
        
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
            
            // Also update horizon planes
            this.horizonPlanes.forEach((plane, i) => {
                const angle = (Math.PI / 2) * i;
                plane.position.x = camera.position.x + Math.cos(angle) * 900;
                plane.position.z = camera.position.z + Math.sin(angle) * 900;
            });
        }
        
        // Subtle color animation (optional - can be removed for static sky)
        const subtle = Math.sin(this.time * 0.1) * 0.02;
        this.skyMaterial.uniforms.exponent.value = 0.8 + subtle;
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
        
        this.horizonPlanes.forEach(plane => {
            this.scene.remove(plane);
            plane.geometry.dispose();
            plane.material.dispose();
        });
    }
}