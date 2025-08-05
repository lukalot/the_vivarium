// LLM Integration for The Vivarium
// Handles Claude 3.5 Haiku API calls for object simulation

class LLMManager {
    constructor() {
        this.apiKey = null;
        this.proxyUrl = 'http://localhost:3001/api/claude'; // Backend proxy
        this.healthUrl = 'http://localhost:3001/api/health';
        this.model = 'claude-3-5-haiku-20241022';
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
                if (health.anthropicConfigured) {
                    console.log('✅ Anthropic API key configured on server');
                    this.serverReady = true;
                } else {
                    console.warn('⚠️ Proxy server running but Anthropic API key not configured');
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

    // Make an API call to Claude (via proxy server)
    async callClaude(prompt, maxTokens = this.maxTokens) {
        if (this.useProxy) {
            return this.callClaudeProxy(prompt, maxTokens);
        } else {
            return this.callClaudeDirect(prompt, maxTokens);
        }
    }

    // Call Claude via backend proxy (recommended)
    async callClaudeProxy(prompt, maxTokens) {
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
        return data.content[0].text.trim();
    }

    // Call Claude directly (legacy - has CORS issues)
    async callClaudeDirect(prompt, maxTokens) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
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
            throw new Error(`Direct API call failed: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
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

Don't append or surround your response with anything that isn't part of the core narrative text.

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
    const manager = window.llmManager;
    const available = manager.isAvailable();
    
    console.log(`🤖 LLM Status: ${available ? '✅ Available' : '❌ Not Available'}`);
    
    if (manager.useProxy) {
        console.log(`📡 Using proxy server at: ${manager.proxyUrl}`);
        console.log(`🏥 Server ready: ${manager.serverReady ? '✅ Yes' : '❌ No'}`);
        
        if (!available) {
            console.log('');
            console.log('🛠️ To fix:');
            console.log('1. Create .env file with: ANTHROPIC_API_KEY=your-key-here');
            console.log('2. Run: npm install && npm start');
            console.log('3. Refresh this page');
        }
    } else {
        console.log('📱 Using direct API calls (legacy mode)');
        if (!available) {
            console.log('To enable: setApiKey("your-anthropic-api-key")');
        }
    }
    
    return available;
};