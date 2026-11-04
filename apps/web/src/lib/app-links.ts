// Where to get the phone app. Plain constants (no React, no "@/" imports): the landing page, the More page and the
// prerendered crawler body in seo.ts all read them.
//
// The Android app is in Google Play's closed testing. Installing takes two steps: join the testers' Google Group (Play
// only lets group members in), then opt in on the testing page and install from Play. When the app goes public, point
// ANDROID_INSTALL_URL at the store listing and drop the group step.

/** Step 1: the testers' Google Group. Anyone can join, with the Google account they use on the phone. */
export const ANDROID_TESTERS_GROUP_URL = "https://groups.google.com/g/joyoarto-testers";
export const ANDROID_TESTERS_GROUP_EMAIL = "joyoarto-testers@googlegroups.com";
/** Step 2: the closed-test opt-in page ("Become a tester"), which then links to the Play listing. */
export const ANDROID_TESTING_URL = "https://play.google.com/apps/testing/com.joyodigitama.joyoarto";
/** The landing page section with the steps. */
export const ANDROID_SECTION_ID = "android";
