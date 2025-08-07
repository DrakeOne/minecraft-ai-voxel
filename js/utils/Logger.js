/**
 * Sistema de Logger Profesional
 * Controla todos los console.log del juego de manera centralizada
 * Configurable desde el menú de settings
 */

class LoggerSystem {
    constructor() {
        // Niveles de log
        this.LOG_LEVELS = {
            NONE: 0,
            ERROR: 1,
            WARN: 2,
            INFO: 3,
            DEBUG: 4,
            VERBOSE: 5
        };
        
        // Configuración por defecto - PRODUCCIÓN
        this.config = {
            enabled: false,  // Deshabilitado por defecto
            level: this.LOG_LEVELS.ERROR,  // Solo errores en producción
            showTimestamp: true,
            showCategory: true,
            colorize: true,
            performanceMetrics: false,
            logToBuffer: true,  // Guardar logs en buffer para debug
            bufferSize: 100
        };
        
        // Buffer de logs para análisis posterior
        this.logBuffer = [];
        
        // Colores para diferentes niveles
        this.colors = {
            ERROR: 'color: #ff5252; font-weight: bold;',
            WARN: 'color: #ffa726; font-weight: bold;',
            INFO: 'color: #66bb6a;',
            DEBUG: 'color: #42a5f5;',
            VERBOSE: 'color: #9e9e9e;'
        };
        
        // Cargar configuración guardada si existe
        this.loadConfig();
        
        // Métricas de rendimiento
        this.metrics = {
            totalLogs: 0,
            suppressedLogs: 0,
            errorCount: 0,
            warnCount: 0
        };
    }
    
    /**
     * Cargar configuración desde localStorage
     */
    loadConfig() {
        try {
            const saved = localStorage.getItem('loggerConfig');
            if (saved) {
                const savedConfig = JSON.parse(saved);
                Object.assign(this.config, savedConfig);
            }
        } catch (e) {
            // Silenciar error si localStorage no está disponible
        }
    }
    
    /**
     * Guardar configuración en localStorage
     */
    saveConfig() {
        try {
            localStorage.setItem('loggerConfig', JSON.stringify(this.config));
        } catch (e) {
            // Silenciar error si localStorage no está disponible
        }
    }
    
    /**
     * Habilitar/Deshabilitar logging
     */
    setEnabled(enabled) {
        this.config.enabled = enabled;
        this.saveConfig();
        
        if (enabled) {
            this.info('[Logger] Logging habilitado');
        }
    }
    
    /**
     * Establecer nivel de log
     */
    setLevel(level) {
        if (typeof level === 'string') {
            level = this.LOG_LEVELS[level.toUpperCase()] || this.LOG_LEVELS.ERROR;
        }
        
        this.config.level = level;
        this.saveConfig();
        
        const levelName = Object.keys(this.LOG_LEVELS).find(key => this.LOG_LEVELS[key] === level);
        this.info(`[Logger] Nivel de log establecido a: ${levelName}`);
    }
    
    /**
     * Configurar opciones adicionales
     */
    configure(options) {
        Object.assign(this.config, options);
        this.saveConfig();
    }
    
    /**
     * Método interno de logging
     */
    _log(level, category, message, ...args) {
        this.metrics.totalLogs++;
        
        // Verificar si debe loggear
        if (!this.config.enabled || level > this.config.level) {
            this.metrics.suppressedLogs++;
            return;
        }
        
        // Construir mensaje
        let logMessage = '';
        
        if (this.config.showTimestamp) {
            const now = new Date();
            logMessage += `[${now.toLocaleTimeString()}.${now.getMilliseconds().toString().padStart(3, '0')}] `;
        }
        
        if (this.config.showCategory) {
            logMessage += category + ' ';
        }
        
        logMessage += message;
        
        // Agregar al buffer si está habilitado
        if (this.config.logToBuffer) {
            this.logBuffer.push({
                timestamp: Date.now(),
                level: Object.keys(this.LOG_LEVELS).find(key => this.LOG_LEVELS[key] === level),
                category,
                message,
                args
            });
            
            // Mantener el buffer dentro del límite
            if (this.logBuffer.length > this.config.bufferSize) {
                this.logBuffer.shift();
            }
        }
        
        // Determinar método de console a usar
        const levelName = Object.keys(this.LOG_LEVELS).find(key => this.LOG_LEVELS[key] === level);
        let consoleMethod = console.log;
        
        switch (levelName) {
            case 'ERROR':
                consoleMethod = console.error;
                this.metrics.errorCount++;
                break;
            case 'WARN':
                consoleMethod = console.warn;
                this.metrics.warnCount++;
                break;
            case 'INFO':
                consoleMethod = console.info;
                break;
            case 'DEBUG':
            case 'VERBOSE':
                consoleMethod = console.log;
                break;
        }
        
        // Aplicar colores si está habilitado
        if (this.config.colorize && this.colors[levelName]) {
            consoleMethod(`%c${logMessage}`, this.colors[levelName], ...args);
        } else {
            consoleMethod(logMessage, ...args);
        }
    }
    
    /**
     * Métodos públicos de logging
     */
    error(message, ...args) {
        this._log(this.LOG_LEVELS.ERROR, '[ERROR]', message, ...args);
    }
    
    warn(message, ...args) {
        this._log(this.LOG_LEVELS.WARN, '[WARN]', message, ...args);
    }
    
    info(message, ...args) {
        this._log(this.LOG_LEVELS.INFO, '[INFO]', message, ...args);
    }
    
    debug(message, ...args) {
        this._log(this.LOG_LEVELS.DEBUG, '[DEBUG]', message, ...args);
    }
    
    verbose(message, ...args) {
        this._log(this.LOG_LEVELS.VERBOSE, '[VERBOSE]', message, ...args);
    }
    
    /**
     * Log de rendimiento (solo si está habilitado)
     */
    performance(label, value) {
        if (this.config.performanceMetrics) {
            this._log(this.LOG_LEVELS.DEBUG, '[PERF]', `${label}: ${value}`);
        }
    }
    
    /**
     * Obtener buffer de logs
     */
    getBuffer() {
        return [...this.logBuffer];
    }
    
    /**
     * Limpiar buffer de logs
     */
    clearBuffer() {
        this.logBuffer = [];
    }
    
    /**
     * Obtener métricas
     */
    getMetrics() {
        return {
            ...this.metrics,
            bufferSize: this.logBuffer.length,
            suppressionRate: this.metrics.totalLogs > 0 
                ? (this.metrics.suppressedLogs / this.metrics.totalLogs * 100).toFixed(2) + '%'
                : '0%'
        };
    }
    
    /**
     * Exportar logs para análisis
     */
    exportLogs() {
        const data = {
            config: this.config,
            metrics: this.getMetrics(),
            logs: this.logBuffer,
            timestamp: new Date().toISOString()
        };
        
        return JSON.stringify(data, null, 2);
    }
    
    /**
     * Método de conveniencia para medir tiempo
     */
    time(label) {
        if (this.config.performanceMetrics) {
            console.time(label);
        }
    }
    
    timeEnd(label) {
        if (this.config.performanceMetrics) {
            console.timeEnd(label);
        }
    }
}

// Crear instancia singleton
const Logger = new LoggerSystem();

// Exportar para uso global
export { Logger };

// También hacer disponible globalmente para debugging
if (typeof window !== 'undefined') {
    window.Logger = Logger;
}