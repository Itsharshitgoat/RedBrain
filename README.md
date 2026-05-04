# RedBrain

A Devvit-based moderation assistant that scores, prioritizes, and explains risky posts and comments to reduce moderator workload.

## Overview

RedBrain operates completely within Reddit's infrastructure, using the Devvit platform to listen to events, perform logic, and provide a user interface directly in a subreddit.

When a user posts or comments, RedBrain analyzes the content using heuristics (keywords, domains, repeated patterns) and a machine learning (ML) text classification engine to assign a risk score. The result is stored securely. Moderators can then access the RedBrain dashboard to review content grouped by risk. Crucially, when a moderator "Approves" or "Removes" an item, the system learns from the decision by dynamically adjusting the internal risk weights of the keywords, domains, and the ML model parameters.

## Features

### 1. Hybrid Scoring Engine
The engine evaluates new content using parallel execution of two distinct layers:
- **Rule Engine:**
  - *Keyword Matching:* Configurable weights for flagged terms.
  - *Domain Matching:* Extracts and flags URLs.
  - *Pattern Matching:* Detects excessive ALL CAPS or multiple emojis.
  - *User Heuristics:* Penalizes very new accounts or accounts with low karma.
  - *Semantic Matching:* Evaluates content against hardcoded intent clusters.
- **ML Engine (Logistic Regression):**
  - Tokenizes input, strips stop words, extracts bigrams, and calculates a predicted toxicity score utilizing dynamic weights derived from live feedback.

The final score is a merge of these two outputs (ML: 70%, Rule Engine: 30%).

### 2. Adaptive Learning Loop & ML Pattern Extraction
The system actively learns in two ways:
- **Rule Adjustment:** When a moderator removes a post, the weight of the known keywords and domains increases. When approved, weights decrease.
- **Online ML Learning (Gradient Descent):** When a mod takes action, the system compares the model's prediction against the human reality (Removed = 1, Approved = 0). It calculates the error and runs a simplified gradient descent algorithm to update the feature weights. The model incorporates both local (subreddit-specific) and global weights to generalize spam patterns efficiently.

### 3. Moderator Dashboard (UI)
The interactive Devvit UI organizes content into three risk tiers:
- 🔴 **High Risk** (Score 70+)
- 🟡 **Medium Risk** (Score 40-69)
- 🟢 **Low Risk** (Score < 40)

The UI explicitly details *why* a piece of content received its score, detailing the top ML contributing features and matched rule features. Note: Access to this panel is strictly restricted to subreddit moderators.

### 4. Settings Configuration
Via Devvit Mod Tools, moderators can customize the app:
- **Sensitivity (Low / Medium / High):** Adjusts the threshold for what is considered a "High Risk" score for automated removals.
- **Auto-remove high risk posts:** Automatically removes posts that exceed the risk threshold.
- **Auto-remove high risk comments:** Automatically removes comments that exceed the risk threshold.
- **Enable NLP-based scoring:** Toggles the ML logistic regression model and semantic checks.

## Architecture & Data Flow

```
Reddit Post / Comment
       ↓
[ Text Preprocessing (Stopwords, Bigrams) ]
       ↓
[ Parallel Execution ]
  ├── [ Rule Engine ]
  └── [ ML Model (Logistic Regression) ]
       ↓
[ Rule Engine Merge ] -> Final Score + Explanations
       ↓
[ Devvit Redis Storage ]
       ↓
[ Mod UI Panel ]
       ↓
[ Mod Action (Approve / Remove) ]
       ↓
[ Online Learning Update (Gradient Descent & Rule Weights) ]
```

### Known Bugs/Limitations
- Due to Reddit API limitations, atomic updates via Redis multi/exec transactions can behave differently in Devvit. The analytic counters are currently updated serially without transactions, making them slightly susceptible to minor race conditions under extremely high load.
- Analytics numbers for risk bounds are hardcoded to the default limits (70/40) and will not accurately match the configurable UI sensitivity levels without further adjustments.
- The ML engine currently stores unstructured bigrams and tokens endlessly inside the Redis instances; without a pruning mechanism for low-usage tokens, KV limits may eventually be breached in high-volume subreddits.
- Unsupervised phrase extraction ignores tokenizing words with internal punctuation resulting in potentially combined tokens not seen in natural language contexts.

### Folder Structure
- `src/index.tsx`: The main entry point containing Devvit configuration, custom settings, menu items, and triggers.
- `src/core/scorer.ts`: The parallel execution pipeline and rule-based logic.
- `src/core/nlp.ts`: Text preprocessing (stop word removal, tokenization, semantic clustering).
- `src/core/ml.ts`: Logistic regression model logic.
- `src/core/learner.ts`: Logic that dynamically adapts keyword and domain weights and performs the gradient descent updates for the ML model.
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
