// LLM Integration for The Vivarium
// Handles Groq/Kimi K2 API calls for object simulation

class LLMManager {
    constructor() {
        this.apiKey = null;
        this.proxyUrl = 'http://localhost:3001/api/groq'; // Backend proxy
        this.healthUrl = 'http://localhost:3001/api/health';
        this.model = 'moonshotai/kimi-k2-instruct';
        this.maxTokens = 150; // Keep responses concise for simulation
        this.narrativeMaxTokens = 250; // Allow more tokens for narrative generation
        this.requestQueue = [];
        this.processing = false;
        this.useProxy = true; // Use backend proxy instead of direct API calls
        
        // Check if proxy server is available
        this.checkProxyHealth();
    }

    // Check if the proxy server is running and healthy
    async checkProxyHealth() {
        if (!this.useProxy) return;
        
        try {
            const response = await fetch(this.healthUrl);
            const health = await response.json();
            
            if (health.status === 'ok') {
                console.log('✅ Proxy server connected');
                if (health.groqConfigured) {
                    console.log('✅ Groq API key configured on server');
                    this.serverReady = true;
                } else {
                    console.warn('⚠️ Proxy server running but Groq API key not configured');
                    this.serverReady = false;
                }
            }
        } catch (error) {
            console.warn('❌ Proxy server not reachable. Start with: npm start');
            console.warn('   Then refresh this page.');
            this.serverReady = false;
        }
    }

    // Set API key (call this first!)
    setApiKey(key) {
        this.apiKey = key;
        console.log('LLM API key configured');
    }

    // Check if LLM is available
    isAvailable() {
        if (this.useProxy) {
            return this.serverReady === true;
        } else {
            return !!this.apiKey;
        }
    }

    // Simulate an object's reaction using Groq/Kimi K2
    async simulateObjectReaction(objectContext, playerAction, childActions = []) {
        if (!this.isAvailable()) {
            return this.fallbackReaction(objectContext, playerAction, childActions);
        }

        const prompt = this.buildSimulationPrompt(objectContext, playerAction, childActions);
        
        try {
            const response = await this.callGroq(prompt);
            return this.parseSimulationResponse(response);
        } catch (error) {
            console.warn('LLM call failed, using fallback:', error.message);
            return this.fallbackReaction(objectContext, playerAction, childActions);
        }
    }

    // Build a prompt for object simulation
    buildSimulationPrompt(objectContext, playerAction, childActions) {
        let prompt = `You are simulating a single object in a text-based game world. Respond with ONLY the action this object takes - no narration, no quotes, no explanation.

OBJECT: ${objectContext.name}
DESCRIPTION: ${objectContext.description}
LOCATION: ${objectContext.parent ? `Inside ${objectContext.parent.name}` : 'At the root level'}

PLAYER ACTION: "${playerAction}"`;

        if (childActions && childActions.length > 0) {
            prompt += `\nCHILD OBJECT ACTIONS: ${childActions.join(', ')}`;
        }

        if (objectContext.relationships && objectContext.relationships.length > 0) {
            const relString = objectContext.relationships.map(r => 
                `${r.relationship} ${r.to} (${r.progress !== null ? Math.floor(r.progress * 100) + '%' : 'ongoing'})`
            ).join(', ');
            prompt += `\nRELATIONSHIPS: ${relString}
NOTE: Progress percentages show relationship status: 100% = relationship is currently true/active, less than 100% = relationship is not yet true but progressing toward being true, 0% = relationship is not true at all currently.`;
        }

        prompt += `\n\nRespond with a single SHORT action phrase (1-8 words) describing what this object does in reaction. Examples:
- "creaks under the pressure"
- "glows faintly"
- "shifts nervously"
- "remains perfectly still"

Your response:`;

        return prompt;
    }

    // Make an API call to Groq (via proxy server)
    async callGroq(prompt, maxTokens = this.maxTokens) {
        if (this.useProxy) {
            return this.callGroqProxy(prompt, maxTokens);
        } else {
            return this.callGroqDirect(prompt, maxTokens);
        }
    }

