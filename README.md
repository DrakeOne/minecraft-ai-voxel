# Minecraft AI Voxel 🎮

Un juego profesional tipo Minecraft construido con Three.js, optimizado para rendimiento y compatible con dispositivos móviles.

## 🚀 Demo en Vivo

[Jugar ahora](https://drakeone.github.io/minecraft-ai-voxel/)

## ✨ Características

### 🎯 Gameplay
- **Mundo voxel infinito** con generación procedural de chunks
- **Sistema de construcción/destrucción** de bloques
- **Física realista** con gravedad y salto
- **Controles FPS** fluidos con captura de mouse

### 📱 Optimización Móvil
- **Joystick virtual** para movimiento
- **Botones táctiles** para acciones (saltar, colocar, romper)
- **Controles táctiles** para rotar la cámara
- **Interfaz adaptativa** que detecta dispositivos móviles

### ⚡ Optimizaciones de Rendimiento
- **Culling de caras ocultas** - Solo renderiza caras visibles
- **Gestión eficiente de chunks** - Carga/descarga dinámica basada en distancia
- **Geometría combinada** - Reduce draw calls mediante mesh merging
- **Vertex colors** en lugar de texturas para mejor rendimiento
- **LOD implícito** mediante distancia de renderizado configurable

### 🛠️ Características Técnicas
- **Three.js r128** para gráficos 3D
- **Sin dependencias externas** - Todo en un solo archivo HTML
- **Compatible con GitHub Pages**
- **Responsive design** para cualquier tamaño de pantalla
- **60 FPS objetivo** con contador de rendimiento

## 🎮 Controles

### Desktop
- **WASD / Flechas** - Movimiento
- **Mouse** - Rotar cámara
- **Click izquierdo** - Romper bloque
- **Click derecho** - Colocar bloque
- **Espacio** - Saltar
- **Click en canvas** - Capturar mouse

### Móvil
- **Joystick izquierdo** - Movimiento
- **Deslizar en pantalla** - Rotar cámara
- **Botón JUMP** - Saltar
- **Botón BREAK** - Romper bloque
- **Botón PLACE** - Colocar bloque

## 🏗️ Arquitectura

### Sistema de Chunks
```javascript
- Tamaño de chunk: 16x16x16 bloques
- Distancia de renderizado: 4 chunks
- Carga/descarga dinámica
- Culling de caras por chunk
```

### Tipos de Bloques
- **Aire** (0) - Espacio vacío
- **Césped** (1) - Bloque verde
- **Tierra** (2) - Bloque marrón
- **Piedra** (3) - Bloque gris
- **Madera** (4) - Bloque marrón oscuro

### Optimizaciones Implementadas
1. **Frustum Culling** - Solo renderiza chunks visibles
2. **Face Culling** - Solo renderiza caras expuestas al aire
3. **Mesh Merging** - Combina geometría por chunk
4. **Object Pooling** - Reutiliza objetos para reducir GC
5. **Efficient Data Structures** - Uint8Array para almacenamiento de bloques

## 🚀 Instalación y Uso

1. **Clonar el repositorio**
```bash
git clone https://github.com/DrakeOne/minecraft-ai-voxel.git
```

2. **Abrir localmente**
```bash
# Opción 1: Abrir directamente el archivo
open index.html

# Opción 2: Usar un servidor local
python -m http.server 8000
# Luego visitar http://localhost:8000
```

3. **Deploy en GitHub Pages**
- Ve a Settings > Pages
- Source: Deploy from a branch
- Branch: main / root
- Save

## 🔧 Configuración

Puedes ajustar la configuración del juego modificando el objeto `config`:

```javascript
const config = {
    chunkSize: 16,          // Tamaño de cada chunk
    renderDistance: 4,      // Chunks a renderizar
    blockSize: 1,          // Tamaño de cada bloque
    gravity: -20,          // Fuerza de gravedad
    jumpVelocity: 10,      // Velocidad de salto
    moveSpeed: 5,          // Velocidad de movimiento
    mouseSensitivity: 0.002 // Sensibilidad del mouse
};
```

## 📈 Roadmap Futuro

- [ ] Más tipos de bloques con texturas
- [ ] Sistema de inventario
- [ ] Generación de terreno más compleja
- [ ] Iluminación dinámica
- [ ] Multijugador básico
- [ ] Sonidos y música
- [ ] Sistema de crafteo
- [ ] Guardado/carga de mundos
- [ ] Mobs y entidades
- [ ] Ciclo día/noche

## 🤝 Contribuciones

Las contribuciones son bienvenidas! Por favor:

1. Fork el proyecto
2. Crea tu feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la branch (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para detalles.

## 🙏 Agradecimientos

- Three.js por el increíble motor 3D
- La comunidad de Minecraft por la inspiración
- Todos los contribuidores y testers

---

Hecho con ❤️ por Daniel L.