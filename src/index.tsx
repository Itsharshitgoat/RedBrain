import { Devvit } from "@devvit/public-api";
import { onPostCreate } from "./triggers/postCreate";
import { onCommentCreate } from "./triggers/commentCreate";
import { ModPanel } from "./ui/ModPanel";

// Add global triggers
Devvit.addTrigger(onPostCreate);
Devvit.addTrigger(onCommentCreate);

// Settings configuration
Devvit.addSettings([
    {
        type: "select",
        name: "sensitivity",
        label: "Sensitivity (Low / Medium / High)",
        options: [
            { label: "Low", value: "Low" },
            { label: "Medium", value: "Medium" },
            { label: "High", value: "High" }
        ],
        defaultValue: ["Medium"]
    },
    {
        type: "boolean",
        name: "autoRemoveHighRiskPosts",
        label: "Auto-remove high risk posts",
        defaultValue: false
    },
    {
        type: "boolean",
        name: "autoRemoveHighRiskComments",
        label: "Auto-remove high risk comments",
        defaultValue: false
    },
    {
        type: "boolean",
        name: "enableAdvancedScoring",
        label: "Enable NLP-based scoring",
        defaultValue: false
    }
]);

// Menu item to open the Mod Panel by creating a post
Devvit.addMenuItem({
    label: "Open Sky For Redbrain Panel",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (event, context) => {
        try {
            const subreddit = await context.reddit.getCurrentSubreddit();
            const post = await context.reddit.submitPost({
                title: "Sky For Redbrain - Dashboard",
                subredditName: subreddit.name,
                preview: (
                    <vstack width="100%" height="100%" alignment="center middle">
                        <text size="large" weight="bold">Loading Sky For Redbrain...</text>
                    </vstack>
                )
            });
            context.ui.navigateTo(post);
        } catch (e) {
            console.error("Failed to open mod panel", e);
            context.ui.showToast("Failed to open Sky For Redbrain");
        }
    }
});

// Custom post type
Devvit.addCustomPostType({
    name: "Sky For RedbrainPanel",
    render: ModPanel,
    height: "tall"
});

export default Devvit;
