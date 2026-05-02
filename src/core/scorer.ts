import { ScoreData, ScoreReason, getKeywords, getDomains, getPhrases } from "../storage/kv";
import { RedisClient } from "@devvit/public-api";

export async function calculateScore(
    text: string,
    authorAgeDays: number,
    authorKarma: number,
    redis: RedisClient,
    enableAdvancedScoring: boolean
): Promise<ScoreData> {
    const keywords = await getKeywords(redis);
    const domains = await getDomains(redis);
    const phrases = await getPhrases(redis);

    let score = 0;
    const reasons: ScoreReason[] = [];
    const lowerText = text.toLowerCase();

    // 1. Keyword Matching
    for (const [keyword, weight] of Object.entries(keywords)) {
        if (lowerText.includes(keyword.toLowerCase())) {
            score += weight;
            reasons.push({ type: "keyword", value: keyword, weight });
        }
    }

    // 2. Domain Matching
    // Very basic URL extraction
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex) || [];
    for (const url of urls) {
        for (const [domain, weight] of Object.entries(domains)) {
            if (url.includes(domain)) {
                score += weight;
                reasons.push({ type: "domain", value: domain, weight });
            }
        }
    }

    // 3. Pattern Matching
    // ALL CAPS check (if text is > 10 chars and mostly uppercase)
    const lettersOnly = text.replace(/[^a-zA-Z]/g, '');
    if (lettersOnly.length > 10) {
        const uppercaseCount = text.replace(/[^A-Z]/g, '').length;
        if (uppercaseCount / lettersOnly.length > 0.7) {
            score += 10;
            reasons.push({ type: "pattern", value: "ALL CAPS", weight: 10 });
        }
    }

    // Repeated words or emojis could be added here
    const emojiRegex = /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g;
    const emojis = text.match(emojiRegex);
    if (emojis && emojis.length >= 3) {
        score += 10;
        reasons.push({ type: "pattern", value: "Multiple Emojis", weight: 10 });
    }

    // 4. Simulated NLP (Phrases)
    if (enableAdvancedScoring) {
        for (const [phrase, weight] of Object.entries(phrases)) {
            if (lowerText.includes(phrase.toLowerCase())) {
                score += weight;
                reasons.push({ type: "nlp", value: phrase, weight });
            }
        }
    }

    // 5. User Scoring
    if (authorAgeDays < 7) {
        score += 10;
        reasons.push({ type: "user", value: "New Account", weight: 10 });
    }
    if (authorKarma < 10) {
        score += 10;
        reasons.push({ type: "user", value: "Low Karma", weight: 10 });
    }

    // Cap score at 100
    if (score > 100) {
        score = 100;
    }

    return { score, reasons };
}
