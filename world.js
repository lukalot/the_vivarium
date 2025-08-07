/**
 * The Vivarium World System
 * Hierarchical object structure for LLM-based simulation
 */

class WorldObject {
    constructor(id, name, description, parent = null) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.parent = parent;
        this.containedObjects = [];
        this.relationships = []; // { relationship, to, progress }
        this.lastUpdated = Date.now();
    }

    // Add a child object
    addChild(child) {
        if (child.parent) {
            child.parent.removeChild(child);
        }
        child.parent = this;
        this.containedObjects.push(child);
    }

    // Remove a child object
    removeChild(child) {
        const index = this.containedObjects.indexOf(child);
        if (index > -1) {
            this.containedObjects.splice(index, 1);
            child.parent = null;
        }
    }

    // Get all sibling objects (excluding self)
    getSiblings() {
        if (!this.parent) return [];
        return this.parent.containedObjects.filter(obj => obj !== this);
    }

    // Add or update a relationship
    addRelationship(relationship, targetId, progress = null, progressTime = null) {
        // Remove existing relationship of same type to same target
        this.relationships = this.relationships.filter(
            rel => !(rel.relationship === relationship && rel.to === targetId)
        );
        this.relationships.push({ 
            relationship, 
            to: targetId, 
            progress, 
            progressTime,
            initialProgress: progress, // Store original progress for calculation
            initialProgressTime: progressTime // Store original time for calculation
        });
    }

    // Get relationships of a specific type
    getRelationships(type = null) {
        if (type) {
            return this.relationships.filter(rel => rel.relationship === type);
        }
        return this.relationships;
    }

    // Get local context for LLM (this container + contents + relationships)
    getLocalContext(maxDepth = 1) {
        const context = {
            location: this.parent ? {
                name: this.parent.name,
                description: this.parent.description
            } : null,
            currentObject: {
                name: this.name,
                description: this.description
            },
            siblings: this.getSiblings().map(obj => ({
                id: obj.id,
                name: obj.name,
                description: obj.description
            })),
            contents: this.containedObjects.map(obj => ({
                id: obj.id,
                name: obj.name,
                description: obj.description,
                relationships: obj.relationships
            })),
            relationships: this.relationships
        };

        return context;
    }

    // Check if object is within simulation distance
    isWithinSimulationDistance(targetObject, maxDistance = 2) {
        return this.getDistance(targetObject) <= maxDistance;
    }

    // Get distance between objects in the hierarchy
    getDistance(targetObject) {
        // Same object
        if (this === targetObject) return 0;
        
        // Siblings
        if (this.parent === targetObject.parent) return 1;
        
        // Parent-child relationship
        if (this.parent === targetObject || targetObject.parent === this) return 1;
        
        // TODO: Implement more complex distance calculation
        return Infinity;
    }
}

class World {
    constructor() {
        this.objects = new Map(); // id -> WorldObject for fast lookup
        this.rootObject = null;
        this.simulationTime = 0;
        this.isSimulating = false;
        this.simulationInterval = null;
    }

    // Create and add an object to the world
    createObject(id, name, description, parentId = null) {
        if (this.objects.has(id)) {
            console.warn(`Object with id "${id}" already exists`);
            return null;
        }

        const parent = parentId ? this.objects.get(parentId) : this.rootObject;
        const obj = new WorldObject(id, name, description, parent);
        
        this.objects.set(id, obj);
        
        if (parent) {
            parent.addChild(obj);
        } else if (!this.rootObject) {
            this.rootObject = obj;
        }

        return obj;
    }

    // Get object by ID
    getObject(id) {
        return this.objects.get(id);
    }

    // Move object to new parent
    moveObject(objectId, newParentId) {
        const obj = this.objects.get(objectId);
        const newParent = newParentId ? this.objects.get(newParentId) : this.rootObject;
        
        if (obj && newParent) {
            if (obj.parent) {
                obj.parent.removeChild(obj);
            }
            newParent.addChild(obj);
            return true;
        }
        return false;
    }

