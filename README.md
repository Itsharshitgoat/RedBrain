# RedBrain

A Devvit-based moderation assistant that scores, prioritizes, and explains risky posts and comments to reduce moderator workload.

## Overview

RedBrain operates completely within Reddit's infrastructure, using the Devvit platform to listen to events, perform logic, and provide a user interface directly in a subreddit.

When a user posts or comments, RedBrain analyzes the content using heuristics (keywords, domains, repeated patterns) and simulated NLP to assign a risk score. The result is stored securely. Moderators can then access the RedBrain dashboard to review content grouped by risk. Crucially, when a moderator "Approves" or "Removes" an item, the system learns from the decision by dynamically adjusting the internal risk weights of the keywords and domains present.

## Features

### 1. Automated Scoring
The engine evaluates new content based on several factors:
- **Keyword Matching:** Configurable weights for flagged terms.
- **Domain Matching:** Extracts and flags URLs.
- **Pattern Matching:** Detects excessive ALL CAPS or multiple emojis.
- **Simulated NLP:** Evaluates content against phrase clusters.
- **User Heuristics:** Penalizes very new accounts or accounts with low karma.

### 2. Adaptive Learning Loop & ML Pattern Extraction
The system actively learns in two ways:
- **Supervised Adjustment:** When a moderator removes a post, the weight of the known keywords and domains increases. When approved, weights decrease.
- **Unsupervised Pattern Discovery:** When a moderator removes a post or comment, the system's Machine Learning component parses the raw text content, removes stop-words, and extracts new tokens and bigrams (two-word phrases). These unseen patterns are seeded into the tracking logic with a very low initial weight. If the pattern appears in subsequent removed posts, its weight climbs until it reaches the threshold for auto-removal. Over time, this allows RedBrain to autonomously identify and act upon emerging toxic trends without human intervention.

### 3. Moderator Dashboard (UI)
The interactive Devvit UI organizes content into three risk tiers:
- 🔴 **High Risk** (Score 70+)
- 🟡 **Medium Risk** (Score 40-69)
- 🟢 **Low Risk** (Score < 40)

The UI explicitly details *why* a piece of content received its score, creating a fully explainable, trustworthy moderation tool. Note: Access to this panel is strictly restricted to subreddit moderators.

### 4. Settings Configuration
Via Devvit Mod Tools, moderators can customize the app:
- **Sensitivity (Low / Medium / High):** Adjusts the threshold for what is considered a "High Risk" score for automated removals.
- **Auto-remove high risk posts:** Automatically removes posts that exceed the risk threshold.
- **Auto-remove high risk comments:** Automatically removes comments that exceed the risk threshold.
- **Enable NLP-based scoring:** Toggles the simulated phrase classification engine.

## Architecture & Data Flow

```
Reddit Post / Comment
       ↓
[ Devvit Trigger (onPostCreate / onCommentCreate) ]
       ↓
[ Scoring Engine ]  <-- (Fetches rules from Storage)
       ↓
[ Devvit Redis Storage ]
       ↓
[ Mod UI Panel ]
       ↓
[ Mod Action (Approve / Remove) ]
       ↓
[ Learning System (Updates weights & Discovers new NLP patterns) ]
```

### Known Bugs/Limitations
- Due to Reddit API limitations, atomic updates via Redis multi/exec transactions can behave differently in Devvit. The analytic counters are currently updated serially without transactions, making them slightly susceptible to minor race conditions under extremely high load.
- Analytics numbers for risk bounds are hardcoded to the default limits (70/40) and will not accurately match the configurable UI sensitivity levels without further adjustments.
- Simulated NLP ignores tokenizing words with internal punctuation resulting in potentially combined tokens not seen in natural language contexts.
- Extracted bigrams do not account for natural sentence boundaries (e.g. bridging two separate sentences with a stopword removed).

### Folder Structure
- `src/index.tsx`: The main entry point containing Devvit configuration, custom settings, menu items, and triggers.
- `src/core/scorer.ts`: Contains the rule-based logic for assigning risk scores.
- `src/core/learner.ts`: Logic that dynamically adapts keyword and domain weights and performs ML phrase extraction based on mod decisions.
- `src/storage/kv.ts`: Handles data persistence using the Devvit Redis Client.
- `src/triggers/`: Contains the event listener definitions that catch new content.
- `src/ui/ModPanel.tsx`: The Devvit Blocks user interface components.

## Installation & Setup

1. Make sure you have the required dependencies:
   ```bash
   npm install
   ```

2. To build the TypeScript files:
   ```bash
   npm run build
   ```

3. Uploading to a subreddit (requires the `@devvit/cli`):
   ```bash
   devvit upload
   devvit install <subreddit_name>
   ```

After installation, the app works silently in the background. A moderator can initialize the Mod Panel by navigating to a subreddit, opening the moderation menu, and selecting **"Open RedBrain Panel"**.
