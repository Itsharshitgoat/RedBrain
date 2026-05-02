import { Devvit, TriggerContext } from "@devvit/public-api";
import { calculateScore } from "../core/scorer";
import { PostData, savePost, getRecentPosts, saveRecentPosts, getAnalytics, saveAnalytics } from "../storage/kv";

export const onPostCreate = {
    event: "PostCreate" as const,
    onEvent: async (event: any, context: TriggerContext) => {
        const post = event.post;
        if (!post) return;

        const redis = context.redis;

        const autoRemoveHighRiskPosts = await context.settings.get("autoRemoveHighRiskPosts") as boolean || false;
        const enableAdvancedScoring = await context.settings.get("enableAdvancedScoring") as boolean || false;
        const sensitivityRaw = await context.settings.get("sensitivity") as string || "Medium";

        // Adjust threshold based on sensitivity
        let threshold = 70;
        if (sensitivityRaw === "High") threshold = 50;
        if (sensitivityRaw === "Low") threshold = 85;

        let authorAgeDays = 30; // Default safe value
        let authorKarma = 100; // Default safe value
        try {
            const author = await context.reddit.getUserById(post.authorId);
            if (author) {
                const createdAt = author.createdAt.getTime();
                authorAgeDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
                authorKarma = author.linkKarma + author.commentKarma;
            }
        } catch (e) {
            console.error("Failed to fetch author info", e);
        }

        const scoreData = await calculateScore(
            post.title + " " + (post.body || ""),
            authorAgeDays,
            authorKarma,
            redis,
            enableAdvancedScoring
        );

        const postData: PostData = {
            id: post.id,
            title: post.title,
            content: post.body || "",
            author: post.authorId,
            score: scoreData.score,
            reasons: scoreData.reasons,
            status: "pending",
            timestamp: Date.now()
        };

        if (autoRemoveHighRiskPosts && scoreData.score >= threshold) {
            try {
                await context.reddit.remove(post.id, false);
                postData.status = "removed";
            } catch (e) {
                console.error("Failed to auto-remove post", e);
            }
        }

        await savePost(redis, postData);

        const recent = await getRecentPosts(redis);
        recent.unshift(post.id);
        await saveRecentPosts(redis, recent);

        // Simple update for analytics to avoid transaction issues
        const analytics = await getAnalytics(redis);
        analytics.totalPosts++;
        if (scoreData.score >= 70) {
            analytics.highRiskCount++;
        } else if (scoreData.score >= 40) {
            analytics.mediumRiskCount++;
        } else {
            analytics.lowRiskCount++;
        }
        if (postData.status === "removed") {
            analytics.removedPosts++;
        }
        await saveAnalytics(redis, analytics);
    }
};