    // Get all objects at a specific depth from root
    getObjectsAtDepth(depth = 0, startObject = null) {
        const start = startObject || this.rootObject;
        if (!start) return [];
        
        if (depth === 0) return [start];
        
        const result = [];
        for (const child of start.containedObjects) {
            result.push(...this.getObjectsAtDepth(depth - 1, child));
        }
        return result;
    }

    // Process a player action and simulate the world one step
    async processPlayerAction(action) {
        if (!this.playerObjectId) {
            return "No player object set.";
        }

        const playerObject = this.getObject(this.playerObjectId);
        if (!playerObject) {
            return "Player object not found.";
        }

        this.simulationTime++;

        // PHASE 0: Progress existing time-based relationships first
        this.progressTimeBasedRelationships();

        // Find the simulation branch (from player up to root)
        const branch = this.getSimulationBranch(playerObject);
        
        // PHASE 1: Complete all simulation first
        const results = await this.simulateBottomUp(branch, action);

        // PHASE 1.5: Analyze actions and update relationships (new relationships won't progress until next turn)
        await this.analyzeAndUpdateRelationships(action, results);

        // Emit simulation event for terminal display
        if (window.terminal && typeof window.onWorldUpdate === 'function') {
            window.onWorldUpdate(this);
        }

        // PHASE 2: Concurrently generate narration and update descriptions
        const [narrative] = await Promise.all([
            this.narratePlayerExperience(results, action),
            this.updateObjectDescriptions(results)
        ]);
        
        return narrative;
    }

    // Get the simulation branch - all objects from player's container up to root
    getSimulationBranch(playerObject) {
        const branch = new Set();
        
        // Start from player's container (the boat)
        let current = playerObject.parent;
        
        while (current) {
            // Add this container to the branch
            branch.add(current);
            
            // Add all objects within this container (siblings + their descendants)
            this.addDescendantsToSet(current, branch);
            
            // Move up the hierarchy
            current = current.parent;
        }
        
        return Array.from(branch);
    }

    // Recursively add all descendants of an object to a set
    addDescendantsToSet(obj, set) {
        set.add(obj);
        obj.containedObjects.forEach(child => {
            this.addDescendantsToSet(child, set);
        });
    }

    // Simulate objects bottom-up within the branch
    async simulateBottomUp(branchObjects, playerAction) {
        const results = new Map();
        
        // Group objects by depth (distance from deepest leaf)
        const depthGroups = this.groupObjectsByDepth(branchObjects);
        
        // Process from deepest to shallowest
        const depths = Array.from(depthGroups.keys()).sort((a, b) => b - a);
        
        if (window.terminal && window.terminal.developerMode) {
            window.terminal.devLog(`=== Bottom-Up Simulation Started ===`);
            window.terminal.devLog(`Processing ${depths.length} depth levels: [${depths.join(' → ')}]`);
        }
        
        for (const depth of depths) {
            const objectsAtDepth = depthGroups.get(depth);
            
            if (window.terminal && window.terminal.developerMode) {
                const objNames = objectsAtDepth.map(o => o.name).join(', ');
                window.terminal.devLog(`Depth ${depth}: Simulating [${objNames}]`);
            }
            
            // Process all objects at this depth in parallel
            const promises = objectsAtDepth.map(async (obj) => {
                const action = await this.simulateObject(obj, playerAction, results);
                return { objId: obj.id, action };
            });
            
            const depthResults = await Promise.all(promises);
            
            // Store results for this depth
            depthResults.forEach(({ objId, action }) => {
                results.set(objId, action);
            });
        }
        
        if (window.terminal && window.terminal.developerMode) {
            window.terminal.devLog(`=== Bottom-Up Simulation Complete ===`);
        }
        
        return results;
    }

    // Group objects by their depth (distance from deepest descendant)
    groupObjectsByDepth(objects) {
        const depthMap = new Map();
        
        // Calculate depth for each object
        objects.forEach(obj => {
            const depth = this.calculateObjectDepth(obj);
            if (!depthMap.has(depth)) {
                depthMap.set(depth, []);
            }
            depthMap.get(depth).push(obj);
        });
        
        return depthMap;
    }

