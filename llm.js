// LLM Integration for The Vivarium
// Handles Claude 3.5 Haiku API calls for object simulation

class LLMManager {
    constructor() {
        this.apiKey = null;
        this.baseUrl = 'https://api.anthropic.com/v1/messages';
        this.model = 'claude-3-5-haiku-20241022';
        this.maxTokens = 150; // Keep responses concise for simulation
        this.requestQueue = [];
        this.processing = false;
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
    async callClaude(prompt) {
        const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: this.model,
                max_tokens: this.maxTokens,
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