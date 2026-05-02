import { ScoreReason, getKeywords, saveKeywords, getDomains, saveDomains, getPhrases, savePhrases } from "../storage/kv";
import { RedisClient } from "@devvit/public-api";

const MAX_WEIGHT = 50;
const MIN_WEIGHT = 0;

export async function learnFromAction(
    reasons: ScoreReason[],
    action: "approve" | "remove",
    redis: RedisClient
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
        } else if (reason.type === "nlp") { // mapped from phrases
            const currentWeight = phrases[reason.value] || 0;
            const newWeight = action === "remove"
                ? Math.min(MAX_WEIGHT, currentWeight + 2)
                : Math.max(MIN_WEIGHT, currentWeight - 1);

            phrases[reason.value] = newWeight;
            phrasesUpdated = true;
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
}