    // Call Groq via backend proxy (recommended)
    async callGroqProxy(prompt, maxTokens) {
        const response = await fetch(this.proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: prompt,
                maxTokens: maxTokens
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Proxy API call failed: ${response.status} ${response.statusText} - ${errorData.error || 'Unknown error'}`);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();
    }

    // Call Groq directly (legacy - has CORS issues)
    async callGroqDirect(prompt, maxTokens) {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: this.model,
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                max_tokens: maxTokens,
                temperature: 0.6,
                top_p: 1,
                stream: false,
                stop: null
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Direct API call failed: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();
    }

    // Parse and clean the LLM response
    parseSimulationResponse(response) {
        // Remove quotes, excess whitespace, and ensure it's a reasonable length
        let action = response.replace(/["']/g, '').trim();
        
        // Ensure it ends properly
        if (action && !action.endsWith('.') && !action.endsWith('!') && !action.endsWith('?')) {
            action += '';
        }

        // Fallback if response is too long or empty
        if (!action || action.length > 100) {
            return "responds to the situation";
        }

        return action;
    }

    // Fallback reactions when LLM is unavailable
    fallbackReaction(objectContext, playerAction, childActions) {
        // Basic keyword-based reactions
        const keywords = playerAction.toLowerCase();
        
        if (objectContext.id === 'cat_tail') {
            if (keywords.includes('turn') || keywords.includes('wheel')) return "twitches nervously";
            if (keywords.includes('pet') || keywords.includes('cat')) return "flicks with pleasure";
            return "sways gently";
        }
        
        if (objectContext.id === 'ship_cat') {
            if (childActions.some(a => a.includes('twitches'))) return "meows softly";
            if (keywords.includes('pet') || keywords.includes('cat')) return "purrs and rubs against you";
            return "watches alertly";
        }
        
        if (objectContext.id === 'wheel') {
            if (keywords.includes('turn') || keywords.includes('wheel')) return "creaks as it turns";
            if (keywords.includes('touch') || keywords.includes('hold')) return "feels warm under your hands";
            return "holds steady";
        }
        
        if (objectContext.id === 'boat_1') {
            if (childActions.some(a => a.includes('creak') || a.includes('turn'))) return "changes course through the water";
            if (childActions.some(a => a.includes('meow'))) return "rocks gently";
            return "drifts quietly";
        }
        
        return "remains still";
    }

    // Generate a narrative summary from the player's perspective
    async generateNarrative(playerAction, parentAction, siblingActions, contextInfo, relationships = []) {
        if (!this.isAvailable()) {
            throw new Error('LLM not available. Please configure your API key in config.js or use setApiKey().');
        }

        const prompt = this.buildNarrativePrompt(playerAction, parentAction, siblingActions, contextInfo, relationships);
        
        try {
            const response = await this.callGroq(prompt, this.narrativeMaxTokens);
            return this.parseNarrativeResponse(response);
        } catch (error) {
            throw new Error(`LLM narrative generation failed: ${error.message}`);
        }
    }

    // Build a prompt for narrative generation
    buildNarrativePrompt(playerAction, parentAction, siblingActions, contextInfo, relationships = []) {
        let prompt = `You are a narrator for a rich textual world simulation. Write a short, atmospheric description (2-3 sentences) of what happens from the player's perspective.

PLAYER CHARACTER: ${contextInfo.playerName} (${contextInfo.playerDescription})
LOCATION: ${contextInfo.containerName} (${contextInfo.containerDescription})

WHAT HAPPENED:
- Player Action: ${playerAction}`;

        // Helper function to get relationships for a specific object
        const getRelationshipsFor = (objectName) => {
            if (!relationships || relationships.length === 0) return [];
            return relationships.filter(r => r.from === objectName);
        };

        // Helper function to add relationships under an object
        const addRelationships = (objectName) => {
            const objRelationships = getRelationshipsFor(objectName);
            if (objRelationships.length > 0) {
                objRelationships.forEach(rel => {
                    const progressDisplay = rel.progress !== null ? Math.floor(rel.progress * 100) + '%' : 'ongoing';
                    prompt += `\n  → ${rel.relationship} ${rel.to} (${progressDisplay})`;
                });
            }
        };

        // Add player relationships
        addRelationships(contextInfo.playerName);

        // Add parent container action and relationships
        if (parentAction && parentAction !== "remains still") {
            prompt += `\n- ${contextInfo.containerName}: ${parentAction}`;
            addRelationships(contextInfo.containerName);
        }

        // Add sibling actions and their relationships
        if (siblingActions && siblingActions.length > 0) {
            siblingActions.forEach(({ objectName, action }) => {
                if (action !== "remains still" && action !== "no action") {
                    prompt += `\n- ${objectName}: ${action}`;
                    addRelationships(objectName);
                }
            });
        }

        // Add any remaining relationships from objects that didn't have actions
        if (relationships && relationships.length > 0) {
            const objectsWithActions = new Set([contextInfo.playerName]);
            if (parentAction && parentAction !== "remains still") {
                objectsWithActions.add(contextInfo.containerName);
            }
            if (siblingActions) {
                siblingActions.forEach(({ objectName, action }) => {
                    if (action !== "remains still" && action !== "no action") {
                        objectsWithActions.add(objectName);
                    }
                });
            }

            // Find objects with relationships but no actions listed
            const objectsWithRelationships = [...new Set(relationships.map(r => r.from))];
            const unlistedObjects = objectsWithRelationships.filter(obj => !objectsWithActions.has(obj));
            
            if (unlistedObjects.length > 0) {
                unlistedObjects.forEach(objectName => {
                    prompt += `\n- ${objectName}: (present)`;
                    addRelationships(objectName);
                });
            }
        }

        // Add progress explanation if there are any relationships
        if (relationships && relationships.length > 0) {
            prompt += `\n\nRelationship progress: 100% = currently true/active, 0-99% = progressing toward being true, 0% = not true at all`;
        }

        prompt += `\n\nWrite a flowing story segment that captures the atmosphere and describes what the player observes. Focus on sensory details and the immediate environment. Keep it concise but evocative. Write in second person ("You...").

Example style: "You turn the wheel and feel the old wood creak beneath your hands. The cat beside you meows nervously as the boat responds, slowly changing course through the dark water."

Avoid appending or surrounding your response with anything that isn't part of the core narrative text.

Your narration:`;

        return prompt;
    }

    // Parse and clean the narrative response
    parseNarrativeResponse(response) {
        // Remove quotes and clean up
        let narrative = response.replace(/["']/g, '').trim();
        
        // Ensure it ends with proper punctuation
        if (narrative && !narrative.endsWith('.') && !narrative.endsWith('!') && !narrative.endsWith('?')) {
            narrative += '.';
        }

        // Add line breaks for terminal display
        return `\n${narrative}\n`;
    }

    // Legacy fallback method (no longer used - narrator now requires LLM)
    fallbackNarrative(playerAction, parentAction, siblingActions) {
        console.warn('fallbackNarrative() called but narrator now requires LLM. Use checkLLM() to verify setup.');
        throw new Error('Fallback narrative disabled. Please configure LLM with setApiKey() or config.js');
    }

    // Analyze object actions to detect new relationships
    async analyzeRelationshipChanges(playerAction, objectActions) {
        if (!this.isAvailable()) {
            console.log('🔗 LLM not available for relationship analysis');
            return [];
        }

        console.log('🔗 Building relationship analysis prompt...');
        const prompt = this.buildRelationshipAnalysisPrompt(playerAction, objectActions);
        console.log('🔗 Prompt:', prompt.substring(0, 200) + '...');
        
        try {
            console.log('🔗 Sending to LLM...');
            const response = await this.callGroq(prompt, this.maxTokens);
            console.log('🔗 Raw LLM response:', response);
            
            const parsed = this.parseRelationshipChanges(response);
            console.log('🔗 Parsed relationships:', parsed);
            
            return parsed;
        } catch (error) {
            console.error('🔗 Relationship analysis failed:', error.message);
            console.warn('Relationship analysis failed:', error.message);
            return [];
        }
    }

    // Build a prompt for relationship analysis
    buildRelationshipAnalysisPrompt(playerAction, objectActions) {
        let prompt = `You are an adept 1T parameter 2025 AI model (Kimi K2) analyzing the following actions and identifying new spatial or functional relationships that should be created or updated.

PLAYER ACTION: ${playerAction}

OBJECT ACTIONS:`;

        objectActions.forEach(({ objectName, action }) => {
            if (action !== "remains still") {
                prompt += `\n- ${objectName}: ${action}`;
            }
        });

        prompt += `\n\nBased on these actions, identify relationships that should be created or updated. Focus on:
- Spatial relationships (on, in, near, attached to, shining on, etc.)
- Functional relationships (piloting, carrying, supporting, etc.)
- State changes (connected/disconnected, etc.)

Important guidelines:
- Pay careful attention to significant changes in the world such as an object moving out of or into another container, and declare true / complete relationships to help define those actions.
- Don't create relationships that are implicit from parent-child containment (e.g., if person is child of car, they're already "in" the car)
- Only create relationships that are new or changed due to the specific actions described
- Focus on relationships that are direct consequences of the actions, not pre-existing states
- Avoid creating redundant bidirectional relationships (choose one direction)
- Skip obvious permanent attachments (wheel "attached to" car, etc.)
- Don't create relationships with progress values that are not 0 or 1. Progress values between 0 and 1 are exclusively produced when relationships are updated by the progress algorithm, so assign 0 and a Progress Time for incomplete relationships, but any other relationship should already be 1.0, "true".
- Avoid creating relationships that are not expected or intended by objects or the player. For example, if the player enters a house, this doesn't mean that the player will be "sitting on the couch" or "standing in the kitchen" within any specific number of steps.
- Note that "state" is not the goal value or value that will be achieved, but rather the current value of the relationship. Relationships always progress towards 1.0, "true". You should name your relationships based on the target state, never a state that is being moved away from towards 0.

For each relationship, provide:
- The object name (source) - USE EXACT LOWERCASE NAMES as shown above
- Relationship type (verb/preposition)
- Target object name - USE EXACT LOWERCASE NAMES as shown above
- State (Progress) (0.0 or 1.0): 1.0 = relationship exists now, 0.0 = relationship will become true over time
- Progress time (integer >= 1): Number of simulation steps for 0.0 progress to reach 1.0. Use 1 for immediate, 2-10 for gradual changes. A step is roughly 5 seconds, but can vary.

Format as: object_name|relationship_type|target_object|state|progress_time

IMPORTANT: Use the exact object names from the actions above. Do not capitalize or change the names.

Examples:
dog|reached|kennel|0.0|3
dog|in|kennel|1.0|0
cup|held by|constantine|0.0|2
lighthouse|beacon for|boat|1.0|0

Only list relationships that are clearly indicated by the actions. If no new relationships are evident, respond with "NONE".

Response:`;

        return prompt;
    }

    // Parse relationship analysis response
    parseRelationshipChanges(response) {
        console.log('🔗 Parsing LLM response:', response);
        const changes = [];
        const lines = response.trim().split('\n');
        console.log('🔗 Split into lines:', lines);
        
        for (const line of lines) {
            const trimmed = line.trim();
            console.log('🔗 Processing line:', trimmed);
            
            if (trimmed === 'NONE' || trimmed === '') {
                console.log('🔗 Skipping empty/NONE line');
                continue;
            }
            
            const parts = trimmed.split('|');
            console.log('🔗 Split parts:', parts);
            
            if (parts.length === 5) {
                const [from, relationship, to, progressStr, progressTimeStr] = parts;
                const progress = parseFloat(progressStr);
                const progressTime = parseInt(progressTimeStr);
                
                console.log(`🔗 Parsing: ${from} -> ${relationship} -> ${to} (${progressStr} = ${progress}, time: ${progressTimeStr} = ${progressTime})`);
                
                if (!isNaN(progress) && progress >= 0 && progress <= 1 && !isNaN(progressTime) && progressTime >= 1) {
                    const change = {
                        from: from.trim().toLowerCase(), // Force lowercase to match object names
                        relationship: relationship.trim(),
                        to: to.trim().toLowerCase(), // Force lowercase to match object names
                        progress: progress,
                        progressTime: progressTime
                    };
                    console.log('🔗 Valid relationship change:', change);
                    changes.push(change);
                } else {
                    console.log('🔗 Invalid progress/time values:', progressStr, progress, progressTimeStr, progressTime);
                }
            } else {
                console.log('🔗 Wrong number of parts (expected 5):', parts.length);
            }
        }
        
        console.log('🔗 Final parsed changes:', changes);
        return changes;
    }

    // Update an object's description based on its context and recent actions
    async updateObjectDescription(objectContext, objectAction, siblingActions = []) {
        if (!this.isAvailable()) {
            return objectContext.description; // Return unchanged if LLM not available
        }

        const prompt = this.buildDescriptionUpdatePrompt(objectContext, objectAction, siblingActions);
        
        try {
            const response = await this.callGroq(prompt, this.narrativeMaxTokens);
            return this.parseDescriptionResponse(response, objectContext.description);
        } catch (error) {
            console.warn(`Description update failed for ${objectContext.name}:`, error.message);
            return objectContext.description; // Return unchanged on error
        }
    }

    // Build a prompt for description updating
    buildDescriptionUpdatePrompt(objectContext, objectAction, siblingActions = []) {
        let prompt = `You are updating the description of an object in a dynamic world simulation. Revise the description to reflect recent events and the current state.

OBJECT: ${objectContext.name}
CURRENT DESCRIPTION: ${objectContext.description}
LOCATION: ${objectContext.parent ? `Inside ${objectContext.parent.name} (${objectContext.parent.description})` : 'At the root level'}

RECENT ACTIVITY:
- ${objectContext.name}: ${objectAction}`;

        if (siblingActions && siblingActions.length > 0) {
            siblingActions.forEach(({ objectName, action }) => {
                if (action !== "remains still") {
                    prompt += `\n- ${objectName}: ${action}`;
                }
            });
        }

        prompt += `\n\nGUIDELINES:
- Keep the core identity and nature of the object
- Incorporate subtle changes that reflect the recent activity
- Update physical state, wear, positioning, or mood as appropriate
- Maintain the atmospheric tone and writing style
- Keep descriptions concise (1-3 sentences)
- Don't make dramatic changes unless the action clearly warrants it

Write only the updated description, nothing else.

Updated description:`;

        return prompt;
    }

    // Parse and clean the description response
    parseDescriptionResponse(response, fallbackDescription) {
        let description = response.replace(/["']/g, '').trim();
        
        // Basic validation - if response seems too short or weird, use fallback
        if (description.length < 10 || description.toLowerCase().includes('updated description')) {
            return fallbackDescription;
        }
        
        // Ensure it ends with proper punctuation
        if (description && !description.endsWith('.') && !description.endsWith('!') && !description.endsWith('?')) {
            description += '.';
        }

        return description;
    }

    // Batch simulate multiple objects (for future optimization)
    async batchSimulateObjects(simulations) {
        const results = new Map();
        
        // For now, process sequentially to avoid rate limits
        // TODO: Implement proper batching/queuing for production
        for (const { objectId, objectContext, playerAction, childActions } of simulations) {
            const reaction = await this.simulateObjectReaction(objectContext, playerAction, childActions);
            results.set(objectId, reaction);
        }
        
        return results;
    }
}

// Create global LLM manager instance
window.llmManager = new LLMManager();

// Helper function to set API key
window.setApiKey = (key) => {
    window.llmManager.setApiKey(key);
};

// Helper function to check LLM status
window.checkLLM = () => {
    const manager = window.llmManager;
    const available = manager.isAvailable();
    
    console.log(`🤖 LLM Status: ${available ? '✅ Available' : '❌ Not Available'}`);
    
    if (manager.useProxy) {
        console.log(`📡 Using proxy server at: ${manager.proxyUrl}`);
        console.log(`🏥 Server ready: ${manager.serverReady ? '✅ Yes' : '❌ No'}`);
        
        if (!available) {
            console.log('');
            console.log('🛠️ To fix:');
            console.log('1. Create .env file with: GROQ_API_KEY=your-key-here');
            console.log('2. Run: npm install && npm start');
            console.log('3. Refresh this page');
        }
    } else {
        console.log('📱 Using direct API calls (legacy mode)');
        if (!available) {
            console.log('To enable: setApiKey("your-groq-api-key")');
        }
    }
    
    return available;
};