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

// The iPhone app is in Apple's TestFlight beta. Installing: get the TestFlight app, open the invite link, sign in.

/** The TestFlight app on the App Store (step 1). */
export const TESTFLIGHT_APP_STORE_URL = "https://apps.apple.com/app/testflight/id899247664";
/**
 * The public TestFlight invite link (App Store Connect group "Publik"). Set to "" to hide it again: the iPhone section
 * then says the link is coming and points to the web app in Safari instead.
 */
export const IOS_TESTFLIGHT_URL = "https://testflight.apple.com/join/QRb1W23m";
/** The landing page section with the iPhone steps. */
export const IOS_SECTION_ID = "iphone";

// Community: the JoyoDigitama Discord server (JoyoArto, JoyoRogo, JoyoFit), with a forum per app for bug reports and
// feedback, and release announcements. Permanent invite.

/** The Discord invite. Linked from the landing page (footer, phone apps section, Android FAQ) and the More page. */
export const DISCORD_URL = "https://discord.gg/vtud8UYekp";
