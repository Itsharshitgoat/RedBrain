import { Devvit, TriggerContext } from "@devvit/public-api";
import { calculateScore } from "../core/scorer";
import { CommentData, saveComment, getRecentComments, saveRecentComments, getAnalytics, saveAnalytics } from "../storage/kv";

export const onCommentCreate = {
    event: "CommentCreate" as const,
    onEvent: async (event: any, context: TriggerContext) => {
        const comment = event.comment;
        if (!comment) return;

        const redis = context.redis;
        const autoRemoveHighRiskComments = await context.settings.get("autoRemoveHighRiskComments") as boolean || false;
        const enableAdvancedScoring = await context.settings.get("enableAdvancedScoring") as boolean || false;
        const sensitivityRaw = await context.settings.get("sensitivity") as string || "Medium";

        let threshold = 70;
        if (sensitivityRaw === "High") threshold = 50;
        if (sensitivityRaw === "Low") threshold = 85;


        let authorAgeDays = 30;
        let authorKarma = 100;
        try {
            const author = await context.reddit.getUserById(comment.authorId);
            if (author) {
                const createdAt = author.createdAt.getTime();
                authorAgeDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
                authorKarma = author.linkKarma + author.commentKarma;
            }
        } catch (e) {
            console.error("Failed to fetch author info", e);
        }

        const scoreData = await calculateScore(
            comment.body,
            authorAgeDays,
            authorKarma,
            redis,
            enableAdvancedScoring
        );

        const commentData: CommentData = {
            id: comment.id,
            postId: comment.postId,
            content: comment.body,
            author: comment.authorId,
            score: scoreData.score,
            reasons: scoreData.reasons,
            status: "pending",
            timestamp: Date.now()
        };

        if (autoRemoveHighRiskComments && scoreData.score >= threshold) {
            try {
                await context.reddit.remove(comment.id, false);
                commentData.status = "removed";
            } catch (e) {
                console.error("Failed to auto-remove comment", e);
            }
        }

        await saveComment(redis, commentData);

        const recent = await getRecentComments(redis);
        recent.unshift(comment.id);
        await saveRecentComments(redis, recent);

        const analytics = await getAnalytics(redis);
        analytics.totalComments++;
        if (commentData.status === "removed") {
            analytics.removedComments++;
        }
        await saveAnalytics(redis, analytics);
    }
};
