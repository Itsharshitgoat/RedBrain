import { RedisClient } from "@devvit/public-api";

export type Status = "pending" | "approved" | "removed";

export interface ScoreReason {
    type: "keyword" | "domain" | "pattern" | "user" | "nlp" | "semantic" | "ml_feature";
    value: string;
    weight: number;
}

export interface ScoreData {
    score: number;
    reasons: ScoreReason[];
}

export interface PostData {
    id: string;
    title: string;
    content: string;
    author: string;
    score: number;
    reasons: ScoreReason[];
    status: Status;
    timestamp: number;
}

export interface CommentData {
    id: string;
    postId: string;
    content: string;
    author: string;
    score: number;
    reasons: ScoreReason[];
    status: Status;
    timestamp: number;
}

export interface AnalyticsData {
    totalPosts: number;
    removedPosts: number;
    approvedPosts: number;
    totalComments: number;
    removedComments: number;
    approvedComments: number;
    highRiskCount: number;
    mediumRiskCount: number;
    lowRiskCount: number;
}

// Upgraded model structures
export interface WeightData {
    weight: number;
    frequency: number;
    lastSeen: number;
}

export interface ModelWeights {
    localWeights: Record<string, WeightData>;
    globalWeights: Record<string, WeightData>;
}

export function getThresholds(sensitivity: string) {
    switch (sensitivity) {
        case "Low":
            return { high: 80, medium: 50 };
        case "Medium":
            return { high: 70, medium: 40 };
        case "High":
            return { high: 60, medium: 30 };
        default:
            return { high: 70, medium: 40 }; // default medium
    }
}

export async function getPost(redis: RedisClient, id: string): Promise<PostData | null> {
    const data = await redis.get(`posts:${id}`);
    if (data) {
        return JSON.parse(data) as PostData;
    }
    return null;
}

export async function savePost(redis: RedisClient, post: PostData): Promise<void> {
    await redis.set(`posts:${post.id}`, JSON.stringify(post));
}

export async function getComment(redis: RedisClient, id: string): Promise<CommentData | null> {
    const data = await redis.get(`comments:${id}`);
    if (data) {
        return JSON.parse(data) as CommentData;
    }
    return null;
}

export async function saveComment(redis: RedisClient, comment: CommentData): Promise<void> {
    await redis.set(`comments:${comment.id}`, JSON.stringify(comment));
}

export async function getKeywords(redis: RedisClient): Promise<Record<string, number>> {
    const data = await redis.get('keywords');
    if (data) return JSON.parse(data);
    return {};
}

export async function saveKeywords(redis: RedisClient, keywords: Record<string, number>): Promise<void> {
    await redis.set('keywords', JSON.stringify(keywords));
}

export async function getDomains(redis: RedisClient): Promise<Record<string, number>> {
    const data = await redis.get('domains');
    if (data) return JSON.parse(data);
    return {};
}

export async function saveDomains(redis: RedisClient, domains: Record<string, number>): Promise<void> {
    await redis.set('domains', JSON.stringify(domains));
}

export async function getPhrases(redis: RedisClient): Promise<Record<string, number>> {
    const data = await redis.get('phrases');
    if (data) return JSON.parse(data);
    return {};
}

export async function savePhrases(redis: RedisClient, phrases: Record<string, number>): Promise<void> {
    await redis.set('phrases', JSON.stringify(phrases));
}

export async function getAnalytics(redis: RedisClient): Promise<AnalyticsData> {
    const data = await redis.get('analytics');
    if (data) return JSON.parse(data);
    return {
        totalPosts: 0,
        removedPosts: 0,
        approvedPosts: 0,
        totalComments: 0,
        removedComments: 0,
        approvedComments: 0,
        highRiskCount: 0,
        mediumRiskCount: 0,
        lowRiskCount: 0
    };
}

export async function updateAnalytics(redis: RedisClient, updateFn: (data: AnalyticsData) => AnalyticsData): Promise<void> {
    let retries = 3;
    while (retries > 0) {
        try {
            const data = await getAnalytics(redis);
            const updated = updateFn(data);
            await redis.set('analytics', JSON.stringify(updated));
            return;
        } catch (e) {
            retries--;
            if (retries === 0) console.error("Failed to update analytics after 3 retries", e);
        }
    }
}

export async function getRecentPosts(redis: RedisClient): Promise<string[]> {
    const data = await redis.get('recent_posts');
    if (data) return JSON.parse(data);
    return [];
}

export async function saveRecentPosts(redis: RedisClient, postIds: string[]): Promise<void> {
    const limited = postIds.slice(0, 300);
    await redis.set('recent_posts', JSON.stringify(limited));
}

export async function getRecentComments(redis: RedisClient): Promise<string[]> {
    const data = await redis.get('recent_comments');
    if (data) return JSON.parse(data);
    return [];
}

export async function saveRecentComments(redis: RedisClient, commentIds: string[]): Promise<void> {
    const limited = commentIds.slice(0, 300);
    await redis.set('recent_comments', JSON.stringify(limited));
}

export async function getModelWeights(redis: RedisClient): Promise<ModelWeights> {
    const data = await redis.get('model_weights_v2');
    if (data) return JSON.parse(data);
    return {
        localWeights: {},
        globalWeights: {}
    };
}

export async function saveModelWeights(redis: RedisClient, weights: ModelWeights): Promise<void> {
    await redis.set('model_weights_v2', JSON.stringify(weights));
}
