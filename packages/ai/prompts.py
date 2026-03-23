"""
Prompt templates for the Stride AI-powered goal execution app.

Every function accepts Python inputs and returns a fully-formed prompt string
ready to be sent to Gemini.  Each prompt embeds explicit output-format
instructions and inline examples so the model knows exactly what to produce.
"""


# ── 1. Domain Classification ────────────────────────────────────────────────


def domain_classify_prompt(goal_text: str) -> str:
    """Classify a user's goal into one of the supported learning domains.

    Returns a prompt that instructs Gemini to output a JSON object with keys
    ``domain``, ``confidence``, and ``reasoning``.
    """
    return f"""You are a goal-classification expert for an AI learning platform.

Classify the following goal into EXACTLY ONE of these domains:

  competitive_programming | swe_career | academic_exam |
  web_development | data_science | design | language_learning |
  fitness | entrepreneurship | other

── DOMAIN EXAMPLES ──────────────────────────────────────────

competitive_programming:
  1. "Become Expert in Competitive Programming and crack ICPC regionals"
  2. "Solve 500 LeetCode problems in 6 months"
  3. "Master dynamic programming and graph algorithms for Codeforces"
  4. "Prepare for Google Code Jam"
  5. "Get 5-star rating on CodeChef"

swe_career:
  1. "Get a software engineering job at a FAANG company"
  2. "Prepare for system design interviews"
  3. "Transition from QA to backend developer role"
  4. "Learn DevOps and get AWS certified"
  5. "Build a strong GitHub portfolio for job applications"

academic_exam:
  1. "Score 95+ in GATE Computer Science exam"
  2. "Clear UPSC Civil Services preliminary exam"
  3. "Prepare for JEE Advanced Physics and Maths"
  4. "Pass the AWS Solutions Architect certification exam"
  5. "Score 320+ on GRE"

web_development:
  1. "Build a full-stack e-commerce app using React and Node.js"
  2. "Learn Next.js and deploy a SaaS product"
  3. "Master TypeScript and GraphQL for production apps"
  4. "Create a personal portfolio website with animations"
  5. "Learn Django and build a REST API from scratch"

data_science:
  1. "Learn machine learning and build 5 end-to-end projects"
  2. "Master Python pandas and data visualization for analytics"
  3. "Complete a Kaggle competition with a top-10% finish"
  4. "Learn NLP and build a sentiment analysis pipeline"
  5. "Transition into a data analyst role using SQL and Tableau"

design:
  1. "Learn UI/UX design and land a junior designer role"
  2. "Master Figma and create a design system from scratch"
  3. "Build a UX case study portfolio with 4 projects"
  4. "Learn motion design with After Effects"
  5. "Redesign 3 popular apps to improve usability"

language_learning:
  1. "Reach B2 level in German in 6 months"
  2. "Pass JLPT N3 Japanese proficiency test"
  3. "Become conversationally fluent in Spanish"
  4. "Learn French for a move to Paris next year"
  5. "Improve English writing for academic papers"

fitness:
  1. "Run a sub-4-hour marathon in 6 months"
  2. "Lose 15 kg with a structured workout and diet plan"
  3. "Build muscle mass with a 12-week hypertrophy program"
  4. "Complete an Ironman triathlon"
  5. "Improve flexibility and do a full split in 3 months"

entrepreneurship:
  1. "Launch a micro-SaaS product and get 100 paying users"
  2. "Validate and launch my mobile app idea"
  3. "Build and monetize a newsletter to 5k subscribers"
  4. "Start a dropshipping business and hit $10k/month"
  5. "Create and sell an online course on Udemy"

other:
  1. "Learn to play guitar and perform at an open mic"
  2. "Write and self-publish a fiction novel"
  3. "Learn chess and reach 1500 Elo rating"
  4. "Master personal finance and start investing"
  5. "Organize and declutter my entire house using KonMari"

── INSTRUCTIONS ─────────────────────────────────────────────

Analyze the goal below and return a JSON object with:
- "domain" — exactly one of the domain identifiers listed above
- "confidence" — a float between 0.0 and 1.0
- "reasoning" — a single sentence explaining the classification

Output format (no additional text):
{{"domain": "competitive_programming", "confidence": 0.92, "reasoning": "The goal focuses on solving algorithmic problems for contests."}}

── USER GOAL ────────────────────────────────────────────────

"{goal_text}"
"""


