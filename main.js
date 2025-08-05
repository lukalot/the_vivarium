import * as THREE from 'https://unpkg.com/three@0.158.0/build/three.module.js';

class ASCIITerminal {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.textMaterial = null;
        this.textGeometry = null;
        this.textMesh = null;
        
        // Terminal properties - these will be calculated dynamically
        this.targetCols = 160;  // Target number of columns we want to fit
        this.targetRows = 40;   // Target number of rows we want to fit
        this.minCharSize = 6;   // Minimum character size for readability
        this.maxCharSize = 24;  // Maximum character size
        
        // Calculated dynamically based on viewport
        this.charWidth = 8;
        this.charHeight = 16;
        this.cols = 80;
        this.rows = 25;
        
        // Terminal buffer - 2D array of characters
        this.buffer = [];
        this.cursor = { x: 0, y: 0 };
        
        // Input handling
        this.inputMode = true;  // Whether we're accepting input
        this.inputBuffer = ''; // Current line being typed
        this.inputStartX = 0;  // Where the current input line starts
        this.showCursor = true; // For blinking cursor
        
        // Three.js objects for each character
        this.characterMeshes = [];
        
        // Background meshes for full-width row backgrounds
        this.rowBackgroundMeshes = [];
        
        // Character texture cache to avoid recreating textures
        this.characterTextureCache = new Map();
        
        // Padding around screen edges (in characters)
        this.paddingX = 4; // 4 character width on each side
        this.paddingY = 2; // 2 character height on top and bottom
        
        // Vertical padding around title (in lines)
        this.titleVerticalPadding = 4; // Empty lines above and below title
        
        this.init();
        this.setupTerminal();
        this.animate();
        this.handleResize();
        
        // Add resize listener
        window.addEventListener('resize', () => this.handleResize());
        
        // Add keyboard listeners
        this.setupKeyboardInput();
        
