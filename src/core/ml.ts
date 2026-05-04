import { RedisClient } from "@devvit/public-api";
import { getModelWeights, saveModelWeights, ModelWeights } from "../storage/kv";

export interface MLFeatures {
    [feature: string]: number;
}

export interface MLResult {
    score: number;
    topFeatures: { feature: string, weight: number }[];
}

function sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
}

// computeMLScore implements a weighted linear model + sigmoid for probability
export async function computeMLScore(
    features: MLFeatures,
    redis: RedisClient
): Promise<MLResult> {
    const model = await getModelWeights(redis);

    // finalWeight = 0.7 * local + 0.3 * global
    const local = model.localWeights;
    const global = model.globalWeights;

    let z = 0;
    const featureContributions: { feature: string, weight: number }[] = [];

    for (const [feature, val] of Object.entries(features)) {
        if (val === 0) continue;

        const localW = local[feature] || 0;
        const globalW = global[feature] || 0;
        const finalW = (0.7 * localW) + (0.3 * globalW);

        const contribution = finalW * val;
        z += contribution;

        if (contribution > 0) {
            featureContributions.push({ feature, weight: contribution });
        }
    }

    // Add bias
    const biasLocal = local["__bias__"] || 0;
    const biasGlobal = global["__bias__"] || 0;
    z += (0.7 * biasLocal) + (0.3 * biasGlobal);

    const probability = sigmoid(z);
    const score = Math.round(probability * 100);

    featureContributions.sort((a, b) => b.weight - a.weight);

    return {
        score,
        topFeatures: featureContributions.slice(0, 3)
    };
}
