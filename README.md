# Minecraft AI Voxel 🎮

Un juego profesional tipo Minecraft construido con Three.js, optimizado para rendimiento y compatible con dispositivos móviles.

## 🚀 Demo en Vivo

[Jugar ahora](https://drakeone.github.io/minecraft-ai-voxel/)

## 🆕 Actualización Mayor - Arquitectura Modular

El proyecto ha sido completamente refactorizado con una arquitectura modular profesional:

- ✅ **Código Modular** - Separado en módulos ES6 organizados
- ✅ **Física Corregida** - Sin más bugs de salto infinito
- ✅ **Face Culling Arreglado** - Renderizado correcto de caras
- ✅ **Frustum Culling** - Optimización de renderizado mejorada

Ver [REFACTORING_COMPLETE.md](REFACTORING_COMPLETE.md) para detalles.

## 📊 Análisis Profesional

Se ha realizado un análisis técnico exhaustivo del proyecto. Consulta los siguientes documentos:

- 📋 **[Análisis Técnico Completo](PROFESSIONAL_ANALYSIS.md)** - Evaluación detallada de la arquitectura
- 🚀 **[Guía de Optimización](OPTIMIZATION_GUIDE.md)** - Implementaciones con código para mejoras de rendimiento
- 📈 **[Benchmarks de Rendimiento](PERFORMANCE_BENCHMARKS.md)** - Métricas actuales y proyecciones
- 📊 **[Resumen del Análisis](docs/ANALYSIS_SUMMARY.md)** - Resumen ejecutivo con hallazgos clave

## ✨ Características

### 🎯 Gameplay
- **Mundo voxel infinito** con generación procedural de chunks
- **Sistema de construcción/destrucción** de bloques
- **Física realista** con gravedad y salto (corregida)
- **Controles FPS** fluidos con captura de mouse

### 📱 Optimización Móvil
- **Joystick virtual** para movimiento
- **Botones táctiles** para acciones (saltar, colocar, romper)
- **Controles táctiles** para rotar la cámara
- **Interfaz adaptativa** que detecta dispositivos móviles

### ⚡ Optimizaciones de Rendimiento
- **Frustum Culling** - Solo renderiza chunks en el campo de visión
- **Face Culling** - Solo renderiza caras visibles
- **Gestión eficiente de chunks** - Carga/descarga dinámica basada en distancia
- **Geometría combinada** - Reduce draw calls mediante mesh merging
- **Vertex colors** en lugar de texturas para mejor rendimiento

### 🛠️ Características Técnicas
- **Three.js r128** para gráficos 3D
- **Arquitectura modular** con ES6 modules
- **Compatible con GitHub Pages**
- **Responsive design** para cualquier tamaño de pantalla
- **60 FPS objetivo** con contador de rendimiento

## 🏗️ Estructura del Proyecto

```
minecraft-ai-voxel/
├── index.html          # Entrada principal (minimalista)
├── css/
│   └── styles.css      # Todos los estilos
└── js/
    ├── config.js       # Configuración global
    ├── main.js         # Inicialización y game loop
    ├── world/
    │   ├── World.js    # Gestión del mundo y frustum culling
    │   └── Chunk.js    # Generación y renderizado de chunks
    ├── player/
    │   └── Player.js   # Física y controles del jugador
    └── input/
        └── InputHandler.js # Manejo de entrada (teclado/mouse/touch)
```

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

## 🚀 Instalación y Uso

1. **Clonar el repositorio**
```bash
git clone https://github.com/DrakeOne/minecraft-ai-voxel.git
```

2. **Abrir localmente**
```bash
# Opción 1: Usar un servidor local (recomendado para módulos ES6)
python -m http.server 8000
# Luego visitar http://localhost:8000

# Opción 2: Usar Live Server en VS Code
```

3. **Deploy en GitHub Pages**
- Ve a Settings > Pages
- Source: Deploy from a branch
- Branch: main / root
- Save

## 🔧 Configuración

Puedes ajustar la configuración del juego modificando `js/config.js`:

```javascript
export const config = {
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

- [ ] Implementar Greedy Meshing (reducción 60-80% de geometría)
- [ ] Sistema de inventario
- [ ] Más tipos de bloques con texturas
- [ ] Generación de terreno más compleja
- [ ] Iluminación dinámica
- [ ] Sistema de crafteo
- [ ] Guardado/carga de mundos
- [ ] Sonidos y música
- [ ] Multijugador básico
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