// Populate MNS 521 worksheet with course content from Dariush's doc.
// APPENDS to existing activities/materials — never duplicates or removes.
// Usage:  node scripts/populate-mns521.mjs --dry    (preview)
//         node scripts/populate-mns521.mjs          (push)

const SUPABASE_URL = 'https://gflnymqjraxonbdtbxma.supabase.co';
const KEY = 'sb_publishable_di7j_DR1Ie3GJdOtHb8NlQ_rI5eiP4Y';
const COURSE_ID = 'mns521';

// ---------------------------------------------------------------------
// MATERIALS TO ADD (by module). URLs embedded in title; links[] unused by UI.
// ---------------------------------------------------------------------
const materialsToAdd = {
  1: [
    { type: 'Reading', title: 'Chapter 2 — Intelligent Agents\n2.1 Agents and Environments\n2.2 Good Behavior: The Concept of Rationality\n2.3 The Nature of Environments', objectives: [] },
    { type: 'Reading', title: 'IBM AI Overview\nhttps://www.ibm.com/topics/artificial-intelligence\nClear, non-technical definition; distinguishes AI from ML. Supports MLO 1.1, 1.5.', objectives: ['1.1','1.5'] },
    { type: 'Video', title: 'AI vs Machine Learning vs Deep Learning (IBM, ~6 min)\nhttps://www.youtube.com/watch?v=4RixMPF4xis\nClearest distinction between AI/ML/DL. Supports MLO 1.1, 1.5.', objectives: ['1.1','1.5'] },
    { type: 'Video', title: 'CrashCourse AI #1 — What is AI? (~10 min)\nhttps://www.youtube.com/watch?v=a0_lo_GDcFw\nEngaging intro to agents, history, applications. Supports MLO 1.1, 1.2.', objectives: ['1.1','1.2'] },
    { type: 'Reading', title: 'The AI Effect (Discussion Trigger)\nhttps://en.wikipedia.org/wiki/AI_effect\nPrompt: "If something becomes common, is it still AI?" Supports MLO 1.1, 1.5.', optional: true, objectives: ['1.1','1.5'] },
    { type: 'Reading', title: 'Real-World AI Applications Overview (IBM)\nhttps://www.ibm.com/topics/artificial-intelligence-use-cases\nConcrete examples across industries. Supports MLO 1.2, 1.5.', optional: true, objectives: ['1.2','1.5'] },
    { type: 'Other', title: 'Instructor-provided: Agent–Environment Diagram (Percepts → Agent → Actions). Supports MLO 1.2.', optional: true, objectives: ['1.2'] },
    { type: 'Other', title: 'Instructor-provided: PEAS Worksheet / Template. Supports MLO 1.3.', optional: true, objectives: ['1.3'] },
    { type: 'Other', title: 'Instructor-provided: Environment Classification Table (observable vs partial, deterministic vs stochastic). Supports MLO 1.4.', optional: true, objectives: ['1.4'] },
    { type: 'Lecture Slides', title: 'Instructor-provided: AI Paradigm Comparison Slide (symbolic vs statistical vs hybrid). Supports MLO 1.5.', optional: true, objectives: ['1.5'] },
  ],
  2: [
    { type: 'Website', title: 'VisuAlgo — Graph Traversal (DFS/BFS)\nhttps://visualgo.net/en/dfsbfs\nInteractive visualization of state-space search. Supports MLO 2.1, 2.2.', objectives: ['2.1','2.2'] },
    { type: 'Video', title: 'Heuristic Search (A* Intuition)\nhttps://www.youtube.com/watch?v=dRMvK76xQJI\nWhy heuristics matter, intuition-focused. Supports MLO 2.1, 2.5.', objectives: ['2.1','2.5'] },
    { type: 'Video', title: 'CSP Introduction + Backtracking\nhttps://www.youtube.com/watch?v=5R-vizbX0Yc\nVariables, domains, constraints with map-coloring / Sudoku examples. Supports MLO 2.3, 2.5.', objectives: ['2.3','2.5'] },
  ],
  3: [
    { type: 'Reading', title: 'Chapter 19 — Learning from Examples\n19.1 Forms of Learning\n19.2 Supervised Learning\n19.3 Learning Decision Trees', objectives: [] },
    { type: 'Reading', title: 'Chapter 19 — Learning from Examples\n19.4 Evaluating and Choosing Models', optional: true, objectives: [] },
    { type: 'Reading', title: 'Chapter 20 — Learning Probabilistic Models\n20.1 Learning with Complete Data\n20.2 Learning with Hidden Variables (conceptual only)', objectives: [] },
    { type: 'Reading', title: 'Chapter 20 — Learning Probabilistic Models\n20.3 EM Algorithm (high-level only)', optional: true, objectives: [] },
    { type: 'Reading', title: 'Chapter 21 — Deep Learning\n21.1 Neural Networks\n21.2 Deep Learning\n(Skip mathematical derivations)', objectives: [] },
    { type: 'Website', title: 'Visual Introduction to Machine Learning (R2D3) — CORE VISUALIZATION\nhttps://r2d3.us/visual-intro-to-machine-learning-part-1/\nInteractive, animated explanation of fitting, decision boundaries, generalization. Supports MLO 3.1, 3.2, 3.4.', objectives: ['3.1','3.2','3.4'] },
    { type: 'Video', title: 'Supervised vs Unsupervised Learning (Clear Intro)\nhttps://www.youtube.com/watch?v=IpGxLWOIZy4\nSimple visual explanation of paradigms. Supports MLO 3.1.', objectives: ['3.1'] },
    { type: 'Video', title: 'Machine Learning Explained (Conceptual Overview)\nhttps://www.youtube.com/watch?v=ukzFI9rgwfU\nHigh-level: data → model → prediction. Supports MLO 3.2.', objectives: ['3.2'] },
    { type: 'Reading', title: 'Overfitting & Underfitting (Google ML Crash Course)\nhttps://developers.google.com/machine-learning/crash-course/overfitting/overfitting\nClear explanation of overfitting, underfitting, generalization. Supports MLO 3.4.', objectives: ['3.4'] },
    { type: 'Video', title: 'Overfitting Visualization\nhttps://www.youtube.com/watch?v=EuBBz3bI-aA\nVisualizes training vs test error — directly supports assignment.', optional: true, objectives: ['3.4'] },
  ],
  4: [
    { type: 'Reading', title: 'Chapter 23 — Natural Language Processing\n23.1 Language Models (conceptual)\n23.2 Text Classification\n(Skip grammar/parsing details)', objectives: [] },
    { type: 'Reading', title: 'Chapter 24 — Deep Learning for NLP (Selective)\nHigh-level overview only (transformers conceptually)', objectives: [] },
    { type: 'Reading', title: 'Chapter 25 — Computer Vision\n25.1 Image Formation\n25.2 Early Image Processing\n25.3 Object Recognition', objectives: [] },
    { type: 'Reading', title: 'The Illustrated Transformer (Jay Alammar) — CORE VISUAL READING\nhttps://jalammar.github.io/illustrated-transformer/\nBest visual explanation of embeddings, attention, transformers. Supports MLO 4.1, 4.2.', objectives: ['4.1','4.2'] },
    { type: 'Reading', title: 'NLP in Practice (IBM)\nhttps://www.ibm.com/topics/natural-language-processing\nReal NLP tasks: chatbots, sentiment, translation. Supports MLO 4.1, 4.5.', objectives: ['4.1','4.5'] },
    { type: 'Video', title: 'What is NLP? (Short Intro)\nhttps://www.youtube.com/watch?v=fOvTtapxa9c\nClear explanation of NLP tasks. Supports MLO 4.1.', objectives: ['4.1'] },
    { type: 'Video', title: 'Transformers Explained (Simple)\nhttps://www.youtube.com/watch?v=TQQlZhbC5ps\nAttention conceptually, no math required.', optional: true, objectives: ['4.1'] },
    { type: 'Reading', title: 'Computer Vision Overview (IBM)\nhttps://www.ibm.com/topics/computer-vision\nImage classification, object detection, real-world context. Supports MLO 4.1, 4.5.', objectives: ['4.1','4.5'] },
    { type: 'Video', title: 'CNN Intuition (Best Visual Explanation)\nhttps://www.youtube.com/watch?v=YRhxdVk_sIs\nHow CNNs detect patterns — visual and intuitive. Supports MLO 4.1.', objectives: ['4.1'] },
    { type: 'Video', title: 'How Image Recognition Works\nhttps://www.youtube.com/watch?v=ArPaAX_PhIs\nFull pipeline: input → processing → output.', optional: true, objectives: ['4.1'] },
    { type: 'Video', title: 'How AI Systems Work (End-to-End)\nhttps://www.youtube.com/watch?v=2ePf9rue1Ao\nData → Model → Decision integration. Supports MLO 4.4.', objectives: ['4.4'] },
    { type: 'Website', title: 'spaCy Streamlit Demo (NLP)\nhttps://spacy.io/universe/project/spacy-streamlit\nLets students see named entity recognition with immediate feedback.', optional: true, objectives: ['4.1'] },
    { type: 'Website', title: 'Google Teachable Machine (Vision Demo)\nhttps://teachablemachine.withgoogle.com/\nHands-on model interaction, no coding required.', optional: true, objectives: ['4.1'] },
    { type: 'Other', title: 'Instructor-provided: NLP Pipeline Diagram (Text → Tokenization → Embeddings → Model → Output). Supports MLO 4.1.', optional: true, objectives: ['4.1'] },
    { type: 'Other', title: 'Instructor-provided: Vision Pipeline Diagram (Image → Feature extraction → Model → Classification). Supports MLO 4.1.', optional: true, objectives: ['4.1'] },
    { type: 'Other', title: 'Instructor-provided: System Architecture Diagram (Data → Model → Decision → Action). Supports MLO 4.2, 4.4.', optional: true, objectives: ['4.2','4.4'] },
    { type: 'Other', title: 'Instructor-provided: Symbolic vs ML-based Comparison Table. Supports MLO 4.3.', optional: true, objectives: ['4.3'] },
  ],
  5: [
    { type: 'Reading', title: 'Chapter 27 — Philosophical Foundations (Selected)\n27.1 Weak AI vs Strong AI\n27.2 Ethics and Risks of AI', objectives: [] },
    { type: 'Reading', title: 'Chapter 28 — AI: The Present and Future\nHigh-level overview', objectives: [] },
    { type: 'Reading', title: 'Ethics of AI (Foundational Overview)\nhttps://en.wikipedia.org/wiki/Ethics_of_artificial_intelligence\nBias, fairness, accountability, transparency. Supports MLO 5.1, 5.2, 5.4.', objectives: ['5.1','5.2','5.4'] },
    { type: 'Reading', title: 'Algorithmic Bias (Clear Explanation)\nhttps://en.wikipedia.org/wiki/Algorithmic_bias\nWhere bias comes from: data, design, usage. Supports MLO 5.1, 5.2.', objectives: ['5.1','5.2'] },
    { type: 'Reading', title: 'Explainable AI Overview\nhttps://en.wikipedia.org/wiki/Explainable_artificial_intelligence\nInterpretability vs explainability, black-box vs transparent. Supports MLO 5.3, 5.5.', objectives: ['5.3','5.5'] },
    { type: 'Reading', title: 'Explainable AI Tutorial (DataCamp)\nhttps://www.datacamp.com/tutorial/explainable-ai-understanding-and-trusting-machine-learning-models\nWhy explainability matters and builds trust. Supports MLO 5.3, 5.5.', objectives: ['5.3','5.5'] },
    { type: 'Video', title: 'Bias in AI (Short, Clear)\nhttps://www.youtube.com/watch?v=UG_X_7g63rY\nReal-world bias examples. Supports MLO 5.1.', objectives: ['5.1'] },
    { type: 'Video', title: 'Explainable AI (Conceptual Overview)\nhttps://www.youtube.com/watch?v=jf2gOSOR0dQ\nBlack-box problem and need for explainability. Supports MLO 5.3.', optional: true, objectives: ['5.3'] },
    { type: 'Reading', title: 'SHAP & LIME: Making AI Models Explainable\nhttps://letsdatascience.com/blog/shap-and-lime-making-ai-models-explainable\nConnects explainability to real-world decisions and legal requirements.', optional: true, objectives: ['5.3','5.5'] },
    { type: 'Reading', title: 'AI Explainability & Regulation Overview (Glacis)\nhttps://www.glacis.io/guide-ai-explainability\nReal-world regulatory requirements (GDPR, AI regs).', optional: true, objectives: ['5.4','5.5'] },
    { type: 'Reading', title: 'Ethical AI Overview\nhttps://sdlccorp.com/post/ethical-explainable-ai-build-transparent-trustworthy-models/\nEthics, explainability, trust connected.', optional: true, objectives: ['5.4','5.5'] },
    { type: 'Other', title: 'Instructor-provided: Bias Pipeline Diagram (Data → Model → Decision → Impact). Supports MLO 5.1.', optional: true, objectives: ['5.1'] },
    { type: 'Other', title: 'Instructor-provided: Fairness Comparison Table (different fairness definitions). Supports MLO 5.2.', optional: true, objectives: ['5.2'] },
    { type: 'Other', title: 'Instructor-provided: Local vs Global Explainability Diagram. Supports MLO 5.3.', optional: true, objectives: ['5.3'] },
    { type: 'Lecture Slides', title: 'Instructor-provided: Case Study Slides (loan approval, hiring, healthcare diagnosis). Supports MLO 5.4, 5.5.', optional: true, objectives: ['5.4','5.5'] },
    { type: 'Other', title: 'Instructor-provided: Responsible Design Checklist (bias, explainability, monitoring). Supports MLO 5.6.', optional: true, objectives: ['5.6'] },
  ],
  6: [
    { type: 'Reading', title: 'Chapter 26 — Robotics (Selected Examples) — suggested AIMA reading', optional: true, objectives: [] },
    { type: 'Reading', title: 'AI System Design (High-Level Overview) — IBM\nhttps://www.ibm.com/think/topics/ai-system\nData, models, decision-making components; system thinking. Supports MLO 6.1, 6.3.', objectives: ['6.1','6.3'] },
    { type: 'Reading', title: 'How to Explain ML Models to Non-Technical People\nhttps://towardsdatascience.com/how-to-explain-machine-learning-models-to-non-technical-people-1c8f6a97f0b3\nPractical strategies for clear communication. Supports MLO 6.2, 6.5.', objectives: ['6.2','6.5'] },
    { type: 'Video', title: 'How to Explain AI Simply\nhttps://www.youtube.com/watch?v=2ePf9rue1Ao\nSimplifying complex systems, using analogies. Supports MLO 6.2.', objectives: ['6.2'] },
    { type: 'Video', title: 'AI System Design Thinking (Conceptual)\nhttps://www.youtube.com/watch?v=YQdR2QyW6VY\nProblem framing and design decisions. Supports MLO 6.3, 6.4.', objectives: ['6.3','6.4'] },
    { type: 'Reading', title: 'AI System Architecture Overview (GeeksforGeeks)\nhttps://www.geeksforgeeks.org/artificial-intelligence-system-architecture/\nSimple architecture diagrams. Supports MLO 6.1.', optional: true, objectives: ['6.1'] },
    { type: 'Reading', title: 'Tradeoffs in AI Systems (Google ML Crash Course — Fairness)\nhttps://developers.google.com/machine-learning/crash-course/fairness\nAccuracy vs fairness, performance vs interpretability. Supports MLO 6.4.', optional: true, objectives: ['6.4'] },
    { type: 'Reading', title: "Explain Like I'm 5 (ELI5 Concept)\nhttps://en.wikipedia.org/wiki/Explain_like_I%27m_five\nTechnique for non-technical communication. Supports MLO 6.2.", optional: true, objectives: ['6.2'] },
    { type: 'Website', title: 'Storytelling with Data (Blog)\nhttps://www.storytellingwithdata.com/blog\nClear communication and visual explanation. Supports MLO 6.2, 6.5.', optional: true, objectives: ['6.2','6.5'] },
    { type: 'Other', title: 'Instructor-provided: AI System Architecture Template (Input → Processing → Model → Output). Supports MLO 6.1.', optional: true, objectives: ['6.1'] },
    { type: 'Other', title: 'Instructor-provided: Design Justification Template ("Why this model? Why not alternatives?"). Supports MLO 6.3.', optional: true, objectives: ['6.3'] },
    { type: 'Other', title: 'Instructor-provided: Tradeoff Analysis Framework (Option | Pros | Cons). Supports MLO 6.4.', optional: true, objectives: ['6.4'] },
    { type: 'Other', title: 'Instructor-provided: Communication Checklist (clear explanation, minimal jargon, audience awareness). Supports MLO 6.2, 6.5.', optional: true, objectives: ['6.2','6.5'] },
  ],
  7: [
    { type: 'Reading', title: 'Designing AI Systems (High-Level Integration) — IBM\nhttps://www.ibm.com/think/topics/ai-system\nData → model → decision → deployment; system integration. Supports MLO 7.1, 7.2.', objectives: ['7.1','7.2'] },
    { type: 'Reading', title: 'Responsible AI Overview (Microsoft)\nhttps://www.microsoft.com/en-us/ai/responsible-ai\nFairness, reliability, transparency; real-world design principles. Supports MLO 7.3, 7.5.', objectives: ['7.3','7.5'] },
    { type: 'Reading', title: 'ML Evaluation Overview (Google Crash Course)\nhttps://developers.google.com/machine-learning/crash-course/classification/accuracy\nEvaluation metrics and performance analysis. Supports MLO 7.3.', objectives: ['7.3'] },
    { type: 'Reading', title: 'Tradeoffs in AI Systems (Fairness vs Accuracy)\nhttps://developers.google.com/machine-learning/crash-course/fairness\nReal-world tradeoffs. Supports MLO 7.4, 7.5.', objectives: ['7.4','7.5'] },
    { type: 'Video', title: 'How AI Systems Work End-to-End\nhttps://www.youtube.com/watch?v=2ePf9rue1Ao\nComplete system flow; integration mindset. Supports MLO 7.1.', objectives: ['7.1'] },
    { type: 'Video', title: 'AI Design & Tradeoffs (Conceptual)\nhttps://www.youtube.com/watch?v=YQdR2QyW6VY\nDecision-making and tradeoffs; prepares for justification. Supports MLO 7.4.', optional: true, objectives: ['7.4'] },
    { type: 'Reading', title: 'AI Use Cases (Systems Perspective) — IBM\nhttps://www.ibm.com/topics/artificial-intelligence-use-cases\nEnd-to-end systems, domain-specific examples. Supports MLO 7.1, 7.3.', optional: true, objectives: ['7.1','7.3'] },
    { type: 'Reading', title: 'List of AI Failures (Discussion Trigger)\nhttps://en.wikipedia.org/wiki/List_of_artificial_intelligence_failures\nReal-world failures and risks of poor design. Supports MLO 7.3, 7.5.', optional: true, objectives: ['7.3','7.5'] },
    { type: 'Video', title: 'How to Present Technical Ideas Clearly\nhttps://www.youtube.com/watch?v=Unzc731iCUY\nClarity and structure; helps final presentations. Supports MLO 7.6.', objectives: ['7.6'] },
    { type: 'Other', title: 'Instructor-provided: Final Project Guidelines (problem definition, system design, evaluation, ethics). Supports all MLOs.', optional: true, objectives: [] },
    { type: 'Other', title: 'Instructor-provided: System Architecture Template (Input → Processing → Model → Output). Supports MLO 7.1.', optional: true, objectives: ['7.1'] },
    { type: 'Other', title: 'Instructor-provided: Evaluation Checklist (accuracy, fairness, robustness). Supports MLO 7.3.', optional: true, objectives: ['7.3'] },
    { type: 'Other', title: 'Instructor-provided: Tradeoff Analysis Template (Option | Pros | Cons). Supports MLO 7.4.', optional: true, objectives: ['7.4'] },
    { type: 'Other', title: 'Instructor-provided: Responsible Design Checklist (bias mitigation, explainability, monitoring). Supports MLO 7.5.', optional: true, objectives: ['7.5'] },
    { type: 'Other', title: 'Instructor-provided: Presentation Rubric (clarity, justification, structure). Supports MLO 7.6.', optional: true, objectives: ['7.6'] },
  ],
};

