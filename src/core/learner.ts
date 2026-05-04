import { ScoreReason, getKeywords, saveKeywords, getDomains, saveDomains, getPhrases, savePhrases, getModelWeights, saveModelWeights } from "../storage/kv";
import { RedisClient } from "@devvit/public-api";
import { STOP_WORDS, cleanAndTokenize, extractBigrams } from "./nlp";
import { computeMLScoreWrapper } from "./scorer";

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

    // Adjust existing known reasons in the Rule Engine
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

    if (keywordsUpdated) {
        await saveKeywords(redis, keywords);
    }
    if (domainsUpdated) {
        await saveDomains(redis, domains);
    }
    if (phrasesUpdated) {
        await savePhrases(redis, phrases);
    }

    // --- Online Learning Loop (ML Model) ---
    if (enableAdvancedScoring) {
        await updateMLWeights(content, action, redis);
    }
}

async function updateMLWeights(content: string, action: "approve" | "remove", redis: RedisClient) {
    const tokens = cleanAndTokenize(content);
    const bigrams = extractBigrams(tokens);

    // Construct feature vector for this content
    const features: Record<string, number> = {};
    for (const token of tokens) {
        features[`token_${token}`] = (features[`token_${token}`] || 0) + 1;
    }
    for (const bigram of bigrams) {
        features[`bigram_${bigram}`] = (features[`bigram_${bigram}`] || 0) + 1;
    }

    // Target label: removed = 1, approved = 0
    const target = action === "remove" ? 1 : 0;

    const model = await getModelWeights(redis);

    // Calculate current prediction
    let z = 0;
    for (const [feature, val] of Object.entries(features)) {
        if (val === 0) continue;
        const localW = model.localWeights[feature] || 0;
        const globalW = model.globalWeights[feature] || 0;
        const finalW = (0.7 * localW) + (0.3 * globalW);
        z += finalW * val;
    }
    z += (0.7 * (model.localWeights["__bias__"] || 0)) + (0.3 * (model.globalWeights["__bias__"] || 0));

    const prediction = 1 / (1 + Math.exp(-z));

    // Simplified Gradient Descent
    const error = prediction - target;

    for (const [feature, val] of Object.entries(features)) {
        if (val === 0) continue;
        const currentLocal = model.localWeights[feature] || 0;
        // update = current - LR * error * feature_value
        model.localWeights[feature] = currentLocal - (LEARNING_RATE * error * val);

        // Slightly update global weights if desired, but primarily focus on local
        const currentGlobal = model.globalWeights[feature] || 0;
        model.globalWeights[feature] = currentGlobal - ((LEARNING_RATE * 0.1) * error * val);
    }

    // Update bias
    model.localWeights["__bias__"] = (model.localWeights["__bias__"] || 0) - (LEARNING_RATE * error);

    await saveModelWeights(redis, model);
}