    // Calculate the depth of an object (0 = leaf, higher = closer to root)
    calculateObjectDepth(obj) {
        if (obj.containedObjects.length === 0) {
            return 0; // Leaf object
        }
        
        let maxChildDepth = -1;
        obj.containedObjects.forEach(child => {
            maxChildDepth = Math.max(maxChildDepth, this.calculateObjectDepth(child));
        });
        
        return maxChildDepth + 1;
    }

    // Simulate a single object's action using LLM or fallback
    async simulateObject(obj, playerAction, childResults) {
        // Collect actions from children
        const childActions = obj.containedObjects.map(child => {
            const childResult = childResults.get(child.id);
            return childResult || "no action";
        }).filter(action => action !== "no action");

        // Developer logging: show what children did
        if (window.terminal && window.terminal.developerMode && childActions.length > 0) {
            window.terminal.devLog(`${obj.name} sees children actions: [${childActions.join(', ')}]`);
        }

        // Player always takes the exact action they specified
        if (obj.id === this.playerObjectId) {
            if (window.terminal && window.terminal.developerMode) {
                window.terminal.devLog(`Player (${obj.name}): "${playerAction}"`);
            }
            return playerAction;
        }
        
        // Use LLM if available, otherwise fall back to basic reactions
        if (window.llmManager && window.llmManager.isAvailable()) {
            try {
                const result = await window.llmManager.simulateObjectReaction(obj, playerAction, childActions);
                if (window.terminal && window.terminal.developerMode) {
                    window.terminal.devLog(`${obj.name}: "${result}"`);
                }
                return result;
            } catch (error) {
                console.warn(`LLM simulation failed for ${obj.id}, using fallback:`, error);
                if (window.terminal && window.terminal.developerMode) {
                    window.terminal.devLog(`LLM failed for ${obj.name}, using fallback`);
                }
                const fallbackResult = this.getBasicReaction(obj, playerAction, childActions);
                if (window.terminal && window.terminal.developerMode) {
                    window.terminal.devLog(`${obj.name} fallback action: "${fallbackResult}"`);
                }
                return fallbackResult;
            }
        } else {
            if (window.terminal && window.terminal.developerMode) {
                window.terminal.devLog(`LLM not available for ${obj.name}, using fallback`);
            }
            const fallbackResult = this.getBasicReaction(obj, playerAction, childActions);
            if (window.terminal && window.terminal.developerMode) {
                window.terminal.devLog(`${obj.name} fallback action: "${fallbackResult}"`);
            }
            return fallbackResult;
        }
    }

    // Basic fallback reactions when LLM is not available
    getBasicReaction(obj, playerAction, childActions) {
        if (obj.id === 'cat_tail') {
            if (playerAction.includes('turn') || playerAction.includes('wheel')) return "twitches nervously";
            if (playerAction.includes('pet') || playerAction.includes('cat')) return "flicks with pleasure";
            return "sways gently";
        }
        
        if (obj.id === 'ship_cat') {
            if (childActions.some(a => a.includes('twitches'))) return "meows softly";
            if (playerAction.includes('pet') || playerAction.includes('cat')) return "purrs and rubs against you";
            return "watches alertly";
        }
        
        if (obj.id === 'wheel') {
            if (playerAction.includes('turn') || playerAction.includes('wheel')) return "creaks as it turns";
            if (playerAction.includes('touch') || playerAction.includes('hold')) return "feels warm under your hands";
            return "holds steady";
        }
        
        if (obj.id === 'boat_1') {
            if (childActions.some(a => a.includes('creak') || a.includes('turn'))) return "changes course";
            if (childActions.some(a => a.includes('meow'))) return "rocks gently";
            return "drifts quietly";
        }
        
        return "remains still";
    }

