import { createClient } from "@supabase/supabase-js";

// 部署后在 Supabase 后台获取这两个值，填入 .env 文件
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
