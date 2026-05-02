import { ScoreReason, getKeywords, saveKeywords, getDomains, saveDomains, getPhrases, savePhrases } from "../storage/kv";
import { RedisClient } from "@devvit/public-api";

const MAX_WEIGHT = 50;
const MIN_WEIGHT = 0;

// A simple set of stop words to filter out noise
const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in",
    "into", "is", "it", "no", "not", "of", "on", "or", "such", "that", "the",
    "their", "then", "there", "these", "they", "this", "to", "was", "will", "with",
    "i", "you", "he", "she", "we", "my", "your", "his", "hers", "our", "its"
]);

export async function learnFromAction(
    reasons: ScoreReason[],
    action: "approve" | "remove",
    content: string,
    redis: RedisClient
): Promise<void> {
    const keywords = await getKeywords(redis);
    const domains = await getDomains(redis);
    const phrases = await getPhrases(redis);

    let keywordsUpdated = false;
    let domainsUpdated = false;
    let phrasesUpdated = false;

    // Adjust existing known reasons
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

    // Unsupervised ML: Automatically discover new toxic patterns from removals
    if (action === "remove" && content) {
        const tokens = content.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);

        // Find potentially bad tokens we don't already track
        for (const token of tokens) {
            if (token.length > 3 && !STOP_WORDS.has(token)) {
                // If the word isn't tracked yet, initialize it with a low weight.
                // Over time, multiple removals will automatically increase its weight
                // to a point where it triggers auto-removals (future actions).
                if (!(token in keywords)) {
                    keywords[token] = 1;
                    keywordsUpdated = true;
                } else if (!reasons.some(r => r.type === "keyword" && r.value === token)) {
                    // Even if we know it but didn't flag it this time, bump it up slightly.
                    keywords[token] = Math.min(MAX_WEIGHT, keywords[token] + 0.5);
                    keywordsUpdated = true;
                }
            }
        }

        // Try extracting bigrams (two-word phrases) for simple NLP pattern learning
        for (let i = 0; i < tokens.length - 1; i++) {
            const w1 = tokens[i];
            const w2 = tokens[i+1];
            if (w1.length > 2 && w2.length > 2 && !STOP_WORDS.has(w1) && !STOP_WORDS.has(w2)) {
                const bigram = `${w1} ${w2}`;
                if (!(bigram in phrases)) {
                    phrases[bigram] = 2; // Bigrams are stronger indicators than single words
                    phrasesUpdated = true;
                } else {
                    phrases[bigram] = Math.min(MAX_WEIGHT, phrases[bigram] + 1);
                    phrasesUpdated = true;
                }
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
}