# ── 2. Q6 — Domain-Expert Follow-Up Question ────────────────────────────────


def q6_prompt(domain: str, goal_text: str, prior_answers: dict) -> str:
    """Generate one deep, domain-specific follow-up question.

    Returns a prompt asking Gemini for a single expert-level clarification
    question that generic goal-tracking apps would never think to ask.
    """
    prior_str = "\n".join(
        f"  - {k}: {v}" for k, v in prior_answers.items()
    ) if prior_answers else "  (none yet)"

    return f"""You are a world-class {domain} mentor creating a hyper-personalised
learning roadmap.  The user already answered some basic questions.

Your job: generate ONE follow-up question that only a true domain expert would
ask — a question that generic productivity apps never think to include.

── EXAMPLE Q6 PER DOMAIN ────────────────────────────────────

competitive_programming:
  "Which algorithmic paradigm do you struggle with most — greedy, divide-and-conquer, or DP?  Knowing this lets me front-load weak areas."

swe_career:
  "Are you targeting L3/L4 new-grad or L5+ senior roles?  The interview bar and prep strategy differ significantly."

academic_exam:
  "Which previous-year paper sections do you consistently lose marks in?  I'll weight those topics higher."

web_development:
  "Is your goal to ship a production product or build portfolio projects?  The tech depth changes drastically."

data_science:
  "Do you need to present findings to non-technical stakeholders?  If yes, storytelling and viz skills become a core track."

design:
  "Are you designing for mobile-first or desktop-first workflows?  Constraint patterns differ and affect the curriculum."

language_learning:
  "Will you have daily immersion access (native speakers, media)?  This determines whether we optimise for input-heavy or output-heavy practice."

fitness:
  "Do you have any current injuries or mobility limitations?  This changes exercise selection and progression."

entrepreneurship:
  "Do you plan to bootstrap or raise funding?  The early milestones and skills required are very different."

other:
  "What does 'success' look like for you in measurable terms?  A clear target lets me design checkpoints."

── CONTEXT ──────────────────────────────────────────────────

Domain: {domain}
Goal: "{goal_text}"
Prior answers:
{prior_str}

── INSTRUCTIONS ─────────────────────────────────────────────

Return a JSON object with:
- "question" — the follow-up question text (1–2 sentences)
- "field_name" — a camelCase identifier for the answer field

Output format (no extra text):
{{"question": "Which algorithmic paradigm trips you up most?", "field_name": "weakParadigm"}}
"""


# ── 3. Roadmap Generation ───────────────────────────────────────────────────


