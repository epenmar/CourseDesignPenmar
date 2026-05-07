// Course-code → college / program directory for the ASU Online programs
// in Elisa's portfolio. Used by the dashboard's "Identify Course" tool.
//
// Two layers:
//   - PREFIX directory: maps a department prefix (e.g. "HSC") to the
//     home college + the programs that prefix typically lives in. Use
//     this for partial codes like "HSC" with no number, or for any
//     course whose specific number isn't in the dashboard's tracked
//     courses.
//   - SPECIFIC overrides: optional per-course entries when a single
//     course is jointly offered, cross-listed, or otherwise needs
//     more nuance than the prefix-level default. Cross-listings are
//     listed under crossListedAs.
//
// To extend: add or edit entries below. The directory tool also
// cross-references the dashboard's own tracked courses (window.allCourses)
// so anything in the user's portfolio shows up automatically with the
// course title.

window.COURSE_PREFIX_DIRECTORY = {
  'TPH': {
    college: 'School of Technology for Public Health',
    collegeShort: 'STPH',
    programs: ['MPH in Public Health Technology']
  },
  'POP': {
    college: 'College of Health Solutions',
    collegeShort: 'CHS',
    programs: ['Population Health', 'Public Health']
  },
  'BMI': {
    college: 'College of Health Solutions',
    collegeShort: 'CHS',
    programs: ['Biomedical Informatics']
  },
  'BST': {
    college: 'College of Health Solutions',
    collegeShort: 'CHS',
    programs: ['Biostatistics']
  },
  'HSC': {
    college: 'College of Health Solutions',
    collegeShort: 'CHS',
    programs: ['Health Sciences']
  },
  'EXW': {
    college: 'College of Health Solutions',
    collegeShort: 'CHS',
    programs: ['Exercise & Wellness']
  },
  'NTR': {
    college: 'College of Health Solutions',
    collegeShort: 'CHS',
    programs: ['Nutrition']
  },
  'CDE': {
    college: 'College of Health Solutions',
    collegeShort: 'CHS',
    programs: ['Communication Disorders']
  },
  'KIN': {
    college: 'College of Health Solutions',
    collegeShort: 'CHS',
    programs: ['Kinesiology']
  },
  'MNS': {
    college: 'New College of Interdisciplinary Arts and Sciences',
    collegeShort: 'NCIAS',
    programs: ['Biological Data Science (MS)']
  },
  'BIO': {
    college: 'New College of Interdisciplinary Arts and Sciences',
    collegeShort: 'NCIAS',
    programs: ['Biology / Biological Sciences']
  },
  'STP': {
    college: 'School of Technology for Public Health',
    collegeShort: 'STPH',
    programs: ['MPH in Public Health Technology']
  }
};

// Specific overrides + known cross-listings. Add a row whenever a
// course needs more detail than the prefix default, or is offered
// jointly across colleges/programs.
window.COURSE_SPECIFIC_DIRECTORY = {
  // Example shape (uncomment and fill in when a real cross-listing
  // is confirmed):
  //
  // 'POP 644': {
  //   college: 'College of Health Solutions',
  //   collegeShort: 'CHS',
  //   programs: ['Population Health'],
  //   crossListedAs: ['TPH 644 — School of Technology for Public Health']
  // }
};