        // Demo text is called by handleResize() above
    }
    
    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        // Camera - orthographic for 2D text rendering
        this.camera = new THREE.OrthographicCamera(
            window.innerWidth / -2,  // left
            window.innerWidth / 2,   // right
            window.innerHeight / 2,  // top
            window.innerHeight / -2, // bottom
            1,                       // near
            1000                     // far
        );
        this.camera.position.z = 100;
        
        // Renderer
        const canvas = document.getElementById('three-canvas');
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: canvas,
            antialias: false // Keep crisp pixels for terminal
        });
        
        // Set proper pixel ratio for high-DPI displays
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000);
        
        // We'll create individual textures for each character as needed
    }
    

    
    setupTerminal() {
        // Calculate terminal dimensions based on window size
        this.updateTerminalDimensions();
        
        // Initialize buffer
        this.initBuffer();
        
        // Create character meshes
        this.createCharacterMeshes();
    }
    
    updateTerminalDimensions() {
        // Calculate optimal character size based on target dimensions
        const targetCharWidth = window.innerWidth / this.targetCols;
        const targetCharHeight = window.innerHeight / this.targetRows;
        
        // Use the smaller dimension to maintain aspect ratio
        // Character height is typically 2x width for monospace fonts
        const baseSize = Math.min(targetCharWidth, targetCharHeight * 0.5);
        
        // Clamp to min/max sizes for readability
        const clampedSize = Math.max(this.minCharSize, Math.min(this.maxCharSize, baseSize));
        
        // Set character dimensions (width = height/2 for typical monospace ratio)
        this.charWidth = Math.floor(clampedSize);
        this.charHeight = Math.floor(clampedSize * 2);
        
        // Calculate total characters that fit on screen (for backgrounds)
        this.fullCols = Math.floor(window.innerWidth / this.charWidth);
        this.fullRows = Math.floor(window.innerHeight / this.charHeight);
        
        // Calculate usable text area (subtract padding)
        this.cols = this.fullCols - (this.paddingX * 2);
        this.rows = this.fullRows - (this.paddingY * 2);
        
        // Calculate scale factor for display
        const scaleFactorX = this.cols / this.targetCols;
        const scaleFactorY = this.rows / this.targetRows;
        const scaleFactor = Math.min(scaleFactorX, scaleFactorY);
        
        // Update debug info (only if elements exist)
        const terminalSizeEl = document.getElementById('terminal-size');
        const targetSizeEl = document.getElementById('target-size');
        const windowSizeEl = document.getElementById('window-size');
        const charSizeEl = document.getElementById('char-size');
        const scaleFactorEl = document.getElementById('scale-factor');
        const pixelRatioEl = document.getElementById('pixel-ratio');
        
        if (terminalSizeEl) terminalSizeEl.textContent = `${this.cols}×${this.rows}`;
        if (targetSizeEl) targetSizeEl.textContent = `${this.targetCols}×${this.targetRows}`;
        if (windowSizeEl) windowSizeEl.textContent = `${window.innerWidth}×${window.innerHeight}`;
        if (charSizeEl) charSizeEl.textContent = `${this.charWidth}×${this.charHeight}`;
        if (scaleFactorEl) scaleFactorEl.textContent = `${(scaleFactor * 100).toFixed(1)}%`;
        if (pixelRatioEl) pixelRatioEl.textContent = `${window.devicePixelRatio}x`;
        
        console.log(`Updated terminal: ${this.cols}×${this.rows} chars (${(scaleFactor * 100).toFixed(1)}% of target), size: ${this.charWidth}×${this.charHeight}px, DPR: ${window.devicePixelRatio}x`);
    }
    
    initBuffer() {
        this.buffer = [];
        for (let y = 0; y < this.fullRows; y++) {
            this.buffer[y] = [];
            for (let x = 0; x < this.fullCols; x++) {
                this.buffer[y][x] = ' ';
            }
        }
    }
    
    createCharacterMeshes() {
        // Clear existing meshes
        this.characterMeshes.forEach(row => {
            row.forEach(mesh => {
                if (mesh) {
                    this.scene.remove(mesh);
                }
            });
        });
        this.characterMeshes = [];
        
        // Clear existing row background meshes
        this.rowBackgroundMeshes.forEach(mesh => {
            if (mesh) {
                this.scene.remove(mesh);
            }
        });
        this.rowBackgroundMeshes = [];
        
        // Create geometry for a single character quad
        const geometry = new THREE.PlaneGeometry(this.charWidth, this.charHeight);
        
        // Create geometry for row backgrounds (full screen width, no padding)
        const rowBackgroundWidth = window.innerWidth;
        const rowBackgroundGeometry = new THREE.PlaneGeometry(rowBackgroundWidth, this.charHeight);
        
        // Calculate starting position (simple top-left corner, no padding offset for backgrounds)
        const startX = -window.innerWidth / 2 + this.charWidth / 2;
        const startY = window.innerHeight / 2 - this.charHeight / 2;
        
        // Create row background meshes first (so they appear behind characters) - full screen height
        for (let y = 0; y < this.fullRows; y++) {
            // Determine row background color based on even/odd
            const isEvenRow = y % 2 === 0;
            const defaultEvenBgColor = '#0a0a0a';
            const defaultOddBgColor = '#121212';
            
            // Use custom background colors if set, otherwise use defaults
            const evenBgColor = window.terminalEvenRowColor || defaultEvenBgColor;
            const oddBgColor = window.terminalOddRowColor || defaultOddBgColor;
            const backgroundColor = isEvenRow ? evenBgColor : oddBgColor;
            
            // Create background material
            const bgMaterial = new THREE.MeshBasicMaterial({
                color: new THREE.Color(backgroundColor),
                transparent: false
            });
            
            // Create background mesh
            const bgMesh = new THREE.Mesh(rowBackgroundGeometry, bgMaterial);
            bgMesh.position.set(
                0, // Center horizontally on full screen
                startY - y * this.charHeight,
                -1 // Behind characters
            );
            
            this.scene.add(bgMesh);
            this.rowBackgroundMeshes[y] = bgMesh;
        }
        
        // Create meshes for each character position (full screen grid)
        for (let y = 0; y < this.fullRows; y++) {
            this.characterMeshes[y] = [];
            for (let x = 0; x < this.fullCols; x++) {
                // Create material without initial texture (we'll add textures per character)
                const material = new THREE.MeshBasicMaterial({
                    transparent: true,
                    alphaTest: 0.1,
                    color: 0xffffff // White base color
                });
                
                // Create mesh
                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.set(
                    startX + x * this.charWidth,
                    startY - y * this.charHeight,
                    0 // In front of backgrounds
                );
                mesh.visible = false; // Start hidden until we have content
                
                this.scene.add(mesh);
                this.characterMeshes[y][x] = mesh;
            }
        }
    }
    
    updateCharacter(x, y, char) {
        // Auto-translate logical text coordinates to screen coordinates with padding
        const screenX = x + this.paddingX;
        const screenY = y + this.paddingY;
        

        if (x >= 0 && x < this.cols && y >= 0 && y < this.rows) {
            this.buffer[screenY][screenX] = char;
            
            // Update the texture for this character
            const mesh = this.characterMeshes[screenY][screenX];
            if (mesh) {
                // Create cache key for this character
                const cacheKey = char;
                
                let texture = this.characterTextureCache.get(cacheKey);
                
                // Only create new texture if not cached
                if (!texture) {
                    // Create a new canvas for this character at device pixel ratio resolution
                    const charCanvas = document.createElement('canvas');
                    const charCtx = charCanvas.getContext('2d');
                    
                    // Calculate high-DPI dimensions
                    const dpr = window.devicePixelRatio || 1;
                    const canvasWidth = this.charWidth * dpr;
                    const canvasHeight = this.charHeight * dpr;
                    
                    // Set actual canvas size (high-DPI)
                    charCanvas.width = canvasWidth;
                    charCanvas.height = canvasHeight;
                    
                    // Scale the context to match device pixel ratio
                    charCtx.scale(dpr, dpr);
                    
                    // Set font properties - use November font with fallbacks
                    const fontSize = Math.max(8, this.charHeight * 0.8);
                    charCtx.font = `${fontSize}px 'November', 'DejaVu Sans Mono', 'Consolas', 'Monaco', 'Courier New', monospace`;
                    charCtx.textAlign = 'center';
                    charCtx.textBaseline = 'middle';
                    
                    // Text color stays the same purple
                    const textColor = '#9d00ff';
                    
                    // Enable high-quality text rendering
                    charCtx.textRenderingOptimization = 'optimizeQuality';
                    charCtx.imageSmoothingEnabled = false; // Keep pixels crisp
                    
                    // Clear the canvas first (transparent background)
                    charCtx.clearRect(0, 0, this.charWidth, this.charHeight);
                    
                    // Draw the character at logical center with purple text
                    // Draw all characters except regular spaces (cursor █ should be drawn)
                    if (char !== ' ') {
                        charCtx.fillStyle = textColor;
                        charCtx.fillText(char, this.charWidth / 2, this.charHeight / 2);
                    }
                    
                    // Create new texture for this character
                    texture = new THREE.CanvasTexture(charCanvas);
                    texture.generateMipmaps = false;
                    texture.minFilter = THREE.NearestFilter;
                    texture.magFilter = THREE.NearestFilter;
                    texture.format = THREE.RGBAFormat; // Ensure alpha channel support
                    
                    // Cache the texture
                    this.characterTextureCache.set(cacheKey, texture);
                }
                
                // Replace the material's texture
                if (mesh.material.map && mesh.material.map !== texture) {
                    mesh.material.map.dispose();
                }
                mesh.material.map = texture;
                mesh.material.needsUpdate = true;
                
                // Make mesh visible for non-space characters (including cursor)
                mesh.visible = (char !== ' ');
            }
        }
    }
    
    writeText(text, x = null, y = null) {
        // Use current cursor position if not specified
        if (x !== null) this.cursor.x = x;
        if (y !== null) this.cursor.y = y;
        

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            
            if (char === '\n') {
                this.cursor.x = 0;
                this.cursor.y++;
            } else {
                this.updateCharacter(this.cursor.x, this.cursor.y, char);
                this.cursor.x++;
                
                // Wrap to next line if needed
                if (this.cursor.x >= this.cols) {
                    this.cursor.x = 0;
                    this.cursor.y++;
                }
            }
            
            // Scroll if needed
            if (this.cursor.y >= this.rows) {
                this.scrollUp();
                this.cursor.y = this.rows - 1;
            }
        }
    }
    
    scrollUp() {
        // Move all lines up by one (buffer is indexed by screen coordinates)
        for (let y = 0; y < this.rows - 1; y++) {
            for (let x = 0; x < this.cols; x++) {
                const sourceScreenX = x + this.paddingX;
                const sourceScreenY = (y + 1) + this.paddingY;
                const char = this.buffer[sourceScreenY] && this.buffer[sourceScreenY][sourceScreenX] ? this.buffer[sourceScreenY][sourceScreenX] : ' ';
                this.updateCharacter(x, y, char);
            }
        }
        
        // Clear the bottom line
        for (let x = 0; x < this.cols; x++) {
            this.updateCharacter(x, this.rows - 1, ' ');
        }
    }
    
    clear() {
        // Clear buffer (full screen)
        for (let y = 0; y < this.fullRows; y++) {
            for (let x = 0; x < this.fullCols; x++) {
                this.buffer[y][x] = ' ';
                // Hide all character meshes
                if (this.characterMeshes[y] && this.characterMeshes[y][x]) {
                    this.characterMeshes[y][x].visible = false;
                }
            }
        }
        this.cursor.x = 0;
        this.cursor.y = 0;
    }
    
    async handleResize() {
        // Update camera
        this.camera.left = window.innerWidth / -2;
        this.camera.right = window.innerWidth / 2;
        this.camera.top = window.innerHeight / 2;
        this.camera.bottom = window.innerHeight / -2;
        this.camera.updateProjectionMatrix();
        
        // Update renderer with proper pixel ratio
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // Clear texture cache since character dimensions changed
        this.characterTextureCache.clear();
        
        // Recreate terminal with new dimensions
        this.setupTerminal();
        
        // Redraw demo text
        await this.demoText();
    }
    
    async loadTitleFromFile(filename = 'glowy.txt') {
        try {
            const response = await fetch(`./assets/title/${filename}`);
            if (!response.ok) {
                throw new Error(`Failed to load title file: ${response.status}`);
            }
            const titleText = await response.text();
            return titleText.trim();
        } catch (error) {
            console.warn(`Could not load title from ${filename}:`, error);
            // Fallback to simple ASCII art
            return "╔══════════════════════════════════════════════════╗\n" +
                   "║                  THE VIVARIUM                    ║\n" +
                   "║            Universe Simulation Engine            ║\n" +
                   "╚══════════════════════════════════════════════════╝";
        }
    }

    writeCenteredText(text) {
        // Split text into lines and center each line horizontally
        const lines = text.split('\n');
        
        for (const line of lines) {
            // Calculate centering offset
            const lineWidth = line.length;
            const centerX = Math.max(0, Math.floor((this.cols - lineWidth) / 2));
            
            // Position cursor at centered x position, write the line
            this.writeText(line, centerX, this.cursor.y);
            
            // Move to next line
            this.cursor.x = 0;
            this.cursor.y++;
        }
    }

    async demoText(titleFile = 'glowy.txt') {   
        this.clear();
        
        // Add empty lines above title
        for (let i = 0; i < this.titleVerticalPadding; i++) {
            this.writeText("\n");
        }
        
        // Load and display the ASCII art title (centered)
        const titleArt = await this.loadTitleFromFile(titleFile);
        this.writeCenteredText(titleArt);

        this.writeText("\n");
        const messages = [
            "A simple game about the end of the world",
            "Welcome to the eschaton",
            "Enjoy your stay",
            "You're not supposed to be here",
            "This isn't a game",
            "Hyperstition is necessary",
            "Assistant is in a CLI mood today"
        ];
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        this.writeCenteredText(randomMessage);
        
        // Add empty lines below title
        for (let i = 0; i < this.titleVerticalPadding; i++) {
            this.writeText("\n");
        }
        
        this.writeText("Interactive terminal ready. Type and press Enter.");
        this.writeText("\n");
        
        // Set up input prompt
        this.writeText(">> ");
        this.inputStartX = this.cursor.x;
        this.inputBuffer = '';
        
        // Add blinking cursor
        this.addBlinkingCursor();
        
        // Update row backgrounds only (don't render all characters yet)
        this.updateRowBackgrounds();
    }
    
    addBlinkingCursor() {
        this.cursorInterval = setInterval(() => {
            if (this.inputMode) {
                this.showCursor = !this.showCursor;
                this.redrawInputLine(); // Redraw to update cursor
            }
        }, 700); // Slower blink rate - 750ms feels more natural
    }
    
    setupKeyboardInput() {
        // Make sure the canvas can receive focus
        const canvas = document.getElementById('three-canvas');
        canvas.tabIndex = 0; // Make it focusable
        canvas.focus(); // Focus it initially
        
        // Add keyboard event listeners
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keypress', (e) => this.handleKeyPress(e));
        
        // Ensure canvas stays focused when clicked
        canvas.addEventListener('click', () => {
            canvas.focus();
            console.log('Canvas focused');
        });
        
        console.log('Keyboard input setup complete');
    }
    
    handleKeyDown(event) {
        console.log(`KeyDown: "${event.key}", inputMode: ${this.inputMode}`);
        
        if (!this.inputMode) return;
        
        switch (event.key) {
            case 'Enter':
                console.log('Processing Enter key');
                this.handleEnter();
                event.preventDefault();
                break;
            case 'Backspace':
                console.log('Processing Backspace key');
                this.handleBackspace();
                event.preventDefault();
                break;
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'ArrowUp':
            case 'ArrowDown':
                // Handle arrow keys if needed later
                event.preventDefault();
                break;
            default:
                // Let keypress handle regular characters
                break;
        }
    }
    
    handleKeyPress(event) {
        console.log(`KeyPress: "${event.key}" (charCode: ${event.charCode}), inputMode: ${this.inputMode}`);
        
        if (!this.inputMode) return;
        
        // Only handle printable characters
        if (event.charCode >= 32 && event.charCode <= 126) {
            console.log(`Processing printable character: "${event.key}"`);
            this.addCharacterToInput(event.key);
            event.preventDefault();
        } else {
            console.log(`Ignoring non-printable character with charCode: ${event.charCode}`);
        }
    }
    
    handleEnter() {
        // Process the input (for now, just log it)
        console.log(`User input: "${this.inputBuffer}"`);
        
        // Move to next line
        this.cursor.y++;
        this.cursor.x = 0;
        this.inputStartX = 0;
        this.inputBuffer = '';
        
        // Scroll if needed
        if (this.cursor.y >= this.rows) {
            this.scrollUp();
            this.cursor.y = this.rows - 1;
        }
        
        // Add prompt for next input
        this.writeText('>> ');
        this.inputStartX = this.cursor.x;
        
        // Ensure cursor is visible for new input
        this.showCursor = true;
        this.redrawInputLine();
    }
    
    handleBackspace() {
        if (this.inputBuffer.length > 0) {
            // Remove character from input buffer
            this.inputBuffer = this.inputBuffer.slice(0, -1);
            
            // Redraw the input buffer (this will handle cursor positioning)
            this.redrawInputLine();
        }
    }
    
    addCharacterToInput(char) {
        console.log(`Adding character: "${char}"`);
        
        // Add to input buffer
        this.inputBuffer += char;
        console.log(`Input buffer now: "${this.inputBuffer}"`);
        
        // Check if we need to wrap (for now, limit to line width)
        const maxLineLength = this.cols - this.inputStartX - 1; // Leave space for cursor
        if (this.inputBuffer.length >= maxLineLength) {
            // For now, ignore characters that would exceed line length
            this.inputBuffer = this.inputBuffer.slice(0, -1);
            console.log('Character ignored - line too long');
            return;
        }
        
        // Redraw the input line
        console.log('Calling redrawInputLine...');
        this.redrawInputLine();
    }
    
    redrawInputLine() {
        // Clear the current input area by hiding meshes directly
        for (let i = this.inputStartX; i < this.cols; i++) {
            const screenX = i + this.paddingX;
            const screenY = this.cursor.y + this.paddingY;
            if (this.characterMeshes[screenY] && this.characterMeshes[screenY][screenX]) {
                this.characterMeshes[screenY][screenX].visible = false;
            }
        }
        
        // Draw the input buffer (updateCharacter handles padding automatically)
        for (let i = 0; i < this.inputBuffer.length; i++) {
            const char = this.inputBuffer[i];
            const x = this.inputStartX + i;
            this.updateCharacter(x, this.cursor.y, char);
        }
        
        // Draw cursor at the end of input if it should be visible
        if (this.showCursor) {
            const cursorX = this.inputStartX + this.inputBuffer.length;
            if (cursorX < this.cols) {
                this.updateCharacter(cursorX, this.cursor.y, '█');
            }
        }
    }
    
    // Method to adjust target dimensions at runtime
    setTargetDimensions(cols, rows) {
        this.targetCols = cols;
        this.targetRows = rows;
        this.handleResize(); // Recalculate and redraw
        console.log(`Updated target dimensions to ${cols}x${rows}`);
    }
    
    // Method to adjust character size limits
    setCharacterSizeLimits(minSize, maxSize) {
        this.minCharSize = minSize;
        this.maxCharSize = maxSize;
        this.handleResize(); // Recalculate and redraw
        console.log(`Updated character size limits: ${minSize}-${maxSize}px`);
    }
    
    // Method to adjust padding around the screen edges (in character widths/heights)
    setPadding(paddingX, paddingY) {
        this.paddingX = paddingX;
        this.paddingY = paddingY;
        this.handleResize(); // Recalculate and redraw
        console.log(`Updated screen padding to ${paddingX}x${paddingY} characters`);
    }

    // Method to adjust vertical padding around the title (in lines)
    setTitleVerticalPadding(lines) {
        this.titleVerticalPadding = lines;
        this.demoText(); // Redraw demo with new padding
        console.log(`Updated title vertical padding to ${lines} lines`);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        this.renderer.render(this.scene, this.camera);
    }
}

