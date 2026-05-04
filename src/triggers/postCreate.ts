import { Devvit, TriggerContext } from "@devvit/public-api";
import { calculateScore } from "../core/scorer";
import { PostData, savePost, getRecentPosts, saveRecentPosts, updateAnalytics, getThresholds } from "../storage/kv";

export const onPostCreate = {
    event: "PostCreate" as const,
    onEvent: async (event: any, context: TriggerContext) => {
        const post = event.post;
        if (!post) return;

        const redis = context.redis;

        const autoRemoveHighRiskPosts = await context.settings.get("autoRemoveHighRiskPosts") as boolean || false;
        const enableAdvancedScoring = await context.settings.get("enableAdvancedScoring") as boolean || false;
        const sensitivityRaw = await context.settings.get("sensitivity") as string || "Medium";

        const thresholds = getThresholds(sensitivityRaw);

        let authorAgeDays = 30;
        let authorKarma = 100;
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
            confidence: scoreData.confidence,
            reasons: scoreData.reasons,
            status: "pending",
            timestamp: Date.now()
        };

        if (autoRemoveHighRiskPosts && scoreData.score >= thresholds.high && scoreData.confidence > 0.85) {
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

        // Update analytics with optimistic retry
        await updateAnalytics(redis, (analytics) => {
            analytics.totalPosts++;
            if (scoreData.score >= thresholds.high) {
                analytics.highRiskCount++;
            } else if (scoreData.score >= thresholds.medium) {
                analytics.mediumRiskCount++;
            } else {
                analytics.lowRiskCount++;
            }
            if (postData.status === "removed") {
                analytics.removedPosts++;
            }
            return analytics;
        });
    }
};
