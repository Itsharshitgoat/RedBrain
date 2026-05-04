import { ScoreReason, getKeywords, saveKeywords, getDomains, saveDomains, getPhrases, savePhrases, getModelWeights, saveModelWeights, WeightData } from "../storage/kv";
import { RedisClient } from "@devvit/public-api";
import { STOP_WORDS, cleanAndTokenize, extractBigrams } from "./nlp";

const MAX_WEIGHT = 50;
const MIN_WEIGHT = 0;
const LEARNING_RATE = 0.05;

export async function learnFromAction(
    reasons: ScoreReason[],
    action: "approve" | "remove",
    content: string,
    redis: RedisClient,
    enableAdvancedScoring: boolean
): Promise<void> {
    const keywords = await getKeywords(redis);
    const domains = await getDomains(redis);
    const phrases = await getPhrases(redis);

    let keywordsUpdated = false;
    let domainsUpdated = false;
    let phrasesUpdated = false;

    for (const reason of reasons) {
        if (reason.type === "keyword") {
            const currentWeight = keywords[reason.value] || 0;
            const newWeight = action === "remove"
                ? Math.min(MAX_WEIGHT, currentWeight + 2)
                : Math.max(MIN_WEIGHT, currentWeight - 1);

            keywords[reason.value] = newWeight;
            keywordsUpdated = true;
        } else if (reason.type === "domain") {
            const currentWeight = domains[reason.value] || 0;
            const newWeight = action === "remove"
                ? Math.min(MAX_WEIGHT, currentWeight + 3)
                : Math.max(MIN_WEIGHT, currentWeight - 1);

            domains[reason.value] = newWeight;
            domainsUpdated = true;
        } else if (reason.type === "nlp") {
            const currentWeight = phrases[reason.value] || 0;
            const newWeight = action === "remove"
                ? Math.min(MAX_WEIGHT, currentWeight + 2)
                : Math.max(MIN_WEIGHT, currentWeight - 1);

            phrases[reason.value] = newWeight;
            phrasesUpdated = true;
        }
    }

    if (action === "remove" && content) {
        const tokens = cleanAndTokenize(content);

        for (const token of tokens) {
            if (token.length > 3) {
                if (!(token in keywords)) {
                    keywords[token] = 1;
                    keywordsUpdated = true;
                } else if (!reasons.some(r => r.type === "keyword" && r.value === token)) {
                    keywords[token] = Math.min(MAX_WEIGHT, keywords[token] + 0.5);
                    keywordsUpdated = true;
                }
            }
        }

        const bigrams = extractBigrams(tokens);
        for (const bigram of bigrams) {
            if (!(bigram in phrases)) {
                phrases[bigram] = 2;
                phrasesUpdated = true;
            } else {
                phrases[bigram] = Math.min(MAX_WEIGHT, phrases[bigram] + 1);
                phrasesUpdated = true;
            }
        }
    }

    // Optional decay for basic lists
    for (const key of Object.keys(keywords)) {
        keywords[key] = keywords[key] * 0.98;
    }
    for (const key of Object.keys(domains)) {
        domains[key] = domains[key] * 0.98;
    }
    for (const key of Object.keys(phrases)) {
        phrases[key] = phrases[key] * 0.98;
    }


    if (keywordsUpdated || Object.keys(keywords).length > 0) {
        await saveKeywords(redis, pruneRecord(keywords, 500));
    }
    if (domainsUpdated || Object.keys(domains).length > 0) {
        await saveDomains(redis, pruneRecord(domains, 200));
    }
    if (phrasesUpdated || Object.keys(phrases).length > 0) {
        await savePhrases(redis, pruneRecord(phrases, 300));
    }

    if (enableAdvancedScoring) {
        await updateMLWeights(content, action, redis);
    }
}

// Helper to prevent infinite dictionary growth
function pruneRecord(record: Record<string, number>, maxLen: number): Record<string, number> {
    const entries = Object.entries(record);
    if (entries.length <= maxLen) return record;

    entries.sort((a, b) => b[1] - a[1]);
    const pruned: Record<string, number> = {};
    for (let i = 0; i < maxLen; i++) {
        pruned[entries[i][0]] = entries[i][1];
    }
    return pruned;
}

