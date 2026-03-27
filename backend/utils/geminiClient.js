const DEFAULT_MODEL = 'gemini-1.5-flash';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const PREFERRED_MODELS = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
    'gemini-1.5-pro-latest',
    'gemini-1.0-pro',
    'gemini-pro',
];

const getApiKey = () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        throw new Error('GEMINI_API_KEY is not set');
    }
    return key;
};

const getModelName = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;

const getBaseUrl = () => process.env.GEMINI_BASE_URL || DEFAULT_BASE_URL;

const extractText = (data) => {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('');
    return text.trim();
};

const normalizeModelName = (name) => {
    if (!name) return name;
    return String(name).replace(/^models\//, '');
};

const listModels = async ({ apiKey, baseUrl }) => {
    const url = `${baseUrl}/models?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
        const text = await response.text();
        const err = new Error(`Gemini ListModels error (${response.status}): ${text}`);
        err.statusCode = response.status;
        err.body = text;
        throw err;
    }
    const data = await response.json();
    return Array.isArray(data?.models) ? data.models : [];
};

const pickAvailableModel = (models) => {
    if (!Array.isArray(models) || models.length === 0) return null;
    const filtered = models.filter((m) => {
        const methods = m?.supportedGenerationMethods;
        if (!Array.isArray(methods)) return true;
        return methods.includes('generateContent');
    });

    const normalized = filtered.map((m) => ({
        ...m,
        _name: normalizeModelName(m.name),
    }));

    for (const preferred of PREFERRED_MODELS) {
        const found = normalized.find((m) => m._name === preferred);
        if (found) return found._name;
    }
    return normalized[0]?._name || null;
};

async function generateText({ prompt, temperature = 0.2 }) {
    const apiKey = getApiKey();
    const model = normalizeModelName(getModelName());
    const baseUrl = getBaseUrl();

    const body = {
        contents: [
            {
                role: 'user',
                parts: [{ text: prompt }],
            },
        ],
        generationConfig: {
            temperature,
        },
    };

    const attempt = async (modelName) => {
        const modelId = normalizeModelName(modelName);
        const url = `${baseUrl}/models/${modelId}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const text = await response.text();
            const err = new Error(`Gemini API error (${response.status}): ${text}`);
            err.statusCode = response.status;
            err.body = text;
            throw err;
        }
        const data = await response.json();
        const text = extractText(data);
        if (!text) {
            throw new Error('Gemini API returned an empty response');
        }
        return text;
    };

    try {
        return await attempt(model);
    } catch (err) {
        const bodyText = String(err.body || err.message || '');
        const shouldRetry = err.statusCode === 404 || bodyText.toLowerCase().includes('not found');
        if (shouldRetry) {
            // First fallback: try DEFAULT_MODEL if different
            if (model && normalizeModelName(model) !== normalizeModelName(DEFAULT_MODEL)) {
                try {
                    return await attempt(DEFAULT_MODEL);
                } catch (e) {
                    // continue to list models
                }
            }
            // Second fallback: list models and pick a supported one
            const models = await listModels({ apiKey, baseUrl });
            const picked = pickAvailableModel(models);
            if (picked) {
                return await attempt(picked);
            }
        }
        throw err;
    }
}

module.exports = {
    generateText,
};
