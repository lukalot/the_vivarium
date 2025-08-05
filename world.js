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
    addRelationship(relationship, targetId, progress = null) {
        // Remove existing relationship of same type to same target
        this.relationships = this.relationships.filter(
            rel => !(rel.relationship === relationship && rel.to === targetId)
        );
        this.relationships.push({ relationship, to: targetId, progress });
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

        // Find the simulation branch (from player up to root)
        const branch = this.getSimulationBranch(playerObject);
        
        // PHASE 1: Complete all simulation first
        const results = await this.simulateBottomUp(branch, action);

        // Emit simulation event for terminal display
        if (window.terminal && typeof window.onWorldUpdate === 'function') {
            window.onWorldUpdate(this);
        }

        // PHASE 2: Only after simulation is complete, generate narration
        return await this.narratePlayerExperience(results, action);
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
        
        for (const depth of depths) {
            const objectsAtDepth = depthGroups.get(depth);
            
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

        // Player always takes the exact action they specified
        if (obj.id === this.playerObjectId) {
            return playerAction;
        }
        
        // Use LLM if available, otherwise fall back to basic reactions
        if (window.llmManager && window.llmManager.isAvailable()) {
            try {
                return await window.llmManager.simulateObjectReaction(obj, playerAction, childActions);
            } catch (error) {
                console.warn(`LLM simulation failed for ${obj.id}, using fallback:`, error);
                return this.getBasicReaction(obj, playerAction, childActions);
            }
        } else {
            return this.getBasicReaction(obj, playerAction, childActions);
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

        // Prepare context information for the LLM
        const contextInfo = {
            playerName: playerObject.name,
            playerDescription: playerObject.description,
            containerName: playerParent.name,
            containerDescription: playerParent.description
        };

        // Use LLM to generate the narrative (no fallbacks - show errors)
        if (!window.llmManager) {
            return "\n❌ LLM Manager not loaded. Check console for errors.\n";
        }

        try {
            return await window.llmManager.generateNarrative(
                playerAction, 
                parentAction, 
                siblingActions, 
                contextInfo
            );
        } catch (error) {
            // Show the error to the user instead of falling back silently
            console.error('LLM narrative generation failed:', error);
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
}

// Export for use in main.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WorldObject, World };
} else {
    window.WorldObject = WorldObject;
    window.World = World;
}