// ---------------------------------------------------------------------
// ACTIVITIES TO ADD (by module). "Thursday - Week N" format matches existing.
// ---------------------------------------------------------------------
const activitiesToAdd = {
  // Module 1 already has all 3 core activities.
  2: [
    { name: 'Search Modeling Assignment', objectives: ['2.1','2.2','2.5'], due: 'Thursday - Week 3', points: '', contentType: 'assignment' },
    { name: 'Planning Representation Exercise', objectives: ['2.2','2.5'], due: 'Thursday - Week 5', points: '', contentType: 'assignment' },
    { name: 'Logic & Inference Quiz', objectives: ['2.6'], due: 'Thursday - Week 6', points: '', contentType: 'quiz' },
  ],
  3: [
    { name: 'Model Behavior, Overfitting, and Generalization in ML', objectives: ['3.1','3.2','3.3','3.4','3.6'], due: 'Thursday - Week 8', points: '', contentType: 'assignment' },
    { name: 'Deep Learning Concept Check', objectives: ['3.5'], due: 'Thursday - Week 9', points: '', contentType: 'assignment' },
    { name: 'Discussion: "When NOT to Use ML"', objectives: ['3.6'], due: 'Thursday - Week 9', points: '', contentType: 'discussion' },
  ],
  4: [
    { name: 'NLP Pipeline Exploration', objectives: ['4.1','4.2'], due: 'Thursday - Week 10', points: '', contentType: 'assignment' },
    { name: 'Vision Mini-Lab', objectives: ['4.1','4.2','4.5'], due: 'Thursday - Week 10', points: '', contentType: 'assignment' },
    { name: 'Architecture Comparison Task', objectives: ['4.3','4.4'], due: 'Thursday - Week 11', points: '', contentType: 'assignment' },
    { name: 'System Analysis Reflection', objectives: ['4.4','4.5'], due: 'Thursday - Week 11', points: '', contentType: 'discussion' },
  ],
  5: [
    { name: 'Bias Audit Exercise', objectives: ['5.1','5.2'], due: 'Thursday - Week 12', points: '', contentType: 'assignment' },
    { name: 'Explainability Analysis Task', objectives: ['5.3'], due: 'Thursday - Week 12', points: '', contentType: 'assignment' },
    { name: 'Ethical Scenario Discussion', objectives: ['5.4','5.5','5.6'], due: 'Thursday - Week 13', points: '', contentType: 'discussion' },
    { name: 'Structured Discussion (Ethics)', objectives: ['5.5'], due: 'Thursday - Week 13', points: '', contentType: 'discussion' },
  ],
  6: [
    { name: 'AI Architecture Proposal Draft', objectives: ['6.1','6.3','6.4'], due: 'Thursday - Week 14', points: '', contentType: 'assignment' },
    { name: 'Peer Review Activity', objectives: ['6.2','6.4','6.5'], due: 'Thursday - Week 14', points: '', contentType: 'assignment' },
    { name: 'Proposal Presentation (Optional/Light)', objectives: ['6.2','6.5'], due: 'Thursday - Week 14', points: '', contentType: 'assignment' },
  ],
  7: [
    { name: 'Final Project', objectives: ['7.1','7.2','7.3','7.4','7.5'], due: 'Thursday - Week 15', points: '', contentType: 'assignment' },
    { name: 'Final Presentation', objectives: ['7.6'], due: 'Thursday - Week 15', points: '', contentType: 'assignment' },
  ],
};

