// LLM Integration for The Vivarium
// Handles Claude 3.5 Haiku API calls for object simulation

class LLMManager {
    constructor() {
        this.apiKey = null;
        this.baseUrl = 'https://api.anthropic.com/v1/messages';
        this.model = 'claude-3-5-haiku-20241022';
        this.maxTokens = 150; // Keep responses concise for simulation
        this.narrativeMaxTokens = 250; // Allow more tokens for narrative generation
        this.requestQueue = [];
        this.processing = false;
        
        // Try to auto-load API key from config
        this.loadConfigApiKey();
    }

    // Try to load API key from config.js
    loadConfigApiKey() {
        try {
            if (window.VIVARIUM_CONFIG && window.VIVARIUM_CONFIG.ANTHROPIC_API_KEY) {
                const configKey = window.VIVARIUM_CONFIG.ANTHROPIC_API_KEY;
                if (configKey && configKey !== "your-api-key-here") {
                    this.apiKey = configKey;
                    console.log('API key loaded from config.js');
                } else {
                    console.log('Config found but API key not set. Update config.js with your Anthropic API key.');
                }
            } else {
                console.log('No config.js found or ANTHROPIC_API_KEY not defined. Use setApiKey() manually.');
            }
        } catch (error) {
            console.log('Could not load config.js:', error.message);
        }
    }

    // Set API key (call this first!)
    setApiKey(key) {
        this.apiKey = key;
        console.log('LLM API key configured');
    }

    // Check if LLM is available
    isAvailable() {
        return !!this.apiKey;
    }

    // Simulate an object's reaction using Claude
    async simulateObjectReaction(objectContext, playerAction, childActions = []) {
        if (!this.isAvailable()) {
            return this.fallbackReaction(objectContext, playerAction, childActions);
        }

        const prompt = this.buildSimulationPrompt(objectContext, playerAction, childActions);
        
        try {
            const response = await this.callClaude(prompt);
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
                `${r.relationship} ${r.to} (${r.progress !== null ? Math.round(r.progress * 100) + '%' : 'ongoing'})`
            ).join(', ');
            prompt += `\nRELATIONSHIPS: ${relString}`;
        }

        prompt += `\n\nRespond with a single SHORT action phrase (1-8 words) describing what this object does in reaction. Examples:
- "creaks under the pressure"
- "glows faintly"
- "shifts nervously"
- "remains perfectly still"

Your response:`;

        return prompt;
    }

    // Make an API call to Claude
    async callClaude(prompt, maxTokens = this.maxTokens) {
        const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: this.model,
                max_tokens: maxTokens,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`API call failed: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
        }

        const data = await response.json();
        return data.content[0].text.trim();
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
    async generateNarrative(playerAction, parentAction, siblingActions, contextInfo) {
        if (!this.isAvailable()) {
            throw new Error('LLM not available. Please configure your API key in config.js or use setApiKey().');
        }

        const prompt = this.buildNarrativePrompt(playerAction, parentAction, siblingActions, contextInfo);
        
        try {
            const response = await this.callClaude(prompt, this.narrativeMaxTokens);
            return this.parseNarrativeResponse(response);
        } catch (error) {
            throw new Error(`LLM narrative generation failed: ${error.message}`);
        }
    }

    // Build a prompt for narrative generation
    buildNarrativePrompt(playerAction, parentAction, siblingActions, contextInfo) {
        let prompt = `You are a narrator for a text-based game. Write a short, atmospheric description (2-3 sentences) of what happens from the player's perspective.

PLAYER CHARACTER: ${contextInfo.playerName} (${contextInfo.playerDescription})
LOCATION: ${contextInfo.containerName} (${contextInfo.containerDescription})

WHAT HAPPENED:
- Player Action: ${playerAction}`;

        if (parentAction && parentAction !== "remains still") {
            prompt += `\n- ${contextInfo.containerName}: ${parentAction}`;
        }

        if (siblingActions && siblingActions.length > 0) {
            siblingActions.forEach(({ objectName, action }) => {
                if (action !== "remains still" && action !== "no action") {
                    prompt += `\n- ${objectName}: ${action}`;
                }
            });
        }

        prompt += `\n\nWrite a flowing narrative that captures the atmosphere and describes what the player observes. Focus on sensory details and the immediate environment. Keep it concise but evocative. Write in second person ("You...").

Example style: "You turn the wheel and feel the old wood creak beneath your hands. The cat beside you meows nervously as the boat responds, slowly changing course through the dark water."

Your narrative:`;

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
    const available = window.llmManager.isAvailable();
    console.log(`LLM Status: ${available ? 'Available' : 'Not configured'}`);
    if (!available) {
        console.log('To enable LLM: setApiKey("your-anthropic-api-key")');
    }
    return available;
};