    // Generate a narrated description of what happened from the player's perspective
    async narratePlayerExperience(results, playerAction) {
        const playerObject = this.getObject(this.playerObjectId);
        if (!playerObject) {
            return "\nSomething seems wrong - you can't sense yourself.\n";
        }

        const playerParent = playerObject.parent;
        if (!playerParent) {
            return "\nYou float in an empty void.\n";
        }

        // Get the player's siblings (other objects in the same container)
        const siblings = playerParent.containedObjects.filter(obj => obj.id !== this.playerObjectId);
        
        // Collect parent action
        const parentAction = results.get(playerParent.id) || "remains still";
        
        // Collect sibling actions
        const siblingActions = siblings.map(sibling => ({
            objectName: sibling.name,
            action: results.get(sibling.id) || "remains still"
        })).filter(({ action }) => action !== "remains still");

        // Collect ALL relationships from ALL visible objects for narrative context
        const allRelevantRelationships = [];
        
        // Helper function to add relationships from an object
        const addObjectRelationships = (obj) => {
            if (obj.relationships.length > 0) {
                obj.relationships.forEach(rel => {
                    const target = this.getObject(rel.to);
                    allRelevantRelationships.push({
                        from: obj.name,
                        relationship: rel.relationship,
                        to: target ? target.name : rel.to,
                        progress: rel.progress,
                        progressTime: rel.progressTime
                    });
                });
            }
        };
        
        // Player's relationships
        addObjectRelationships(playerObject);
        
        // Parent container relationships
        addObjectRelationships(playerParent);
        
        // Sibling relationships (other objects in same container)
        siblings.forEach(sibling => {
            addObjectRelationships(sibling);
        });
        
        // Child object relationships (objects contained within visible objects)
        const allVisibleObjects = [playerObject, playerParent, ...siblings];
        allVisibleObjects.forEach(obj => {
            if (obj.containedObjects && obj.containedObjects.length > 0) {
                obj.containedObjects.forEach(child => {
                    addObjectRelationships(child);
                });
            }
        });

        // Prepare context information for the LLM
        const contextInfo = {
            playerName: playerObject.name,
            playerDescription: playerObject.description,
            containerName: playerParent.name,
            containerDescription: playerParent.description
        };

        // Developer logging for narrative generation
        if (window.terminal && window.terminal.developerMode) {
            window.terminal.devLog(`Generating narrative for ${playerObject.name}`);
            window.terminal.devLog(`Parent (${playerParent.name}): "${parentAction}"`);
            if (siblingActions.length > 0) {
                siblingActions.forEach(sa => {
                    window.terminal.devLog(`Sibling (${sa.objectName}): "${sa.action}"`);
                });
            }
        }

        // Use LLM to generate the narrative (no fallbacks - show errors)
        if (!window.llmManager) {
            return "\n❌ LLM Manager not loaded. Check console for errors.\n";
        }

        try {
            const narrative = await window.llmManager.generateNarrative(
                playerAction, 
                parentAction, 
                siblingActions, 
                contextInfo,
                allRelevantRelationships
            );
            if (window.terminal && window.terminal.developerMode) {
                window.terminal.devLog(`Narrative generated successfully`);
            }
            return narrative;
        } catch (error) {
            // Show the error to the user instead of falling back silently
            console.error('LLM narrative generation failed:', error);
            if (window.terminal && window.terminal.developerMode) {
                window.terminal.devLog(`Narrative generation FAILED: ${error.message}`);
            }
            return `\n❌ Narrative Error: ${error.message}\n\nTip: Use checkLLM() to verify your setup.\n`;
        }
    }

    // Legacy fallback method (no longer used - narrator now requires LLM)
    generateFallbackNarration(parentAction, siblingActions) {
        console.warn('generateFallbackNarration() called but narrator now requires LLM. Use checkLLM() to verify setup.');
        return "\n❌ Fallback narration disabled. Please configure LLM in config.js\n";
    }

    // Legacy method for compatibility (now deprecated)
    simulateStep() {
        console.warn("simulateStep() is deprecated. Use processPlayerAction() instead.");
    }

    // Start continuous simulation
    startSimulation(intervalMs = 1000) {
        if (this.isSimulating) return;
        
        this.isSimulating = true;
        this.simulationInterval = setInterval(() => {
            this.simulateStep();
        }, intervalMs);
        
        console.log(`World simulation started (${intervalMs}ms intervals)`);
    }

