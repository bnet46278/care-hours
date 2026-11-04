// Care Hours settings.
//
// To turn on online sync and sharing, paste two values from your Supabase project here:
//   Supabase dashboard -> Project Settings -> API (or "API Keys")
//     supabaseUrl:     the Project URL, like https://abcdefghijkl.supabase.co
//     supabaseAnonKey: the "anon public" key or the "publishable" key (starts with eyJ... or sb_publishable_...)
//
// Both values are meant to be public. They're safe to commit to GitHub, because the
// access rules in setup.sql decide what each signed-in person can see.
// NEVER put the "service_role" or "secret" key here.
//
// Leave them empty and Care Hours works on each device only, with no sign-in.
window.CARE_HOURS_CONFIG = {
  supabaseUrl: "https://ygzaypnzkjrqdlcvghjm.supabase.co",
  supabaseAnonKey: "sb_publishable__0Fw5gI4KfGo6SEhmKEbRA_kyRkQG2k",
};