// ---------------------------------------------------------------------
async function fetchCurrent() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/worksheets?course_id=eq.${COURSE_ID}&select=data`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const rows = await r.json();
  if (!rows.length) throw new Error('No worksheet row for ' + COURSE_ID);
  return rows[0].data;
}

function normalize(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

function merge(data) {
  data.courseActivities = data.courseActivities || {};
  data.courseMaterials = data.courseMaterials || {};

  let maxAct = 0, maxMat = 0;
  Object.values(data.courseActivities).forEach(list => list.forEach(a => {
    const n = parseInt(String(a.id||'').replace('act-',''), 10);
    if (!isNaN(n) && n > maxAct) maxAct = n;
  }));
  Object.values(data.courseMaterials).forEach(list => list.forEach(m => {
    const n = parseInt(String(m.id||'').replace('mat-',''), 10);
    if (!isNaN(n) && n > maxMat) maxMat = n;
  }));

  const report = { activitiesAdded: [], activitiesSkipped: [], materialsAdded: [], materialsSkipped: [] };

  for (const [mod, list] of Object.entries(activitiesToAdd)) {
    const existing = data.courseActivities[mod] || (data.courseActivities[mod] = []);
    const existingNames = new Set(existing.map(a => normalize(a.name)));
    for (const a of list) {
      if (existingNames.has(normalize(a.name))) {
        report.activitiesSkipped.push(`Mod ${mod}: "${a.name}"`);
        continue;
      }
      maxAct++;
      existing.push({
        id: 'act-' + maxAct,
        objectives: a.objectives || [],
        name: a.name,
        points: a.points || '',
        due: a.due || '',
        contentType: a.contentType || 'assignment',
        links: [],
        richText: '',
      });
      report.activitiesAdded.push(`Mod ${mod}: "${a.name}"`);
    }
  }

  for (const [mod, list] of Object.entries(materialsToAdd)) {
    const existing = data.courseMaterials[mod] || (data.courseMaterials[mod] = []);
    // Dedup on full title (handles Ch 2 / Ch 2.4 as distinct entries).
    const existingKeys = new Set(existing.map(m => normalize(m.title)));
    for (const m of list) {
      const key = normalize(m.title);
      if (key && existingKeys.has(key)) {
        report.materialsSkipped.push(`Mod ${mod}: "${(m.title||'').split('\n')[0].slice(0,60)}"`);
        continue;
      }
      maxMat++;
      const row = {
        id: 'mat-' + maxMat,
        type: m.type || 'Reading',
        title: m.title || '',
        links: [],
        richText: '',
        objectives: m.objectives || [],
      };
      if (m.optional) row.optional = true;
      existing.push(row);
      existingKeys.add(key);
      report.materialsAdded.push(`Mod ${mod}: "${(m.title||'').split('\n')[0].slice(0,60)}"`);
    }
  }

  return report;
}

async function push(data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/worksheets?course_id=eq.${COURSE_ID}`, {
    method: 'PATCH',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ data }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('PATCH failed: ' + r.status + ' ' + t);
  }
}