    // Stop simulation
    stopSimulation() {
        if (this.simulationInterval) {
            clearInterval(this.simulationInterval);
            this.simulationInterval = null;
        }
        this.isSimulating = false;
        console.log('World simulation stopped');
    }

    // Generate a text description of the world state
    describe(focusObjectId = null, maxDepth = 2) {
        const focusObject = focusObjectId ? this.getObject(focusObjectId) : this.rootObject;
        if (!focusObject) return "The void stares back.";

        let description = `=== ${focusObject.name} ===\n`;
        description += `${focusObject.description}\n\n`;

        if (focusObject.containedObjects.length > 0) {
            description += "Contents:\n";
            focusObject.containedObjects.forEach(obj => {
                description += `  • ${obj.name}: ${obj.description}\n`;
                
                // Show relationships
                if (obj.relationships.length > 0) {
                    obj.relationships.forEach(rel => {
                        const target = this.getObject(rel.to);
                        const progressStr = rel.progress !== null ? ` (${Math.round(rel.progress * 100)}%)` : '';
                        description += `    - ${rel.relationship} ${target ? target.name : rel.to}${progressStr}\n`;
                    });
                }
            });
        }

        return description;
    }

    // Export world state for saving
    export() {
        const objects = [];
        for (const [id, obj] of this.objects) {
            objects.push({
                id: obj.id,
                name: obj.name,
                description: obj.description,
                parentId: obj.parent ? obj.parent.id : null,
                relationships: obj.relationships
            });
        }
        
        return {
            objects,
            simulationTime: this.simulationTime,
            rootObjectId: this.rootObject ? this.rootObject.id : null
        };
    }

    // Import world state from save data
    import(data) {
        this.objects.clear();
        this.simulationTime = data.simulationTime || 0;
        
        // Create all objects first
        data.objects.forEach(objData => {
            const obj = new WorldObject(objData.id, objData.name, objData.description);
            obj.relationships = objData.relationships || [];
            this.objects.set(objData.id, obj);
        });
        
        // Then establish parent-child relationships
        data.objects.forEach(objData => {
            if (objData.parentId) {
                const obj = this.objects.get(objData.id);
                const parent = this.objects.get(objData.parentId);
                if (obj && parent) {
                    parent.addChild(obj);
                }
            }
        });
        
        // Set root object
        if (data.rootObjectId) {
            this.rootObject = this.objects.get(data.rootObjectId);
        }
    }

    // Analyze object actions and update relationships based on what happened
    async analyzeAndUpdateRelationships(playerAction, simulationResults) {
        console.log('🔗 Starting relationship analysis...');
        
        if (!window.llmManager || !window.llmManager.isAvailable()) {
            console.log('🔗 Skipping relationship analysis - LLM not available');
            return;
        }

        // Prepare object actions for analysis
        const objectActions = [];
        for (const [objectId, action] of simulationResults) {
            const obj = this.getObject(objectId);
            if (obj && action !== "remains still") {
                objectActions.push({
                    objectName: obj.name.toLowerCase(), // Ensure lowercase for consistency
                    objectId: objectId,
                    action: action
                });
            }
        }

        console.log(`🔗 Found ${objectActions.length} meaningful actions to analyze`);
        if (objectActions.length > 0) {
            objectActions.forEach(oa => {
                console.log(`🔗   - ${oa.objectName}: "${oa.action}"`);
            });
        }

        // Only analyze if there are meaningful actions
        if (objectActions.length === 0) {
            console.log('🔗 No meaningful actions - skipping analysis');
            return;
        }

        // Developer logging
        if (window.terminal && window.terminal.developerMode) {
            window.terminal.devLog(`Analyzing relationships based on ${objectActions.length} object actions`);
        }

        try {
            console.log('🔗 Calling LLM for relationship analysis...');
            
            // Analyze actions to detect relationship changes
            const relationshipChanges = await window.llmManager.analyzeRelationshipChanges(
                playerAction, 
                objectActions
            );

            console.log(`🔗 LLM returned ${relationshipChanges.length} relationship changes`);

            // Apply the relationship changes
            if (relationshipChanges.length > 0) {
                console.log('🔗 Applying relationship changes:');
                
                if (window.terminal && window.terminal.developerMode) {
                    window.terminal.devLog(`Found ${relationshipChanges.length} relationship changes`);
                }

                for (const change of relationshipChanges) {
                    this.applyRelationshipChange(change);
                }
            } else {
                console.log('🔗 No new relationships detected');
                
                if (window.terminal && window.terminal.developerMode) {
                    window.terminal.devLog(`No new relationships detected`);
                }
            }
        } catch (error) {
            console.error('🔗 Relationship analysis failed:', error.message);
            console.warn('Relationship analysis failed:', error.message);
        }
    }

