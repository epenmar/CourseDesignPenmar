// CEPH + UOEEE required-assessment mapping for the STPH MPH program.
// Source: STPH MPH CEPH Assessment Mapping documents.
//
// When the course-worksheet loads a course whose id matches one of the
// keys below (courseId is the lowercased URL slug, e.g. "tph501"), an
// alert is shown on the Assignments Overview page summarizing which
// CEPH foundational competencies and which UOEEE program-learning
// outcomes that course is responsible for assessing.
//
// To add or update mappings: edit COMPETENCY_TEXTS[framework] for the
// human-readable competency name, and add an entry to ASSESSMENTS[courseId]
// referencing the framework + competency id. assignmentTitle should match
// (or get close to) the activity name in the worksheet so the user can
// cross-reference quickly.

window.CEPH_COMPETENCY_TEXTS = {
  CEPH: {
    1:  'Apply epidemiological methods to settings and situations in public health practice',
    2:  'Select quantitative and qualitative data collection methods appropriate for a given public health context',
    3:  'Analyze quantitative and qualitative data using biostatistics, informatics, computer-based programming, and software',
    4:  'Interpret results of data analysis for public health research, policy or practice',
    5:  'Compare the organization, structure, and function of health care, public health, and regulatory systems across national and international settings',
    6:  'Discuss the means by which structural bias, social inequities and racism undermine health and create challenges to achieving health equity',
    7:  'Assess population needs, assets, and capacities that affect communities\' health',
    8:  'Apply awareness of cultural values and practices to the design, implementation, or critique of public health policies or programs',
    9:  'Design a population-based policy, program, project, or intervention',
    10: 'Explain basic principles and tools of budget and resource management',
    11: 'Select methods to evaluate public health programs',
    12: 'Discuss the policy-making process, including the roles of ethics and evidence',
    13: 'Propose strategies to identify relevant communities and individuals and build coalitions and partnerships for influencing public health outcomes',
    14: 'Advocate for political, social, or economic policies and programs that will improve health in diverse populations',
    15: 'Evaluate policies for their impact on public health and health equity',
    16: 'Apply leadership and/or management principles to address a relevant issue',
    17: 'Apply negotiation and mediation skills to address organizational or community challenges',
    18: 'Select communication strategies for different audiences and sectors',
    19: 'Communicate audience-appropriate public health content, both in writing and through oral presentation to a non-academic, non-peer audience',
    20: 'Describe the importance of cultural humility in communicating public health content',
    21: 'Integrate perspectives from other sectors and/or professions to promote and advance population health',
    22: 'Apply a systems thinking tool to visually represent a public health issue in a format other than standard narrative'
  },
  UOEEE: {
    1: 'Evaluate the technology landscape related to a public health problem',
    2: 'Develop recommendations that propose principled technological solutions for organizational public health objectives',
    3: 'Analyze how public health technologies can exacerbate or reduce health inequities across populations',
    4: 'Analyze public health datasets utilizing advanced data science techniques',
    5: 'Propose technology-enabled intervention strategies grounded in behavioral and social sciences'
  }
};

