// the project URL and the publishable (anon) key are meant to be public. what each person can see is
// decided by the row-level security rules in supabase/schema.sql, not by hiding this key.
export const SUPABASE_URL = "https://idpfukzvvypnwxxwdalz.supabase.co";
export const SUPABASE_KEY = "sb_publishable_TcFR1bCgLX-HNkmL5Wm4mA_an31eQsY";
export const APP_SCHEME = "com.varunaahil.macrotracker://login";

// the web address Google/Supabase send the phone browser back to; it hands the sign-in over to the app with a button tap
export const WEB_URL = "https://varun-aahil.github.io/macro-tracker/";

// the "Web application" client ID from Google Cloud (ends in .apps.googleusercontent.com). Used for the in-app Google account picker on Android.
export const GOOGLE_WEB_CLIENT_ID = "978166960077-k1gnag9bcfsak3uegg8au0i1eju2gal6.apps.googleusercontent.com";