function pruneWeights(record: Record<string, WeightData>, maxLen: number): Record<string, WeightData> {
    // Only prune by frequency if we are exceeding the max length, otherwise let new tokens live long enough to gain frequency
    const entries = Object.entries(record);
    if (entries.length <= maxLen) return record;

    // Favor tokens with high weight first
    entries.sort((a, b) => b[1].weight - a[1].weight);
    const pruned: Record<string, WeightData> = {};
    let added = 0;

    for (const [k, v] of entries) {
        // Keep top items, but drop items with frequency <= 2 if we need room
        if (added < maxLen) {
            // we will keep any bias token regardless of anything else
             if (k === "__bias__" || v.frequency > 0) { // removed the > 2 strictness so new tokens don't instantly vanish on maxLen hits
                pruned[k] = v;
                added++;
             }
        } else {
             break;
        }
    }

    if (record["__bias__"] && !pruned["__bias__"]) pruned["__bias__"] = record["__bias__"];
    return pruned;
}


async function updateMLWeights(content: string, action: "approve" | "remove", redis: RedisClient) {
    const tokens = cleanAndTokenize(content);
    const bigrams = extractBigrams(tokens);
    const now = Date.now();

    // Construct feature vector for this content
    const features: Record<string, number> = {};
    for (const token of tokens) {
        features[`token_${token}`] = (features[`token_${token}`] || 0) + 1;
    }
    for (const bigram of bigrams) {
        features[`bigram_${bigram}`] = (features[`bigram_${bigram}`] || 0) + 1;
    }

    const target = action === "remove" ? 1 : 0;
    const model = await getModelWeights(redis);

    let z = 0;
    for (const [feature, val] of Object.entries(features)) {
        if (val === 0) continue;
        const localW = model.localWeights[feature]?.weight || 0;
        const globalW = model.globalWeights[feature]?.weight || 0;
        const finalW = (0.7 * localW) + (0.3 * globalW);
        z += finalW * val;
    }
    z += (0.7 * (model.localWeights["__bias__"]?.weight || 0)) + (0.3 * (model.globalWeights["__bias__"]?.weight || 0));

    const prediction = 1 / (1 + Math.exp(-z));
    const error = prediction - target;

    for (const [feature, val] of Object.entries(features)) {
        if (val === 0) continue;

        // Update Local
        const currentLocalData = model.localWeights[feature] || { weight: 0, frequency: 0, lastSeen: 0 };
        const newLocalW = currentLocalData.weight - (LEARNING_RATE * error * val);
        model.localWeights[feature] = {
            weight: Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, newLocalW)),
            frequency: currentLocalData.frequency + 1,
            lastSeen: now
        };

        // Update Global
        const currentGlobalData = model.globalWeights[feature] || { weight: 0, frequency: 0, lastSeen: 0 };
        const newGlobalW = currentGlobalData.weight - ((LEARNING_RATE * 0.1) * error * val);
        model.globalWeights[feature] = {
            weight: Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, newGlobalW)),
            frequency: currentGlobalData.frequency + 1,
            lastSeen: now
        };
    }

    // Decay all weights and clean up old ones (Drift Protection)
    for (const feature of Object.keys(model.localWeights)) {
        model.localWeights[feature].weight *= 0.98;
    }
    for (const feature of Object.keys(model.globalWeights)) {
        model.globalWeights[feature].weight *= 0.98;
    }

    // Update bias
    const currentBias = model.localWeights["__bias__"]?.weight || 0;
    model.localWeights["__bias__"] = {
        weight: currentBias - (LEARNING_RATE * error),
        frequency: 1000,
        lastSeen: now
    };

    // Prune dictionaries to prevent KV explosion
    model.localWeights = pruneWeights(model.localWeights, 1000);
    model.globalWeights = pruneWeights(model.globalWeights, 1000);

    await saveModelWeights(redis, model);
}