    // Apply a single relationship change to the world
    applyRelationshipChange(change) {
        console.log(`🔗 Looking for source object: "${change.from}"`);
        const sourceObj = this.getObjectByName(change.from);
        console.log(`🔗 Found source object:`, sourceObj ? `${sourceObj.name} (${sourceObj.id})` : 'NOT FOUND');
        
        console.log(`🔗 Looking for target object: "${change.to}"`);
        const targetObj = this.getObjectByName(change.to);
        console.log(`🔗 Found target object:`, targetObj ? `${targetObj.name} (${targetObj.id})` : 'NOT FOUND');
        
        if (!sourceObj) {
            console.warn(`🔗 Relationship source object not found: "${change.from}"`);
            console.log(`🔗 Available objects:`, Array.from(this.objects.entries()).map(([id, obj]) => `${id} (${obj.name})`));
            return;
        }
        
        if (!targetObj) {
            console.warn(`🔗 Relationship target object not found: "${change.to}"`);
            console.log(`🔗 Available objects:`, Array.from(this.objects.entries()).map(([id, obj]) => `${id} (${obj.name})`));
            return;
        }

        // Apply the relationship
        sourceObj.addRelationship(change.relationship, targetObj.id, change.progress, change.progressTime);
        
        // Always log relationship changes (not just in dev mode)
        const progressPercent = Math.round(change.progress * 100);
        const timeInfo = change.progressTime ? ` in ${change.progressTime} steps` : '';
        console.log(`🔗 ✅ Applied: ${change.from} ${change.relationship} ${change.to} (${progressPercent}%${timeInfo})`);
        
        if (window.terminal && window.terminal.developerMode) {
            window.terminal.devLog(`Applied: ${change.from} ${change.relationship} ${change.to} (${progressPercent}%${timeInfo})`);
        }
    }

    // Helper method to find object by name or ID (case-insensitive)
    getObjectByName(name) {
        const lowerName = name.toLowerCase();
        
        // First try to find by object ID (exact match or case-insensitive)
        if (this.objects.has(name)) {
            return this.objects.get(name);
        }
        if (this.objects.has(lowerName)) {
            return this.objects.get(lowerName);
        }
        
        // Then try to find by display name (case-insensitive)
        for (const [id, obj] of this.objects) {
            if (obj.name.toLowerCase() === lowerName) {
                return obj;
            }
        }
        
        // Also try to find by ID case-insensitive
        for (const [id, obj] of this.objects) {
            if (id.toLowerCase() === lowerName) {
                return obj;
            }
        }
        
        return null;
    }

