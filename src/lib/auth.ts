import { supabase } from "./supabase";

// 获取当前登录用户
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

// 获取当前 session
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// 邮箱注册
export async function signUp(email: string, password: string) {
  return supabase.auth.signUp({ email, password });
}

// 邮箱登录
export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

// 登出
export async function signOut() {
  return supabase.auth.signOut();
}

// GitHub 登录
export async function signInWithGitHub() {
  return supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: window.location.origin,
    },
  });
}
