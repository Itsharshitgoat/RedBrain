import { ScoreData, ScoreReason, getKeywords, getDomains, getPhrases } from "../storage/kv";
import { RedisClient } from "@devvit/public-api";
import { computeMLScore, MLFeatures } from "./ml";
import { cleanAndTokenize, extractBigrams, computeSemanticScore } from "./nlp";

export async function calculateScore(
    text: string,
    authorAgeDays: number,
    authorKarma: number,
    redis: RedisClient,
    enableAdvancedScoring: boolean
): Promise<ScoreData> {

    // Create parallel execution pipeline
    const [ruleResult, mlResult] = await Promise.all([
        computeRuleScore(text, authorAgeDays, authorKarma, redis, enableAdvancedScoring),
        computeMLScoreWrapper(text, authorAgeDays, authorKarma, redis, enableAdvancedScoring)
    ]);

    // Rule Engine + ML Merge
    // Final Score = ML Score * 0.7 + Rule Score * 0.3
    const finalScoreRaw = (mlResult.score * 0.7) + (ruleResult.score * 0.3);
    let finalScore = Math.round(finalScoreRaw);

    if (finalScore > 100) finalScore = 100;

    // Combine explanations
    const reasons = [...ruleResult.reasons];
    for (const topF of mlResult.topFeatures) {
        reasons.push({ type: "ml_feature", value: topF.feature, weight: Math.round(topF.weight * 10) / 10 });
    }

    return { score: finalScore, reasons };
}

async function computeRuleScore(
    text: string,
    authorAgeDays: number,
    authorKarma: number,
    redis: RedisClient,
    enableAdvancedScoring: boolean
): Promise<{ score: number, reasons: ScoreReason[] }> {
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
    const lettersOnly = text.replace(/[^a-zA-Z]/g, '');
    if (lettersOnly.length > 10) {
        const uppercaseCount = text.replace(/[^A-Z]/g, '').length;
        if (uppercaseCount / lettersOnly.length > 0.7) {
            score += 10;
            reasons.push({ type: "pattern", value: "ALL CAPS", weight: 10 });
        }
    }

    const emojiRegex = /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g;
    const emojis = text.match(emojiRegex);
    if (emojis && emojis.length >= 3) {
        score += 10;
        reasons.push({ type: "pattern", value: "Multiple Emojis", weight: 10 });
    }

    // 4. NLP & Semantics
    if (enableAdvancedScoring) {
        const semResult = computeSemanticScore(text);
        if (semResult.score > 0) {
            score += semResult.score;
            for (const match of semResult.matches) {
                reasons.push({ type: "semantic", value: match, weight: 15 });
            }
        }

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

    return { score, reasons };
}

export async function computeMLScoreWrapper(
    text: string,
    authorAgeDays: number,
    authorKarma: number,
    redis: RedisClient,
    enableAdvancedScoring: boolean
) {
    if (!enableAdvancedScoring) {
        return { score: 0, topFeatures: [] };
    }

    const tokens = cleanAndTokenize(text);
    const bigrams = extractBigrams(tokens);

    // Construct feature vector
    const features: MLFeatures = {};

    // Add token features
    for (const token of tokens) {
        features[`token_${token}`] = (features[`token_${token}`] || 0) + 1;
    }

    // Add bigram features
    for (const bigram of bigrams) {
        features[`bigram_${bigram}`] = (features[`bigram_${bigram}`] || 0) + 1;
    }

    // Add heuristics
    features["user_new"] = authorAgeDays < 7 ? 1 : 0;
    features["user_low_karma"] = authorKarma < 10 ? 1 : 0;

    return await computeMLScore(features, redis);
}