def roadmap_generation_prompt(profile: dict) -> str:
    """Build a complete, prerequisite-ordered learning roadmap.

    The returned prompt instructs Gemini to wrap its JSON output inside
    ``<roadmap>…</roadmap>`` XML tags.
    """
    goal_title = profile.get("goal_title", "")
    domain = profile.get("domain", "")
    timeline_days = profile.get("timeline_days", 30)
    daily_hours = profile.get("daily_hours", 2)
    prior_knowledge = profile.get("prior_knowledge", "beginner")
    budget = profile.get("budget", "free")
    external_materials = profile.get("external_materials", "")
    domain_specific_answer = profile.get("domain_specific_answer", "")
    max_topic_minutes = int(daily_hours * 60 * 1.2)
    desired_phase_count = min(6, max(3, timeline_days // 10))

    return f"""You are an elite curriculum designer building a concise, focused learning roadmap for Stride.

── LEARNER PROFILE ──────────────────────────────────────────

Goal: "{goal_title}"
Domain: {domain}
Timeline: {timeline_days} days
Daily study time: {daily_hours} hours
Prior knowledge: {prior_knowledge}
Budget: {budget}
External materials / syllabus: {external_materials if external_materials else "none provided"}
Domain-specific context: {domain_specific_answer if domain_specific_answer else "none"}

── HARD RULES ───────────────────────────────────────────────

1. PREREQUISITE ORDERING IS MANDATORY.
   Never schedule an advanced topic before its foundational prerequisites.
   The roadmap should feel like a serious mentor designed it, not a generic syllabus dump.

2. NO topic may exceed {max_topic_minutes} minutes (daily_hours × 60 × 1.2).
   If a topic is bigger, split it into sub-topics.

3. BE CONCISE. Do NOT include redundant, obvious, or padded topics.
   Every topic must be genuinely essential for achieving the goal.
   Prefer depth over breadth. Cut topics a learner could skip.
   Do not waste days on vague filler like "revision", "practice more", or "overview"
   unless it is tied to a concrete deliverable or assessment.

4. MAKE THE ROADMAP EFFECTIVE, NOT JUST COMPLETE.
   Each phase must have a clear job to do.
   Each topic must move the learner measurably closer to the goal.
   Prefer concrete, outcome-oriented topics over broad textbook chapter names.
   GOOD: "Solve 8 two-pointer problems with shrinking window patterns"
   BAD: "Learn two pointers"

5. resource_queries: EXACTLY 2 per topic, highly specific.
   GOOD: "Abdul Bari stack data structure lecture"
   BAD:  "stack tutorial"
   Queries should be tailored to the exact scope of the topic, not the whole phase.

6. ai_note: ONE sentence max. Explain WHY this topic comes now.
   Reference the previous topic or prerequisite.

7. PHASE DESIGN:
   Create about {desired_phase_count} phases, unless the goal clearly needs fewer.
   Each phase should represent a meaningful milestone.
   Front-load foundations, then guided practice, then applied work/mock evaluation.
   Phase durations must be realistic and proportional to topic difficulty.

8. DOMAIN-SPECIFIC ORDERING:
   - competitive_programming: Arrays → Strings → Sorting → Hashing →
     LinkedList → Stacks/Queues → Trees → Graphs → DP → Advanced
   - academic_exam: Follow the syllabus unit order if provided.
     Weight units by typical exam marks. Skip topics the learner already knows.
   - web_development: HTML/CSS → JS fundamentals → framework → backend → database → deployment
   - data_science: Python basics → stats → pandas/numpy → visualization → ML fundamentals → advanced models
   - fitness: Assessment → foundation → progressive overload → specialisation
   - language_learning: Phonetics → grammar → vocabulary → reading → writing → conversation
   - swe_career: DSA → system design → behavioural → mock interviews

9. PERSONALISATION:
   Use the learner's prior knowledge, budget, timeline, and any supplied materials.
   If external materials were provided, align the roadmap to them where sensible.
   If the learner is time-constrained, prioritize the highest-yield sequence.

10. Total duration of all phases must equal {timeline_days} days.

── OUTPUT FORMAT ────────────────────────────────────────────

Output ONLY inside <roadmap>...</roadmap> XML tags.
Inside the tags, produce valid JSON matching this schema exactly.
No markdown fences, no explanation — just the XML-wrapped JSON.

{{
  "phases": [
    {{
      "phase_id": "phase_1",
      "title": "Phase title",
      "duration_days": 7,
      "topics": [
        {{
          "topic_id": "t1",
          "title": "Concise topic title",
          "estimated_minutes": 90,
          "ai_note": "One sentence: why this topic now.",
          "resource_queries": [
            "Specific search query 1",
            "Specific search query 2"
          ]
        }}
      ]
    }}
  ],
  "skill_nodes": [
    {{
      "name": "Skill name",
      "prerequisites": []
    }}
  ]
}}
"""


# ── 4. Resource Curation ────────────────────────────────────────────────────


def resource_curation_prompt(
    topic_title: str,
    domain: str,
    budget: str,
    *,
    goal_title: str = "",
    phase_title: str = "",
    phase_topics: list[str] | None = None,
    previous_topic_title: str = "",
    next_topic_title: str = "",
    prior_knowledge: str = "",
    domain_specific_answer: str = "",
) -> str:
    """Curate 3–4 real, high-confidence resources for a specific topic."""
    phase_topics = phase_topics or []
    phase_topic_lines = "\n".join(f"  - {title}" for title in phase_topics[:8]) if phase_topics else "  (not provided)"

    return f"""You are a learning-resource curator.  Find 3–4 real, specific
resources for the topic below that you are HIGHLY CONFIDENT actually exist.

── GOAL + PHASE CONTEXT ─────────────────────────────────────

Goal: "{goal_title or topic_title}"
Current phase: "{phase_title or 'Current phase'}"
Phase topics:
{phase_topic_lines}

Previous topic: "{previous_topic_title or 'none'}"
Current topic: "{topic_title}"
Next topic: "{next_topic_title or 'none'}"
Learner level: "{prior_knowledge or 'unknown'}"
Domain-specific learner context: "{domain_specific_answer or 'none'}"

Domain: {domain}
Budget: {budget}

── DOMAIN-SPECIFIC PREFERENCES ─────────────────────────────

competitive_programming:
  - MUST include 1-2 practice links from trusted coding platforms only:
    LeetCode, CodeChef, Codeforces, CSES, or AtCoder.
  - Prefer Abdul Bari, NeetCode, or Striver video explanations for concept learning.
  - Never use random blogs or obscure judge platforms for practice.

swe_career:
  - For DSA / interview-prep topics, MUST include 1-2 practice links from:
    LeetCode, CodeChef, Codeforces, CSES, or AtCoder.
  - Prefer NeetCode, Striver, or Abdul Bari for concept videos.
  - For system design or behavioural topics, prefer high-quality articles/videos instead of coding judges.

academic_exam:
  - Prefer NPTEL lectures, official syllabus PDFs, university materials.
  - Include previous-year question papers when relevant.

web_development:
  - Prefer official docs (MDN, React docs, Next.js docs).
  - Include free project-based tutorials (freeCodeCamp, The Odin Project).

data_science:
  - Prefer Kaggle notebooks, Scikit-learn docs, StatQuest videos.
  - Include dataset links for practice.

design:
  - Prefer Figma community files, Refactoring UI excerpts, Nielsen Norman Group articles.

language_learning:
  - Prefer Anki decks, italki, official proficiency exam guides.

fitness:
  - Prefer evidence-based sources (Jeff Nippard, AthleanX, NSCA guidelines).

entrepreneurship:
  - Prefer Y Combinator library, Indie Hackers case studies, Stratechery.

── CRITICAL RULE ────────────────────────────────────────────

Only include URLs you are CERTAIN exist as of late 2025.
If you are not sure a URL is valid, OMIT IT entirely.
It is better to return 2 solid resources than 4 with broken links.

The resources must fit THIS topic's role inside THIS phase.
Do not return generic beginner links if the topic is mid-phase or advanced.
Do not return resources that cover the entire field when the topic is narrow.
Prefer canonical, high-signal resources a serious learner would actually use.

For coding practice resources:
- ONLY use these domains: leetcode.com, codechef.com, codeforces.com, cses.fi, atcoder.jp
- Mark those as type = "practice"
- Do not include search pages, homepages, contest listing pages, or generic tag pages
- Prefer direct problem URLs that a learner can solve immediately

For YouTube:
- Only use direct watch URLs that you are highly confident are active
- Prefer established channels like NeetCode, Striver, Abdul Bari, freeCodeCamp
- If you are unsure about a video URL, omit it instead of guessing

── OUTPUT FORMAT ────────────────────────────────────────────

Return a JSON array (no wrapping object, no markdown fences):

[
  {{
    "type": "video",
    "title": "Abdul Bari — Merge Sort in 12 Minutes",
    "url": "https://www.youtube.com/watch?v=mB5HXBb_HY8",
    "source": "YouTube / Abdul Bari",
    "is_free": true
  }},
  {{
    "type": "practice",
    "title": "LeetCode — Merge Intervals",
    "url": "https://leetcode.com/problems/merge-intervals/",
    "source": "LeetCode",
    "is_free": true
  }}
]

Valid types: video | article | course | book | practice | tool | documentation
"""


def concept_resource_curation_prompt(
    topic_title: str,
    domain: str,
    budget: str,
    *,
    goal_title: str = "",
    phase_title: str = "",
    phase_topics: list[str] | None = None,
    previous_topic_title: str = "",
    next_topic_title: str = "",
    prior_knowledge: str = "",
    domain_specific_answer: str = "",
) -> str:
    """Curate concept-learning materials with a strong preference for valid videos."""
    phase_topics = phase_topics or []
    phase_topic_lines = "\n".join(f"  - {title}" for title in phase_topics[:8]) if phase_topics else "  (not provided)"

    return f"""You are a learning-resource curator. Find concept-learning resources for this topic.

Goal: "{goal_title or topic_title}"
Current phase: "{phase_title or 'Current phase'}"
Phase topics:
{phase_topic_lines}
Previous topic: "{previous_topic_title or 'none'}"
Current topic: "{topic_title}"
Next topic: "{next_topic_title or 'none'}"
Learner level: "{prior_knowledge or 'unknown'}"
Domain-specific learner context: "{domain_specific_answer or 'none'}"
Domain: {domain}
Budget: {budget}

Goal:
- Return 2 or 3 HIGH-CONFIDENCE concept resources.
- At least 2 MUST be YouTube videos when possible.
- Prefer established channels and canonical explainers.
- Make the depth match where this topic sits in the phase.
- Avoid generic introductions if the surrounding phase is already beyond basics.

For coding / DSA topics:
- Strongly prefer NeetCode, Striver, Abdul Bari, or freeCodeCamp.
- Use direct YouTube watch URLs only.

For non-coding topics:
- Prefer the best available video explainers and one strong article/doc if helpful.

Rules:
- Only include URLs you are highly confident exist.
- If unsure about a video URL, omit it.
- Do not include practice problem links here.
- It is better to return 2 solid links than 5 uncertain ones.

Return a JSON array only:
[
  {{
    "type": "video",
    "title": "Striver — Topic Explanation",
    "url": "https://www.youtube.com/watch?v=example",
    "source": "YouTube / Striver",
    "is_free": true
  }}
]
"""


def supporting_resource_curation_prompt(
    topic_title: str,
    domain: str,
    budget: str,
    *,
    goal_title: str = "",
    phase_title: str = "",
    phase_topics: list[str] | None = None,
    previous_topic_title: str = "",
    next_topic_title: str = "",
    prior_knowledge: str = "",
    domain_specific_answer: str = "",
) -> str:
    """Curate non-video support resources such as practice links, docs, or notes."""
    phase_topics = phase_topics or []
    phase_topic_lines = "\n".join(f"  - {title}" for title in phase_topics[:8]) if phase_topics else "  (not provided)"

    return f"""You are a learning-resource curator. Find support resources for this topic.

Goal: "{goal_title or topic_title}"
Current phase: "{phase_title or 'Current phase'}"
Phase topics:
{phase_topic_lines}
Previous topic: "{previous_topic_title or 'none'}"
Current topic: "{topic_title}"
Next topic: "{next_topic_title or 'none'}"
Learner level: "{prior_knowledge or 'unknown'}"
Domain-specific learner context: "{domain_specific_answer or 'none'}"
Domain: {domain}
Budget: {budget}

Goal:
- Return 2 or 3 HIGH-CONFIDENCE support resources.
- These MUST be non-video links.
- The links should be directly usable for this topic's practice or reference work.
- Prefer specific pages over broad landing pages.

For coding / DSA topics:
- Prefer direct problem links from LeetCode, CodeChef, Codeforces, CSES, or AtCoder.
- If helpful, one documentation/article link is allowed, but at least 2 should be practice-ready when possible.
- Never use random blogs or low-quality practice sites.

For non-coding topics:
- Prefer official docs, strong articles, notes, or high-quality exercises.

Rules:
- Only include URLs you are highly confident exist.
- Do not include YouTube links here.
- Avoid homepages, listing pages, and search pages.
- Prefer links the learner can use immediately.

Return a JSON array only:
[
  {{
    "type": "practice",
    "title": "LeetCode — Two Sum",
    "url": "https://leetcode.com/problems/two-sum/",
    "source": "LeetCode",
    "is_free": true
  }}
]
"""


# ── 5. Subtask Generation ───────────────────────────────────────────────────


def subtask_generation_prompt(task_raw: str, due_hours: int) -> str:
    """Break a plain-English task into 3–6 ordered, actionable subtasks."""
    return f"""You are a task-decomposition specialist.  Break the following task
into 3–6 small, ordered, actionable subtasks.

── TASK ─────────────────────────────────────────────────────

"{task_raw}"

Time available: {due_hours} hours

── RULES ────────────────────────────────────────────────────

1. Each subtask must be completable in ONE sitting (no multi-day items).
2. The sequence is LOGICAL — you cannot do step 3 before step 1.
   Example for "Build a REST API":
     1. Set up project scaffolding and install dependencies
     2. Define database models and migrations
     3. Implement CRUD endpoint handlers
     4. Write request validation and error handling
     5. Add unit tests for each endpoint
3. Total estimated minutes should not exceed {due_hours * 60}.
4. Subtask titles must start with a verb (Build, Write, Implement, …).

── OUTPUT FORMAT ────────────────────────────────────────────

Return JSON (no markdown fences, no extra text):

{{
  "estimated_total_minutes": 120,
  "subtasks": [
    {{"title": "Set up project scaffolding and install Flask", "estimated_minutes": 20}},
    {{"title": "Define SQLAlchemy models for User and Post", "estimated_minutes": 25}},
    {{"title": "Implement CRUD routes for /users and /posts", "estimated_minutes": 35}},
    {{"title": "Add input validation with Marshmallow schemas", "estimated_minutes": 20}},
    {{"title": "Write pytest tests for all endpoints", "estimated_minutes": 20}}
  ]
}}
"""


# ── 6. Mentor System Prompt ─────────────────────────────────────────────────


def mentor_system_prompt(
    goal_title: str,
    phase_title: str,
    day_index: int,
    total_days: int,
    topic_title: str,
    resources: list[dict],
    prior_knowledge: str,
    recent_skills: list[str],
    budget: str,
) -> str:
    """Return a SYSTEM PROMPT that instructs the AI how to behave as a mentor."""
    resource_lines = "\n".join(
        f"  - [{r.get('title', 'Untitled')}]({r.get('url', '')})"
        for r in resources
    ) if resources else "  (no resources loaded for today)"

    recent_str = ", ".join(recent_skills) if recent_skills else "none yet"

    return f"""You are a warm, knowledgeable mentor guiding a learner through their
personal roadmap on Stride, an AI-powered goal-execution app.

── CONTEXT (do NOT repeat this verbatim to the user) ───────

Goal: "{goal_title}"
Current phase: {phase_title}
Day: {day_index} of {total_days}
Today's topic: "{topic_title}"
Learner's prior knowledge: {prior_knowledge}
Recently acquired skills: {recent_str}
Budget: {budget}

Today's resources:
{resource_lines}

── YOUR BEHAVIOUR RULES ─────────────────────────────────────

1. EXPLAIN at the learner's level ("{prior_knowledge}").
   If they are a beginner, avoid jargon without defining it first.
   If they are advanced, skip the basics and go deep.

2. REFERENCE today's resources BY NAME AND URL.
   Example: "Start with [Abdul Bari — Merge Sort](https://...) — he walks
   through the divide step visually before the code."
   Never invent URLs.  Only mention LeetCode problem slugs if they appear in
   today's resources above.

3. TONE: a knowledgeable senior developer talking to a junior.
   Warm, editorial.  Short paragraphs.  **Bold key terms** inline.
   NO bullet-point walls.  Write prose, not lists.

4. LENGTH: 80–140 words by default.
   Expand ONLY when the user explicitly asks for more depth ("explain more",
   "go deeper", "I don't understand").

5. OVERWHELM MODE: If the user says they feel overwhelmed, stuck, or anxious,
   switch to micro-task mode.  Give them ONE tiny, concrete action:
   "Just open [this video](url) and watch the first 5 minutes. That's it."

6. NEVER invent content.  If you don't know, say so honestly.

7. PROGRESS AWARENESS: You are on day {day_index}/{total_days}.  If they are
   behind, gently acknowledge it and suggest a catch-up plan.  If they are
   ahead, celebrate briefly and offer an optional stretch challenge.

8. CONTINUITY: The learner recently covered: {recent_str}.
   Build on those skills naturally when explaining today's topic.
"""


# ── 7. Replan Prompt ────────────────────────────────────────────────────────


def replan_prompt(
    skipped_topics: list[dict],
    remaining_days: int,
    daily_hours: float,
) -> str:
    """Create a redistribution plan for skipped topics."""
    skipped_str = "\n".join(
        f"  - {t.get('topic_id', '?')}: \"{t.get('title', 'Untitled')}\" "
        f"({t.get('estimated_minutes', '?')} min, prereqs: {t.get('prerequisites', [])})"
        for t in skipped_topics
    )
    max_daily_minutes = int(daily_hours * 60)

    return f"""You are a learning-plan optimiser.  The learner skipped some topics and
needs a revised schedule that fits within their remaining time.

── SKIPPED TOPICS ───────────────────────────────────────────

{skipped_str}

── CONSTRAINTS ──────────────────────────────────────────────

Remaining days: {remaining_days}
Daily study budget: {daily_hours} hours ({max_daily_minutes} min/day)

── RULES ────────────────────────────────────────────────────

1. PRESERVE prerequisite ordering.  If topic B depends on A, B must come
   after A even in the new schedule.
2. Do not exceed {max_daily_minutes} minutes on any single day.
3. Merge related skipped topics where possible to save time.
4. If it's mathematically impossible to fit everything, drop the lowest-
   priority non-prerequisite topic and note it in the message.

── OUTPUT FORMAT ────────────────────────────────────────────

Return JSON (no markdown fences, no extra text):

{{
  "redistributed": [
    {{"topic_id": "t5", "new_day_index": 18}},
    {{"topic_id": "t6", "new_day_index": 19}},
    {{"topic_id": "t8", "new_day_index": 20}}
  ],
  "message": "Adjusted your plan around the skipped topics — your Dec 2026 goal is still on track. Picked up where the logic flows best for you."
}}

The "message" field:
- Exactly 2 sentences
- Warm, specific, reassuring — NOT generic
- Must reference the actual topics or timeline
- Good: "Moved trees and graphs to next week so you can nail recursion first — your 90-day roadmap still lands on time."
- Bad: "Don't worry, you can do it! Keep going! 💪"
"""


# ── 8. Anti-Procrastination Push Notification ────────────────────────────────


def anti_procrastination_prompt(
    topic_title: str,
    completed_count: int,
    total_count: int,
    resource_url: str,
) -> str:
    """Generate a push-notification nudge message (≤ 60 chars)."""
    return f"""You write push-notification nudges for a learning app.

── CONTEXT ──────────────────────────────────────────────────

Today's topic: "{topic_title}"
Progress: {completed_count} of {total_count} topics completed
Resource to link: {resource_url}

── RULES ────────────────────────────────────────────────────

1. Maximum 60 characters.
2. MUST reference the specific topic name (abbreviated if needed).
3. MUST mention progress (e.g. "9 of 10 done").
4. MUST end with ONE concrete micro-action (e.g. "One video, 30 min.").
5. Tone: direct, warm, editorial.  NOT generic motivational fluff.
6. NO emojis.  NO exclamation marks.

── EXAMPLES ─────────────────────────────────────────────────

GOOD:
  "Trees today — 9 of 10 done. One video, 30 min."
  "DP basics — 4 of 8 done. Solve one easy problem."
  "React hooks — 6 of 7. Read the docs, 20 min."

BAD:
  "Keep going! You can do it! 💪"
  "Don't give up now!"
  "Time to study!"

── OUTPUT FORMAT ────────────────────────────────────────────

Return JSON (no markdown fences, no extra text):

{{"message": "Trees today — 9 of 10 done. One video, 30 min."}}
"""
