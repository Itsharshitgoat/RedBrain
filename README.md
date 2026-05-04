# RedBrain

A Devvit-based moderation assistant that scores, prioritizes, and explains risky posts and comments to reduce moderator workload.

## Overview

RedBrain operates completely within Reddit's infrastructure, using the Devvit platform to listen to events, perform logic, and provide a user interface directly in a subreddit.

When a user posts or comments, RedBrain analyzes the content using heuristics (keywords, domains, repeated patterns) and a machine learning (ML) text classification engine to assign a risk score. The result is stored securely using Devvit's Redis client. Moderators can then access the RedBrain dashboard to review content grouped by risk. Crucially, when a moderator "Approves" or "Removes" an item, the system learns from the decision by dynamically adjusting the internal risk weights of the keywords, domains, and the ML model parameters via gradient descent.

---

## Complete Architecture & Execution Flow

```text
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

### 1. Triggers and Entry Points (`src/triggers/`)
RedBrain hooks into Reddit events using `Devvit.addTrigger`. Specifically, it listens to `onPostCreate` and `onCommentCreate`. Whenever content is submitted:
1. It fetches the author's age and karma.
2. It fetches the subreddit's specific RedBrain settings (Sensitivity, Auto-remove toggles, and ML scoring toggles).
3. It passes this data to the Scorer.
4. If the final score exceeds the user-configured Sensitivity threshold (e.g., 70 for Medium, 50 for High), RedBrain uses the Reddit API to automatically remove the post.
5. It saves the item data and updates global analytics counters in Redis.

### 2. Hybrid Scoring Engine (`src/core/scorer.ts`)
To keep latency low, the engine evaluates new content using parallel execution (`Promise.all`) of two distinct layers. The final score is a hybrid merge (ML: 70%, Rule Engine: 30%).

#### Layer A: Rule Engine
- **Keyword Matching:** Configurable weights for flagged terms.
- **Domain Matching:** Extracts URLs using regex and flags known spam domains.
- **Pattern Matching:** Detects excessive ALL CAPS (if >70% of text) or multiple emojis (≥3).
- **User Heuristics:** Penalizes very new accounts (< 7 days) or accounts with low karma (< 10).
- **Semantic Matching:** Evaluates content against hardcoded intent clusters (e.g., "promo", "scam") defined in `src/core/nlp.ts`.

#### Layer B: ML Engine (Logistic Regression)
- Implemented in `src/core/ml.ts`.
- **Text Preprocessing:** Handled by `src/core/nlp.ts`. The text is lowercased, URLs and special characters are stripped, and common stop words ("the", "and", "is", etc.) are removed to reduce noise.
- **Feature Extraction:** It converts the remaining tokens and bigrams (two-word phrases) into a numerical feature vector, merging it with user heuristics.
- **Calculation:** It fetches learned weights from Redis. It calculates `z` (the sum of feature weights multiplied by their occurrence). The weights are a blend of Local (Subreddit-specific, 70% weight) and Global (Cross-subreddit, 30% weight) knowledge. Finally, it passes `z` through a sigmoid function `1 / (1 + Math.exp(-z))` to generate a 0-100 probability score.

### 3. Adaptive Learning Loop (`src/core/learner.ts`)
The system actively learns in two ways when a moderator interacts with the UI:
- **Rule Adjustment:** When a moderator removes a post, the explicit weight of the known keywords and domains increases. When approved, weights decrease.
- **Online ML Learning (Gradient Descent):**
  1. The system compares the model's prediction against the human reality (Removed = Target 1, Approved = Target 0).
  2. It calculates the error: `error = prediction - target`.
  3. It runs a simplified gradient descent algorithm to update the feature weights: `weight = weight - (LEARNING_RATE * error * feature_value)`.
  4. Both Local and Global weights are updated and saved back to Redis.

### 4. Unsupervised Pattern Discovery
When a moderator removes a post or comment, the system's Machine Learning component parses the raw text content, removes stop-words, and extracts new tokens and bigrams. These previously unseen patterns are seeded into the tracking logic with a very low initial weight. If the pattern appears in subsequent removed posts, its weight climbs until it reaches the threshold for auto-removal.

### 5. Moderator Dashboard UI (`src/ui/ModPanel.tsx`)
The interactive Devvit UI uses Devvit Blocks to organize content into three risk tiers:
- 🔴 **High Risk** (Score 70+)
- 🟡 **Medium Risk** (Score 40-69)
- 🟢 **Low Risk** (Score < 40)

The UI features:
- **Security Check:** A hook verifies that the viewing user is in the `getModerators` list. Non-mods receive an "Access Denied" screen.
- **Explainability:** The UI explicitly details *why* a piece of content received its score, detailing the top ML contributing features and matched rule features.
- **Instant Actions:** Buttons allow instantaneous "Approve" or "Remove" actions which trigger the Reddit API and immediately feed back into the learning loop.

### 6. Settings Configuration
Via Devvit Mod Tools, moderators can customize the app:
- **Sensitivity (Low / Medium / High):** Adjusts the threshold for what is considered a "High Risk" score for automated removals (Low = 85, Medium = 70, High = 50).
- **Auto-remove high risk posts:** Automatically removes posts that exceed the risk threshold.
- **Auto-remove high risk comments:** Automatically removes comments that exceed the risk threshold.
- **Enable NLP-based scoring:** Toggles the ML logistic regression model and semantic checks.

---

## Known Bugs/Limitations
- Due to Reddit API limitations, atomic updates via Redis multi/exec transactions can behave differently in Devvit. The analytic counters are currently updated serially without transactions, making them slightly susceptible to minor race conditions under extremely high load.
- Analytics numbers for risk bounds are hardcoded to the default limits (70/40) in the dashboard display and will not dynamically update if the sensitivity threshold is changed.
- The ML engine currently stores unstructured bigrams and tokens endlessly inside the Redis instances; without a pruning mechanism for low-usage tokens, KV limits may eventually be breached in high-volume subreddits over years of operation.
- Unsupervised phrase extraction ignores tokenizing words with internal punctuation resulting in potentially combined tokens not seen in natural language contexts.

---

## Full Usage & Installation Guide

To deploy RedBrain to a subreddit, follow these steps using the terminal.

### Prerequisites
1. Ensure you have **Node.js** (v18+) and **npm** installed.
2. Install the Devvit CLI globally:
   ```bash
   npm install -g @devvit/cli
   ```

### 1. Build the Application
Navigate to the root directory of the RedBrain source code and install the dependencies:
```bash
npm install
```
Compile the TypeScript code:
```bash
npm run build
```

### 2. Authenticate
Log in to your Reddit account via the CLI. This requires an account that has moderation privileges in the target subreddit.
```bash
devvit login
```

### 3. Upload to Devvit
Upload your local build to Reddit's Devvit platform. This creates the app in the ecosystem under your account.
```bash
devvit upload
```

### 4. Install to a Subreddit
Install the application to a subreddit where you are a moderator (e.g., `r/your_test_subreddit`).
```bash
devvit install your_test_subreddit
```

### 5. Configuration & Usage
Once installed, RedBrain is active. To configure it and use the dashboard:

1. **Open Reddit:** Go to your subreddit on desktop or mobile.
2. **Configure Settings:** Navigate to **Mod Tools -> Apps -> RedBrain**. Here you can adjust the "Sensitivity", enable "Auto-remove", and toggle the "NLP-based scoring" feature.
3. **Open the Dashboard:** As a moderator, click the "Create Post" button or view the subreddit overflow menu to find the action **"Open RedBrain Panel"**.
4. **Take Action:** Clicking the menu item will generate a private, custom interface post visible only to you. You can click between the Posts, Comments, and Analytics tabs to review content and click "Approve" or "Remove" to train the AI.
