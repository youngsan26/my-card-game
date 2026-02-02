const fs = require("fs");

const config = `window.SUPABASE_CONFIG = {
  url: "${process.env.SUPABASE_URL || ""}",
  anonKey: "${process.env.SUPABASE_ANON_KEY || ""}",
};
`;

fs.writeFileSync("supabase-config.js", config);
