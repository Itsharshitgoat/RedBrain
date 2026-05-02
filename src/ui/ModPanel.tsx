import { Devvit, useAsync, useState, JSONValue } from "@devvit/public-api";
import { getAnalytics, getRecentPosts, getRecentComments, getPost, getComment, PostData, CommentData, savePost, saveComment, saveAnalytics, AnalyticsData } from "../storage/kv";
import { learnFromAction } from "../core/learner";

type Tab = "posts" | "comments" | "analytics" | "settings";

export const ModPanel: Devvit.CustomPostComponent = (context) => {
    const [activeTab, setActiveTab] = useState<Tab>("posts");
    const [actionCounter, setActionCounter] = useState<number>(0);

    const { data: isMod, loading: isModLoading } = useAsync(async () => {
        if (!context.userId) return false;
        const currentSubreddit = await context.reddit.getCurrentSubreddit();
        const modId = await context.reddit.getModerators({
            subredditName: currentSubreddit.name,
        }).all();
        return modId.some(mod => mod.id === context.userId);
    }, { depends: [] });


    const { data: analytics, loading: analyticsLoading } = useAsync(async () => {
        const data = await getAnalytics(context.redis);
        return data as unknown as JSONValue;
    }, { depends: [activeTab, actionCounter] });

    const { data: recentPostsData, loading: postsLoading } = useAsync(async () => {
        const postIds = await getRecentPosts(context.redis);
        const posts: PostData[] = [];
        for (const id of postIds) {
            const p = await getPost(context.redis, id);
            if (p && p.status === "pending") {
                posts.push(p);
            }
        }
        return posts.sort((a: PostData, b: PostData) => b.score - a.score) as unknown as JSONValue;
    }, { depends: [activeTab, actionCounter] });

    const { data: recentCommentsData, loading: commentsLoading } = useAsync(async () => {
        const commentIds = await getRecentComments(context.redis);
        const comments: CommentData[] = [];
        for (const id of commentIds) {
            const c = await getComment(context.redis, id);
            if (c && c.status === "pending") {
                comments.push(c);
            }
        }
        return comments.sort((a: CommentData, b: CommentData) => b.score - a.score) as unknown as JSONValue;
    }, { depends: [activeTab, actionCounter] });


    const handleAction = async (item: PostData | CommentData, type: "post" | "comment", action: "approve" | "remove") => {
        try {
            if (action === "remove") {
                if (type === "post") {
                    await context.reddit.remove(item.id, false);
                } else {
                    await context.reddit.remove(item.id, false);
                }
            } else {
                if (type === "post") {
                    await context.reddit.approve(item.id);
                } else {
                    await context.reddit.approve(item.id);
                }
            }

            item.status = action === "remove" ? "removed" : "approved";
            if (type === "post") {
                await savePost(context.redis, item as PostData);
            } else {
                await saveComment(context.redis, item as CommentData);
            }

            await learnFromAction(item.reasons, action, context.redis);

            const currentAnalytics = await getAnalytics(context.redis);
            if (action === "remove") {
                if (type === "post") currentAnalytics.removedPosts++;
                else currentAnalytics.removedComments++;
            } else {
                if (type === "post") currentAnalytics.approvedPosts++;
                else currentAnalytics.approvedComments++;
            }
            await saveAnalytics(context.redis, currentAnalytics);

            context.ui.showToast(`Successfully ${action}d!`);
            setActionCounter(prev => prev + 1);
        } catch (e) {
            console.error("Action failed", e);
            context.ui.showToast(`Failed to ${action} item.`);
        }
    };


    const renderReasons = (reasons: { type: string, value: string, weight: number }[]) => {
        if (!reasons || reasons.length === 0) return "None";
        return reasons.map(r => `${r.type}: ${r.value} (+${r.weight})`).join(", ");
    };

    const renderItem = (item: PostData | CommentData, type: "post" | "comment") => {
        let riskLabel = "Low Risk";
        let riskColor = "neutral-background";
        if (item.score >= 70) {
            riskLabel = "High Risk";
            riskColor = "red-background";
        } else if (item.score >= 40) {
            riskLabel = "Medium Risk";
            riskColor = "yellow-background";
        }

        return (
            <vstack gap="small" padding="medium" backgroundColor={riskColor} cornerRadius="medium">
                <text size="large" weight="bold">{type === "post" ? (item as PostData).title : "Comment"}</text>
                <text size="small" color="neutral-content-weak">Score: {item.score} ({riskLabel})</text>
                <text size="small" color="neutral-content-weak">Reasons: {renderReasons(item.reasons)}</text>
                <text size="medium" wrap>{item.content.substring(0, 200)}{item.content.length > 200 ? '...' : ''}</text>
                <hstack gap="small" alignment="end middle">
                    <button appearance="success" onPress={() => handleAction(item, type, "approve")}>Approve</button>
                    <button appearance="destructive" onPress={() => handleAction(item, type, "remove")}>Remove</button>
                </hstack>
            </vstack>
        );
    };

    const renderPostsTab = () => {
        if (postsLoading) return <text>Loading posts...</text>;
        const posts = recentPostsData as unknown as PostData[];
        if (!posts || posts.length === 0) return <text>No pending posts to review.</text>;

        const high = posts.filter((p: PostData) => p.score >= 70);
        const medium = posts.filter((p: PostData) => p.score >= 40 && p.score < 70);
        const low = posts.filter((p: PostData) => p.score < 40);

        return (
            <vstack gap="medium">
                {high.length > 0 && <text size="large" weight="bold">🔴 High Risk</text>}
                {high.map((p: PostData) => renderItem(p, "post"))}

                {medium.length > 0 && <text size="large" weight="bold">🟡 Medium Risk</text>}
                {medium.map((p: PostData) => renderItem(p, "post"))}

                {low.length > 0 && <text size="large" weight="bold">🟢 Low Risk</text>}
                {low.map((p: PostData) => renderItem(p, "post"))}
            </vstack>
        );
    };

    const renderCommentsTab = () => {
        if (commentsLoading) return <text>Loading comments...</text>;
        const comments = recentCommentsData as unknown as CommentData[];
        if (!comments || comments.length === 0) return <text>No pending comments to review.</text>;

        const high = comments.filter((c: CommentData) => c.score >= 70);
        const medium = comments.filter((c: CommentData) => c.score >= 40 && c.score < 70);
        const low = comments.filter((c: CommentData) => c.score < 40);

        return (
            <vstack gap="medium">
                {high.length > 0 && <text size="large" weight="bold">🔴 High Risk</text>}
                {high.map((c: CommentData) => renderItem(c, "comment"))}

                {medium.length > 0 && <text size="large" weight="bold">🟡 Medium Risk</text>}
                {medium.map((c: CommentData) => renderItem(c, "comment"))}

                {low.length > 0 && <text size="large" weight="bold">🟢 Low Risk</text>}
                {low.map((c: CommentData) => renderItem(c, "comment"))}
            </vstack>
        );
    };

    const renderAnalyticsTab = () => {
        if (analyticsLoading || !analytics) return <text>Loading analytics...</text>;

        const typedAnalytics = analytics as unknown as AnalyticsData;
        const totalProcessed = typedAnalytics.totalPosts + typedAnalytics.totalComments;

        return (
            <vstack gap="medium" padding="medium">
                <text size="large" weight="bold">Analytics</text>
                <text>Total Processed (Posts/Comments): {totalProcessed}</text>
                <text>Removed Posts: {typedAnalytics.removedPosts}</text>
                <text>Approved Posts: {typedAnalytics.approvedPosts}</text>
                <text>Removed Comments: {typedAnalytics.removedComments}</text>
                <text>Approved Comments: {typedAnalytics.approvedComments}</text>

                <text size="large" weight="bold">Risk Breakdown</text>
                <text>High: {typedAnalytics.highRiskCount}</text>
                <text>Medium: {typedAnalytics.mediumRiskCount}</text>
                <text>Low: {typedAnalytics.lowRiskCount}</text>
            </vstack>
        );
    };

    if (isModLoading) {
        return (
            <vstack width="100%" height="100%" alignment="center middle">
                <text>Loading Auth...</text>
            </vstack>
        );
    }

    if (!isMod) {
        return (
            <vstack width="100%" height="100%" alignment="center middle" padding="medium">
                <text size="large" weight="bold" color="red">Access Denied</text>
                <text>This panel is only visible to subreddit moderators.</text>
            </vstack>
        );
    }

    return (
        <vstack width="100%" height="100%" padding="medium">
            <text size="large" weight="bold" alignment="center">AutoMod Brain</text>

            <hstack gap="small" alignment="center middle">
                <button appearance={activeTab === "posts" ? "primary" : "secondary"} onPress={() => setActiveTab("posts")}>Posts</button>
                <button appearance={activeTab === "comments" ? "primary" : "secondary"} onPress={() => setActiveTab("comments")}>Comments</button>
                <button appearance={activeTab === "analytics" ? "primary" : "secondary"} onPress={() => setActiveTab("analytics")}>Analytics</button>
            </hstack>

            <vstack grow>
                {activeTab === "posts" && renderPostsTab()}
                {activeTab === "comments" && renderCommentsTab()}
                {activeTab === "analytics" && renderAnalyticsTab()}
            </vstack>
        </vstack>
    );
};
