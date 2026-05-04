export const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in",
    "into", "is", "it", "no", "not", "of", "on", "or", "such", "that", "the",
    "their", "then", "there", "these", "they", "this", "to", "was", "will", "with",
    "i", "you", "he", "she", "we", "my", "your", "his", "hers", "our", "its"
]);

export function cleanAndTokenize(text: string): string[] {
    const cleanText = text
        .toLowerCase()
        .replace(/(https?:\/\/[^\s]+)/g, "") // remove URLs
        .replace(/[^a-z0-9\s]/g, "")         // remove special chars
        .replace(/\s+/g, " ")                // normalize whitespace
        .trim();

    return cleanText.split(" ").filter(t => t.length > 0 && !STOP_WORDS.has(t));
}

export function extractBigrams(tokens: string[]): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < tokens.length - 1; i++) {
        if (tokens[i].length > 2 && tokens[i+1].length > 2) {
            bigrams.push(`${tokens[i]} ${tokens[i+1]}`);
        }
    }
    return bigrams;
}

// Manual semantic clustering
export const CLUSTERS: Record<string, string[]> = {
    "scam": ["earn money fast", "quick cash", "double your money", "free crypto", "guaranteed returns"],
    "promo": ["subscribe", "check my channel", "follow me", "link in bio", "limited offer"]
};

export function computeSemanticScore(text: string): { score: number, matches: string[] } {
    let score = 0;
    const matches: string[] = [];
    const lower = text.toLowerCase();

    for (const [intent, phrases] of Object.entries(CLUSTERS)) {
        for (const phrase of phrases) {
            if (lower.includes(phrase)) {
                score += 15; // Arbitrary base weight for a cluster hit
                matches.push(`intent:${intent} (${phrase})`);
            }
        }
    }

    return { score, matches };
}