    // Progress all time-based relationships by one step
    progressTimeBasedRelationships() {
        let relationshipsChanged = 0;
        let relationshipsCompleted = 0;
        
        for (const [objectId, obj] of this.objects) {
            for (let i = 0; i < obj.relationships.length; i++) {
                const rel = obj.relationships[i];
                
                // Only progress relationships that have progressTime and aren't complete
                if (rel.progressTime !== null && rel.progressTime > 0 && rel.progress < 1.0) {
                    const wasIncomplete = rel.progress < 1.0;
                    
                    // Decrease time remaining
                    rel.progressTime--;
                    
                    // Calculate new progress based on original values
                    if (rel.initialProgress !== null && rel.initialProgressTime !== null && rel.initialProgressTime > 0) {
                        const timeElapsed = rel.initialProgressTime - rel.progressTime;
                        const progressGain = (1.0 - rel.initialProgress) * (timeElapsed / rel.initialProgressTime);
                        rel.progress = Math.min(1.0, rel.initialProgress + progressGain);
                    }
                    
                    relationshipsChanged++;
                    
                    // Check if this relationship just became complete
                    if (wasIncomplete && rel.progress >= 1.0) {
                        relationshipsCompleted++;
                    }
                    
                    // Log the progression
                    const targetObj = this.getObject(rel.to);
                    const progressPercent = Math.round(rel.progress * 100);
                    const timeRemaining = rel.progressTime > 0 ? ` (${rel.progressTime} steps remaining)` : ' (complete)';
                    const completedIndicator = wasIncomplete && rel.progress >= 1.0 ? ' ✅' : '';
                    
                    if (window.terminal && window.terminal.developerMode) {
                        window.terminal.devLog(`Progressed: ${obj.name} ${rel.relationship} ${targetObj ? targetObj.name : rel.to} → ${progressPercent}%${timeRemaining}${completedIndicator}`);
                    }
                    
                    console.log(`🔗 ⏱️ Progressed: ${obj.name} ${rel.relationship} ${targetObj ? targetObj.name : rel.to} → ${progressPercent}%${timeRemaining}${completedIndicator}`);
                }
            }
        }
        
        if (relationshipsChanged > 0) {
            console.log(`🔗 ⏱️ Relationship Summary: ${relationshipsChanged} progressed, ${relationshipsCompleted} completed`);
            
            if (window.terminal && window.terminal.developerMode) {
                window.terminal.devLog(`Relationship Summary: ${relationshipsChanged} progressed, ${relationshipsCompleted} completed`);
            }
        }
    }

    // Update descriptions of all objects that had actions (concurrent with narrative generation)
    async updateObjectDescriptions(simulationResults) {
        if (!window.llmManager || !window.llmManager.isAvailable()) {
            console.log('📝 Skipping description updates - LLM not available');
            return;
        }

        const updatePromises = [];
        let updatesScheduled = 0;

        for (const [objectId, action] of simulationResults) {
            const obj = this.getObject(objectId);
            
            // Only update objects that had meaningful actions
            if (obj && action !== "remains still") {
                const objectContext = {
                    name: obj.name,
                    description: obj.description,
                    parent: obj.parent
                };

                // Get sibling actions for context (but not player action)
                const siblingActions = [];
                if (obj.parent) {
                    obj.parent.containedObjects.forEach(sibling => {
                        if (sibling.id !== objectId && simulationResults.has(sibling.id)) {
                            const siblingAction = simulationResults.get(sibling.id);
                            if (siblingAction !== "remains still") {
                                siblingActions.push({
                                    objectName: sibling.name,
                                    action: siblingAction
                                });
                            }
                        }
                    });
                }

                // Schedule description update
                const updatePromise = window.llmManager.updateObjectDescription(
                    objectContext, 
                    action, 
                    siblingActions
                ).then(newDescription => {
                    if (newDescription !== obj.description) {
                        const oldDesc = obj.description;
                        obj.description = newDescription;
                        
                        console.log(`📝 ✏️ Updated ${obj.name} description`);
                        
                        if (window.terminal && window.terminal.developerMode) {
                            window.terminal.devLog(`Updated ${obj.name} description`);
                            window.terminal.devLog(`Old: "${oldDesc}"`);
                            window.terminal.devLog(`New: "${newDescription}"`);
                        }
                    }
                }).catch(error => {
                    console.warn(`📝 Failed to update ${obj.name} description:`, error.message);
                });

                updatePromises.push(updatePromise);
                updatesScheduled++;
            }
        }

        if (updatesScheduled > 0) {
            console.log(`📝 Updating descriptions for ${updatesScheduled} objects...`);
            
            if (window.terminal && window.terminal.developerMode) {
                window.terminal.devLog(`Updating descriptions for ${updatesScheduled} objects...`);
            }

            // Wait for all description updates to complete
            await Promise.all(updatePromises);
            
            console.log(`📝 Description updates completed`);
        }
    }
}

// Export for use in main.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WorldObject, World };
} else {
    window.WorldObject = WorldObject;
    window.World = World;
}