window.CEPH_REQUIRED_ASSESSMENTS = {
  'tph501': {
    courseLabel: 'TPH 501: Foundations of Public Health I',
    items: [
      { fw: 'CEPH',  cId: 2,  variant: 'qualitative', mod: 8,  title: 'Written Practical Application: Behavioral Challenges in Public Health Interview Report' },
      { fw: 'CEPH',  cId: 3,  variant: 'qualitative', mod: 8,  title: 'Written Practical Application: Behavioral Challenges in Public Health Interview Report' },
      { fw: 'CEPH',  cId: 7,                          mod: 15, title: 'Community Needs Assessment Final Project Report: Synthesizing a Public Health Challenge' },
      { fw: 'CEPH',  cId: 14,                         mod: 4,  title: 'Practical Writing Application (school board statement on autism surveillance)' },
      { fw: 'CEPH',  cId: 19, variant: 'writing',     mod: 5,  title: 'Practical Writing Application: Measles Outbreak Op-Ed for the Arizona Republic' },
      { fw: 'CEPH',  cId: 19, variant: 'oral',        mod: 6,  title: 'Practical Application: Chronic Diseases Interview Video' },
      { fw: 'CEPH',  cId: 22,                         mod: 11, title: 'Community Needs Assessment Part III (concept map)' }
    ]
  },
  'tph502': {
    courseLabel: 'TPH 502: Foundations of Public Health II',
    items: [
      { fw: 'CEPH', cId: 2,  variant: 'qualitative',  mod: 2,  title: 'Chapter 2 Case Study Analysis' },
      { fw: 'CEPH', cId: 5,  variant: 'national',     mod: 3,  title: 'Opinion Editorial Assignment' },
      { fw: 'CEPH', cId: 5,  variant: 'international', mod: 4, title: 'Health System Profile Assignment' },
      { fw: 'CEPH', cId: 8,                           mod: 8,  title: 'Discussion Prep 3 (cultural competence)' },
      { fw: 'CEPH', cId: 10,                          mod: 5,  title: 'Discussion Prep #3 (budget and resource management)' },
      { fw: 'CEPH', cId: 11,                          mod: 5,  title: 'Evaluation Plan Assignment' },
      { fw: 'CEPH', cId: 12,                          mod: 6,  title: 'Case Analysis Presentation — Current Policy Discussion' },
      { fw: 'CEPH', cId: 15,                          mod: 6,  title: 'Case Analysis Presentation — Current Policy Discussion' }
    ]
  },
  'tph551': {
    courseLabel: 'TPH 551: Public Health Technology',
    items: [
      { fw: 'CEPH',  cId: 18,         mod: 6,           title: 'Social Media Public Health Campaign' },
      { fw: 'CEPH',  cId: 21,         mod: '5 + 15',    title: 'Interview an outside-of-public-health professional (multi-part); integrated perspectives in final project' },
      { fw: 'UOEEE', cId: 1,          mod: 15,          title: 'Evaluating the Technology Landscape Paper' }
    ]
  },
  'tph552': {
    courseLabel: 'TPH 552: Systems Design and Engineering for Public Health',
    items: [
      { fw: 'CEPH',  cId: 22,         mod: 11,          title: 'Systems Modeling Assignment' },
      { fw: 'UOEEE', cId: 2,          mod: 12,          title: 'Systems Engineering Design Presentation' }
    ]
  },
  'tph553': {
    courseLabel: 'TPH 553: Health Technology and Equity',
    items: [
      { fw: 'CEPH',  cId: 6,          mod: 1,           title: 'Individual Assignment 1: Analyze and Define a Public Health Problem' },
      { fw: 'CEPH',  cId: 13,         mod: 3,           title: 'Design Research Approach Using CBPR' },
      { fw: 'UOEEE', cId: 3,          mod: 2,           title: 'Sociotechnical Analysis of a Public Health Technology' }
    ]
  },
  'tph554': {
    courseLabel: 'TPH 554: AI/ML in Public Health',
    items: [
      { fw: 'UOEEE', cId: 4,          mod: 15,          title: 'Final Project (human-centered AI/ML proposal with anticipatory justice analysis)' }
    ]
  },
  'tph555': {
    courseLabel: 'TPH 555: Health Communication, Behavior, and Technology',
    items: [
      { fw: 'CEPH',  cId: 9,          mod: 15,          title: 'Final Paper Assignment: Health Behavior Change Technology Intervention Proposal' },
      { fw: 'CEPH',  cId: 20,         mod: 6,           title: 'Case Study Analysis – Assessing Research on Health Literacy' },
      { fw: 'UOEEE', cId: 5,          mod: 15,          title: 'Written Proposal for Design Project' }
    ]
  },
  'tph557': {
    courseLabel: 'TPH 557: Ethics, Policy, and Law',
    items: [
      { fw: 'CEPH',  cId: 12,         mod: 5,           title: 'Public Health Policy Briefing Memo' },
      { fw: 'CEPH',  cId: 15,         mod: 11,          title: 'Obesity Policy Challenge Brief' },
      { fw: 'UOEEE', cId: 1,          mod: 14,          title: 'Written Analysis: Ethical and Legal Implications of an Emerging Technology' },
      { fw: 'UOEEE', cId: 3,          mod: 13,          title: 'Technology and Health Disparities — Case-Based Ethical and Legal Analysis' }
    ]
  },
  'tph591': {
    courseLabel: 'TPH 591: Entrepreneurship and Leadership for Public Health',
    items: [
      { fw: 'CEPH', cId: 16,          mod: 15,          title: 'Action Plan' },
      { fw: 'CEPH', cId: 17,          mod: 8,           title: 'Shared Solutions Lab (negotiation/mediation team exercise)' }
    ]
  },
  'pop644': {
    courseLabel: 'POP 644: Epidemiology in Population Health',
    items: [
      { fw: 'CEPH', cId: 1,                              mod: 6,  title: 'Homework 2: Epidemiologic Methods (RR, OR)' },
      { fw: 'CEPH', cId: 1,                              mod: 7,  title: 'Homework 3: Attributable Risk' },
      { fw: 'CEPH', cId: 2, variant: 'quantitative',     mod: 2,  title: 'Topic Selection and Rationale (Analytic Epi Data Analysis)' },
      { fw: 'CEPH', cId: 4,                              mod: 9,  title: 'Article 1 Review: Experimental Designs' },
      { fw: 'CEPH', cId: 4,                              mod: 10, title: 'Article 2 Review: Case-Control Study' },
      { fw: 'CEPH', cId: 4,                              mod: 11, title: 'Article 3 Review: Cohort Study' }
    ]
  },
  'bmi515': {
    courseLabel: 'BMI 515: Applied Biostatistics in Medicine and Informatics',
    items: [
      { fw: 'CEPH', cId: 3, variant: 'quantitative',     title: 'Communication Enhancement Assignment Part 3 (statistical analysis)' },
      { fw: 'CEPH', cId: 4,                              title: 'Communication Enhancement Assignment Part 3 (interpret + report findings)' }
    ]
  }
};