// Wait for fonts to load before initializing terminal
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for November font to load
    try {
        await document.fonts.load("16px November");
        console.log('November font loaded successfully');
        
        // Small delay to ensure font is fully ready
        await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
        console.warn('November font failed to load, using fallback fonts:', error);
    }
    
    console.log('Initializing terminal with November font...');
    const terminal = new ASCIITerminal();
    
    // Terminal ready - no need to force render all characters
    console.log('Terminal initialized with full-width row backgrounds');
    console.log('Row backgrounds: Even=#0a0a0a, Odd=#121212 (use useVisibleRowColors() for better visibility)');
    console.log('Try useVisibleRowColors() for more visible background alternation!');
    
    // Make terminal globally accessible for debugging
window.terminal = terminal;

// Test function to visualize padding
window.testPadding = () => {
    terminal.clear();
    
    // Fill the text area with dots (using logical coordinates)
    const fillChar = '·';
    for (let y = 0; y < terminal.rows; y++) {
        for (let x = 0; x < terminal.cols; x++) {
            terminal.updateCharacter(x, y, fillChar);
        }
    }
    
    // Add border markers to show the edges of the text area
    // Top row
    for (let x = 0; x < terminal.cols; x++) {
        terminal.updateCharacter(x, 0, '─');
    }
    // Bottom row
    for (let x = 0; x < terminal.cols; x++) {
        terminal.updateCharacter(x, terminal.rows - 1, '─');
    }
    // Left column
    for (let y = 0; y < terminal.rows; y++) {
        terminal.updateCharacter(0, y, '│');
    }
    // Right column  
    for (let y = 0; y < terminal.rows; y++) {
        terminal.updateCharacter(terminal.cols - 1, y, '│');
    }
    
    // Corner markers
    terminal.updateCharacter(0, 0, '┌');
    terminal.updateCharacter(terminal.cols - 1, 0, '┐');
    terminal.updateCharacter(0, terminal.rows - 1, '└');
    terminal.updateCharacter(terminal.cols - 1, terminal.rows - 1, '┘');
    
    console.log(`Padding test: Text area is ${terminal.cols}x${terminal.rows}, should be offset by ${terminal.paddingX} chars horizontally and ${terminal.paddingY} chars vertically from screen edges`);
};
    
    // Add some helpful console functions for experimenting with scaling
    window.setTerminalTarget = (cols, rows) => terminal.setTargetDimensions(cols, rows);
    window.setCharSizeLimits = (min, max) => terminal.setCharacterSizeLimits(min, max);
    window.setPadding = (paddingX, paddingY) => terminal.setPadding(paddingX, paddingY);
    window.setTitleVerticalPadding = (lines) => terminal.setTitleVerticalPadding(lines);
    window.writeCenteredText = (text) => terminal.writeCenteredText(text);
    
    // Debug function to test character rendering
    window.testChar = (char = 'A', x = 5, y = 5) => {
        terminal.updateCharacter(x, y, char);
        console.log(`Test: Drew "${char}" (code: ${char.charCodeAt(0)}) at position ${x},${y}`);
    };
    
    // Function to test Unicode block characters
    window.testUnicode = () => {
        const testChars = ['█', '▄', '▀', '▐', '▌', '▊', '▍', '▎', '▏'];
        testChars.forEach((char, i) => {
            terminal.updateCharacter(i * 2, 1, char);
        });
        console.log('Unicode test characters drawn on row 1');
    };
    
    // Function to add debug panel back if needed
    window.showDebugPanel = () => {
        if (document.getElementById('debug-info')) {
            console.log('Debug panel already exists');
            return;
        }
        
        const debugHTML = `
            <div id="debug-info" style="position: absolute; top: 10px; left: 10px; color: #9d00ff; font-family: 'Courier New', monospace; font-size: 11px; z-index: 100; background: rgba(0, 0, 0, 0.8); padding: 8px 12px; border-radius: 5px; border: 1px solid #9d00ff; line-height: 1.4;">
                <div><strong>ADAPTIVE TERMINAL SCALING</strong></div>
                <div>Actual: <span id="terminal-size">0x0</span> chars</div>
                <div>Target: <span id="target-size">0x0</span> chars</div>
                <div>Window: <span id="window-size">0x0</span> px</div>
                <div>Char Size: <span id="char-size">0x0</span> px</div>
                <div>Scale Factor: <span id="scale-factor">0.0</span></div>
                <div>Device Pixel Ratio: <span id="pixel-ratio">0.0</span></div>
            </div>
        `;
        
        document.getElementById('canvas-container').insertAdjacentHTML('beforeend', debugHTML);
        terminal.updateTerminalDimensions(); // Refresh debug info
        console.log('Debug panel added');
    };
    
    window.hideDebugPanel = () => {
        const debugPanel = document.getElementById('debug-info');
        if (debugPanel) {
            debugPanel.remove();
            console.log('Debug panel removed');
        } else {
            console.log('Debug panel not found');
        }
    };
    
    // Input control functions
    window.enableInput = () => {
        terminal.inputMode = true;
        console.log('Input mode enabled - you can type in the terminal');
    };
    
    window.disableInput = () => {
        terminal.inputMode = false;
        console.log('Input mode disabled');
    };
    
    window.clearTerminal = () => {
        terminal.clear();
        terminal.writeText(">> ");
        terminal.inputStartX = terminal.cursor.x;
        terminal.inputBuffer = '';
        console.log('Terminal cleared and reset for input');
    };
    
    // Cursor control
    window.setCursorBlinkRate = (milliseconds) => {
        if (terminal.cursorInterval) {
            clearInterval(terminal.cursorInterval);
        }
        terminal.cursorInterval = setInterval(() => {
            if (terminal.inputMode) {
                terminal.showCursor = !terminal.showCursor;
                terminal.redrawInputLine();
            }
        }, milliseconds);
        console.log(`Cursor blink rate set to ${milliseconds}ms`);
    };
    
    // Function to add custom input handlers
    window.onTerminalInput = null; // Users can set this to handle input
    
    // Font testing function
    window.testFont = () => {
        terminal.clear();
        terminal.writeText("NOVEMBER FONT TEST - HIGH DPI\n");
        terminal.writeText("==============================\n");
        terminal.writeText("ABCDEFGHIJKLMNOPQRSTUVWXYZ\n");
        terminal.writeText("abcdefghijklmnopqrstuvwxyz\n");
        terminal.writeText("0123456789 !@#$%^&*()_+-=\n");
        terminal.writeText("{}[]|\\:;\"'<>?,./ \n");
        terminal.writeText("Unicode: █▄▀▐▌▊▍▎▏ ╔═══╗\n");
        terminal.writeText(`Device Pixel Ratio: ${window.devicePixelRatio}x\n`);
        terminal.writeText("Should now be crisp!\n");
        terminal.writeText("\n> ");
        terminal.inputStartX = terminal.cursor.x;
        terminal.inputBuffer = '';
        console.log('High-DPI font test displayed');
    };
    
    // Function to refresh all visible characters (useful after DPI changes)
    window.refreshDisplay = () => {
        console.log('Refreshing all characters with current settings...');
        
        // Clear texture cache to force recreation with current settings
        terminal.characterTextureCache.clear();
        
        for (let y = 0; y < terminal.rows; y++) {
            for (let x = 0; x < terminal.cols; x++) {
                const char = terminal.buffer[y][x];
                if (char && char !== ' ') {
                    terminal.updateCharacter(x, y, char);
                }
            }
        }
        // Also update row backgrounds
        terminal.updateRowBackgrounds();
        console.log('Display refresh complete');
    };
    
    // Function to test different color schemes
    window.testColors = () => {
        terminal.clear();
        terminal.writeText("FULL-WIDTH ROW BACKGROUND TEST\n");
        terminal.writeText("==============================\n");
        terminal.writeText("Each row has a full-width background!\n");
        terminal.writeText("Row backgrounds span entire screen width\n");
        terminal.writeText("Even rows: darker background\n");
        terminal.writeText("Odd rows: lighter background\n");
        terminal.writeText("Text remains purple on all rows\n");
        terminal.writeText("Background colors:\n");
        terminal.writeText("  Even=#0a0a0a, Odd=#121212\n");
        terminal.writeText("Try useVisibleRowColors() for brighter!\n");
        terminal.writeText("\n> ");
        terminal.inputStartX = terminal.cursor.x;
        terminal.inputBuffer = '';
        console.log('Full-width background test displayed - backgrounds span entire screen width');
    };
    
    // Function to set custom row background colors
    window.setRowColors = (evenBgColor, oddBgColor) => {
        // Store background colors globally so updateCharacter can access them
        window.terminalEvenRowColor = evenBgColor;
        window.terminalOddRowColor = oddBgColor;
        
        // Update row backgrounds immediately
        terminal.updateRowBackgrounds();
        console.log(`Row background colors updated: Even=${evenBgColor}, Odd=${oddBgColor}`);
    };
    
    // Test some more visible background color schemes
    window.testVisibleColors = () => {
        console.log('Testing more visible background color combinations:');
        console.log('(Text stays purple #9d00ff in all cases)');
        console.log('1. setRowColors("#2a2a2a", "#1a1a1a") - Subtle gray alternation');
        console.log('2. setRowColors("#1a1a2a", "#0a0a1a") - Subtle blue alternation');
        console.log('3. setRowColors("#2a1a1a", "#1a0a0a") - Subtle red alternation');
        console.log('4. setRowColors("#1a2a1a", "#0a1a0a") - Subtle green alternation');
        console.log('5. setRowColors("#2a1a2a", "#1a0a1a") - Subtle purple alternation');
        console.log('6. setRowColors("#000000", "#111111") - Black/dark gray');
    };
    
    // Clear texture cache (useful for debugging)
    window.clearTextureCache = () => {
        terminal.characterTextureCache.clear();
        console.log('Character texture cache cleared');
    };
    
    // Reset to single background color (no alternation)
    window.resetRowColors = (singleBgColor = '#000000') => {
        window.terminalEvenRowColor = singleBgColor;
        window.terminalOddRowColor = singleBgColor;
        terminal.updateRowBackgrounds();
        console.log(`Row background colors reset to single color: ${singleBgColor}`);
    };
    
    // Quick function to set more visible alternating colors
    window.useVisibleRowColors = () => {
        setRowColors('#1a1a1a', '#2a2a2a');
        console.log('Applied more visible row background colors: #1a1a1a / #2a2a2a');
    };
    
    // Switch title files
    window.loadTitle = async (filename) => {
        console.log(`Loading title: ${filename}`);
        await terminal.demoText(filename);
        console.log(`Title loaded: ${filename}`);
    };
    
    // List available titles
    window.listTitles = () => {
        console.log('Available title files:');
        console.log('- glowy.txt (default)');
        console.log('- clean_tiny.txt');
        console.log('- clean.txt');
        console.log('- gradient.txt');
        console.log('- soft.txt');
        console.log('- flowy.txt');
        console.log('- roman.txt');
        console.log('- story.txt');
        console.log('Usage: loadTitle("filename.txt")');
    };
    
    // Test typing functionality
    window.testTyping = () => {
        terminal.clear();
        terminal.writeText("TYPING TEST\n");
        terminal.writeText("===========\n");
        terminal.writeText("Type below to test input:\n");
        terminal.writeText("\n> ");
        terminal.inputStartX = terminal.cursor.x;
        terminal.inputBuffer = '';
        
        // Ensure canvas is focused
        const canvas = document.getElementById('three-canvas');
        canvas.focus();
        
        console.log('Typing test ready - try typing in the terminal');
        console.log(`Input mode: ${terminal.inputMode}`);
        console.log(`Input start X: ${terminal.inputStartX}`);
        console.log(`Current cursor position: ${terminal.cursor.x}, ${terminal.cursor.y}`);
    };
    
    // Debug function to check input state
    window.debugInput = () => {
        console.log('=== INPUT DEBUG ===');
        console.log(`Input mode: ${terminal.inputMode}`);
        console.log(`Input buffer: "${terminal.inputBuffer}"`);
        console.log(`Input start X: ${terminal.inputStartX}`);
        console.log(`Cursor position: ${terminal.cursor.x}, ${terminal.cursor.y}`);
        console.log(`Show cursor: ${terminal.showCursor}`);
        
        const canvas = document.getElementById('three-canvas');
        console.log(`Canvas focused: ${document.activeElement === canvas}`);
        console.log(`Canvas tabIndex: ${canvas.tabIndex}`);
        
        // Test character directly
        terminal.updateCharacter(5, 5, 'X');
        console.log('Test character X placed at 5,5');
    };
    
    // Force focus canvas
    window.focusTerminal = () => {
        const canvas = document.getElementById('three-canvas');
        canvas.focus();
        console.log('Terminal focused');
    };
    
    // Test if ANY keyboard events are being captured
    window.testKeyboardEvents = () => {
        console.log('=== TESTING KEYBOARD EVENTS ===');
        console.log('Press any key now...');
        
        // Add temporary listeners that will show ALL keyboard events
        const tempKeyDown = (e) => {
            console.log(`🔑 KEYDOWN CAPTURED: "${e.key}" (code: ${e.code})`);
        };
        const tempKeyPress = (e) => {
            console.log(`🔑 KEYPRESS CAPTURED: "${e.key}" (charCode: ${e.charCode})`);
        };
        
        document.addEventListener('keydown', tempKeyDown);
        document.addEventListener('keypress', tempKeyPress);
        
        // Remove after 10 seconds
        setTimeout(() => {
            document.removeEventListener('keydown', tempKeyDown);
            document.removeEventListener('keypress', tempKeyPress);
            console.log('🔑 Keyboard event test ended');
        }, 10000);
    };
    
    // Function to update just row backgrounds without refresh
    window.updateRowBackgrounds = () => {
        terminal.updateRowBackgrounds();
        console.log('Row backgrounds updated');
    };
    
    // Override the handleEnter method to allow custom input processing
    const originalHandleEnter = terminal.handleEnter;
    terminal.handleEnter = function() {
        // Call custom input handler if set
        if (window.onTerminalInput && typeof window.onTerminalInput === 'function') {
            try {
                window.onTerminalInput(this.inputBuffer);
            } catch (e) {
                console.error('Error in custom input handler:', e);
            }
        }
        
        // Call original handleEnter
        originalHandleEnter.call(this);
    };
    
    // Log available console commands
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    THE VIVARIUM CONSOLE                      ║
╠══════════════════════════════════════════════════════════════╣
║ Available commands:                                          ║
║                                                              ║
║ setTerminalTarget(cols, rows)    - Set target dimensions     ║
║   Example: setTerminalTarget(120, 40)                        ║
║                                                              ║
║ setCharSizeLimits(min, max)      - Set character size range  ║
║   Example: setCharSizeLimits(8, 20)                          ║
║                                                              ║
║ setPadding(x, y)                 - Set screen edge padding   ║
║   Example: setPadding(2, 1) - 2 chars left/right, 1 top/bot  ║
║ setTitleVerticalPadding(lines)   - Set empty lines around title║
║   Example: setTitleVerticalPadding(3) - 3 lines above/below  ║
║ testPadding()                    - Visualize current padding ║
║                                                              ║
║ terminal.writeText(text, x, y)   - Write text to terminal    ║
║   Example: terminal.writeText("Hello World!", 0, 5)          ║
║ writeCenteredText(text)          - Write horizontally centered║
║   Example: writeCenteredText("Centered!")                    ║
║                                                              ║
║ terminal.clear()                 - Clear terminal            ║
║                                                              ║
║ testChar(char, x, y)             - Test single character     ║
║   Example: testChar('A', 10, 10)                             ║
║                                                              ║
║ testUnicode()                    - Test Unicode characters   ║
║ testFont()                       - Test November font        ║
║ testColors()                     - Test full-width row backgrounds║
║ testTyping()                     - Test keyboard input          ║
║ debugInput()                     - Debug input system state    ║
║ focusTerminal()                  - Focus terminal for input    ║
║ testKeyboardEvents()             - Test if keyboard events work║
║ listTitles()                     - Show available ASCII titles ║
║ loadTitle(filename)              - Load different ASCII title  ║
║ setRowColors(even, odd)          - Set custom background colors║
║ resetRowColors(bgColor)          - Reset to single background  ║
║ useVisibleRowColors()            - Apply more visible backgrounds║
║ updateRowBackgrounds()           - Update only row backgrounds  ║
║ clearTextureCache()              - Clear character texture cache║
║ testVisibleColors()              - Show background color examples║
║ refreshDisplay()                 - Refresh all characters    ║
║                                                              ║
║ showDebugPanel()                 - Show debug info panel     ║
║ hideDebugPanel()                 - Hide debug info panel     ║
║                                                              ║
║ enableInput()                    - Enable terminal input     ║
║ disableInput()                   - Disable terminal input    ║
║ clearTerminal()                  - Clear and reset terminal  ║
║                                                              ║
║ setCursorBlinkRate(ms)           - Set cursor blink speed    ║
║   Example: setCursorBlinkRate(1000) - 1 second blinks        ║
║                                                              ║
║ Custom input handler:                                        ║
║   onTerminalInput = (text) => { ... }                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
});