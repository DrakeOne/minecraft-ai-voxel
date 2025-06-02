# Minecraft AI Voxel 🎮

Un juego profesional tipo Minecraft construido con Three.js, optimizado para rendimiento y compatible con dispositivos móviles.

## 🚀 Demo en Vivo

[Jugar ahora](https://drakeone.github.io/minecraft-ai-voxel/)

## 🆕 Actualización Mayor - Terreno 3D y Debug

### ✨ Nuevas Características:

#### 1. **Generación de Terreno 3D**
- Sistema de densidad 3D para terreno más natural
- Cuevas y overhangs generados proceduralmente
- Biomas básicos (llanuras, colinas, montañas, océano)
- Transiciones suaves entre biomas

#### 2. **F3 Debug Overlay**
- Presiona F3 para ver información detallada
- FPS y coordenadas del jugador
- Información de chunks y bloques
- Estado de workers y memoria
- Dirección de vista y bioma actual

#### 3. **Modo Vuelo**
- Presiona F para activar/desactivar
- 5x velocidad de movimiento normal
- Controles Q/E para subir/bajar
- Indicador visual de estado de vuelo

### 🎮 Controles:

#### Desktop
- **WASD / Flechas** - Movimiento
- **Mouse** - Rotar cámara
- **Click izquierdo** - Romper bloque
- **Click derecho** - Colocar bloque
- **Espacio** - Saltar
- **F** - Toggle modo vuelo
- **Q/E** - Subir/Bajar (en modo vuelo)
- **F3** - Debug overlay
- **Click en canvas** - Capturar mouse

#### Móvil
- **Joystick izquierdo** - Movimiento
- **Deslizar en pantalla** - Rotar cámara
- **Botón JUMP** - Saltar
- **Botón BREAK** - Romper bloque
- **Botón PLACE** - Colocar bloque
- **Botón FLY** - Toggle modo vuelo
- **Botones ▲/▼** - Subir/Bajar (en modo vuelo)

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

## 🎯 Características Técnicas

### 🌍 Generación de Terreno
- **Sistema de Densidad 3D** para terreno natural
- **Cuevas y Overhangs** generados proceduralmente
- **Biomas** con transiciones suaves
- **Capas de bloques** (grass, dirt, stone)

### ⚡ Optimizaciones
- **Frustum Culling** - Solo renderiza chunks visibles
- **Face Culling** - Solo caras visibles
- **Web Workers** - Generación asíncrona
- **Object Pooling** - Gestión eficiente de memoria

### 📱 Soporte Móvil
- **Controles táctiles** optimizados
- **UI adaptativa**
- **Joystick virtual**
- **Botones de acción**

### 🔍 Debug (F3)
- **FPS y coordenadas**
- **Chunks cargados**
- **Faces renderizadas**
- **Estado de workers**
- **Uso de memoria**

## 🛠️ Desarrollo

### Estructura del Proyecto
```
minecraft-ai-voxel/
├── index.html          # Entrada principal
├── css/
│   └── styles.css      # Estilos
└── js/
    ├── config.js       # Configuración
    ├── main.js         # Loop principal
    ├── world/
    │   ├── World.js    # Gestión del mundo
    │   ├── Chunk.js    # Chunks y mesh
    │   └── DensityGenerator.js # Generación 3D
    ├── player/
    │   └── Player.js   # Física y controles
    ├── input/
    │   └── InputHandler.js # Input y touch
    └── ui/
        └── DebugOverlay.js # Overlay F3
```

### 🚀 Instalación Local

1. **Clonar el repositorio**
```bash
git clone https://github.com/DrakeOne/minecraft-ai-voxel.git
```

2. **Servir localmente**
```bash
# Python
python -m http.server 8000
# O usar Live Server en VS Code
```

3. **Visitar**
```
http://localhost:8000
```

## 🤝 Contribuciones

¡Las contribuciones son bienvenidas! Por favor:

1. Fork el proyecto
2. Crea tu feature branch
3. Commit tus cambios
4. Push a la branch
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.

## 🙏 Agradecimientos

- Three.js por el motor 3D
- La comunidad de Minecraft por la inspiración
- Todos los contribuidores

---

Hecho con ❤️ por Daniel L.