const DRY = process.argv.includes('--dry');
(async () => {
  console.log('Fetching current worksheet...');
  const data = await fetchCurrent();
  console.log('Before: activities=' + Object.values(data.courseActivities||{}).reduce((a,l)=>a+l.length,0) +
              ', materials=' + Object.values(data.courseMaterials||{}).reduce((a,l)=>a+l.length,0));

  const report = merge(data);

  console.log('\n=== ADDED ===');
  console.log(`Activities: ${report.activitiesAdded.length}`);
  report.activitiesAdded.forEach(x => console.log('  + ' + x));
  console.log(`\nMaterials: ${report.materialsAdded.length}`);
  report.materialsAdded.forEach(x => console.log('  + ' + x));

  if (report.activitiesSkipped.length || report.materialsSkipped.length) {
    console.log('\n=== SKIPPED (duplicates) ===');
    report.activitiesSkipped.forEach(x => console.log('  - ' + x));
    report.materialsSkipped.forEach(x => console.log('  - ' + x));
  }

  console.log('\nAfter: activities=' + Object.values(data.courseActivities).reduce((a,l)=>a+l.length,0) +
              ', materials=' + Object.values(data.courseMaterials).reduce((a,l)=>a+l.length,0));

  if (DRY) {
    console.log('\n[DRY RUN — no changes pushed]');
    return;
  }

  console.log('\nPushing to Supabase...');
  await push(data);
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
